-- Phase 10c — reattach Sam Schwartz's orphaned batch history to his live account.
--
-- Run after 22. Every destructive step is commented out and gated behind a check.
-- Work down the file in order; do not skip the backup.
--
-- WHAT WAS FOUND
--
-- 22's preview reported 4598017f-0c73-4ab2-94dd-58d4efe10e4a on 24 batches with
-- no profile behind it. delete-user.js removes the membership and, when it was
-- that person's last, the profile and auth account too — so the usual join is
-- dead.
--
-- Three independent tables that denormalise a name beside the id all agreed:
--
--   audit_logs           sam@maumeeriverroofing.com   (many rows, through 2026-07-31)
--   team_chat_messages   "Sam Schwartz"               (2026-07-29, 2026-07-17)
--   maintenance_requests "Sam Schwartz"               (2026-07-16)
--
-- None of those join to profiles at read time, which is why they survived the
-- deletion intact.
--
-- THE USEFUL PART
--
-- Sam appears TWICE in 22's preview:
--
--   4598017f-…  24 batches, no profile      ← the deleted account
--   5ef0b3cb-…   1 batch,  "Sam Schwartz"   ← the live account
--
-- The account was deleted and recreated. So this is not a lost identity, it is a
-- SPLIT one, and the better repair is to point the orphaned rows at the live
-- profile rather than to freeze a copy of his name onto them.
--
-- Why remapping beats stamping a name:
--
--   * The person filter on the batch ledger lists distinct ids. Stamping leaves
--     two "Sam Schwartz" entries that each match half his history.
--   * A live id keeps working if he ever changes his name; a stamped string does not.
--   * The monthly count and every other per-person view group correctly.
--
-- `byPriorId` is written alongside, so the remap stays visible and reversible.
-- Nothing in the app reads it; it exists so this edit is not a silent rewrite of
-- who did what.
--
-- audit_logs is deliberately NOT remapped. It is the immutable record, it already
-- carries user_email on every row, and rewriting history to tidy it up is exactly
-- what an audit log must never do.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — CONFIRM BOTH IDS ARE THE SAME HUMAN. Read-only.
--
-- Expect: the live id returns sam@maumeeriverroofing.com, matching the email the
-- audit log recorded for the dead id. If the email differs, STOP: they are two
-- different people and nothing below applies.
-- ─────────────────────────────────────────────────────────────────────────────
select p.id,
       p.full_name,
       p.email,
       m.company_id,
       m.active as membership_active
from public.profiles p
left join public.memberships m on m.user_id = p.id
where p.id = '5ef0b3cb-1f50-4d31-bf68-a37839028b05';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — BLAST RADIUS. Read-only.
--
-- Where else the dead id appears. Batches are the reported problem; jobs matter
-- too, because a job assigned to a deleted account shows no supervisor.
--
-- Only columns this app demonstrably reads are named below. A UNION referencing a
-- column that does not exist fails to parse as a whole, taking the working
-- branches down with it, so 2b lists every candidate column instead of this file
-- guessing at them.
-- ─────────────────────────────────────────────────────────────────────────────
select 'inventory.batches' as location,
       count(*)            as rows_affected
from public.inventory i
cross join lateral jsonb_array_elements(i.batches) b
where b->>'by' = '4598017f-0c73-4ab2-94dd-58d4efe10e4a'

union all
select 'jobs.assignedto', count(*) from public.jobs
where assignedto::text = '4598017f-0c73-4ab2-94dd-58d4efe10e4a'

union all
select 'maintenance_requests.uid', count(*) from public.maintenance_requests
where uid::text = '4598017f-0c73-4ab2-94dd-58d4efe10e4a'

union all
select 'audit_logs.user_id (left alone on purpose)', count(*) from public.audit_logs
where user_id::text = '4598017f-0c73-4ab2-94dd-58d4efe10e4a';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2b — every column that could hold a person id. Read-only.
--
-- Run this if you want to be thorough. Anything it lists that STEP 2 does not
-- cover can be checked by hand with:
--   select count(*) from public.<table> where <column>::text = '4598017f-…';
-- ─────────────────────────────────────────────────────────────────────────────
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (column_name ilike '%user%id%'
       or column_name ilike '%_by'
       or column_name in ('uid', 'assignedto', 'inspector_id', 'opened_by', 'closed_by'))
