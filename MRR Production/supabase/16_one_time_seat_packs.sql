-- Phase 4c — crew packs become a one-time purchase.
--
-- 09_seats.sql modelled extra seats as a RECURRING $10/mo Stripe subscription item,
-- and derived seat_capacity by reading the live subscription's line items. The pack
-- is actually a ONE-TIME $10 charge, which breaks that derivation outright: a
-- one-time payment creates no subscription item, so the next subscription.updated
-- webhook would recompute capacity from the base plan alone and silently delete
-- seats the customer had already paid for.
--
-- So the count of purchased packs has to be persisted here rather than inferred
-- from Stripe. purchased_seat_packs is the permanent record of how many packs a
-- company has bought; seat_capacity stays the enforced ceiling and is still written
-- by the webhook, now as:
--
--     seat_capacity = 10  +  5 × purchased_seat_packs   (while subscribed)
--     seat_capacity = 10                                (subscription lapsed)
--
-- Packs are bought, never sold back — taking one off would mean refunding a
-- completed payment, so there is deliberately no decrement path here.
--
-- NULL seat_capacity still means unlimited (comped companies like Maumee River).
-- Those have no Stripe subscription, so no webhook ever fires for them and this
-- migration cannot start capping them.
--
-- Run after 15. Idempotent.

begin;

alter table public.companies
  add column if not exists purchased_seat_packs integer not null default 0;

alter table public.companies
  drop constraint if exists companies_purchased_seat_packs_check;
alter table public.companies
  add constraint companies_purchased_seat_packs_check
  check (purchased_seat_packs >= 0);

-- ── Record a completed pack purchase ─────────────────────────────────────────
-- Called by the Stripe webhook (service_role) when a one-time seat-pack checkout
-- completes. Increments inside the statement rather than read-modify-write in JS,
-- so two packs bought in the same second can't clobber each other.
--
-- Returns the new pack total so the caller can recompute the ceiling without a
-- second round trip.
create or replace function public.record_seat_pack_purchase(target uuid, packs integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_total integer;
begin
  if packs is null or packs <= 0 then
    raise exception 'packs must be a positive count';
  end if;

  update public.companies
     set purchased_seat_packs = purchased_seat_packs + packs
   where id = target
  returning purchased_seat_packs into new_total;

  if new_total is null then
    raise exception 'No such company: %', target;
  end if;

  return new_total;
end;
$$;

-- Service role only: this is money changing a seat ceiling. No 'authenticated'
-- grant, or a company admin could hand themselves seats they never paid for.
revoke all on function public.record_seat_pack_purchase(uuid, integer) from public;
grant execute on function public.record_seat_pack_purchase(uuid, integer) to service_role;

commit;
