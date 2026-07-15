-- Phase 4b — seat limits.
--
-- Pricing: $99/month includes 10 users. Each additional block of 5 users is +$10/mo.
-- So a company's seat ceiling is  10 + 5 × (number of $10 add-on packs).
--
-- seat_capacity holds that ceiling as a plain number the app can enforce against
-- without calling Stripe on every user-add. The Stripe webhook is the source of
-- truth: it recomputes seat_capacity from the live subscription's line items.
--
-- NULL = unlimited. That's for comped / manually-activated companies (Maumee River),
-- which have no Stripe subscription and must not be capped. Only Stripe-billed
-- companies carry a numeric ceiling.
--
-- Run after 08. Idempotent.

begin;

alter table public.companies
  add column if not exists seat_capacity integer;  -- NULL = unlimited (comped)

-- Existing companies are all comped today (only Maumee River exists, and you don't
-- bill yourself) → leave them NULL = unlimited. New self-serve companies get a
-- number set by the webhook when their base subscription activates.
--   (no backfill needed: the column defaults to NULL, which is exactly 'unlimited')

-- ── How many seats is a company using, and what's its ceiling? ───────────────
-- Readable by that company's own admins (for the Billing tab) and by you.
create or replace function public.company_seat_status(target uuid default null)
returns table (used integer, capacity integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  co uuid := coalesce(target, public.active_company_id());
begin
  -- A company admin may only ask about their OWN company; the platform owner, any.
  if not public.is_platform_admin()
     and (co is distinct from public.active_company_id() or public.active_role() <> 'admin') then
    raise exception 'Not allowed';
  end if;

  return query
    select (select count(*)::int from public.memberships m where m.company_id = co and m.active),
           (select c.seat_capacity from public.companies c where c.id = co);
end;
$$;

grant execute on function public.company_seat_status(uuid) to authenticated;

-- ── The enforcement gate ─────────────────────────────────────────────────────
-- True when the company has room for one more active user. NULL capacity = always
-- room. Used by admin_add_company_admin (below) and by the create-user Netlify
-- function before it adds a membership.
create or replace function public.company_has_seat(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (select seat_capacity from public.companies where id = target) is null then true
    else (select count(*) from public.memberships where company_id = target and active)
         < (select seat_capacity from public.companies where id = target)
  end;
$$;

grant execute on function public.company_has_seat(uuid) to authenticated, service_role;

-- ── Owner override, for comped or special-deal companies ─────────────────────
-- Lets you set (or clear → unlimited) a company's ceiling by hand from the console,
-- independent of Stripe.
create or replace function public.admin_set_company_seats(target uuid, capacity integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  update public.companies set seat_capacity = capacity where id = target;
end;
$$;

grant execute on function public.admin_set_company_seats(uuid, integer) to authenticated;

-- ── Bake the cap into the existing add-admin RPC ─────────────────────────────
-- Recreate admin_add_company_admin (from 06) with a seat check. The platform owner
-- bypasses the cap (they can always seat someone); a company admin cannot.
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

  -- Only counts against the cap if they're NOT already a member (re-inviting an
  -- existing member just re-activates them and takes no new seat).
  if not exists (select 1 from public.memberships where user_id = target_user and company_id = target_company)
     and not public.company_has_seat(target_company) then
    raise exception 'Company is at its seat limit. Add a seat pack first.';
  end if;

  insert into public.memberships (user_id, company_id, role, active)
  values (target_user, target_company, 'admin', true)
  on conflict (user_id, company_id) do update set role = 'admin', active = true;

  update public.profiles set active_company_id = target_company
  where id = target_user and active_company_id is null;

  return target_user;
end;
$$;

grant execute on function public.admin_add_company_admin(uuid, text) to authenticated;

commit;
