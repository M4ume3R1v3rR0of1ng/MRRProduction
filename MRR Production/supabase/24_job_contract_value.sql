-- Phase 11 — give a job a real contract value.
--
-- Run after 23. Idempotent.
--
-- WHY
--
-- The Job Profitability report computed revenue as `estimatedMaterialCost * 3.2`.
-- Nothing in this database has ever held what a job was sold for, so that
-- multiplier WAS the revenue: an invented number, printed in a currency column
-- and exported to CSV.
--
-- It was rigged as well as invented. With revenue defined as 3.2x the estimate, a
-- job that spends exactly its estimate reports (3.2e - e) / 3.2e = 68.75% margin
-- every time, and the report's "healthy" trophy threshold was 65%. A job only
-- lost its trophy by overrunning materials more than 12%, so the report praised
-- almost everything, and the thing it actually measured was materials variance.
--
-- This column is where the real number goes.
--
-- WHY numeric(12,2) AND NOT double precision
--
-- Money. float8 cannot represent 0.10 exactly, so sums drift — and this value is
-- summed across jobs for portfolio margin. numeric is exact decimal arithmetic.
-- 12 digits carries a job up to 9,999,999,999.99, which is far past any roof.
--
-- WHY NULLABLE, AND WHY NO DEFAULT
--
-- NULL means "nobody has entered this yet", and the app renders it as "not set".
-- A DEFAULT 0 would be actively harmful: every historical job would read as a
-- total loss, and the code cannot distinguish "sold for nothing" from "not filled
-- in". src/utils/jobCosting.js treats 0 as unset for the same reason, since an
-- empty HTML number input posts as 0.
--
-- The 21 existing jobs stay NULL. They are excluded from margin rather than
-- dragging it to -100%, and the report shows how many are unpriced so the gap is
-- visible instead of quietly shrinking the denominator.

begin;

alter table public.jobs
  add column if not exists contract_value numeric(12,2);

-- Negative revenue is not a thing. A credit or a write-off is a different concept
-- and would need its own column rather than a sign flip on this one.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_contract_value_nonneg') then
    alter table public.jobs
      add constraint jobs_contract_value_nonneg
      check (contract_value is null or contract_value >= 0);
  end if;
end $$;

comment on column public.jobs.contract_value is
  'What the job was sold for, entered by a user. NULL = not yet entered; never defaulted. '
  'Revenue must never be derived from cost — see the 3.2x multiplier this replaced.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
-- Expect every existing row to show as unpriced. Fill them in from Build Jobs
-- (Edit Job) as you go; the report counts what is still missing.
-- ─────────────────────────────────────────────────────────────────────────────
select count(*)                                                as jobs,
       count(contract_value)                                   as priced,
       count(*) - count(contract_value)                        as unpriced,
       coalesce(sum(contract_value), 0)                        as total_contract_value
from public.jobs
where status in ('completed', 'closed');
