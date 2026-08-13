-- Phase 32 — mark a company as the platform operator's own tenant.
--
-- Steadwerk is a company row like any other, but it is not a roofing business. It
-- has no jobs, no inventory, no trucks and never will. Signing in there still
-- rendered the full operational portal — Pull Inventory, Fleet, Schedule, a
-- dashboard of zeroes — because the app has no way to tell "runs roofing crews"
-- from "runs the platform".
--
-- WHY A COLUMN AND NOT A PERMISSION
--
-- Permissions cannot express this. getEffectivePerms() short-circuits role 'admin'
-- to every permission true (src/database/permissions.js), so switching perms off
-- for Steadwerk's admins does nothing at all. Even if it did, the nav items that
-- matter most here — Dashboard, Schedule, Pull Inventory — are ungated in the
-- sidebar and would survive.
--
-- WHY NOT JUST "is the viewer a platform admin"
--
-- Because that is a property of the PERSON, and it would strip the operational app
-- from a platform admin who also runs a real company. Whoever administers the
-- platform while working daily in Maumee River would lose Jobs, Inventory and
-- Fleet there. The distinction belongs to the COMPANY: this tenant is not an
-- operating business.
--
-- It also correctly follows you around. Enter a customer's company from the Owner
-- Console and is_platform_company is false for THAT company, so the full portal
-- comes back — which is exactly what you went in there to use.
--
-- Run after 31. Idempotent.

begin;

alter table public.companies
  add column if not exists is_platform_company boolean not null default false;

comment on column public.companies.is_platform_company is
  'True for the platform operator''s own tenant (Steadwerk). Such a company runs no '
  'roofing operations, so the app hides the operational views and lands on the Owner '
  'Console instead. Property of the COMPANY, not of the viewer — a platform admin who '
  'also works in a real operating company keeps the full portal there. See supabase/32.';

-- Writable only by a platform admin, same as every other column on this table
-- (companies_platform_admin_all, supabase/01).

-- my_company() has a fixed RETURNS TABLE column list, so a new column on
-- `companies` does NOT appear in it — the app reads its active company through
-- this RPC and would never see the flag. Widen it. Additive only: the four
-- existing columns keep their names, types and order, so every current caller is
-- unaffected.
--
-- DROP first, not CREATE OR REPLACE. Adding an OUT column changes the function's
-- return type, and Postgres refuses that on a replace with "cannot change return
-- type of existing function". The drop also discards the grant, which is why it
-- is reissued below.
drop function if exists public.my_company();

create function public.my_company()
returns table (id uuid, name text, slug text, branding jsonb, is_platform_company boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name, c.slug, c.branding, c.is_platform_company
  from public.companies c
  where c.id = public.active_company_id();
$$;

grant execute on function public.my_company() to authenticated;

-- Set it for the operator's tenant. Idempotent, and a no-op if the slug differs —
-- the verify block below is how you find out which happened.
update public.companies
set is_platform_company = true
where slug = 'steadwerk';

commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verify
--
--   select name, slug, is_platform_company from public.companies order by name;
--
-- EXACTLY ONE row should be true, and it must be Steadwerk. If none are, the slug
-- is not 'steadwerk' — set it by hand against the real slug:
--
--   update public.companies set is_platform_company = true where slug = '<yours>';
--
-- If a CUSTOMER's row is true, unset it immediately. That company's staff would
-- lose Jobs, Inventory, Fleet and Pull Inventory — the entire product they pay
-- for — on their next page load:
--
--   update public.companies set is_platform_company = false where slug = '<theirs>';
-- ═════════════════════════════════════════════════════════════════════════════
