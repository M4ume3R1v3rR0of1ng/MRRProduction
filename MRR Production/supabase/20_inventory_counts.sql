-- Phase 9 — monthly physical stock counts, and the variance between what the books
-- claim and what is actually on the shelf.
--
-- Run after 19. Idempotent.
--
-- WHY THIS TABLE HAS TO EXIST AT ALL
--
-- Every quantity in this app is derived from inventory.batches. That makes the
-- system perfectly self-consistent and completely unable to detect its own losses:
-- an item can sit at -1 and nothing disagrees, because the negative row IS the
-- book. Material that walks off the yard produces no event, so no derivation can
-- ever find it.
--
-- A physical count is the only outside fact the system gets. This table is where
-- that fact lands, and the variance against it is the only honest measure of bleed
-- the product can offer.
--
-- WHY NOT JUST USE THE AUDIT LOG
--
-- Adjust Stock already writes an audit_logs line saying "corrected 12 to 9". Two
-- problems. archive_old_audit_logs() deletes that line after 30 days, so the
-- history needed to say "this item bleeds every month" is gone before the trend
-- exists. And a correction records the fix, not the expectation it was measured
-- against, so it cannot distinguish 3 units lost from 3 units that were never
-- received in the first place.
--
-- WHY TWO JSONB COLUMNS AND NOT ONE
--
--   entries — what people typed, [{ iid, counted, at, by }]. Written repeatedly
--             while the count is open, over days. This is raw input.
--   lines   — the full reconciliation, frozen at close. opening, received, used,
--             expected, counted, variance, and the price each was valued at.
--
-- While a count is OPEN the lines are recomputed live in the browser from current
-- batches and jobs, because a receipt that lands mid-count must move the expected
-- number. Once CLOSED they must never move again: next month's opening balance
-- reads from this row, so a closed count that silently re-derived itself would
-- rewrite the history every later period was measured against.
--
-- That is also why closing is a one-way door here. There is no policy below that
-- lets a closed count be edited back open.

begin;

create table if not exists public.inventory_counts (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.active_company_id()
             references public.companies(id) on delete cascade,

  -- Calendar month, 'YYYY-MM'. Not a date range: a count is a monthly ritual, and
  -- letting two counts cover overlapping spans would make "last period's counted
  -- number" ambiguous, which is the one input the whole chain depends on.
  period     text not null,
  status     text not null default 'open',

  entries    jsonb not null default '[]'::jsonb,
  lines      jsonb not null default '[]'::jsonb,
  notes      text,

  opened_by  uuid,
  opened_at  timestamptz not null default now(),
  closed_by  uuid,
  closed_at  timestamptz
);

-- Guard the shape of `period` at the database rather than trusting the client.
-- A row written as '2026-1' or 'Jan 2026' would never match the next month's
-- lookup for an opening balance, and the count would silently restart from the
-- book instead of from the last physical count.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_counts_period_fmt') then
    alter table public.inventory_counts
      add constraint inventory_counts_period_fmt check (period ~ '^\d{4}-(0[1-9]|1[0-2])$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_counts_status_chk') then
    alter table public.inventory_counts
      add constraint inventory_counts_status_chk check (status in ('open','closed'));
  end if;
end $$;

-- One count per company per month. Scoped by company_id, not global: every other
-- tenant counts the same months.
create unique index if not exists inventory_counts_company_period_idx
  on public.inventory_counts (company_id, period);

create index if not exists inventory_counts_company_id_idx
  on public.inventory_counts (company_id);

alter table public.inventory_counts enable row level security;

-- Same tenant policy the rest of the business tables carry (see 02). Read and
-- write are both open to members: counting is warehouse-floor work, and the app
-- gates who sees the SHEET through the inv_view / inv_edit permissions rather
-- than through RLS.
drop policy if exists inventory_counts_tenant_all on public.inventory_counts;
create policy inventory_counts_tenant_all on public.inventory_counts
  for all to authenticated
  using      (company_id = public.active_company_id() or public.is_platform_admin())
  with check  (company_id = public.active_company_id() or public.is_platform_admin());

-- No DELETE policy is created on purpose. `for all` above covers delete, so this
-- is a note rather than a restriction: if you later want counts to be undeletable
-- history the way audit_logs is, split this into explicit select/insert/update
-- policies and simply omit delete.

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
select period, status, jsonb_array_length(lines) as counted_lines, closed_at
from public.inventory_counts
order by period desc;
