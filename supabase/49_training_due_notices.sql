-- Phase 49 — reminders for an assigned clip: a heads-up before the deadline and
-- a daily nudge once it has passed.
--
-- Run after 48. Idempotent.
--
-- WHY
--
-- 48 put a due date on an assignment and showed it inside the app. That only
-- reaches someone who opens the app, which is exactly the person who did not
-- need reminding. Nothing went out when a deadline approached and nothing at all
-- happened when one passed, so an overdue assignment just sat there being
-- overdue.
--
-- WHAT THIS DOES
--
-- 1. TWO SENT-STAMPS on the assignment itself, rather than a parallel notices
--    table like oil_due_notices (38-40). That table exists because an oil cycle
--    reopens every time the oil is changed, so "which cycle was this notice
--    about" needs its own row. A training assignment has no cycles: one
--    deadline, one heads-up, done when completed_at lands. The stamps belong on
--    the row they describe.
--
--      heads_up_sent_at      the "due in N days" notice went out (once, ever)
--      overdue_last_sent_at  the last overdue nudge, which caps it to one a day
--
-- 2. A FIX TO 48'S GUARD TRIGGER. As written, training_assignment_guard()
--    refused any update but completed_at from anyone it did not recognise as an
--    admin — and it recognises an admin by reading active_role(), which is a JWT
--    claim. A service_role request has no such claim, so the nightly cron
--    stamping heads_up_sent_at would have been rejected by its own database.
--    Migration 12's enforce_job_perms() already set the pattern for this:
--    current_user tells a browser request ('authenticated') from a trusted
--    backend one (service_role from the Netlify functions, postgres from a
--    migration), and only the browser is gated. 48 should have done the same.
--
--    This widens nothing for a crew member: 'authenticated' is still held to
--    completed_at, which is the whole point of the guard.
--
-- 3. REALTIME on training_assignments, so a reminder landing — or an admin
--    assigning something while the crew member is looking at the app — reaches
--    the open tab instead of waiting for a reload. Same mechanism supabase/40
--    gave oil_due_notices and 41 gave chat_messages. The row-level policy from
--    48 still applies to the stream: a member only ever receives their own rows.

begin;

alter table public.training_assignments
  add column if not exists heads_up_sent_at     timestamptz,
  add column if not exists overdue_last_sent_at timestamptz;

comment on column public.training_assignments.heads_up_sent_at is
  'When the "due in N days" notice went out. Set once and never cleared — the '
  'heads-up is a single event, unlike the overdue nudge. See supabase/49.';

comment on column public.training_assignments.overdue_last_sent_at is
  'When the most recent overdue nudge went out. Compared against today to cap '
  'the escalation at one send per day. See supabase/49.';

-- Only unfinished, dated rows are ever swept, and the sweep runs across every
-- company at once (the cron has no active company), so this index deliberately
-- leads with due_on rather than company_id.
create index if not exists training_assignments_sweep_idx
  on public.training_assignments (due_on, heads_up_sent_at, overdue_last_sent_at)
  where completed_at is null and due_on is not null;

-- ── 48's guard, with the trusted-backend bypass it should have had ───────────
-- Still SECURITY INVOKER: it has to see the CALLER, both to read current_user
-- here and to evaluate active_role() below. A definer would report the owner for
-- both and enforce nothing.
create or replace function public.training_assignment_guard()
returns trigger
language plpgsql
as $$
declare
  is_admin boolean;
begin
  -- Trusted backend paths pass straight through: service_role is the Netlify
  -- functions (the nightly sweep stamping its own sent-markers), postgres is a
  -- migration or a backfill. Same line, and the same reasoning, as
  -- enforce_job_perms() in supabase/12. Only a browser session is gated.
  if current_user <> 'authenticated' then
    return new;
  end if;

  is_admin := public.is_platform_admin()
    or (new.company_id = public.active_company_id() and public.active_role() = 'admin');

  if tg_op = 'INSERT' then
    -- Rule 1: the clip has to be one this company can see.
    if not exists (
      select 1 from public.training_media tm
      where tm.id = new.media_id
        and (tm.is_global or tm.company_id = new.company_id)
    ) then
      raise exception
        'Cannot assign a training clip this company cannot see (media_id %)', new.media_id
        using errcode = 'check_violation';
    end if;

    -- Rule 2: the assignee has to actually be in the company.
    if not exists (
      select 1 from public.memberships m
      where m.user_id = new.user_id
        and m.company_id = new.company_id
        and m.active
    ) then
      raise exception
        'Cannot assign training to someone who is not an active member of this company'
        using errcode = 'check_violation';
    end if;

    return new;
  end if;

  if is_admin then
    return new;
  end if;

  -- The assignee. completed_at is theirs to move; the sent-stamps from this
  -- migration are the sweep's, and are listed here so a crafted PATCH cannot
  -- suppress its own reminder by backdating one.
  if new.id                   is distinct from old.id
  or new.company_id           is distinct from old.company_id
  or new.media_id             is distinct from old.media_id
  or new.user_id              is distinct from old.user_id
  or new.due_on               is distinct from old.due_on
  or new.assigned_by          is distinct from old.assigned_by
  or new.assigned_by_name     is distinct from old.assigned_by_name
  or new.assigned_at          is distinct from old.assigned_at
  or new.heads_up_sent_at     is distinct from old.heads_up_sent_at
  or new.overdue_last_sent_at is distinct from old.overdue_last_sent_at then
    raise exception
      'Only completed_at may be changed on your own training assignment'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- ── Realtime ────────────────────────────────────────────────────────────────
-- A table only streams once it is on this publication. Guarded because adding a
-- table already present raises, which would break re-running this file.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'training_assignments'
  ) then
    alter publication supabase_realtime add table public.training_assignments;
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   select column_name from information_schema.columns
--   where table_name = 'training_assignments'
--     and column_name in ('heads_up_sent_at','overdue_last_sent_at');
--   -- Expect both.
--
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'training_assignments';
--   -- Expect one row.
--
--   select prosecdef from pg_proc
--   where proname = 'training_assignment_guard' and pronamespace = 'public'::regnamespace;
--   -- Expect false. A definer here reports the OWNER for current_user and would
--   -- treat every browser request as a trusted backend one.
--
--   -- The bypass this file exists for, checked from the SQL editor (which
--   -- connects as postgres, i.e. a trusted path):
--   --   update public.training_assignments set heads_up_sent_at = now()
--   --   where id = '<some row>';
--   -- Expect UPDATE 1. Before this migration the same statement raised
--   -- 'Only completed_at may be changed on your own training assignment'.
-- ─────────────────────────────────────────────────────────────────────────────
