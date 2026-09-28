-- Phase 14 - crew packs go back to being a recurring charge.
--
-- Run after 26. Idempotent.
--
-- WHY
--
-- 09_seats.sql modelled crew packs as a recurring $10/mo subscription item. 16 replaced
-- that with a ONE-TIME $10 charge and persisted the count on purchased_seat_packs,
-- because a one-time payment leaves no subscription item to derive capacity from. This
-- reverses the pricing decision without reversing that migration, because both kinds of
-- pack now have to coexist permanently.
--
-- THE RULE THAT DRIVES THE WHOLE DESIGN
--
-- Nobody who already bought a pack outright gets charged for it again. Those purchases
-- were sold as "bought, never sold back" and the customer paid on that basis. So:
--
--   purchased_seat_packs   FROZEN. Its meaning narrows from "packs bought" to "packs
--                          bought under the old one-time pricing". Nothing increments it
--                          any more. It keeps granting capacity forever, free.
--   recurring_seat_packs   NEW. The quantity of the crew-pack line item on the live
--                          Stripe subscription, mirrored here by the webhook.
--
--   seat_capacity = 10 + 5 × (purchased_seat_packs + recurring_seat_packs)   while subscribed
--   seat_capacity = 10                                                       when lapsed
--
-- WHY MIRROR THE STRIPE QUANTITY RATHER THAN INCREMENT A COUNTER
--
-- The recurring count is derived, not accumulated: Stripe's line-item quantity is the
-- truth, and a customer can change it from the hosted billing portal without going
-- through our UI. An incrementing counter would drift the moment they did. The webhook
-- therefore SETS this column from the subscription on every subscription event, which is
-- also why it needs no RPC - last write wins is the correct semantics for a mirror.
--
-- WHY NO DECREMENT PATH ON purchased_seat_packs
--
-- Same reason as in 16: removing one would mean refunding a completed payment. Removal
-- in the app only ever touches the recurring quantity, which is enforced in
-- src/utils/seatPacks.js and in netlify/functions/add-seats.js.

begin;

alter table public.companies
  add column if not exists recurring_seat_packs integer not null default 0;

alter table public.companies
  drop constraint if exists companies_recurring_seat_packs_check;
alter table public.companies
  add constraint companies_recurring_seat_packs_check
  check (recurring_seat_packs >= 0);

comment on column public.companies.purchased_seat_packs is
  'Crew packs bought under the OLD one-time $10 pricing. Frozen: nothing increments this '
  'any more. Grandfathered - these grant capacity permanently and are never billed again '
  'and never removable. New packs go to recurring_seat_packs. See supabase/27.';

comment on column public.companies.recurring_seat_packs is
  'Quantity of the recurring crew-pack line item on the live Stripe subscription, mirrored '
  'by the stripe-webhook on every subscription event. Derived, not accumulated: the Stripe '
  'quantity is the truth, because a customer can change it from the billing portal.';

-- ── Retire the one-time credit path ──────────────────────────────────────────
-- The function stays (dropping it would break a replay of an old webhook event mid
-- flight) but is marked so nobody wires it up again. The webhook no longer calls it.
comment on function public.record_seat_pack_purchase(uuid, integer) is
  'DEPRECATED as of supabase/27. Credited a ONE-TIME crew pack purchase. Crew packs are '
  'now recurring subscription items mirrored into companies.recurring_seat_packs by the '
  'webhook. Retained only so an in-flight replay of a pre-27 checkout.session.completed '
  'event does not error. Do not call from new code.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
-- Every company should start with recurring_seat_packs = 0. Any company with
-- purchased_seat_packs > 0 is a grandfathered customer: confirm their seat_capacity
-- still reflects those packs AFTER the first subscription webhook lands, because that
-- is the event that recomputes the ceiling under the new formula.
-- ─────────────────────────────────────────────────────────────────────────────
select id,
       name,
       subscription_status,
       seat_capacity,
       purchased_seat_packs  as grandfathered_packs,
       recurring_seat_packs  as billed_packs,
       case
         when seat_capacity is null then 'unlimited (comped)'
         when purchased_seat_packs > 0 then 'GRANDFATHERED - verify capacity after next webhook'
         else 'ok'
       end as note
from public.companies
order by purchased_seat_packs desc, name;
