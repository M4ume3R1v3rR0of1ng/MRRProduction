-- Phase 33 — write down which of these files have actually been run.
--
-- Run after 32. Idempotent, non-destructive, and safe to re-run any time.
--
-- THE PROBLEM
--
-- Files 01 through 32 are applied by hand in the Supabase SQL Editor. Nothing in
-- the database records that this happened. After a gap, or on a second environment,
-- there is no way to answer "is 28 in yet?" short of hunting for a column and
-- guessing. Most of these files are idempotent, so re-running the wrong one is
-- usually harmless — but 02 is explicitly destructive and 15 drops columns, so
-- "just run them all again" is not a safe default.
--
-- WHAT THIS DOES
--
-- Creates public.schema_migrations and then PROBES the live schema for one
-- signature object per migration. It does not take anyone's word for it: a row is
-- marked present because the function, table, column, index or constraint that
-- migration creates is actually there right now.
--
-- So this is a detector, not a log. Re-running it re-probes and refreshes every
-- row, which is what makes it useful after a restore or on a fresh environment.
--
-- THREE FILES CANNOT BE DETECTED, by their nature:
--
--   11 and 13 are bug fixes that CREATE OR REPLACE a function 06 and 12 already
--   created. The function exists either way, so presence proves nothing about
--   which version is installed. They are recorded as 'undetectable'.
--
--   22 is an optional data backfill that writes no schema. Same treatment.
--
-- For those three, check `note` and confirm by hand. Everything else is verified.

begin;

create table if not exists public.schema_migrations (
  filename    text primary key,
  present     boolean,
  -- 'verified'     — the signature object was found; the migration is in.
  -- 'missing'      — it was not found; the migration has almost certainly not run.
  -- 'undetectable' — nothing about this file leaves a distinguishable trace.
  status      text not null default 'missing',
  note        text,
  checked_at  timestamptz not null default now()
);

-- Immediately after the create, and before anything else touches the table: the
-- SQL Editor's advisor reads statements in order and warns about a table that is
-- created without RLS following right behind it.
--
-- Only the platform operator needs to read this, and nothing should write it from
-- a browser session. Service role (which bypasses RLS) and platform admins only.
alter table public.schema_migrations enable row level security;

-- Guarded create rather than `drop policy if exists` + `create policy`. The two
-- are equivalent here, but DROP makes the SQL Editor flag the whole script as
-- containing destructive operations, and this file is meant to be the one thing
-- in this directory you can run without reading it twice.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'schema_migrations'
      and policyname = 'schema_migrations_platform_admin_read'
  ) then
    create policy schema_migrations_platform_admin_read on public.schema_migrations
      for select using (public.is_platform_admin());
  end if;
end $$;

comment on table public.schema_migrations is
  'Which supabase/*.sql files are applied to this database. Populated by probing the live schema, not by trusting a log. Re-run supabase/33_migration_ledger.sql to refresh.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Probe helpers. Each returns true when the named object exists.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._mig_has_function(fn text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = fn
  );
$$;

create or replace function public._mig_has_table(tbl text, sch text default 'public')
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = sch and c.relname = tbl and c.relkind in ('r', 'p')
  );
$$;

create or replace function public._mig_has_column(tbl text, col text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = tbl and column_name = col
  );
$$;

create or replace function public._mig_has_index(idx text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = idx and c.relkind = 'i'
  );
$$;

create or replace function public._mig_has_policy(pol text, tbl text, sch text default 'public')
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from pg_policies
    where schemaname = sch and tablename = tbl and policyname = pol
  );
$$;

create or replace function public._mig_has_constraint(con text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from pg_constraint where conname = con);
$$;

