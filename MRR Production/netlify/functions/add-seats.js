// netlify/functions/add-seats.js
//
// Add or drop 5-seat crew packs from a company's Billing tab.
//
// Crew packs are a RECURRING charge: $10/mo, or the annual equivalent for a company on
// annual billing. This edits the quantity of the crew-pack line item on the company's
// existing subscription rather than opening a checkout session.
//
// WHY NO CHECKOUT REDIRECT ANY MORE
//
// A one-time pack was a payment that had to be collected, so it needed Stripe Checkout
// and a redirect, and capacity could only move once checkout.session.completed confirmed
// the money. A recurring item is added to a subscription that already has a payment
// method on file: Stripe prorates it onto the next invoice. There is nothing to redirect
// to, and the charge is guaranteed by the subscription rather than by a completed
// session.
//
// WHY THIS STILL DOES NOT WRITE seat_capacity
//
// Same discipline as before. Editing the subscription makes Stripe emit
// customer.subscription.updated, and the webhook recomputes capacity from the line items
// it finds there. Writing capacity here as well would give two writers for one number
// and a race between them, and would drift the moment a customer changed their seats
// from Stripe's hosted billing portal instead of from our UI.
//
// BILLING INTERVAL
//
// Every recurring item in one Stripe subscription must share a billing interval, so a
// $10/mo pack cannot be attached to an annual base plan. The interval is read off the
// company's own base-plan item and the matching pack Price is used.
//
// GRANDFATHERED PACKS
//
// Packs bought under the old one-time pricing live on companies.purchased_seat_packs and
// are not touched here. They are not billed and cannot be removed. See supabase/27.
//
// Admin-only, and only for the caller's OWN company.
//
// Env: STRIPE_SECRET_KEY, STRIPE_SEAT_PACK_PRICE_ID (recurring, monthly),
// STRIPE_SEAT_PACK_ANNUAL_PRICE_ID (recurring, yearly), STRIPE_BASE_PRICE_ID,
// STRIPE_ANNUAL_PRICE_ID.

import Stripe from "stripe";
import { adminClient, resolveCaller, isCompanyAdmin, corsHeaders } from "./_shared/tenant.js";

const PACK_SEATS = 5;

const json = (statusCode, headers, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

export const handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin || "");

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, headers, { error: "Method not allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, headers, { error: "Invalid JSON body" });
  }

  // Signed delta: +1 buys a pack, -1 drops one. `packs` is still accepted as a positive
  // add so an older client that has not reloaded keeps working.
  const delta = Number.isInteger(body.delta)
    ? body.delta
    : Number.isInteger(body.packs) && body.packs > 0
      ? body.packs
      : 1;
  if (delta === 0) return json(400, headers, { error: "Nothing to change." });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return json(500, headers, { error: "Billing is not configured (missing STRIPE_SECRET_KEY)." });

  const admin = adminClient();
  const { caller, error: callerError } = await resolveCaller(admin, body.accessToken);
  if (callerError) return json(callerError.status, headers, { error: callerError.message });
  if (!isCompanyAdmin(caller)) return json(403, headers, { error: "Admin access required" });

  try {
    const { data: secrets } = await admin
      .from("company_secrets")
      .select("stripe_subscription_id, stripe_customer_id")
      .eq("company_id", caller.companyId)
      .maybeSingle();

    const subscriptionId = secrets?.stripe_subscription_id;
    if (!subscriptionId) {
      return json(400, headers, {
        error: "This company has no active subscription. Start a subscription before changing seats.",
      });
    }

    const stripe = new Stripe(secretKey);
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (!sub || ["canceled", "incomplete_expired"].includes(sub.status)) {
      return json(400, headers, { error: "This company's subscription is not active." });
    }

    const monthlyPack = process.env.STRIPE_SEAT_PACK_PRICE_ID;
    const annualPack = process.env.STRIPE_SEAT_PACK_ANNUAL_PRICE_ID;
    const basePriceIds = [process.env.STRIPE_BASE_PRICE_ID, process.env.STRIPE_ANNUAL_PRICE_ID].filter(Boolean);
    const packPriceIds = [monthlyPack, annualPack].filter(Boolean);
    if (packPriceIds.length === 0) {
      return json(500, headers, { error: "Billing is not configured (missing crew pack price)." });
    }

    const items = sub.items?.data || [];

    // Match the pack cadence to the base plan's. Reading it off the subscription rather
    // than off a stored flag means a company that switched plans in Stripe's portal
    // still gets the right one.
    const baseItem = items.find((it) => basePriceIds.includes(it.price?.id));
    const interval = baseItem?.price?.recurring?.interval || "month";
    const packPriceId = interval === "year" ? annualPack : monthlyPack;
    if (!packPriceId) {
      return json(400, headers, {
        error:
          interval === "year"
            ? "Annual crew packs are not configured yet (missing STRIPE_SEAT_PACK_ANNUAL_PRICE_ID)."
            : "Monthly crew packs are not configured yet (missing STRIPE_SEAT_PACK_PRICE_ID).",
      });
    }

    // Any existing pack item, on either cadence — a company that switched intervals may
    // still carry the old one, and that quantity is real capacity we must not lose.
    const packItem = items.find((it) => packPriceIds.includes(it.price?.id));
    const currentPacks = packItem?.quantity || 0;
    const nextPacks = currentPacks + delta;

    if (nextPacks < 0) {
      return json(400, headers, { error: "There are not that many billed crew packs to remove." });
    }

    // On removal, refuse to cut capacity below the seats actually in use. The database
    // is the authority on both numbers; a client-side check alone would let a crafted
    // request strand real users above the ceiling. Mirrors validatePackChange in
    // src/utils/seatPacks.js.
    if (delta < 0) {
      const { data: co } = await admin
        .from("companies")
        .select("purchased_seat_packs, subscription_status")
        .eq("id", caller.companyId)
        .single();
      const { count: usedSeats } = await admin
        .from("memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("company_id", caller.companyId)
        .eq("active", true);

      const baseSeats = 10 * (baseItem?.quantity || 1);
      const nextCapacity = baseSeats + PACK_SEATS * ((co?.purchased_seat_packs || 0) + nextPacks);
      if (typeof usedSeats === "number" && nextCapacity < usedSeats) {
        return json(409, headers, {
          error: `That would leave ${usedSeats} active users above a ceiling of ${nextCapacity}. Deactivate users first.`,
        });
      }
    }

    // Proration is deliberate on both directions: adding mid-cycle charges the balance of
    // the period, removing credits it back. Silently skipping proration would bill a full
    // month for a pack held two days.
    if (packItem && nextPacks === 0) {
      await stripe.subscriptionItems.del(packItem.id, { proration_behavior: "create_prorations" });
    } else if (packItem) {
      await stripe.subscriptionItems.update(packItem.id, {
        quantity: nextPacks,
        proration_behavior: "create_prorations",
      });
    } else {
      await stripe.subscriptionItems.create({
        subscription: subscriptionId,
        price: packPriceId,
        quantity: nextPacks,
        proration_behavior: "create_prorations",
      });
    }

    // Capacity itself lands via the customer.subscription.updated webhook this triggers.
    // Returned here only so the UI can say what to expect while that arrives.
    return json(200, headers, {
      ok: true,
      packs: nextPacks,
      interval,
      seatsDelta: PACK_SEATS * delta,
    });
  } catch (err) {
    return json(500, headers, { error: err.message });
  }
};
