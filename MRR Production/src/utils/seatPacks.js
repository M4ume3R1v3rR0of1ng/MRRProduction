// src/utils/seatPacks.js
//
// Seat capacity arithmetic, in one tested place because it is now computed from three
// inputs in two processes (the Stripe webhook, server-side, and the Billing tab in the
// browser) and getting it wrong either locks paying customers out of their own accounts
// or hands out seats nobody paid for.
//
// THE TWO KINDS OF PACK
//
// Crew packs used to be a ONE-TIME $10 charge (supabase/16). They are now a RECURRING
// $10/mo (or the annual equivalent) subscription item. Both kinds coexist forever:
//
//   grandfathered  packs bought outright under the old pricing. companies.purchased_seat_packs.
//                  Permanent, never billed again, never removable. Nobody who paid once
//                  gets charged a second time for the same seats.
//   recurring      packs currently on the live subscription, quantity read straight off
//                  the Stripe line item into companies.recurring_seat_packs. Cancelling
//                  the subscription takes these away; that is what recurring means.
//
// Capacity is the sum, and only while the company is actually paying.

export const BASE_SEATS = 10;
export const PACK_SEATS = 5;

// Packs only count while the base plan is being paid for. A lapsed subscription drops
// the ceiling to the base allowance rather than to zero, so a past_due company can still
// get in and fix their card.
export const SUBSCRIBED_STATUSES = ["trialing", "active", "past_due"];

export function isSubscribed(status) {
  return SUBSCRIBED_STATUSES.includes(status);
}

/**
 * The enforced seat ceiling.
 *
 * Returns null for a comped company (unlimited). `null` in, `null` out is deliberate:
 * a comped company has no Stripe subscription, so no webhook ever computes a number for
 * them, and writing one would cap an account that is supposed to be uncapped.
 */
export function seatCapacity({ baseSeats = BASE_SEATS, grandfatheredPacks = 0, recurringPacks = 0, status } = {}) {
  if (baseSeats == null) return null;
  const packs = Math.max(0, grandfatheredPacks || 0) + Math.max(0, recurringPacks || 0);
  return isSubscribed(status) ? baseSeats + PACK_SEATS * packs : baseSeats;
}

/**
 * How many recurring packs an admin may drop right now.
 *
 * Two limits, and the tighter one wins:
 *   - you cannot remove a pack you are not paying for (grandfathered packs are not
 *     removable; they were bought outright and cost nothing to keep);
 *   - you cannot cut capacity below the seats actually in use, because that would leave
 *     real people holding logins the ceiling says should not exist.
 */
export function maxRemovablePacks({ recurringPacks = 0, capacity, used = 0 } = {}) {
  const owned = Math.max(0, recurringPacks || 0);
  if (owned === 0) return 0;
  if (capacity == null) return owned; // unlimited: nothing to protect
  const spare = Math.max(0, (capacity || 0) - (used || 0));
  return Math.min(owned, Math.floor(spare / PACK_SEATS));
}

/** Whether the Remove button should be live, and why not when it is not. */
export function removalBlockedReason({ recurringPacks = 0, capacity, used = 0 } = {}) {
  if (Math.max(0, recurringPacks || 0) === 0) return "no-recurring-packs";
  if (maxRemovablePacks({ recurringPacks, capacity, used }) === 0) return "seats-in-use";
  return null;
}

/**
 * Validates a requested change in packs against what is actually allowed.
 * `delta` is signed: +1 buys a pack, -1 drops one.
 */
export function validatePackChange({ delta, recurringPacks = 0, capacity, used = 0 } = {}) {
  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, error: "Choose how many packs to add or remove." };
  }
  if (delta > 0) return { ok: true, nextRecurring: Math.max(0, recurringPacks) + delta, error: null };

  const wanted = Math.abs(delta);
  const allowed = maxRemovablePacks({ recurringPacks, capacity, used });
  if (allowed === 0) {
    return {
      ok: false,
      error:
        Math.max(0, recurringPacks) === 0
          ? "There are no monthly crew packs on this subscription to remove."
          : `All ${used} of your ${capacity} seats are in use. Deactivate a user before dropping a pack.`,
    };
  }
  if (wanted > allowed) {
    return {
      ok: false,
      error: `You can drop at most ${allowed} pack${allowed === 1 ? "" : "s"} without cutting capacity below the ${used} seats in use.`,
    };
  }
  return { ok: true, nextRecurring: Math.max(0, recurringPacks) - wanted, error: null };
}

/**
 * Splits a total pack count into its two sources for display, given what the database
 * records. Used by the Billing tab so the copy can say which packs bill monthly and
 * which are already paid for.
 */
export function describePacks({ grandfatheredPacks = 0, recurringPacks = 0 } = {}) {
  const grand = Math.max(0, grandfatheredPacks || 0);
  const rec = Math.max(0, recurringPacks || 0);
  return {
    grandfathered: grand,
    recurring: rec,
    total: grand + rec,
    extraSeats: PACK_SEATS * (grand + rec),
    // Only the recurring ones show up on the next invoice.
    billedPacks: rec,
  };
}
