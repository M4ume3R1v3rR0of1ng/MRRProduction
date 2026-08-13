-- Phase 29 — require a second factor from accounts that have one.
--
-- The point of this file is that hiding the Owner Console in the UI is not a
-- security boundary. is_platform_admin() bypasses every RLS policy in the
-- database, so it is the highest-value credential on the platform, and until now
-- a password alone opened it. supabase.auth.mfa gives us the factor; this makes
-- the DATA layer care about it, so a stolen password cannot read another
-- company's jobs even by calling the RPCs directly with a raw token.
--
-- LOCKOUT SAFETY — read before running.
--
-- The gate is "aal2 OR you have no verified factor". That shape is deliberate:
--
--   * Nobody who has not enrolled is affected. Every existing login keeps working
--     exactly as it does today.
--   * Enrolling raises the bar for yourself only, and the enrollment flow verifies
--     the factor in-session, which upgrades that same session to aal2 immediately.
--     So you can never enrol and lock yourself out in the same breath.
--
-- If a platform admin does lose their authenticator, recovery is one statement
-- run from the Supabase SQL editor (service_role, which is not subject to this):
--
--   delete from auth.mfa_factors
--   where user_id = (select id from auth.users where email = 'sam@steadwerk.com');
--
-- That drops them back to password-only and the OR branch lets them in again.
--
-- Idempotent. Run after 28.

begin;

-- ── The gate ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because auth.mfa_factors is not readable by `authenticated`.
-- search_path is pinned for the same reason as every other function here: a
-- caller must not be able to shadow `public` with their own schema.
--
-- coalesce on the claim matters. A token minted before MFA existed has no 'aal'
-- claim at all, and `null = 'aal2'` is null, which would make this return null
-- rather than false and quietly turn the gate off. Treat a missing claim as aal1.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = auth.uid()
        and f.status = 'verified'
    );
$$;

grant execute on function public.mfa_satisfied() to authenticated;

-- ── Apply it where it counts ─────────────────────────────────────────────────
-- Folding the check into is_platform_admin() rather than into each of the eight
-- admin RPCs means there is exactly one place to get right, and every current
-- AND future caller inherits it — the RPCs in 06, the companies/memberships
-- policies in 01, and anything added later.
--
-- The degradation is deliberate and gentle: an enrolled owner sitting at aal1 is
-- not locked out of the app, they simply stop being the landlord for that
-- session. Their own company membership still resolves, so they land in their
-- portal as a normal admin and the Owner Console returns nothing.
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
  )
  and public.mfa_satisfied();
$$;

commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY, in this order:
--
--   1. Before enrolling, sign in as the platform admin. The Owner Console still
--      lists every company. (The OR branch is carrying you.)
--   2. Enrol a factor in Profile → Two-Factor Authentication. The console keeps
--      working without a reload — verification upgraded the live session.
--   3. Sign out and back in. You are asked for a 6-digit code before the app
--      loads, and the console works after it.
--   4. select public.mfa_satisfied();  -- true at aal2
-- ═════════════════════════════════════════════════════════════════════════════
