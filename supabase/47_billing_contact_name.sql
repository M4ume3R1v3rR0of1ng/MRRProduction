-- Phase 47 — a billing contact name on every company.
--
-- Run after 46. Idempotent.
--
-- WHY
--
-- The Stripe customer created at signup (create-checkout.js) is named after the
-- COMPANY ("Maumee River Roofing"), never the person who actually signed up. That's
-- fine for Stripe's own dashboard, but it means there is nowhere to pull an actual
-- human's name from when building a custom email to a customer — only a business
-- name and an inbox address. Comped companies (admin_create_company) never even
-- collect that name in the first place.
--
-- WHAT THIS DOES
--
-- companies.billing_contact_name: one free-text name per company, meant to hold
-- whoever should be addressed on billing emails/receipts for that account.
--
--   * create-checkout.js now stamps it from the signup form's existing "your name"
--     field the moment a company is provisioned (see its own diff).
--   * update-billing-contact.js (new) lets a company admin set or correct it later
--     from the Billing tab, and mirrors it onto the Stripe customer's metadata
--     (contact_name) when the company has one, so it travels with the customer
--     record for anyone pulling data on the Stripe side too.
--
-- Exposed read-only on my_company() (so BillingView can prefill the field) and on
-- admin_list_companies() (so the owner console — and anyone exporting that list —
-- can pull it across every company at once).

begin;

alter table public.companies
  add column if not exists billing_contact_name text;

-- ── my_company(): add billing_contact_name, same shape otherwise as 32 ─────────
-- CREATE OR REPLACE cannot change a RETURNS TABLE shape (new OUT column) — Postgres
-- requires the old signature dropped first (42P13: cannot change return type).
drop function if exists public.my_company();

create or replace function public.my_company()
returns table (
  id                   uuid,
  name                 text,
  slug                 text,
  branding             jsonb,
  is_platform_company  boolean,
  billing_contact_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name, c.slug, c.branding, c.is_platform_company, c.billing_contact_name
  from public.companies c
  where c.id = public.active_company_id();
$$;

grant execute on function public.my_company() to authenticated;

-- ── admin_list_companies(): add billing_contact_name, same shape otherwise as 11 ─
-- Same reason as above: dropped first because the OUT column list is changing.
drop function if exists public.admin_list_companies();

create or replace function public.admin_list_companies()
returns table (
  id                    uuid,
  name                  text,
  slug                  text,
  subscription_status   text,
  trial_ends_at         timestamptz,
  created_at            timestamptz,
  user_count            bigint,
  active_user_count     bigint,
  last_activity         timestamptz,
  billing_contact_name  text
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

  return query
    select c.id, c.name, c.slug, c.subscription_status, c.trial_ends_at, c.created_at,
           coalesce(m.total, 0),
           coalesce(m.active, 0),
           a.last_activity,
           c.billing_contact_name
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

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   select proname, pg_get_function_result(oid)
--   from pg_proc
--   where proname in ('my_company','admin_list_companies') and pronamespace = 'public'::regnamespace;
--   -- Both should list billing_contact_name in their result.
--
--   select id, name, billing_contact_name from public.companies order by created_at desc limit 5;
--   -- New self-serve signups get it stamped automatically; existing companies are
--   -- null until an admin fills theirs in from the Billing tab, or you backfill by
--   -- hand:
--   --   update public.companies set billing_contact_name = 'Jane Doe' where slug = '...';
-- ─────────────────────────────────────────────────────────────────────────────
