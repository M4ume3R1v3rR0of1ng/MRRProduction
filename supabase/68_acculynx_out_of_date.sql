-- Phase 68 — say so when AccuLynx no longer matches a corrected job.
--
-- Run after 67. Idempotent. Adds three nullable columns; changes no data.
--
-- WHY
--
-- Steadwerk posts a job's material cost to AccuLynx once, when the job is
-- completed. Correct Pulled Materials (51), Correct Return (35) and a late top-up
-- (57) then fix the job inside Steadwerk and, by design, never touch AccuLynx
-- again: a second post would sit beside the first, because the duplicate guard
-- recognises an earlier expense by its exact amount and a corrected job has a new
-- one. So an audit that finds "took 5, really 4" left AccuLynx quietly wrong, and
-- somebody had to notice and work out the new figure by hand.
--
-- netlify/functions/acculynx-correction-notice.js now runs after each of those
-- corrections. When the job's cost was already posted and the corrected total is
-- different, it records both figures here, files a REVISED report on the AccuLynx
-- job, and emails the people who close jobs (jobs_close) exactly what to change.
-- Build Jobs shows "AccuLynx out of date" until one of them presses
-- "Updated in AccuLynx".
--
-- THE THREE COLUMNS
--
--   acculynx_posted_amount   What our expense line in AccuLynx says. Written when
--                            the cost posts, and moved to the corrected figure
--                            when someone confirms they changed it. NULL on jobs
--                            synced before this file: the first correction fills
--                            it from the job as it stood before that correction.
--   acculynx_correct_amount  What it should say now. NULL means nothing is owed.
--   acculynx_out_of_date_at  When it went out of date, for the badge and the log.

begin;

alter table public.jobs
  add column if not exists acculynx_posted_amount  numeric(12, 2),
  add column if not exists acculynx_correct_amount numeric(12, 2),
  add column if not exists acculynx_out_of_date_at timestamptz;

comment on column public.jobs.acculynx_posted_amount is
  'Material cost on Steadwerk''s expense line in AccuLynx (tax included). Set when the '
  'cost posts and when someone confirms they corrected it. NULL for jobs synced before '
  'supabase/68. While set, a sync skips the cost half so it cannot post a second line.';
comment on column public.jobs.acculynx_correct_amount is
  'The corrected material cost AccuLynx should show. NULL when AccuLynx matches. '
  'Written by acculynx-correction-notice.js after a correction on a synced job.';
comment on column public.jobs.acculynx_out_of_date_at is
  'When a correction left AccuLynx showing the old cost. Cleared with '
  'acculynx_correct_amount.';

-- The Build Jobs list asks "which jobs need AccuLynx updating", and the answer is
-- always a handful out of thousands.
create index if not exists jobs_acculynx_out_of_date_idx
  on public.jobs (company_id)
  where acculynx_correct_amount is not null;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: expect 3 columns. out_of_date is 0 until the first correction.
-- ─────────────────────────────────────────────────────────────────────────────
select count(*) filter (where column_name in
         ('acculynx_posted_amount', 'acculynx_correct_amount', 'acculynx_out_of_date_at'))
         as new_columns,
       (select count(*) from public.jobs where acculynx_correct_amount is not null)
         as out_of_date
  from information_schema.columns
 where table_schema = 'public' and table_name = 'jobs';
