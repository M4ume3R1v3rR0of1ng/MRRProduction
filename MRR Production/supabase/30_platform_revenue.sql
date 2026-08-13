-- Phase 30 — what each company is worth per month, and what the platform is worth.
--
-- Everything here is derived from columns the stripe-webhook already maintains, so
-- the owner console can show revenue without a Stripe API call on every page load.
--
-- THE ONE THING THAT WAS MISSING
--
-- Monthly-vs-annual was NOT recoverable from Postgres. create-checkout puts
-- billing_interval in the Stripe subscription metadata and nothing ever mirrored it
-- back, so an annual company looked identical to a monthly one and would have been
-- counted at $99/mo instead of its true $82.50/mo. This migration adds the column;
-- stripe-webhook.js now reads the cadence off the base plan's Price and mirrors it
-- on every subscription event.
--
-- WHAT COUNTS AS REVENUE
--
--   * Billed  = subscription_status in ('active','past_due') AND the company has a
--               stripe_subscription_id. Both halves matter. A comped company
--               (Maumee River, Steadwerk) is manually set 'active' by
--               admin_set_company_status and has no subscription — counting it
--               would invent money that nobody is paying.
--   * Trialing = $0. Stripe charges nothing during the 14-day trial. Trials are
--               pipeline, not revenue, and the console shows them as a separate
--               count rather than folding them into the total.
--   * purchased_seat_packs = $0 forever. Those are the grandfathered one-time
--               packs from supabase/16: paid once, never billed again. They grant
--               capacity but produce no recurring revenue. Only
--               recurring_seat_packs bills. See supabase/27.
--
-- Run after 29. Idempotent.

begin;

-- ── Which cadence is this company billed on? ─────────────────────────────────
-- Mirrored from Stripe by the webhook, exactly like recurring_seat_packs: the
-- subscription is the truth, because a customer can switch cadence in the hosted
-- billing portal without touching our UI. Defaults to 'monthly' so an existing row
-- and any comped company reads sensibly before a webhook ever lands.
alter table public.companies
  add column if not exists billing_interval text not null default 'monthly';

alter table public.companies
  drop constraint if exists companies_billing_interval_check;
alter table public.companies
  add constraint companies_billing_interval_check
  check (billing_interval in ('monthly', 'annual'));

comment on column public.companies.billing_interval is
  'Billing cadence of the base plan, mirrored from the Stripe subscription by '
  'stripe-webhook.js. Derived, not authored: a customer can change cadence from the '
  'billing portal. Only meaningful for a company that has a stripe_subscription_id.';

-- ── Per-company recurring revenue ────────────────────────────────────────────
-- PRICING CONSTANTS — these must match the Stripe Prices that actually bill:
-- STRIPE_BASE_PRICE_ID, STRIPE_ANNUAL_PRICE_ID, STRIPE_SEAT_PACK_PRICE_ID and
-- STRIPE_SEAT_PACK_ANNUAL_PRICE_ID. Nothing reconciles them automatically, so a
-- price change in Stripe means editing this function. They live in one block at
-- the top for exactly that reason.
--
-- pack_annual is the one value not stated anywhere else in the codebase — the
-- annual pack exists only as a Stripe Price id. 100.00/yr is the same "two months
-- free" ratio the base plan uses (990 vs 12 × 99). CONFIRM IT AGAINST STRIPE and
-- correct it here if it differs.
--
-- Every column reference below is alias-qualified. A bare one collides with the
-- RETURNS TABLE OUT column of the same name and throws "column reference is
-- ambiguous" — the exact bug fixed in 11_fix_admin_list.sql.
create or replace function public.admin_revenue_summary()
returns table (
  id                  uuid,
  name                text,
  slug                text,
  subscription_status text,
  billing_interval    text,
  is_billed           boolean,
  recurring_packs     integer,
  grandfathered_packs integer,
  seats_used          integer,
  seat_capacity       integer,
  base_mrr            numeric,
  packs_mrr           numeric,
  mrr                 numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  base_monthly constant numeric := 99.00;
  base_annual  constant numeric := 990.00;
  pack_monthly constant numeric := 10.00;
  pack_annual  constant numeric := 100.00;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  return query
  with priced as (
    select
      c.id                                            as cid,
      c.name                                          as cname,
      c.slug                                          as cslug,
      c.subscription_status                           as cstatus,
      coalesce(c.billing_interval, 'monthly')         as cinterval,
      coalesce(c.recurring_seat_packs, 0)             as crecurring,
      coalesce(c.purchased_seat_packs, 0)             as cgrandfathered,
      c.seat_capacity                                 as ccapacity,
      (
        c.subscription_status in ('active', 'past_due')
        and s.stripe_subscription_id is not null
      )                                               as cbilled,
      case when coalesce(c.billing_interval, 'monthly') = 'annual'
           then round(base_annual / 12, 2) else base_monthly end as cbase_rate,
      case when coalesce(c.billing_interval, 'monthly') = 'annual'
           then round(pack_annual / 12, 2) else pack_monthly end as cpack_rate
    from public.companies c
    left join public.company_secrets s on s.company_id = c.id
  )
  select
    p.cid,
    p.cname,
    p.cslug,
    p.cstatus,
    p.cinterval,
    p.cbilled,
    p.crecurring,
    p.cgrandfathered,
    (select count(*)::int from public.memberships m where m.company_id = p.cid and m.active),
    p.ccapacity,
    case when p.cbilled then p.cbase_rate else 0::numeric end,
    case when p.cbilled then p.cpack_rate * p.crecurring else 0::numeric end,
    case when p.cbilled then p.cbase_rate + p.cpack_rate * p.crecurring else 0::numeric end
  from priced p
  order by
    case when p.cbilled then p.cbase_rate + p.cpack_rate * p.crecurring else 0::numeric end desc,
    p.cname;
end;
$$;

grant execute on function public.admin_revenue_summary() to authenticated;

commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verify
--
--   select * from public.admin_revenue_summary();
--
-- Expect, today: every company is_billed = false and mrr = 0, because Maumee River
-- and Steadwerk are both comped with no Stripe subscription. That is correct — the
-- number becomes real when the first self-serve company's card clears. If a comped
-- company shows a non-zero mrr, its company_secrets row has a stripe_subscription_id
-- it should not have.
-- ═════════════════════════════════════════════════════════════════════════════