order by table_name, column_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — BACKUP. Run this before any UPDATE below.
--
-- A plain copy of the column being rewritten. Cheap, and it makes every step
-- after this reversible with a single statement (see the ROLLBACK at the bottom).
--
-- ⚠️ RLS ON THE BACKUP, IMMEDIATELY.
--
-- This table holds every company's batches, including unit prices. A new table in
-- `public` is exposed through PostgREST, and Supabase's default privileges grant
-- the `authenticated` role access to new objects in that schema — so leaving RLS
-- off would publish one tenant's costs to every other tenant's browser. That is
-- the exact failure supabase/18 exists to prevent.
--
-- RLS is enabled with NO policy attached. Postgres denies by default, so the
-- table becomes unreadable to anon and authenticated entirely, while service_role
-- and the SQL editor (which bypass RLS) can still use it. A backup nobody can
-- read from the app is precisely what is wanted.
-- ─────────────────────────────────────────────────────────────────────────────
-- create table if not exists public.inventory_batches_backup_20260806 as
-- select id, company_id, batches, now() as backed_up_at
-- from public.inventory;
--
-- alter table public.inventory_batches_backup_20260806 enable row level security;
--
-- select count(*) as rows_backed_up from public.inventory_batches_backup_20260806;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4 — REMAP THE BATCHES.
--
-- Sets `by` to the live account and records the id it came from. Idempotent: a
-- second run matches nothing, because the old id is gone from `by`.
-- ─────────────────────────────────────────────────────────────────────────────
-- begin;
--
-- update public.inventory i
-- set batches = (
--   select jsonb_agg(
--            case
--              when b->>'by' = '4598017f-0c73-4ab2-94dd-58d4efe10e4a'
--                then b
--                     || jsonb_build_object('by',         '5ef0b3cb-1f50-4d31-bf68-a37839028b05')
--                     || jsonb_build_object('byName',     'Sam Schwartz')
--                     || jsonb_build_object('byPriorId',  '4598017f-0c73-4ab2-94dd-58d4efe10e4a')
--              else b
--            end
--            -- Preserve array order. FIFO sorts by rcvd when reading, but the
--            -- stored order is the receipt order and there is no reason to shuffle it.
--            order by ord
--          )
--   from jsonb_array_elements(i.batches) with ordinality as t(b, ord)
-- )
-- where jsonb_typeof(batches) = 'array'
--   and exists (
--     select 1 from jsonb_array_elements(i.batches) b
--     where b->>'by' = '4598017f-0c73-4ab2-94dd-58d4efe10e4a'
--   );
--
-- commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5 — OPTIONAL, and nearly moot. Measured 2026-08-06:
--
--   jobs.assignedto            0 rows  → nothing to do, statement removed
--   maintenance_requests.uid   1 row   → cosmetic only
--   audit_logs.user_id       193 rows  → left alone on purpose, see the header
--
-- That single request already stores `uname` ("Sam Schwartz") and renders from it,
-- so this changes nothing visible. It only keeps per-person grouping consistent if
-- anything ever groups requests by uid.
-- ─────────────────────────────────────────────────────────────────────────────
-- update public.maintenance_requests
-- set uid = '5ef0b3cb-1f50-4d31-bf68-a37839028b05'
-- where uid::text = '4598017f-0c73-4ab2-94dd-58d4efe10e4a';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6 — VERIFY.
--
-- Expect one row: 5ef0b3cb-… with 25 batches (his existing 1 plus the 24), and
-- zero rows for the old id. Then reload the app; the Batch Ledger should show
-- Sam Schwartz throughout with a single entry in the person filter.
-- ─────────────────────────────────────────────────────────────────────────────
-- select b->>'by'        as person_id,
--        b->>'byName'    as stamped_name,
--        b->>'byPriorId' as remapped_from,
--        count(*)        as batches
-- from public.inventory i
-- cross join lateral jsonb_array_elements(i.batches) b
-- where b->>'by' in ('5ef0b3cb-1f50-4d31-bf68-a37839028b05',
--                    '4598017f-0c73-4ab2-94dd-58d4efe10e4a')
-- group by 1, 2, 3
-- order by batches desc;

-- ROLLBACK, if anything looks wrong:
--
-- update public.inventory i
-- set batches = bk.batches
-- from public.inventory_batches_backup_20260806 bk
-- where bk.id = i.id and bk.company_id = i.company_id;
--
-- Drop the backup table once you are satisfied:
--   drop table public.inventory_batches_backup_20260806;
