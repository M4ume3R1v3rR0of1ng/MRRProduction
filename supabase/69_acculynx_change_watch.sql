-- Phase 69 — notice every change that leaves AccuLynx wrong, not just the ones the
-- browser reports.
--
-- Run after 68. Idempotent. Adds four jobs columns and one trigger; changes no data.
--
-- WHY
--
-- 68 flags "AccuLynx out of date" when the browser calls
-- acculynx-correction-notice.js after a correction. That call is the only trigger,
-- so a phone that loses signal at the moment of saving, or any future screen that
-- edits a job's materials and forgets to call it, leaves AccuLynx wrong in silence.
-- And nothing at all watched the PO: changing it on a job already synced left the
-- cost and the report on whichever AccuLynx job the old PO pointed at, which for a
-- mistyped PO can be another customer's.
--
-- This trigger records both facts in the row itself, whoever writes it, and the
-- hourly acculynx-retry-sync.js acts on them:
--
--   materials changed on a job whose cost reached AccuLynx
--       -> acculynx_check_due, with the materials as they were before the first
--          change since the last check (acculynx_items_before) as the baseline for
--          jobs synced before 68 recorded what was posted. The cron recomputes the
--          cost and flags it out of date, exactly as the browser path does.
--
--   PO changed on a job whose cost or report reached AccuLynx
--       -> acculynx_po_moved_from = the PO it was filed under. The cron checks
--          whether the two POs are really different AccuLynx jobs; if so it emails
--          the people who close jobs what to remove from the old one and sends the
--          job again under the new PO. Changing the PO back clears it. A job linked
--          by acculynx_job_id is exempt: the id, not the PO, decides where it files.
--
-- acculynx_check_seq counts changes, so a check that ran while another correction
-- landed clears only the change it actually looked at.

begin;

alter table public.jobs
  add column if not exists acculynx_check_due    boolean not null default false,
  add column if not exists acculynx_check_seq    integer not null default 0,
  add column if not exists acculynx_items_before jsonb,
  add column if not exists acculynx_po_moved_from text;

comment on column public.jobs.acculynx_check_due is
  'Materials changed after the cost reached AccuLynx; acculynx-retry-sync.js has not '
  'yet compared the new cost with AccuLynx. Set by acculynx_watch_job_changes().';
comment on column public.jobs.acculynx_check_seq is
  'Bumped on every watched change, so a check clears only what it saw.';
comment on column public.jobs.acculynx_items_before is
  'The materials before the first change since the last check. The baseline cost for '
  'a job with no acculynx_posted_amount (synced before supabase/68).';
comment on column public.jobs.acculynx_po_moved_from is
  'The PO this job''s cost and report were filed under in AccuLynx, when the PO has '
  'since changed. Cleared by the cron once handled, or by changing the PO back.';

create or replace function public.acculynx_watch_job_changes()
returns trigger
language plpgsql
as $$
declare
  cost_posted boolean :=
    old.acculynx_posted_amount is not null or old."syncStatus" = 'synced';
  anything_filed boolean := cost_posted or old.report_uploaded_at is not null;
begin
  if cost_posted
     and coalesce(new.items, new.materials) is distinct from coalesce(old.items, old.materials) then
    if not old.acculynx_check_due then
      new.acculynx_items_before := coalesce(old.items, old.materials, '[]'::jsonb);
    end if;
    new.acculynx_check_due := true;
    new.acculynx_check_seq := old.acculynx_check_seq + 1;
  end if;

  if new.po is distinct from old.po and new.acculynx_job_id is null then
    if new.acculynx_po_moved_from is not null
       and lower(trim(coalesce(new.po, ''))) = lower(trim(new.acculynx_po_moved_from)) then
      -- Put back where it was filed: nothing moved after all.
      new.acculynx_po_moved_from := null;
    elsif anything_filed and old.acculynx_po_moved_from is null then
      new.acculynx_po_moved_from := old.po;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists acculynx_watch_job_changes_trg on public.jobs;
create trigger acculynx_watch_job_changes_trg
  before update on public.jobs
  for each row execute function public.acculynx_watch_job_changes();

-- The cron asks for these every hour; they are always a handful.
create index if not exists jobs_acculynx_watch_idx
  on public.jobs (company_id)
  where acculynx_check_due or acculynx_po_moved_from is not null;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: expect 4 columns and the trigger. Both counts are 0 until something
-- changes on a synced job.
-- ─────────────────────────────────────────────────────────────────────────────
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'jobs'
           and column_name in ('acculynx_check_due', 'acculynx_check_seq',
                               'acculynx_items_before', 'acculynx_po_moved_from')) as new_columns,
       (select count(*) from pg_trigger
         where tgname = 'acculynx_watch_job_changes_trg')                        as trigger_installed,
       (select count(*) from public.jobs where acculynx_check_due)                as checks_due,
       (select count(*) from public.jobs where acculynx_po_moved_from is not null) as po_moves;
