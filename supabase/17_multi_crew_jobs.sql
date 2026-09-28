-- Phase 9 — let one AccuLynx job carry more than one inventory job.
--
-- THE BUG (reported from the field, AccuLynx job 22311):
--
--     Database Error: Could not save job. duplicate key value violates unique
--     constraint "jobs_company_acculynx_job_id_key"
--
-- Roofing and siding are different crews. Each crew pulls its own inventory, so
-- one AccuLynx job legitimately needs two (sometimes more) job records on our
-- side — one per crew, each with its own material list, its own supervisor, and
-- its own pull. The constraint added in 02_tenancy_tables.sql:
--
--     unique (company_id, acculynx_job_id)
--
-- makes the second one impossible. The relationship was modelled as one-to-one
-- and it is actually many-to-one: many inventory jobs -> one AccuLynx job.
--
-- WHY THE CONSTRAINT WAS THERE, AND WHY DROPPING IT IS SAFE:
--
-- It existed for exactly one caller — the upsert in acculynx-import.js, which
-- passed onConflict: 'company_id,acculynx_job_id' and needs SOME unique index to
-- infer. Nothing else in the codebase looks a job up by acculynx_job_id as though
-- it were unique (verified: the only other reader is accuLynxSync.js, which reads
-- the value off a row it already has, to push materials back up).
--
-- The import doesn't need this key at all. It already computes a deterministic
-- primary key for every row it writes:
--
--     id = `acx_${job.id}`
--
-- so upserting on the real primary key (company_id, id) is idempotent in exactly
-- the same way, across exactly the same re-imports. acculynx-import.js is changed
-- to do that in the same commit as this migration.
--
-- Keying the import on the PK also fixes a latent data-loss bug. Under the old
-- constraint, if a crew had already built an inventory job against AccuLynx job
-- 22311, the next import would conflict on (company_id, acculynx_job_id) and
-- UPDATE that hand-built job in place — overwriting its title, PO and customer
-- fields with import data. Keying on `acx_`-prefixed ids means the import can only
-- ever touch rows the import itself created.
--
-- Run after 16. Idempotent.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop the constraint that blocks the second crew's job.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.jobs
  drop constraint if exists jobs_company_acculynx_job_id_key;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Keep the index, drop only the uniqueness.
--
--    "show me every inventory job for AccuLynx job 22311" is now a real query
--    with real multi-row answers, so this lookup matters more than it did when
--    it could only ever return one row. Partial: the column is NULL for every
--    job built without an AccuLynx link, and those nulls don't belong in the
--    index.
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists jobs_company_acculynx_job_id_idx
  on public.jobs (company_id, acculynx_job_id)
  where acculynx_job_id is not null;

commit;
