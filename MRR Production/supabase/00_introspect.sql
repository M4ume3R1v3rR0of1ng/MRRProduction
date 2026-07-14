-- Read-only. Nothing here writes to your database.
--
-- ONE statement on purpose: the Supabase SQL Editor only shows the result of the
-- LAST statement in a script, so a multi-query version silently drops everything
-- above it. This packs the whole schema into a single JSON cell.
--
-- Run it, click the cell, copy the value, paste it back.

select jsonb_pretty(jsonb_build_object(

  -- Every column of every table.
  'columns', (
    select jsonb_object_agg(table_name, cols)
    from (
      select table_name,
             jsonb_agg(
               column_name || ' ' || data_type
               || case when is_nullable = 'NO' then ' NOT NULL' else '' end
               || case when column_default is not null
                       then ' DEFAULT ' || column_default else '' end
               order by ordinal_position
             ) as cols
      from information_schema.columns
      where table_schema = 'public'
      group by table_name
    ) s
  ),

  -- PKs, uniques, FKs. Every one of these must become composite with company_id,
  -- or company B collides with company A's keys.
  'constraints', (
    select jsonb_agg(x order by x->>'tbl')
    from (
      select jsonb_build_object(
               'tbl',  conrelid::regclass::text,
               'kind', case contype when 'p' then 'PRIMARY KEY'
                                    when 'u' then 'UNIQUE'
                                    when 'f' then 'FOREIGN KEY' end,
               'def',  pg_get_constraintdef(oid)
             ) as x
      from pg_constraint
      where connamespace = 'public'::regnamespace
        and contype in ('p','u','f')
    ) s
  ),

  -- Unique indexes don't always appear as constraints above.
  'unique_indexes', (
    select jsonb_agg(indexdef order by indexdef)
    from pg_indexes
    where schemaname = 'public' and indexdef ilike '%unique%'
  ),

  'rls_enabled', (
    select jsonb_object_agg(relname, relrowsecurity)
    from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
  ),

  -- ⚠️ THE CRITICAL ONE. Postgres ORs permissive policies together, so any
  -- leftover "authenticated can read" policy would defeat a new tenant policy
  -- entirely — every company would see every other company's data, and the
  -- application code would look completely correct.
  'policies', (
    select jsonb_agg(x order by x->>'tbl', x->>'name')
    from (
      select jsonb_build_object(
               'tbl',        tablename,
               'name',       policyname,
               'permissive', permissive,
               'roles',      roles::text,
               'cmd',        cmd,
               'using',      qual,
               'with_check', with_check
             ) as x
      from pg_policies where schemaname = 'public'
    ) s
  ),

  -- The auth.users -> profiles trigger lives here; it must learn to assign a
  -- company on signup. archive_old_audit_logs (called by the nightly cron) is
  -- here too and will need to stay company-agnostic.
  'functions', (
    select jsonb_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                     || case when p.prosecdef then '  [SECURITY DEFINER]' else '' end
                     order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not like 'pg_%'
  ),

  'triggers', (
    select jsonb_agg(distinct event_object_table || ': ' || trigger_name
                     || ' ' || action_timing || ' ' || event_manipulation
                     || ' -> ' || action_statement)
    from information_schema.triggers
    where trigger_schema in ('public','auth')
  ),

  -- Table RLS does NOT cover storage. Vehicle photos and logos need their own
  -- company-scoped paths and policies.
  'storage_buckets', (
    select jsonb_agg(jsonb_build_object('name', name, 'public', public))
    from storage.buckets
  ),

  'storage_policies', (
    select jsonb_agg(jsonb_build_object(
             'name', policyname, 'cmd', cmd,
             'using', qual, 'with_check', with_check))
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
  )

)) as schema_dump;
