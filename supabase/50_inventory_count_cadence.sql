-- Phase 50 — let a stock count cover an ISO week as well as a calendar month.
--
-- Run after 49. Idempotent, non-destructive, and safe to re-run.
--
-- WHAT THIS CHANGES
--
-- Exactly one thing: the check constraint on inventory_counts.period. 20 wrote it
-- as month-only,
--
--     check (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
--
-- so a weekly period was rejected by the database before the app ever saw it.
-- This widens it to accept either shape:
--
--     2026-10     a calendar month
--     2026-W41    an ISO 8601 week, Monday to Sunday
--
-- Nothing else in the table moves. No column is added, no row is rewritten, and
-- every period already stored still satisfies the new constraint.
--
-- WHY NO `cadence` COLUMN
--
-- Because the string shape already answers the question, and a column saying the
-- same thing would be a second source of truth to get out of step with the first.
-- src/features/inventory/inventoryCounts.js reads it back with cadenceOf().
--
-- Which cadence a company is CURRENTLY counting at is a different question, and it
-- lives in settings(key = 'inventory_count_cadence') — a plain settings row, like
-- job_notifications and the rest, needing no schema of its own.
--
-- WHY THE TWO CADENCES MUST NOT RUN AS PARALLEL CHAINS
--
-- A week sits inside a month. Close both and the same receipts and the same job
-- usage get reconciled twice, and "last period's counted number" — the single
-- input every later period is measured against — has two different answers.
-- 20's own header makes this argument about date ranges; it applies unchanged to
-- two cadences at once.
--
-- The constraint below cannot enforce that, and deliberately does not try: a
-- check constraint sees one row. Nothing stops a client writing a week and a
-- month that overlap. What makes it safe is that the app offers ONE cadence per
-- company at a time, and that the opening balance chains backwards by DATE
-- rather than by period name (previousClosedCount), so a company that switches
-- cadence keeps an unbroken chain across the switch instead of silently
-- re-deriving from the book.
--
-- If you ever do want both at once, the honest shape for it is period_start /
-- period_end columns with a Postgres exclusion constraint on
-- daterange(period_start, period_end) using && — which is a real migration with
-- a data backfill, not a widened regex. Do not get there by loosening this.

begin;

-- Guarded drop-and-recreate. There is no ALTER CONSTRAINT for a check's
-- expression, so replacing it is the only way to widen it.
--
-- The drop is unavoidable here, unlike in 33 where it was avoidable and therefore
-- avoided: dropping a CHECK momentarily removes a guard, so it is re-added inside
-- the same transaction. A reader who stops halfway down this file should know the
-- window does not outlive the BEGIN above.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'inventory_counts_period_fmt'
      and conrelid = 'public.inventory_counts'::regclass
  ) then
    alter table public.inventory_counts drop constraint inventory_counts_period_fmt;
  end if;

  alter table public.inventory_counts
    add constraint inventory_counts_period_fmt
    check (period ~ '^\d{4}-(0[1-9]|1[0-2])$' or period ~ '^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$');
end $$;

comment on column public.inventory_counts.period is
  'The span this count covers: a calendar month ("2026-10") or an ISO week ("2026-W41"). The shape IS the cadence; there is no separate flag. One count per company per period, enforced by inventory_counts_company_period_idx. A company counts at one cadence at a time, chosen in settings(key=''inventory_count_cadence'').';

commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verify — ONE select, and it must stay the last statement in the file.
--
-- The Supabase SQL Editor shows the result of the FINAL statement only, so a
-- file ending in three selects reports two of them to nobody, and a file ending
-- in `commit;` reports "Success. No rows returned" and shows you nothing at all.
-- Same warning as 00_introspect.sql and 33_migration_ledger.sql. Hence the
-- union: three questions, one result set.
--
-- The pattern section checks the REGEXES rather than attempting trial inserts.
-- inventory_counts.company_id is NOT NULL and defaults to active_company_id(),
-- which is NULL in the SQL Editor because there is no JWT — so a trial insert
-- would fail on company_id long before the period constraint had an opinion, and
-- report the wrong thing as broken. Nothing below writes anything.
--
-- Read it as: every `pattern` row says ok, `installed` shows a definition
-- mentioning W, and `stored` lists what you have.
-- ═════════════════════════════════════════════════════════════════════════════
with pat as (
  select '^\d{4}-(0[1-9]|1[0-2])$'              as month_pat,
         '^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'  as week_pat
),
checks as (
  select
    sample,
    expected,
    (sample ~ month_pat or sample ~ week_pat) as accepted
  from pat, (values
    ('2026-10',  true),   -- a month, the only shape 20 allowed
    ('2026-01',  true),
    ('2026-W41', true),   -- an ISO week, what this file adds
    ('2026-W01', true),
    ('2026-W53', true),   -- 53-week years are real: 2026 is one
    ('2026-W54', false),  -- no year has 54 weeks; a naive \d{2} would allow it
    ('2026-W00', false),
    ('2026-W1',  false),  -- must be zero padded, or it sorts and compares wrong
    ('2026-13',  false),
    ('2026-00',  false),
    ('Jan 2026', false),
    ('2026-1',   false)
  ) as t(sample, expected)
)
select 1 as ord, 'pattern' as section, sample as item,
       case when accepted = expected then 'ok'
            else 'WRONG — expected ' || expected::text || ', got ' || accepted::text
       end as detail
from checks
union all
select 2, 'installed', conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.inventory_counts'::regclass
  and conname = 'inventory_counts_period_fmt'
union all
select 3, 'stored',
       period || ' · ' || case when period like '%-W%' then 'weekly' else 'monthly' end,
       status || ', ' || jsonb_array_length(lines)::text || ' counted lines'
         || coalesce(', closed ' || to_char(closed_at, 'YYYY-MM-DD'), '')
from public.inventory_counts
order by ord, item desc;
