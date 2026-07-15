-- Phase 4 — billing status.
--
-- Adds one subscription state: 'incomplete'. A self-serve signup creates the company
-- in this state BEFORE payment, and the Stripe webhook flips it to 'active' once the
-- first charge clears. Because 'incomplete' is NOT in the usable set that
-- active_company_id() checks (trialing/active/past_due), an abandoned signup that
-- never pays is locked out automatically — it can never see or touch any data.
--
-- Run after 06. Idempotent.

begin;

alter table public.companies drop constraint if exists companies_subscription_status_check;

alter table public.companies
  add constraint companies_subscription_status_check check (
    subscription_status in (
      'incomplete',  -- signed up, first payment not yet completed → locked out
      'trialing',
      'active',
      'past_due',
      'canceled',
      'suspended'    -- owner's manual kill switch; never touched by Stripe webhooks
    )
  );

-- The admin console's create/status RPCs already validate against their own inline
-- list, which does NOT include 'incomplete' — that's intentional. 'incomplete' is only
-- ever set by the signup/checkout function, never by hand in the owner console.

commit;
