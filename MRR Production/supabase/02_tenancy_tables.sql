-- Phase 1b — put every business table behind a company.
--
-- ⚠️  DESTRUCTIVE. Run 01_tenancy_core.sql first. Take a backup first
--     (Supabase → Database → Backups, or just `pg_dump`; your whole dataset is
--     ~1000 rows, so this costs seconds).
--
-- Runs as one transaction: it either fully applies or fully rolls back. There is
-- no half-migrated state to clean up.
--
-- What this does, in order:
--   1. Drops 4 dead tables (unused, empty, and two are anon-writable).
--   2. Creates the Maumee River company row.
--   3. Adds company_id to the 13 live tables and backfills it.
--   4. Rebuilds primary keys as (company_id, id) — text ids like 'v1' WILL
--      collide across companies otherwise.
--   5. Drops every existing "any authenticated user" policy and replaces it
--      with a tenant-scoped one.
--   6. Backfills memberships from the existing profiles.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Preconditions. Fail loudly rather than half-apply.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.companies') is null then
    raise exception 'Run 01_tenancy_core.sql first — companies table is missing.';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop the dead tables.
--
--    Verified empty (0 rows) and unreferenced by any code in src/ or netlify/.
--    public.users is a pre-Supabase-Auth leftover with a plaintext `pass` column
--    and an "Allow all" policy granted to the `public` role — meaning anon can
--    currently INSERT into it. Same for `requests`. Dropping them removes real
--    attack surface, not just clutter.
-- ─────────────────────────────────────────────────────────────────────────────
drop table if exists public.users        cascade;
drop table if exists public.requests     cascade;
drop table if exists public.audit_log    cascade;  -- singular; the live one is audit_logs
drop table if exists public.system_logs  cascade;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The first company.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.companies (name, slug, subscription_status, branding)
values (
  'Maumee River Roofing',
  'maumee-river-roofing',
  'active',                       -- you are not going to bill yourself
  jsonb_build_object('displayName', 'Maumee River Roofing')
)
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. company_id on every business table.
--
--    DEFAULT active_company_id() is the single most important line in this file.
--    It means an INSERT from the browser does not need to pass company_id at all —
--    Postgres stamps it from the caller's session. Almost none of your existing
--    frontend insert code has to change.
--
--    It also means the opposite for the Netlify functions: they authenticate with
--    the service-role key, where auth.uid() is NULL, so the default evaluates to
--    NULL and the NOT NULL constraint rejects the insert. That is deliberate. It
--    turns "a function forgot to scope by company" from a silent cross-tenant leak
--    into a loud, immediate error. See the checklist at the bottom.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t    text;
  mrr  uuid := (select id from public.companies where slug = 'maumee-river-roofing');
