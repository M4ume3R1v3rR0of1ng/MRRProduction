-- Phase 1a — tenancy core.
--
-- Creates the company layer and the helper functions every RLS policy will call.
-- It touches no existing business table, so it is safe to run on its own: nothing
-- in the app reads these objects yet.
--
-- 01 (this file) = new objects only.
-- 02 (next file) = adds company_id to the 14 existing tables and rewrites their
--                  policies. That one is destructive and needs the introspection
--                  output first.

begin;

-- ── companies ────────────────────────────────────────────────────────────────
create table if not exists public.companies (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  slug                    text not null unique,   -- url-safe: 'maumee-river-roofing'
  subscription_status     text not null default 'trialing',
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  trial_ends_at           timestamptz,
  -- logo (data uri or storage path), colors, display name. Read pre-auth by the
  -- login screen, so it must never hold anything secret.
  branding                jsonb not null default '{}'::jsonb,
  -- per-company integration config: acculynx api key, etc. NEVER exposed to anon.
  integrations            jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),

  constraint companies_subscription_status_check check (
    subscription_status in ('trialing','active','past_due','canceled','suspended')
  )
);

-- 'suspended' is distinct from 'canceled' on purpose: canceled is what Stripe
-- writes when billing lapses, suspended is the manual kill switch you control
-- from the owner dashboard. Keeping them separate means a support-driven
-- suspension can't be silently undone by a stray Stripe webhook.

-- ── memberships ──────────────────────────────────────────────────────────────
-- One user may belong to several companies, with a different role in each.
-- This is why role does NOT live on profiles.
create table if not exists public.memberships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  role        text not null default 'employee',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (user_id, company_id)
);

create index if not exists memberships_company_id_idx on public.memberships (company_id);

-- ── profiles gains: which company am I looking at, and am I the landlord ─────
alter table public.profiles
  add column if not exists active_company_id  uuid references public.companies(id),
  add column if not exists is_platform_admin  boolean not null default false;

-- A user must never be able to promote themselves to platform admin, or to
-- point active_company_id at a company they don't belong to. RLS is row-level,
-- not column-level, so these are enforced with column privileges instead. The
-- set_active_company() function below is the only sanctioned way in.
revoke update (is_platform_admin, active_company_id) on public.profiles from authenticated;

-- ── helper functions ─────────────────────────────────────────────────────────
-- All three are SECURITY DEFINER. That is load-bearing: they read profiles /
-- memberships / companies, and those tables have RLS policies that call these
-- very functions. Without SECURITY DEFINER to bypass RLS inside the function
-- body, Postgres recurses infinitely and every query fails.
-- search_path is pinned so a caller can't shadow `public` with a malicious schema.

-- Is the caller the platform owner (you)?
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- The single source of truth for "which company's data may the caller see right now".
--
-- Returns NULL — not an error — when the user is inactive, has no membership, or
-- the company isn't paid up. NULL makes every `company_id = active_company_id()`
-- comparison evaluate to NULL, which RLS treats as false. So the whole app fails
-- CLOSED: a lapsed company can still log in and sees an empty portal.
--
-- 'past_due' is intentionally still allowed. Stripe retries a failed card for
-- roughly two weeks before giving up; locking a roofing company out of its live
-- job data the instant a card expires would be the wrong call. They lose access
-- when Stripe finally moves them to 'canceled'.
create or replace function public.active_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.company_id
  from public.profiles p
  join public.memberships m
    on  m.user_id    = p.id
    and m.company_id = p.active_company_id
  join public.companies c
    on  c.id = m.company_id
  where p.id = auth.uid()
    and p.active
    and m.active
    and c.subscription_status in ('trialing','active','past_due');
$$;

-- The caller's role *within the company they're currently in*.
-- Replaces the old profiles.role for all permission checks.
create or replace function public.active_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from public.memberships m
  where m.user_id = auth.uid()
    and m.company_id = public.active_company_id();
$$;

-- The only sanctioned way to switch companies. Verifies the caller actually
-- belongs to the target before pointing them at it.
create or replace function public.set_active_company(target uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.company_id = target
      and m.active
  ) then
    raise exception 'not a member of that company';
  end if;

  update public.profiles set active_company_id = target where id = auth.uid();
end;
$$;

revoke all on function public.set_active_company(uuid) from public;
grant execute on function public.set_active_company(uuid) to authenticated;

-- ── RLS on the new tables ────────────────────────────────────────────────────
alter table public.companies   enable row level security;
alter table public.memberships enable row level security;

-- Anon gets NO access to companies. The login screen needs a company's name and
-- logo before the user authenticates, but a blanket anon SELECT would publish
-- your entire customer list to anyone who reads the JS bundle. The RPC at the
-- bottom of this file hands out branding for ONE known slug instead, so the
-- table can't be enumerated.
create policy companies_select_own on public.companies
  for select to authenticated
  using (id = public.active_company_id() or public.is_platform_admin());

-- Only you can create companies or change a subscription_status. Company admins
-- editing their own branding comes later, through a narrow RPC — not by opening
-- UPDATE on this table, which would also open subscription_status.
create policy companies_platform_admin_all on public.companies
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- A user can see their own memberships (needed to render a company switcher),
-- and can see fellow members of the company they're currently in.
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or company_id = public.active_company_id()
    or public.is_platform_admin()
  );

-- Membership changes go through the create-user / delete-user Netlify functions,
-- which hold the service-role key. No direct client writes.
create policy memberships_platform_admin_all on public.memberships
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ── pre-auth branding lookup ─────────────────────────────────────────────────
-- Returns only the safe columns, only for a slug the caller already knows.
-- SECURITY DEFINER so it can read past the RLS policy above; it deliberately
-- never returns subscription_status, stripe ids, or integrations.
create or replace function public.company_branding(company_slug text)
returns table (id uuid, name text, slug text, branding jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name, c.slug, c.branding
  from public.companies c
  where c.slug = company_slug
    and c.subscription_status <> 'canceled';
$$;

grant execute on function public.company_branding(text) to anon, authenticated;

commit;
