-- Phase 12 — actually write down what reached AccuLynx.
--
-- Run after 27. Idempotent.
--
-- WHY
--
-- "syncStatus", "syncedAt", "syncNote" and "syncPayload" have existed on this
-- table since before the migration files did. Nothing has ever written to them.
-- attemptAccuLynxSync() put the result into React state via setJobs() and stopped,
-- and BuildJobsView inserts all four as null/"" on every new job, so the columns
-- are present, correct, and empty on all 21 rows.
--
-- The consequence was a visible lie. The sync modal read `syncStatus === 'manual'
-- || !syncStatus` as "AccuLynx is not configured", and since the value was ALWAYS
-- absent after a page load, every completed job told a correctly-configured
-- company to go configure AccuLynx. The modal now separates the states, and this
-- migration gives it something durable to read.
--
-- WHY NO sync_status / synced_at / sync_note COLUMNS
--
-- Adding snake_case twins of four columns that already exist is precisely the debt
-- 15_jobs_schema_debt.sql was written to clear: two columns for one fact, readers
-- coalescing across both, and a slow drift about which one is true. The existing
-- camelCase columns are the storage. Only genuinely new facts get new columns.
--
-- WHAT IS ACTUALLY NEW
--
-- The completion report PDF now uploads to the job's Documents folder in AccuLynx.
-- Whether that happened is a different fact from whether the cost expense posted —
-- different endpoint, different failure mode, either can land without the other —
-- and there is no existing column for it. Without report_uploaded_at the only way
-- to learn whether a job's paperwork is already filed is to upload it again, which
-- files a second copy.

begin;

alter table public.jobs
  add column if not exists report_uploaded_at timestamptz,
  add column if not exists report_file_name   text;

-- Only the three states the app branches on, plus NULL for never-attempted. A
-- typo'd status falls through every UI branch and renders as nothing, so the
-- database refuses it rather than letting it show up as a blank badge.
--
--   synced  report PDF filed on the AccuLynx job
--   failed  attempted, AccuLynx or the network refused
--   manual  no usable AccuLynx config; the office files it by hand
--   NULL    never attempted
--
-- Safe to add against live data: the writer never existed, so every row is NULL.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_sync_status_known') then
    alter table public.jobs
      add constraint jobs_sync_status_known
      check ("syncStatus" is null or "syncStatus" in ('synced', 'failed', 'manual'));
  end if;
end $$;

comment on column public.jobs."syncStatus" is
  'Result of the last AccuLynx report upload. NULL = never attempted, which is NOT '
  'the same as "not configured" — conflating those two was the bug this migration ends.';
comment on column public.jobs."syncedAt" is
  'ISO timestamp of the last successful upload. Empty/NULL while never sent.';
comment on column public.jobs."syncNote" is
  'Human-readable outcome or error text from the last sync attempt.';
comment on column public.jobs."syncPayload" is
  'Unused. The outbound payload is recomputable from the job''s own items, so it is '
  'built on demand for the retry modal rather than stored and left to drift.';
comment on column public.jobs.report_uploaded_at is
  'When the completion report PDF was last filed on the AccuLynx job as a document. '
  'NULL = never uploaded. This is what makes "already filed?" answerable without '
  'uploading a second copy to find out.';
comment on column public.jobs.report_file_name is
  'File name AccuLynx stored, after its own stripping of spaces and punctuation.';

-- "Which finished jobs still have no paperwork in the CRM" is the question this
-- gets asked most. Partial, so the growing set of already-filed jobs stays out.
create index if not exists jobs_report_not_uploaded_idx
  on public.jobs (company_id, status)
  where report_uploaded_at is null;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
-- Expect with_sync_result = 0 and report_filed = 0 on the first run: no code has
-- ever written these. Both should start climbing as jobs are completed. A job that
-- reached AccuLynx before today is indistinguishable from one that did not,
-- because nobody wrote it down — this is the last time that is true.
-- ─────────────────────────────────────────────────────────────────────────────
select count(*)                                         as completed_jobs,
       count("syncStatus")                              as with_sync_result,
       count(*) filter (where "syncStatus" = 'synced')  as synced,
       count(*) filter (where "syncStatus" = 'failed')  as failed,
       count(report_uploaded_at)                        as report_filed
from public.jobs
where status in ('completed', 'closed');
