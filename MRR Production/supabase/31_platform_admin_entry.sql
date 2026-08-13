-- Phase 31 — let the platform owner enter a tenant they do not belong to.
--
-- THE PROBLEM
--
-- Supporting a customer meant granting yourself a membership in their company,
-- which consumes one of their seats, shows you in their user list as staff, and
-- has to be remembered and undone afterwards. The Owner Console's drill-in is
-- read-only, so anything beyond looking required that seat.
--
-- WHY THIS TOUCHES active_company_id() AND NOT JUST set_active_company()
--
-- Loosening only the setter would half-work in the worst way. Reads would look
-- fine, because every tenant policy is
--     company_id = active_company_id() OR is_platform_admin()
-- and the second half already carries a platform admin. But:
--
--   * company_id on all 14 tenant tables is NOT NULL DEFAULT active_company_id()
--     (02_tenancy_tables.sql:85). With that returning NULL, every insert that
--     relies on the default dies on a not-null violation.
--   * audit_logs' insert policy is `with check (company_id = active_company_id())`
--     with NO platform-admin escape, so owner actions would go unlogged — the
--     exact opposite of what support access needs.
--   * active_role() reads from memberships, so has_perm() would see NULL and deny
--     every permission check.
--
-- So the resolver is the right place. One change, and defaults, audit, and
-- permissions all become consistent.
--
-- WHAT IS *NOT* WIDENED
--
-- No new read access. A platform admin could already read every company's rows
-- through the OR half of every policy; that is what the Owner Console runs on.
-- This only makes "which company am I acting in" answerable for them, which turns
-- existing read access into a coherent session.
--
-- The subscription gate is deliberately NOT applied to the platform-admin path. A
-- canceled or suspended tenant is precisely when you need to get in and look, and
-- the owner cannot be locked out of their own product by a billing state.
--
-- Run after 30. Idempotent.

begin;

-- ── Which company am I acting in? ────────────────────────────────────────────
-- Unchanged for everyone who is not a platform admin: membership-backed and
-- subscription-gated, returning NULL (not an error) so RLS fails closed.
--
-- The second branch is the new one. It is reached ONLY when the first returns
-- nothing, so a platform admin working inside a company they are genuinely a
-- member of still goes down the normal path and is still subscription-gated
-- there. coalesce short-circuits, so the extra lookup costs nothing in the
-- overwhelmingly common case.
create or replace function public.active_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
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
        and c.subscription_status in ('trialing','active','past_due')
    ),
    (
      select p.active_company_id
      from public.profiles p
      where p.id = auth.uid()
        and p.active
        and p.active_company_id is not null
        and public.is_platform_admin()
    )
  );
$$;

-- ── What can I do in it? ─────────────────────────────────────────────────────
-- A platform admin inside a company they don't belong to has no membership row to
-- read a role from. They act as 'admin' there: the console already grants them
-- full read across every tenant, so returning anything lesser would produce the
-- confusing half-state where they can see a job but not close it.
create or replace function public.active_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select m.role
      from public.memberships m
      where m.user_id = auth.uid()
        and m.company_id = public.active_company_id()
    ),
    case when public.is_platform_admin() then 'admin' else null end
  );
$$;

-- ── Entering a company ───────────────────────────────────────────────────────
-- Still the only sanctioned way in, and still verifies membership for ordinary
-- users. The platform-admin branch checks the company EXISTS, because without a
-- membership lookup there is nothing else stopping a typo from pointing a profile
-- at a random uuid — which would then be written into company_id defaults.
create or replace function public.set_active_company(target uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_platform_admin() then
    if not exists (select 1 from public.companies c where c.id = target) then
      raise exception 'no such company';
    end if;
  elsif not exists (
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

-- ── Am I a guest in here? ────────────────────────────────────────────────────
-- True when the caller is operating inside a company they hold no active
-- membership in. The app uses this to keep a persistent banner on screen: acting
-- inside someone else's tenant must never be a state you can forget you are in.
create or replace function public.is_visiting_company()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.active_company_id() is not null
     and not exists (
       select 1
       from public.memberships m
       where m.user_id = auth.uid()
         and m.company_id = public.active_company_id()
         and m.active
     );
$$;

grant execute on function public.is_visiting_company() to authenticated;

commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verify — the second and third checks are the ones that matter.
--
--   1. As a NON platform admin, confirm nothing changed:
--        select public.set_active_company('<a company you are not in>');
--      → still raises 'not a member of that company'.
--
--   2. As the platform admin, enter a tenant you have no membership in, then:
--        select public.active_company_id();   -- that company's id
--        select public.active_role();         -- 'admin'
--        select public.is_visiting_company(); -- true
--
--   3. Back in your OWN company:
--        select public.is_visiting_company(); -- false
--
--   4. Confirm an ordinary member of a LAPSED company is still shut out — the
--      subscription gate must not have leaked into the normal path:
--        select public.active_company_id();   -- NULL for them
-- ═════════════════════════════════════════════════════════════════════════════
