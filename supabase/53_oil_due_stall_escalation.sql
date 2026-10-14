-- Phase 53 — a filed maintenance request PAUSES the oil-due escalation; it no
-- longer silences it for good.
--
-- Run after 52. Idempotent.
--
-- THE PROBLEM
--
-- send-maintenance-push-notices.js escalates a truck whose oil change is
-- projected overdue, daily, until somebody files an oil-change maintenance
-- request. Filing one set oil_due_notices.resolved_at, and resolved_at was read
-- as "done, never speak of this cycle again":
--
--   if (notice?.resolved_at) return { action: "none" };
--
-- Nothing in that sentence is true. Filing a request is a statement of intent,
-- not an oil change. The actual oil change is recorded by logging the service,
-- which moves vehicles.lomi — and THAT is already handled, by the staleCycle
-- check that compares the stored cycle_lomi against the vehicle's live lomi and
-- clears the cycle when they differ. So the only thing resolved_at ever did was
-- hide a truck for which a request had been opened and then forgotten, which is
-- the single most likely way for this to go wrong: drivers file late, managers
-- forget to approve, shops reschedule, and the truck keeps moving the whole
-- time on oil that is past its interval.
--
-- THE RULE THIS IMPLEMENTS
--
--   * Filing an oil-change request pauses escalation for 3 days.
--   * Still open on day 4 — escalation resumes, daily, to the FLEET MANAGER
--     (the holders of fleet_edit; see netlify/functions/_shared/fleetRecipients.js).
--   * Still open on day 14 — the request is auto-closed as `expired`, and from
--     the next run the full overdue escalation (driver AND manager) resumes,
--     because as far as the system can tell nobody is working on it at all.
--   * Nothing but a recorded oil change ends the cycle. That has not changed.
--
-- WHY resolved_at IS RENAMED AND NOT JUST REINTERPRETED
--
-- Under the new rule the column records when escalation was PAUSED by a request,
-- and a pause is temporary by definition. Leaving the name as `resolved_at`
-- would leave the old claim sitting in the schema for the next person to read
-- and believe — and the whole bug above came from believing it. The rename is
-- the fix; the new column next to it only holds the once-per-day cap.
--
-- ⚠️ DEPLOY THIS MIGRATION AND THE FUNCTION TOGETHER. The currently deployed
--    send-maintenance-push-notices.js writes `resolved_at`, so between the two
--    its nightly upsert fails on an unknown column. It self-corrects on the
--    next run after the function ships: every decision that job makes is
--    derived from the vehicle and the stored row, never from "did last night
--    work", so a missed night costs one day of notices and nothing else.
--
-- WHY stall_last_sent_at AND NOT REUSING urgent_last_sent_at
--
-- They cap two different notices with two different audiences, and the job has
-- to be able to tell them apart on the next run. A stall notice goes to the
-- manager alone (the driver already did the one thing being asked of them —
-- they filed the request); the urgent notice goes to driver and manager both.
-- One shared timestamp would make a stall notice suppress the following day's
-- urgent escalation after the request was closed, which is precisely the
-- silence this migration exists to remove.

begin;

-- ── oil_due_notices ─────────────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'oil_due_notices'
      and column_name = 'resolved_at'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'oil_due_notices'
      and column_name = 'paused_at'
  ) then
    alter table public.oil_due_notices rename column resolved_at to paused_at;
  end if;
end $$;

-- For a database that somehow has neither (a fresh install that skipped 39's
-- original column, or a hand-repaired table) — the rename above is a no-op
-- there, so the column still has to exist.
alter table public.oil_due_notices
  add column if not exists paused_at timestamptz,
  add column if not exists stall_last_sent_at timestamptz;

comment on column public.oil_due_notices.paused_at is
  'When an open oil-change maintenance request paused this escalation cycle. A '
  'PAUSE, not a resolution: escalation resumes to the fleet manager once the '
  'grace window lapses (see send-maintenance-push-notices.js). Only a recorded '
  'oil change — a change to vehicles.lomi — ends a cycle.';

comment on column public.oil_due_notices.stall_last_sent_at is
  'Last manager-only "request stalled" notice for this cycle. Caps that notice '
  'at one per day without suppressing the separate driver+manager urgent '
  'notice, which has its own urgent_last_sent_at.';

-- ── maintenance_requests.status gains 'expired' ─────────────────────────────
--
-- No DDL: status is free text with no check constraint, which is how 'pending',
-- 'scheduled' and 'completed' got there too. Recorded as a comment so the set
-- of values a reader can expect is written down somewhere, since the app's own
-- status badge falls through to the raw string for anything it does not know.
--
-- 'expired' is terminal and means "opened, never acted on, and no oil change
-- was ever recorded against the vehicle". It is deliberately NOT 'completed':
-- nothing was completed, and letting it land in the completed bucket would put
-- a service that never happened into the vehicle's history and the maintenance
-- reports.

comment on column public.maintenance_requests.status is
  'pending | scheduled | completed | expired. `expired` is written only by '
  'send-maintenance-push-notices.js, for an oil-change request left open 14 '
  'days past filing with no oil change recorded — see supabase/53.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The rename landed and the new cap column exists, and resolved_at is gone:
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'oil_due_notices'
--     and column_name in ('paused_at', 'stall_last_sent_at', 'resolved_at');
--
--   Expect exactly two rows: paused_at and stall_last_sent_at.
--
-- 2. Nothing was lost in the rename — rows that were paused still say so:
--
--   select count(*) from public.oil_due_notices where paused_at is not null;
--
-- 3. The table is still service-role-only for writes, and the driver's read
--    policy still stands (neither should have been touched):
--
--   select policyname, cmd from pg_policies where tablename = 'oil_due_notices';
--
--   Expect one row: oil_due_notices_driver_read, cmd = SELECT.
--
-- 4. No request is already expired (this migration writes none; the nightly
--    job does):
--
--   select status, count(*) from public.maintenance_requests group by status;