create or replace function public._mig_rls_on(tbl text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((
    select c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = tbl
  ), false);
$$;

create or replace function public._mig_has_bucket(b text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from storage.buckets where id = b);
$$;

-- Record one probe result.
create or replace function public._mig_record(fname text, found boolean, why text)
returns void language sql set search_path = public, pg_temp as $$
  insert into public.schema_migrations (filename, present, status, note, checked_at)
  values (fname, found, case when found then 'verified' else 'missing' end, why, now())
  on conflict (filename) do update
    set present    = excluded.present,
        status     = excluded.status,
        note       = excluded.note,
        checked_at = excluded.checked_at;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The probes. One signature object per migration, chosen as the thing that file
-- creates which nothing else does.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public._mig_record('01_tenancy_core.sql',
    public._mig_has_table('companies') and public._mig_has_table('memberships'),
    'tables companies + memberships');

  perform public._mig_record('02_tenancy_tables.sql',
    public._mig_has_column('jobs', 'company_id'),
    'jobs.company_id');

  perform public._mig_record('03_functions.sql',
    public._mig_has_function('archive_old_audit_logs'),
    'function archive_old_audit_logs()');

  perform public._mig_record('04_security_fixes.sql',
    public._mig_has_table('company_secrets'),
    'table company_secrets');

  perform public._mig_record('05_storage.sql',
    public._mig_has_policy('tenant_objects_select', 'objects', 'storage'),
    'storage.objects policy tenant_objects_select');

  perform public._mig_record('06_platform_admin.sql',
    public._mig_has_function('admin_list_companies'),
    'function admin_list_companies()');

  perform public._mig_record('07_billing.sql',
    public._mig_has_constraint('companies_subscription_status_check'),
    'constraint companies_subscription_status_check (adds the incomplete state)');

  perform public._mig_record('08_usage.sql',
    public._mig_has_function('admin_storage_usage'),
    'function admin_storage_usage()');

  perform public._mig_record('09_seats.sql',
    public._mig_has_function('company_seat_status'),
    'function company_seat_status()');

  perform public._mig_record('10_platform_admin_role.sql',
    public._mig_has_function('admin_list_platform_admins'),
    'function admin_list_platform_admins()');

  perform public._mig_record('12_permission_enforcement.sql',
    public._mig_has_function('has_perm'),
    'function has_perm()');

  perform public._mig_record('14_atomic_material_moves.sql',
    public._mig_has_function('commit_job_materials'),
    'function commit_job_materials()');

  -- Inverted on purpose: 15 DROPS the legacy duplicate columns, so the migration
  -- is in when jobs."name" is gone.
  perform public._mig_record('15_jobs_schema_debt.sql',
    not public._mig_has_column('jobs', 'name'),
    'legacy jobs."name" column removed');

  perform public._mig_record('16_one_time_seat_packs.sql',
    public._mig_has_function('record_seat_pack_purchase'),
    'function record_seat_pack_purchase()');

  perform public._mig_record('17_multi_crew_jobs.sql',
    public._mig_has_index('jobs_company_acculynx_job_id_idx'),
    'index jobs_company_acculynx_job_id_idx');

  perform public._mig_record('18_enable_rls.sql',
    public._mig_rls_on('jobs') and public._mig_rls_on('inventory'),
    'row level security on jobs + inventory');

  perform public._mig_record('19_maintenance_vehicle_swap.sql',
    public._mig_has_function('assign_replacement_vehicle'),
    'function assign_replacement_vehicle()');

  perform public._mig_record('20_inventory_counts.sql',
    public._mig_has_table('inventory_counts'),
    'table inventory_counts');

  perform public._mig_record('21_profiles_readable_after_deactivation.sql',
    public._mig_has_function('shares_company_any_status'),
    'function shares_company_any_status()');

  perform public._mig_record('23_recover_orphaned_person.sql',
    public._mig_has_table('inventory_batches_backup_20260806'),
    'table inventory_batches_backup_20260806');

  perform public._mig_record('24_job_contract_value.sql',
    public._mig_has_column('jobs', 'contract_value'),
    'jobs.contract_value');

  perform public._mig_record('25_vehicle_out_of_service.sql',
    public._mig_has_column('vehicles', 'oos_reason'),
    'vehicles.oos_reason');

  perform public._mig_record('26_training_media.sql',
    public._mig_has_table('training_media') and public._mig_has_bucket('training-media'),
    'table training_media + storage bucket training-media');

  perform public._mig_record('27_recurring_seat_packs.sql',
    public._mig_has_column('companies', 'recurring_seat_packs'),
    'companies.recurring_seat_packs');

  perform public._mig_record('28_acculynx_sync_state.sql',
    public._mig_has_column('jobs', 'report_uploaded_at'),
    'jobs.report_uploaded_at');

  perform public._mig_record('29_mfa_enforcement.sql',
    public._mig_has_function('mfa_satisfied'),
    'function mfa_satisfied()');

  perform public._mig_record('30_platform_revenue.sql',
    public._mig_has_function('admin_revenue_summary'),
    'function admin_revenue_summary()');

  perform public._mig_record('31_platform_admin_entry.sql',
    public._mig_has_function('is_visiting_company'),
    'function is_visiting_company()');

  perform public._mig_record('32_platform_company.sql',
    public._mig_has_column('companies', 'is_platform_company'),
    'companies.is_platform_company');

  perform public._mig_record('33_migration_ledger.sql',
    public._mig_has_table('schema_migrations'),
    'this file');
end $$;

-- The three that leave no distinguishable trace. Recorded so the ledger lists
-- every file rather than silently omitting the ones it cannot check.
--
-- The notes are deliberately PROSE, with the confirming queries kept in the
-- Verify block at the bottom of this file instead. The SQL Editor's advisor reads
-- table names out of string literals too, so an embedded `from public.inventory`
-- here made it warn that this script exposes inventory.batches, which it does not.
insert into public.schema_migrations (filename, present, status, note, checked_at)
values
  ('11_fix_admin_list.sql', null, 'undetectable',
   'Bug fix replacing admin_list_companies() from 06. The function exists either way, so presence proves nothing. See Verify block, check A.', now()),
  ('13_fix_has_perm.sql', null, 'undetectable',
   'Bug fix replacing has_perm() from 12. The function exists either way, so presence proves nothing. See Verify block, check B.', now()),
  ('22_backfill_batch_by_name.sql', null, 'undetectable',
   'Optional data backfill stamping byName onto stored batch rows. No schema change. See Verify block, check C.', now())
on conflict (filename) do update
  set present = excluded.present,
      status  = excluded.status,
      note    = excluded.note,
      checked_at = excluded.checked_at;

commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- The answer.
--
-- This select is the last statement in the file ON PURPOSE, and it must stay
-- last. The Supabase SQL Editor displays the result of the FINAL statement only,
-- so a file that ends on `commit;` reports "Success. No rows returned" and shows
-- you nothing at all. The first version of this file did exactly that: it did all
-- its work correctly, said nothing about it, and left the reader to go and find
-- a verification query buried in a comment. That is what running it several times
-- looking for an answer feels like. See the same warning in 00_introspect.sql.
--
-- Missing first, because those are the ones that need action. 'undetectable'
-- next, then everything verified.
--
--   missing       this migration has NOT been run. The note says which object
--                 was looked for and not found.
--   undetectable  cannot be probed. Confirm by hand with checks A, B and C below.
--   verified      the object that migration creates is present.
-- ═════════════════════════════════════════════════════════════════════════════
select
  status,
  filename,
  note
from public.schema_migrations
order by
  case status when 'missing' then 0 when 'undetectable' then 1 else 2 end,
  filename;

-- ═════════════════════════════════════════════════════════════════════════════
-- The three that have to be confirmed by hand
--
-- ── Check A · did 11_fix_admin_list.sql run? ─────────────────────────────────
-- Before the fix this threw: column reference "created_at" is ambiguous.
-- If it returns rows, 11 is in.
--
--   select * from public.admin_list_companies();
--
-- ── Check B · did 13_fix_has_perm.sql run? ───────────────────────────────────
-- Before the fix this threw 42883: operator does not exist: text = uuid.
-- If it returns true or false rather than erroring, 13 is in.
--
--   select public.has_perm('jobs_pull');
--
-- ── Check C · did 22_backfill_batch_by_name.sql run? ─────────────────────────
-- Counts stored batch entries that still carry no byName stamp even though their
-- 'by' id resolves to a live profile. Zero means the backfill has been applied
-- (or there was nothing it could stamp). Anything above zero means 22 has work
-- left to do. Rows whose 'by' matches no profile are correctly excluded: 22
-- cannot invent what was already lost.
--
--   select count(*)
--   from public.inventory i
--   cross join lateral jsonb_array_elements(i.batches) as b
--   join public.profiles p on p.id::text = b->>'by'
--   where jsonb_typeof(i.batches) = 'array'
--     and not (b ? 'byName');
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Re-run this whole file after applying any future migration, and add a probe for
-- it in the do-block above. A migration with no probe is a migration nobody can
-- verify later.
-- ═════════════════════════════════════════════════════════════════════════════
