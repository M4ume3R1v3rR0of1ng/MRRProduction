-- Phase 13 — stop making the AccuLynx sync somebody's job.
--
-- Run after 57. Idempotent.
--
-- WHY
--
-- "Auto sync" was one attempt, in one browser tab, at the instant a crew pressed
-- Complete in Pull Inventory. One shot, and no second one existed anywhere: a
-- completed job drops off Pull Inventory by design, so the crew had nothing left to
-- press, and the only other trigger in the app is Close Job in Build Jobs, gated on
-- jobs_close. A warehouse lead without that permission could watch a job sit
-- unsynced forever and do nothing at all about it. Meanwhile every expense this
-- integration sent before 2026-10-23 was refused outright (isPaid with no
-- accountTypeId — AccuLynx answers 500), so the jobs needing a retry are not an
-- edge case, they are most of the history.
--
-- netlify/functions/acculynx-retry-sync.js is that second attempt, hourly, with no
-- session and no permission involved. This migration gives it the three things it
-- needs: somewhere to count attempts, a way to find the jobs that are due, and a
-- counter that resets itself when a human fixes the thing that was wrong.
--
-- WHAT IS NEW, AND WHAT DELIBERATELY IS NOT
--
-- No new status column. "syncStatus"/"syncedAt"/"syncNote" and report_uploaded_at
-- already say what reached AccuLynx (see supabase/28), and the cron writes exactly
-- the same four. Adding a parallel set for the server's opinion is how one fact
-- ends up with two spellings — the debt 15_jobs_schema_debt.sql exists to clear.
-- What genuinely has no column yet is how often we have TRIED, which is the only
-- thing standing between a permanently-broken PO and an unbounded retry loop.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Attempt bookkeeping.
--
--    NOT NULL DEFAULT 0 so every existing row joins the queue at attempt zero —
--    including the jobs stuck since before the expense fix, which is the point.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.jobs
  add column if not exists sync_attempts        integer not null default 0,
  add column if not exists sync_last_attempt_at timestamptz;

comment on column public.jobs.sync_attempts is
  'How many times the server has tried to send this job to AccuLynx. The cron gives '
  'up at 8 (MAX_ATTEMPTS in acculynx-retry-sync.js) so a PO that matches no AccuLynx '
  'job is not retried forever. Reset to 0 whenever the PO or acculynx_job_id changes.';
comment on column public.jobs.sync_last_attempt_at is
  'When the last server attempt ran. Drives the backoff: 1h, 2h, 4h, 8h, capped at a '
  'day. NULL means never tried by the server, which is due immediately.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A fixed PO goes back in the queue.
--
--    The cron burns all 8 attempts at once on a 404, because a PO that matches no
--    AccuLynx job will still match none in an hour and there is nothing to learn
--    from asking again. That is right, and it would also be a trap: the fix for a
--    404 is to correct the PO, and without this the corrected job would stay
--    retired. So the counter belongs to the (po, acculynx_job_id) pair, not to the
--    job — change either and the history of failures no longer applies.
--
--    SECURITY INVOKER (the default) is fine here, unlike enforce_job_perms: this
--    trigger reads nothing and grants nothing, it only clears two counters.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reset_job_sync_attempts()
returns trigger
language plpgsql
as $$
begin
  if new.po is distinct from old.po
     or new.acculynx_job_id is distinct from old.acculynx_job_id then
    new.sync_attempts        := 0;
    new.sync_last_attempt_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_job_sync_attempts_trg on public.jobs;
create trigger reset_job_sync_attempts_trg
  before update on public.jobs
  for each row execute function public.reset_job_sync_attempts();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Which jobs still owe AccuLynx something?
--
--    This is an RPC rather than a query in the function for two reasons. The
--    comparison is against "syncStatus", a quoted camelCase column, and spelling
--    that correctly inside a PostgREST `or=(…)` filter is a guess that fails
--    silently by matching nothing — the worst possible failure for a job queue.
--    And the rule itself ("completed or closed, not synced, not given up on") is
--    worth having in one place with a name.
--
--    NULL "syncStatus" is INCLUDED: never attempted is not the same as synced, and
--    `<> 'synced'` alone would drop every one of those rows. That conflation is the
--    exact bug supabase/28 was written to end.
--
--    Crosses every company on purpose — there is no caller to scope to — so it is
--    granted to service_role ONLY. authenticated must never reach it: it would hand
--    one tenant a list of another tenant's jobs.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.acculynx_sync_candidates(max_attempts integer, lim integer)
returns setof public.jobs
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select *
    from public.jobs
   where status in ('completed', 'closed')
     and ("syncStatus" is null or "syncStatus" <> 'synced')
     and sync_attempts < max_attempts
   -- Oldest finished first, so a backlog drains in the order the crews actually
   -- finished the work. `completed` is the app's own ISO text stamp and is '' on a
   -- job that never carried one, which is why it is nullif'd rather than trusted.
   order by coalesce(nullif(completed, ''), created) asc nulls last
   limit lim;