begin
  foreach t in array array[
    'inventory','vehicles','jobs','maintenance_requests','job_trailers',
    'warehouses','role_permissions','user_permission_overrides','settings',
    'team_chat_reads','team_chat_messages','audit_logs','vehicle_inspections'
  ] loop
    execute format('alter table public.%I add column if not exists company_id uuid', t);
    execute format('update public.%I set company_id = %L where company_id is null', t, mrr);
    execute format('alter table public.%I alter column company_id set not null', t);
    execute format('alter table public.%I alter column company_id set default public.active_company_id()', t);
    execute format('alter table public.%I add constraint %I foreign key (company_id) '
                   'references public.companies(id) on delete cascade',
                   t, t || '_company_id_fkey');
    execute format('create index if not exists %I on public.%I (company_id)',
                   t || '_company_id_idx', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Primary keys become composite.
--
--    Your ids are app-generated text ('v1', 'w1', 'INV-001' …), not UUIDs — see
--    src/data/seeds.js. They are only unique within one company by luck. A global
--    PRIMARY KEY (id) means Company B's first truck ('v1') collides with yours on
--    day one. Every text-id table needs PRIMARY KEY (company_id, id).
--
--    Tables whose id is already a uuid (team_chat_messages, audit_logs,
--    vehicle_inspections) keep their simple PK — a uuid cannot collide.
-- ─────────────────────────────────────────────────────────────────────────────

-- job_trailers' FKs point at the keys we're about to rebuild, so they come off first.
alter table public.job_trailers drop constraint if exists job_trailers_job_id_fkey;
alter table public.job_trailers drop constraint if exists job_trailers_trailer_id_fkey;

alter table public.jobs        drop constraint jobs_pkey       cascade;
alter table public.jobs        add primary key (company_id, id);

alter table public.vehicles    drop constraint vehicles_pkey   cascade;
alter table public.vehicles    add primary key (company_id, id);

alter table public.inventory   drop constraint inventory_pkey  cascade;
alter table public.inventory   add primary key (company_id, id);

alter table public.warehouses  drop constraint warehouses_pkey cascade;
alter table public.warehouses  add primary key (company_id, id);

alter table public.maintenance_requests drop constraint maintenance_requests_pkey cascade;
alter table public.maintenance_requests add primary key (company_id, id);

alter table public.job_trailers drop constraint job_trailers_pkey cascade;
alter table public.job_trailers add primary key (company_id, id);

-- Keyed by role / key / user_id rather than id — same collision problem.
-- Two companies both have a 'manager' role and both have a 'company_logo' setting.
alter table public.role_permissions drop constraint role_permissions_pkey cascade;
alter table public.role_permissions add primary key (company_id, role);

alter table public.settings drop constraint settings_pkey cascade;
alter table public.settings add primary key (company_id, key);

alter table public.user_permission_overrides drop constraint user_permission_overrides_pkey cascade;
alter table public.user_permission_overrides add primary key (company_id, user_id);

alter table public.team_chat_reads drop constraint team_chat_reads_pkey cascade;
alter table public.team_chat_reads add primary key (company_id, user_id);

-- FKs come back composite, so a job in company A can never reference a trailer
-- in company B. The database now makes cross-tenant references structurally
-- impossible, not merely unlikely.
alter table public.job_trailers
  add constraint job_trailers_job_fkey
  foreign key (company_id, job_id) references public.jobs(company_id, id) on delete cascade;

alter table public.job_trailers
  add constraint job_trailers_trailer_fkey
  foreign key (company_id, trailer_id) references public.vehicles(company_id, id) on delete cascade;

-- The AccuLynx upsert in netlify/functions/acculynx-import.js uses
-- onConflict: 'acculynx_job_id', but no unique constraint on that column has ever
-- existed — so Postgres has been rejecting that ON CONFLICT outright and the
-- import is broken today. This adds the constraint it needs, scoped per company
-- (each company has its own AccuLynx account and its own job-id space).
alter table public.jobs
  add constraint jobs_company_acculynx_job_id_key unique (company_id, acculynx_job_id);

-- Queries still filter on bare id (.eq('id', id)), which no longer has the PK's
-- leading column. Cheap covering indexes so those stay fast.
create index if not exists jobs_id_idx      on public.jobs (id);
create index if not exists vehicles_id_idx  on public.vehicles (id);
create index if not exists inventory_id_idx on public.inventory (id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Backfill memberships from the existing profiles.
--
--    profiles.role is NOT dropped. Every Netlify function still reads it
--    (`callerProfile.role !== "admin"`), and dropping it in the same change that
--    rewrites every policy would mean two failure domains at once. It is now
--    DEPRECATED — memberships.role is the real one — and gets removed in a
--    follow-up once the code has moved over.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.memberships (user_id, company_id, role, active)
select p.id,
       (select id from public.companies where slug = 'maumee-river-roofing'),
       coalesce(p.role, 'employee'),
       coalesce(p.active, true)
from public.profiles p
on conflict (user_id, company_id) do nothing;

-- Everyone starts out looking at the only company that exists.
update public.profiles
set active_company_id = (select id from public.companies where slug = 'maumee-river-roofing')
where active_company_id is null;

-- profiles.email is how create-user.js decides "does this person already have an
-- account on the platform?" — the difference between inviting an existing user into
-- a second company and trying to create a duplicate account. The column exists but
-- may never have been populated, so backfill it from the source of truth.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and (p.email is null or p.email = '');

comment on column public.profiles.role is
  'DEPRECATED — authorization now reads memberships.role via active_role(). '
  'Kept only until the Netlify functions stop reading it. Do not add new uses.';

-- Carry the existing logo into companies.branding, where the pre-auth login
-- screen can read it via company_branding(slug) without exposing the settings
-- table to anon.
update public.companies c
set branding = c.branding || jsonb_build_object('logo', s.value)
from public.settings s
where c.slug = 'maumee-river-roofing'
  and s.key = 'company_logo'
  and s.company_id = c.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Policies.
--
--    Every existing policy is dropped. This is the whole point of the migration:
--    Postgres combines PERMISSIVE policies with OR, so leaving even one
--    "using (true)" policy in place would defeat every tenant policy below it and
--    silently expose all data to all companies.
--
--    The dynamic block guarantees nothing is missed — including any policy added
--    to the dashboard after I ran the introspection.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'inventory','vehicles','jobs','maintenance_requests','job_trailers',
        'warehouses','role_permissions','user_permission_overrides','settings',
        'team_chat_reads','team_chat_messages','audit_logs','vehicle_inspections',
        'profiles'
      )
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- Helper: does the given user share the company I'm currently working in?
-- SECURITY DEFINER so that reading memberships from inside a profiles policy
-- doesn't re-enter RLS and recurse.
create or replace function public.shares_active_company(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id    = target_user
      and m.company_id = public.active_company_id()
      and m.active
  );
$$;

-- ── the plain tenant tables ──────────────────────────────────────────────────
-- Same shape for each: you may touch a row if and only if it belongs to the
-- company you are currently active in. active_company_id() returns NULL for a
-- suspended or unpaid company, and `company_id = NULL` is NULL, which RLS treats
-- as false — so the portal simply goes empty. That is the kill switch.
do $$
declare t text;
begin
  foreach t in array array[
    'inventory','vehicles','jobs','maintenance_requests','job_trailers',
    'warehouses','vehicle_inspections'
  ] loop
    execute format($f$
      create policy tenant_all on public.%I
        for all to authenticated
        using       (company_id = public.active_company_id() or public.is_platform_admin())
        with check  (company_id = public.active_company_id() or public.is_platform_admin())
    $f$, t);
  end loop;
end $$;

-- ── settings ─────────────────────────────────────────────────────────────────
-- Note the anon "public logo read" policy is NOT recreated. It would now leak
-- every company's settings rows to the internet. The login screen gets branding
-- from company_branding(slug) instead. Until that lands (Phase 3), LoginScreen
-- falls back to the bundled mrrpic asset it already imports — a cosmetic change
-- on the login page only.
--
-- Writes stay open to any member of the company, matching today's behaviour:
-- job templates are written here by coordinators, not just admins. Tightening
-- that is a separate change; this migration deliberately does not alter who can
-- do what *within* a company, only which company they can do it to.
create policy settings_tenant_all on public.settings
  for all to authenticated
  using      (company_id = public.active_company_id() or public.is_platform_admin())
  with check (company_id = public.active_company_id() or public.is_platform_admin());

-- ── permissions config: readable by members, writable by that company's admins ──
create policy role_perms_select on public.role_permissions
  for select to authenticated
  using (company_id = public.active_company_id() or public.is_platform_admin());

create policy role_perms_write_admin on public.role_permissions
  for all to authenticated
  using      ((company_id = public.active_company_id() and public.active_role() = 'admin')
              or public.is_platform_admin())
  with check ((company_id = public.active_company_id() and public.active_role() = 'admin')
              or public.is_platform_admin());

create policy overrides_select on public.user_permission_overrides
  for select to authenticated
  using (company_id = public.active_company_id() or public.is_platform_admin());

create policy overrides_write_admin on public.user_permission_overrides
  for all to authenticated
  using      ((company_id = public.active_company_id() and public.active_role() = 'admin')
              or public.is_platform_admin())
  with check ((company_id = public.active_company_id() and public.active_role() = 'admin')
              or public.is_platform_admin());

-- ── audit_logs: append-only, admin-readable. Preserves the existing shape. ────
create policy audit_insert_member on public.audit_logs
  for insert to authenticated
  with check (company_id = public.active_company_id());

create policy audit_select_admin on public.audit_logs
  for select to authenticated
  using ((company_id = public.active_company_id() and public.active_role() = 'admin')
         or public.is_platform_admin());

-- No UPDATE or DELETE policy exists, and with RLS on that means nobody can do
-- either — which is stronger than the old explicit `using (false)` policies and
-- is what an audit log should be. The nightly archive cron runs as service_role,
-- which bypasses RLS entirely, so it is unaffected.

-- ── team chat: read your company's, write only as yourself ───────────────────
create policy chat_select on public.team_chat_messages
  for select to authenticated
  using (company_id = public.active_company_id() or public.is_platform_admin());

create policy chat_insert_own on public.team_chat_messages
  for insert to authenticated
  with check (company_id = public.active_company_id() and user_id = auth.uid());

create policy chat_modify_own on public.team_chat_messages
  for update to authenticated
  using      (company_id = public.active_company_id() and user_id = auth.uid())
  with check (company_id = public.active_company_id() and user_id = auth.uid());

create policy chat_delete_own on public.team_chat_messages
  for delete to authenticated
  using (company_id = public.active_company_id() and user_id = auth.uid());

create policy chat_reads_own on public.team_chat_reads
  for all to authenticated
  using      (company_id = public.active_company_id() and user_id = auth.uid())
  with check (company_id = public.active_company_id() and user_id = auth.uid());

-- ── profiles ─────────────────────────────────────────────────────────────────
-- profiles stays global: one row per human, because auth.users is global. The
-- tenancy lives in memberships. So "who can see this profile" is answered by
-- shared membership, not by a company_id column.
create policy profiles_select_same_company on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.shares_active_company(id)
    or public.is_platform_admin()
  );

