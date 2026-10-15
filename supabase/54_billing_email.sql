-- Phase 54 — a billing email on every company.
--
-- Run after 53. Idempotent.
--
-- WHY
--
-- 47 gave every company a billing contact NAME but no address to send anything
-- to, because there already was one: the Stripe customer's `email`. That field
-- turned out to be unreachable in practice.
--
--   * Nothing in the app ever wrote it after the customer was created.
--     update-billing-contact.js mirrored only metadata.contact_name, so an
--     accounting address that changed could not be corrected anywhere.
--   * start-company-billing.js collected one in the owner console and then threw
--     it away whenever it reused an existing Stripe customer — the address was
--     validated, accepted, reported as saved, and never sent to Stripe at all.
--   * Receipts therefore went wherever the customer happened to have been
--     created pointing, with no screen in Steadwerk admitting it, and no way to
--     see or fix the address short of opening the Stripe dashboard.
--
-- Keeping the address only in Stripe also meant Steadwerk could not send its own
-- billing mail: there was nothing to address it to without a round trip to
-- Stripe first, and nothing left at all if the company were ever moved off it.
--
-- WHAT THIS DOES
--
-- companies.billing_email: one address per company, OUR source of truth for
-- where receipts and invoices go.
--
--   * create-checkout.js stamps it from the signup form at provisioning time.
--   * start-company-billing.js stamps it when the owner console converts a
--     comped company onto real billing, and now also pushes it onto the Stripe
--     customer whether that customer is created fresh or reused.
--   * update-billing-contact.js lets a company admin correct it from the Billing
--     tab, writing it here first and mirroring it onto the Stripe customer's
--     `email` when the company has one, so Stripe's own copy stops drifting.
--   * stripe-webhook.js reads it on invoice.payment_succeeded and sends the
--     receipt from Steadwerk itself.
--
-- Mirrored onto Stripe rather than replaced by it: Stripe still needs a valid
-- address of its own for dunning and for anything sent from its hosted portal.
-- This column is simply the copy we own and the one the app reads.
--
-- Exposed read-only on my_company() (so BillingView can prefill the field) and on
-- admin_list_companies() (so the owner console can see, across every company at
-- once, which ones have nowhere to send a receipt).

begin;

alter table public.companies
  add column if not exists billing_email text;

-- ── my_company(): add billing_email, same shape otherwise as 47 ───────────────
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
  billing_contact_name text,
  billing_email        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name, c.slug, c.branding, c.is_platform_company,
         c.billing_contact_name, c.billing_email
  from public.companies c
  where c.id = public.active_company_id();
$$;

grant execute on function public.my_company() to authenticated;

-- ── admin_list_companies(): add billing_email, same shape otherwise as 47 ─────
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
  billing_contact_name  text,
  billing_email         text
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
           c.billing_contact_name,
           c.billing_email
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
--   -- Both should list billing_email in their result.
--
--   select id, name, billing_email from public.companies order by created_at desc limit 5;
--
-- BACKFILL
--
-- Existing companies are null here until an admin saves one from the Billing tab.
-- Null is not harmless: stripe-webhook.js falls back to the Stripe customer's own
-- email when it is, which is exactly the address that may be wrong. Pull the real
-- ones out of Stripe once and set them by hand:
--
--   update public.companies set billing_email = 'accountant@example.com'
--   where slug = 'maumee-river-roofing';
--
-- Then confirm nobody is left relying on the fallback:
--
--   select c.name
--   from public.companies c
--   join public.company_secrets s on s.company_id = c.id
--   where s.stripe_subscription_id is not null and c.billing_email is null;
-- ─────────────────────────────────────────────────────────────────────────────