$$;

revoke all on function public.acculynx_sync_candidates(integer, integer) from public;
revoke all on function public.acculynx_sync_candidates(integer, integer) from authenticated;
grant execute on function public.acculynx_sync_candidates(integer, integer) to service_role;

comment on function public.acculynx_sync_candidates(integer, integer) is
  'Jobs a human has finished that AccuLynx has not fully received. service_role only '
  '— it spans tenants by design. Backoff between attempts is applied by the caller '
  '(nextAttemptDue in netlify/functions/acculynx-retry-sync.js).';

-- Covers the candidate scan without carrying the already-synced majority, which is
-- the set that grows forever. 28 added jobs_report_not_uploaded_idx for the related
-- "whose paperwork is missing" question; this one is keyed to the retry queue's own
-- predicate so the scan stays on the rows that still owe something.
create index if not exists jobs_sync_retry_queue_idx
  on public.jobs (status, sync_attempts)
  where "syncStatus" is null or "syncStatus" <> 'synced';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A warehouse lead may close a job.
--
--    Closing IS filing: Close Job in Build Jobs is the one place a person can make
--    the sync happen on demand, and withholding it from the warehouse meant the
--    people who actually finish the jobs could not retry their own paperwork. With
--    the cron above they no longer HAVE to — but "the machine will get to it within
--    the hour" is not an answer to someone standing in front of an office that
--    needs the cost posted now.
--
--    Both halves of the resolver have to agree or the UI and the database disagree
--    about who may do what: default_job_perms() here, DEFAULT_ROLE_PERMS in
--    src/shared/database/permissions.js. Keep them in sync.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.default_job_perms(role text)
returns jsonb
language sql
immutable
as $$
  select case role
    when 'coordinator' then '{"jobs_build":true,"jobs_approve":true,"jobs_pull":true,"jobs_complete":true,"jobs_close":true}'::jsonb
    when 'manager'     then '{"jobs_build":true,"jobs_approve":true,"jobs_pull":true,"jobs_complete":true,"jobs_close":true}'::jsonb
    -- jobs_close flipped here, in 58. Everything else is unchanged from 12.
    when 'warehouse'   then '{"jobs_build":false,"jobs_approve":false,"jobs_pull":true,"jobs_complete":true,"jobs_close":true}'::jsonb
    when 'field'       then '{"jobs_build":false,"jobs_approve":false,"jobs_pull":true,"jobs_complete":true,"jobs_close":false}'::jsonb
    when 'bookkeeper'  then '{"jobs_build":false,"jobs_approve":false,"jobs_pull":false,"jobs_complete":false,"jobs_close":true}'::jsonb
    else '{"jobs_build":false,"jobs_approve":false,"jobs_pull":false,"jobs_complete":false,"jobs_close":false}'::jsonb
  end;
$$;

-- The default above only reaches a company that has never saved its permissions:
-- has_perm() reads coalesce(user override, stored role row, default), and a stored
-- row's explicit `"jobs_close": false` wins over any default we ship. Every company
-- that has opened Settings → Permissions once has such a row.
--
-- So the stored row needs updating too — and ONLY for the company that asked. The
-- other tenants are customers; their admins decide who closes jobs there, and
-- quietly granting their warehouse staff the right to archive a job is not a
-- decision this migration gets to make on their behalf. They get the new default
-- when they next reset the role, and the toggle in Settings either way.
update public.role_permissions rp
   set permissions = rp.permissions || '{"jobs_close":true}'::jsonb,
       updated_at  = now()
  from public.companies c
 where c.id = rp.company_id
   and c.slug = 'maumee-river-roofing'
   and rp.role = 'warehouse'
   and coalesce((rp.permissions ->> 'jobs_close')::boolean, false) = false;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
-- queue_depth is the backlog the cron will work through at 8 jobs an hour. Expect
-- it to be most of the completed history on the first run — every expense before
-- 2026-10-23 was refused — and to fall to a handful within a day.
--
-- given_up should stay at 0. Anything there is a PO that matches no AccuLynx job:
-- read its "syncNote", fix the PO in Build Jobs, and the trigger above puts it back
-- in the queue on its own.
-- ─────────────────────────────────────────────────────────────────────────────
select count(*)                                                    as finished_jobs,
       count(*) filter (where "syncStatus" = 'synced')              as synced,
       count(*) filter (where ("syncStatus" is null
                              or "syncStatus" <> 'synced')
                          and sync_attempts < 8)                    as queue_depth,
       count(*) filter (where sync_attempts >= 8
                          and "syncStatus" <> 'synced')              as given_up
  from public.jobs
 where status in ('completed', 'closed');

select role, permissions ->> 'jobs_close' as jobs_close
  from public.role_permissions rp
  join public.companies c on c.id = rp.company_id
 where c.slug = 'maumee-river-roofing'
 order by role;