-- Admins may edit profiles of people in their own company only.
create policy profiles_update_company_admin on public.profiles
  for update to authenticated
  using      ((public.active_role() = 'admin' and public.shares_active_company(id))
              or public.is_platform_admin())
  with check ((public.active_role() = 'admin' and public.shares_active_company(id))
              or public.is_platform_admin());

-- Anyone may edit their own profile, but not their own role or active flag.
-- (is_platform_admin and active_company_id are additionally blocked by the
-- column-level REVOKE in 01 — RLS alone cannot restrict individual columns.)
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role   is not distinct from (select p.role   from public.profiles p where p.id = auth.uid())
    and active is not distinct from (select p.active from public.profiles p where p.id = auth.uid())
  );

-- Profile rows are created by the handle_new_user() trigger (SECURITY DEFINER)
-- and by the create-user Netlify function (service_role). Both bypass RLS, so no
-- INSERT policy is needed — and not having one means the client cannot forge
-- profiles.

commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- AFTER RUNNING THIS, THE APP IS NOT YET CORRECT. Still required:
--
--   1. Make yourself platform admin (replace with your email):
--        update profiles set is_platform_admin = true
--        where id = (select id from auth.users where email = 'you@maumeeriverroofing.com');
--
--   2. Netlify functions — they use the service-role key, which BYPASSES RLS
--      completely. None of the above protects them. Each must derive the caller's
--      company and filter by it explicitly:
--        - acculynx-import.js  → must set company_id on the rows it upserts, and
--                                change onConflict to 'company_id,acculynx_job_id'.
--                                ACCULYNX_API_KEY must move to companies.integrations.
--        - chat.js             → every .from(...) query must .eq('company_id', ...)
--        - create-user.js      → must insert a memberships row, not just a profile
--        - delete-user.js      → should delete the membership, not the whole user
--        - send-alert / send-email / weather → scope their profiles lookups
--
--   3. handle_new_user() — review it. New signups get a profile but no membership,
--      so active_company_id() returns NULL and they see an empty portal. That is
--      the correct fail-closed behaviour, but confirm the trigger doesn't error.
--
--   4. check_inventory_stock_level() — a SECURITY DEFINER trigger on inventory
--      that I could not read. If it reads or writes other tables, it needs to be
--      company-aware.
--
--   5. Storage. All five buckets are PUBLIC with policies that only check
--      bucket_id. Photos are not covered by any of the RLS above. Company-scoped
--      paths (company_id/...) plus real storage policies are a separate migration.
--
--   6. Frontend — role now comes from memberships, not profiles. See
--      src/database/permissions.js, src/views/LoginScreen.jsx, useAppData.js.
-- ═════════════════════════════════════════════════════════════════════════════
