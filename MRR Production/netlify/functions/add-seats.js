// netlify/functions/add-seats.js
//
// "Buy 5 more seats" from a company's Billing tab. Adds (or increments) the $10
// add-on pack on their Stripe subscription. Stripe prorates the charge immediately;
// the resulting customer.subscription.updated webhook recomputes seat_capacity, so
// this function does NOT write capacity itself — Stripe stays the single source of
// truth and the two can't drift.
//
// Admin-only, and only for the caller's OWN company. delta is a count of 5-seat
// packs (usually +1; negative to remove).
//
// Env: STRIPE_SECRET_KEY, STRIPE_ADDON_PRICE_ID.

import Stripe from "stripe";
import { adminClient, resolveCaller, isCompanyAdmin, corsHeaders } from "./_shared/tenant.js";

export const handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin || "");

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const packs = Number.isInteger(body.packs) ? body.packs : 1; // one +5 pack by default

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const addonPrice = process.env.STRIPE_ADDON_PRICE_ID;
  if (!secretKey || !addonPrice) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Billing is not configured (missing STRIPE_ADDON_PRICE_ID)." }) };
  }

  const admin = adminClient();
  const { caller, error: callerError } = await resolveCaller(admin, body.accessToken);
  if (callerError) {
    return { statusCode: callerError.status, headers, body: JSON.stringify({ error: callerError.message }) };
  }
  if (!isCompanyAdmin(caller)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Admin access required" }) };
  }

  try {
    // Find the company's Stripe subscription.
    const { data: secrets } = await admin
      .from("company_secrets")
      .select("stripe_subscription_id")
      .eq("company_id", caller.companyId)
      .maybeSingle();

    const subId = secrets?.stripe_subscription_id;
    if (!subId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "This company has no active subscription to add seats to." }) };
    }

    const stripe = new Stripe(secretKey);
    const sub = await stripe.subscriptions.retrieve(subId);
    const existing = sub.items.data.find((it) => it.price?.id === addonPrice);
    const currentQty = existing ? existing.quantity : 0;
    const nextQty = Math.max(0, currentQty + packs);

    if (existing) {
      if (nextQty === 0) {
        await stripe.subscriptionItems.del(existing.id, { proration_behavior: "create_prorations" });
      } else {
        await stripe.subscriptionItems.update(existing.id, { quantity: nextQty, proration_behavior: "create_prorations" });
      }
    } else if (nextQty > 0) {
      await stripe.subscriptionItems.create({
        subscription: subId,
        price: addonPrice,
        quantity: nextQty,
        proration_behavior: "create_prorations",
      });
    }

    // capacity = 10 base + 5 per add-on pack; returned for an instant UI update
    // (the webhook will confirm the same number authoritatively).
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, seatCapacity: 10 + 5 * nextQty }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
