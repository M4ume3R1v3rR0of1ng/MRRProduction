-- Phase 2 — the owner console's data layer.
--
-- These RPCs are the ONLY way the platform owner (you) reaches across every company.
-- Each one re-checks is_platform_admin() itself and raises if the caller isn't you —
-- SECURITY DEFINER means they bypass RLS, so that guard is the whole security boundary.
-- A normal company admin calling any of these gets an exception, not data.
--
-- Run after 04. Idempotent.

begin;

-- ── List every company, with the numbers the console shows ───────────────────
create or replace function public.admin_list_companies()
returns table (
  id                  uuid,
  name                text,
  slug                text,
  subscription_status text,
  trial_ends_at       timestamptz,
  created_at          timestamptz,
  user_count          bigint,
  active_user_count   bigint,
  last_activity       timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  -- Subquery columns are alias-qualified so no bare `created_at` can collide with the
  -- RETURNS TABLE OUT column of the same name (that collision threw
  -- "column reference created_at is ambiguous"; see 11_fix_admin_list.sql).
  return query
    select c.id, c.name, c.slug, c.subscription_status, c.trial_ends_at, c.created_at,
           coalesce(m.total, 0),
           coalesce(m.active, 0),
           a.last_activity
    from public.companies c
    left join (
      select mm.company_id,
             count(*)                          as total,
             count(*) filter (where mm.active) as active
      from public.memberships mm
      group by mm.company_id
    ) m on m.company_id = c.id
    left join (
      select al.company_id, max(al.created_at) as last_activity
      from public.audit_logs al
      group by al.company_id
    ) a on a.company_id = c.id
    order by c.created_at;
end;
$$;

grant execute on function public.admin_list_companies() to authenticated;

-- ── The manual kill switch / reactivate ──────────────────────────────────────
-- 'suspended' is the owner's deliberate lever, distinct from Stripe's 'canceled'
-- (see 01) — so a support suspension can't be silently undone by a billing webhook.
create or replace function public.admin_set_company_status(target uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  if new_status not in ('trialing','active','past_due','canceled','suspended') then
    raise exception 'Invalid status: %', new_status;
  end if;

  update public.companies set subscription_status = new_status where id = target;
  if not found then
    raise exception 'No such company';
  end if;
end;
$$;

grant execute on function public.admin_set_company_status(uuid, text) to authenticated;

-- ── Create a company by hand (your onboarding flow until Stripe self-serve) ───
-- The companies AFTER INSERT trigger from 04 creates the matching company_secrets
-- row automatically. Returns the new id so the console can immediately let you add
-- its first admin user.
create or replace function public.admin_create_company(
  p_name text,
  p_slug text,
  p_status text default 'trialing'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Company name is required';
  end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Slug must be url-safe (lowercase letters, numbers, hyphens): %', p_slug;
  end if;
  if p_status is null or p_status not in ('trialing','active','past_due','canceled','suspended') then
    raise exception 'Invalid status: %', p_status;
  end if;

  insert into public.companies (name, slug, subscription_status, branding)
  values (trim(p_name), p_slug, p_status, jsonb_build_object('displayName', trim(p_name)))
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.admin_create_company(text, text, text) to authenticated;

-- ── Add the first admin to a freshly created company ─────────────────────────
-- After creating a company you need to attach its first user. This links an EXISTING
-- auth user (by email) as an admin. Creating a brand-new auth account still goes
-- through the create-user Netlify function; this is the "the person already has a
-- login" path, and the console's typical flow (you inviting the brother, who then
-- adds his own staff).
create or replace function public.admin_add_company_admin(target_company uuid, user_email text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  select id into target_user from public.profiles where lower(email) = lower(user_email);
  if target_user is null then
    raise exception 'No account with email %. Create the user first.', user_email;
  end if;

  insert into public.memberships (user_id, company_id, role, active)
  values (target_user, target_company, 'admin', true)
  on conflict (user_id, company_id) do update set role = 'admin', active = true;

  -- Point them at the new company only if they aren't already working in one.
  update public.profiles set active_company_id = target_company
  where id = target_user and active_company_id is null;

  return target_user;
end;
$$;

grant execute on function public.admin_add_company_admin(uuid, text) to authenticated;

commit;
