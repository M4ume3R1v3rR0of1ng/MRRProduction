-- Phase 1g — assert row level security is actually ON.
--
-- Idempotent and non-destructive. Safe to re-run. Enabling RLS on a table that
-- already has it is a no-op, so this either changes nothing (the expected result
-- in production) or closes a hole.
--
-- WHY THIS EXISTS
--
-- 02_tenancy_tables.sql writes a careful tenant policy for fourteen tables. It
-- never enables row level security on any of them. Across every migration in this
-- directory, `enable row level security` appears exactly three times: companies
-- and memberships in 01, company_secrets in 04.
--
-- A policy on a table with RLS off is INERT. Postgres does not warn, does not
-- error, and `pg_policies` still lists the policy in full. The table simply
-- returns every row to everyone. That is the worst possible failure mode: a
-- database that reads as correctly locked down in the schema while serving every
-- company's data to every logged-in user.
--
-- Production is very probably fine already. Those tables carried "any
-- authenticated user" policies before 02 dropped them, and a policy that was
-- actually restricting anything proves RLS was on. But "probably, by inheritance
-- from a state nobody recorded" is not an access control story. Nothing in this
-- repo asserts it, so a rebuild onto fresh tables would silently produce a wide
-- open database that passes a schema review.
--
-- This file makes the guarantee explicit and verifiable.
--
-- SAFETY
--
-- Enabling RLS starts enforcement immediately, so every write path that runs as
-- `authenticated` needs a policy that admits it. Checked before writing this:
--
--   profiles             — rows come from handle_new_user() (SECURITY DEFINER),
--                          which bypasses RLS. No client INSERT path exists.
--   audit_logs           — src/utils/logger.js inserts from the browser; covered
--                          by audit_insert_member. company_id is stamped by its
--                          DEFAULT active_company_id(), so the client need not
--                          pass it.
--   vehicle_inspections  — InspectionModal.jsx inserts from the browser; covered
--                          by the tenant_all policy from 02.
--   team_chat_messages   — covered by chat_insert_own.
--
-- The Netlify functions are unaffected either way: they hold the service-role
-- key, which bypasses RLS entirely. Their isolation comes from resolveCaller()
-- in netlify/functions/_shared/tenant.js, not from anything in this file.
--
-- A NOTE ON WHY NOTHING HERE RAISES
--
-- An earlier draft ended with `raise exception` if it found a table still
-- exposed. That was backwards. Steps 1 and 2 run in one transaction, so raising
-- would roll back the RLS this file just enabled — turning one unrelated
-- misconfigured table into a reason to leave all fourteen unprotected. A
-- security fix must not be blocked by the discovery of a second problem. So the
-- sweep in step 2 FIXES what it finds, and step 3 reports the rest as notices.
-- The only exception raised is for missing tables, which means the earlier
-- migrations were never run and nothing here is meaningful yet.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable RLS on every tenant table that 02 wrote a policy for.
--
--    The three tables already covered (companies, memberships, company_secrets)
--    are deliberately included. Re-enabling is free, and listing them here means
--    this file is the single place to read for "what is protected", rather than
--    a partial list that has to be mentally merged with 01 and 04.
--
--    to_regclass returns NULL rather than raising for a missing table, which lets
--    us collect every missing name and report them together instead of dying on
--    the first one.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t       text;
  missing text[] := '{}';
begin
  foreach t in array array[
    -- the plain tenant tables (02, dynamic loop)
    'inventory','vehicles','jobs','maintenance_requests','job_trailers',
    'warehouses','vehicle_inspections',
    -- explicitly policied in 02
    'settings','role_permissions','user_permission_overrides',
    'audit_logs','team_chat_messages','team_chat_reads','profiles',
    -- already enabled in 01 / 04; restated so this list is complete
    'companies','memberships','company_secrets'
  ] loop
    if to_regclass('public.' || quote_ident(t)) is null then
      missing := missing || t;
    else
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;

  if array_length(missing, 1) > 0 then
    raise exception 'Expected tables do not exist: %. Run the earlier migrations first.',
      array_to_string(missing, ', ');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Sweep up anything the hardcoded list missed.
--
--    Any table in public carrying a policy while RLS is off has the exact bug
--    this file exists to fix, whether or not it was on the list above. A policy
--    that exists was written to restrict something, so enabling RLS is always
--    what its author intended.
--
--    Doing this generally is also what makes step 1's list safe to be a plain
--    hardcoded list: a table that grows a policy later cannot quietly fall
--    through the gap between the two. Each one is named in a NOTICE so it shows
--    up in the output rather than being fixed invisibly.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and not c.relrowsecurity
      and exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname)
    order by c.relname
  loop
    raise notice 'RLS was OFF on public.% despite it having policies — enabling. Add it to the list in step 1.', r.relname;
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Report anything still worth a human look. Notices only, no failures.
--
--    Two shapes, neither of which this file should fix on its own:
--
--      a) RLS on, zero policies. Not a leak (no policy means default deny for
--         the browser roles) but it silently bricks whatever feature reads that
--         table, and it is nearly always an oversight. company_secrets is the
--         one genuine exception: 04 revokes it from anon/authenticated outright
--         and lets only the service-role key touch it, so default deny IS the
--         design there.
--
--      b) RLS off, zero policies. Never part of the tenancy model at all. Step 2
--         does not touch these precisely because there is no policy to infer
--         intent from — enabling RLS would just break reads with no rule to
--         replace them. Worth asking whether the browser can reach it, and if
--         so, whether it should.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
    and c.relrowsecurity
    and c.relname <> 'company_secrets'
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = c.relname);
  if bad is not null then
    raise notice 'RLS on but NO policy (nothing can read these): %', bad;
  end if;

  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
    and not c.relrowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = c.relname);
  if bad is not null then
    raise notice 'Outside the tenancy model entirely (no RLS, no policies): %', bad;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The final picture. Read this before you close the tab.
--
--    Separate statement and LAST on purpose: the Supabase SQL Editor only renders
--    the result of the final statement in a script (the same constraint
--    00_introspect.sql is built around). The notices above appear alongside it.
--
--    Every table holding company data should read rls_enabled = true with at
--    least one policy.
-- ─────────────────────────────────────────────────────────────────────────────
select
  c.relname            as table_name,
  c.relrowsecurity     as rls_enabled,
  count(p.policyname)  as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
  on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind in ('r','p')
group by c.relname, c.relrowsecurity
order by c.relrowsecurity asc, c.relname;
