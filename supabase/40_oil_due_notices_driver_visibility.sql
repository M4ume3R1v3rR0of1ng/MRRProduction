-- Phase 40 — let the assigned driver see their own oil-due notices.
--
-- Run after 39. Idempotent.
--
-- WHY
--
-- send-maintenance-push-notices.js was built APNs-only: the iOS push channel
-- needs an Apple Developer APNs key that isn't in place yet, and the job
-- deliberately no-ops on every run until it is (see the apnsReady check in
-- that file). In the meantime the driver should still see something — an
-- in-app banner/toast on next login (web or iOS), the same way the "your
-- vehicle is ready" banner already works off maintenance_requests.newforrequester
-- — plus an email, since the driver may not open the app that day at all.
--
-- oil_due_notices was built service-role-only in 39 (no browser reader was
-- planned yet). This adds exactly one column and one policy to change that,
-- without touching who can WRITE it — still only service_role.
--
-- WHY A driver_id COLUMN INSTEAD OF A POLICY THAT JOINS vehicles
--
-- oil_due_notices has no direct driver column; the driver is only reachable
-- by joining vehicles.assignedTo through vehicle_id. A join inside the RLS
-- policy would work, but Realtime evaluates that policy on every row change
-- to decide who to fan it out to — a denormalized driver_id keeps that check
-- a plain equality instead of a per-event subquery, and is simpler to reason
-- about. The job already reads vehicle.assignedTo for the push anyway, so
-- writing it here too costs nothing extra.
--
-- WHY ALSO vehicle_name
--
-- Same reasoning maintenance_requests.vname already established: the toast
-- needs something to call the vehicle, and denormalizing it onto the row
-- means useAppData.js's realtime handler can read row.vehicle_name directly
-- instead of looking it up in the `vehs` array — which would otherwise have
-- to be a dependency of that effect, tearing the channel down and
-- resubscribing on every fleet edit, not just on login.

begin;

alter table public.oil_due_notices
  add column if not exists driver_id uuid references auth.users(id) on delete cascade,
  add column if not exists vehicle_name text;

create index if not exists oil_due_notices_driver_id_idx
  on public.oil_due_notices (driver_id);

-- Read-only for the driver. They act on this by filing a maintenance request
-- (a separate table with its own policy, see 02_tenancy_tables.sql) — nothing
-- about this row is theirs to write. service_role still bypasses RLS entirely
-- for the job's own inserts/updates/deletes.
drop policy if exists oil_due_notices_driver_read on public.oil_due_notices;
create policy oil_due_notices_driver_read on public.oil_due_notices
  for select to authenticated
  using (driver_id = auth.uid());

-- Realtime fans out postgres_changes events per-subscriber through each
-- table's RLS, same as maintenance_requests already does (see the comment at
-- useAppData.js's "REALTIME: MAINTENANCE REQUEST LIFECYCLE" effect) — but a
-- table only streams at all once it's on this publication, which new tables
-- are not by default. duplicate_object means it's already there; fine either way.
do $$
begin
  begin
    alter publication supabase_realtime add table public.oil_due_notices;
  exception when duplicate_object then null; end;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Exactly one SELECT policy for authenticated, still no write policy:
--
--   select policyname, cmd
--   from pg_policies
--   where tablename = 'oil_due_notices';
--
--   Expect one row: oil_due_notices_driver_read, cmd = SELECT.
--
-- 2. Table is in the realtime publication:
--
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'oil_due_notices';
--
--   Expect one row back.
--
-- 3. As the driver named on a row, confirm you can read it and nothing else's:
--
--   select count(*) from public.oil_due_notices where driver_id <> auth.uid();
--
--   Expect 0.
