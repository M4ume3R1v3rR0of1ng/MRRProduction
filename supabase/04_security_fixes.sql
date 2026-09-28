-- Phase 1d — close the holes the isolation test found.
--
-- scripts/verify-tenant-isolation.mjs caught four real defects, all from ONE wrong
-- assumption on my part: that a column-level REVOKE could carve an exception out of
-- a table-level GRANT. In PostgreSQL it cannot — "a table-level grant is unaffected
-- by a column-level operation" — and Supabase grants table-level SELECT/UPDATE to the
-- `authenticated` role on every table. So the column REVOKEs in 01 and 03 were no-ops:
--
--   1. a tenant admin could set is_platform_admin = true on themselves  (escalation)
--   2. …and then read/modify every company, because is_platform_admin() now returned true
--   3. a tenant admin could set their own active_company_id to another company
--   4. the AccuLynx API key column was SELECTable straight from the browser
--
-- Fixes here use mechanisms that DON'T depend on column privileges:
--   • a BEFORE UPDATE trigger guards the two privileged profiles columns
--   • secrets move into their own table that has NO grant to anyone
--
-- Run after 03. Idempotent where it can be.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Guard the privileged columns on profiles with a trigger.
--
--    A trigger fires no matter which RLS policy let the row through and no matter
--    what column grants exist — it is the one enforcement point column privileges
--    could not give us.
--
--    current_user is the lever: a direct PostgREST request runs as 'authenticated'
--    or 'anon'; inside a SECURITY DEFINER function (set_active_company) it is the
--    function owner; a service-role request is 'service_role'. So "block when
--    current_user is a browser role" allows exactly the sanctioned paths
--    (set_active_company, the create-user/delete-user functions) and nothing else.
--
--    The trigger function is SECURITY INVOKER (the default) on purpose — DEFINER
--    would rewrite current_user to the owner and defeat the very check it makes.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.is_platform_admin is distinct from old.is_platform_admin then
      raise exception 'is_platform_admin cannot be changed by a client';
    end if;
    if new.active_company_id is distinct from old.active_company_id then
      raise exception 'active_company_id can only be changed via set_active_company()';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profiles_privileged on public.profiles;
create trigger guard_profiles_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Move secrets off `companies` into their own ungranted table.
--
--    integrations (the AccuLynx key) and the Stripe ids do not belong in a table the
--    browser can SELECT. A column REVOKE can't hide them (see the header). Splitting
--    them into a table with no grant to anon/authenticated makes them unreadable by
--    structure, not by a privilege rule that a default grant can quietly override.
--
--    Bonus: `companies` is now safe to SELECT in full, so the membership→company
--    name joins in LoginScreen and CompanySwitcher keep working untouched, and the
--    future owner console can read companies through RLS without ever seeing a secret.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.company_secrets (
  company_id             uuid primary key references public.companies(id) on delete cascade,
  integrations           jsonb not null default '{}'::jsonb,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique
);

-- Carry existing values across (integrations may hold Maumee River's AccuLynx key
-- once it's saved; today it's likely empty, which is fine).
insert into public.company_secrets (company_id, integrations, stripe_customer_id, stripe_subscription_id)
select id,
       coalesce(integrations, '{}'::jsonb),
       stripe_customer_id,
       stripe_subscription_id
from public.companies
on conflict (company_id) do nothing;

-- Every company must have a secrets row, including any created before this ran.
insert into public.company_secrets (company_id)
select id from public.companies
on conflict (company_id) do nothing;

-- Drop the columns from companies now that they live in company_secrets.
alter table public.companies
  drop column if exists integrations,
  drop column if exists stripe_customer_id,
  drop column if exists stripe_subscription_id;

-- RLS on, and NO policy for authenticated/anon → default deny. Only service_role
-- (which bypasses RLS) and SECURITY DEFINER functions owned by postgres can touch it.
alter table public.company_secrets enable row level security;
revoke all on public.company_secrets from anon, authenticated;

-- New companies need their secrets row created automatically.
create or replace function public.create_company_secrets_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.company_secrets (company_id) values (new.id)
  on conflict (company_id) do nothing;
  return new;
end;
$$;

drop trigger if exists companies_create_secrets on public.companies;
create trigger companies_create_secrets
  after insert on public.companies
  for each row execute function public.create_company_secrets_row();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Re-point the config functions from 03 at company_secrets.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_company_integration(k text, v jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := public.active_company_id();
begin
  if target is null then
    raise exception 'No active company';
  end if;
  if public.active_role() <> 'admin' and not public.is_platform_admin() then
    raise exception 'Admin access required';
  end if;

  insert into public.company_secrets (company_id, integrations)
  values (target, jsonb_build_object(k, v))
  on conflict (company_id)
  do update set integrations = public.company_secrets.integrations || jsonb_build_object(k, v);
end;
$$;

grant execute on function public.set_company_integration(text, jsonb) to authenticated;

create or replace function public.company_integration_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'acculynxConfigured',
      coalesce(nullif(s.integrations->>'acculynxApiKey', ''), null) is not null
  )
  from public.company_secrets s
  where s.company_id = public.active_company_id();
$$;

grant execute on function public.company_integration_status() to authenticated;

-- A service-side reader for the Netlify functions. They use the service-role key so
-- they could read company_secrets directly, but going through one function keeps the
-- "where the AccuLynx key lives" knowledge in a single place.
create or replace function public.company_integration(target uuid, k text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.integrations->k from public.company_secrets s where s.company_id = target;
$$;

revoke all on function public.company_integration(uuid, text) from public, anon, authenticated;
grant execute on function public.company_integration(uuid, text) to service_role;

commit;
