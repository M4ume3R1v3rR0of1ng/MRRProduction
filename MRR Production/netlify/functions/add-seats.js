// netlify/functions/add-seats.js
//
// "Buy 5 more seats" from a company's Billing tab. The crew pack is a ONE-TIME
// $10 charge, so this opens a Stripe Checkout session in payment mode and returns
// its URL for the browser to redirect to.
//
// It deliberately does NOT write seat_capacity. Capacity moves only when Stripe
// confirms the money actually landed, via the checkout.session.completed webhook —
// returning a seat here and hoping the payment succeeds would hand out capacity
// for free on every abandoned checkout.
//
// This used to add a recurring $10/mo subscription item and let
// customer.subscription.updated recompute capacity from the line items. That
// derivation is gone: a one-time payment leaves no subscription item behind, so
// the pack count is persisted on companies.purchased_seat_packs instead
// (supabase/16_one_time_seat_packs.sql).
//
// Packs are additive only. Removing one would mean refunding a completed payment,
// which is a conversation with a human, not a button.
//
// Admin-only, and only for the caller's OWN company.
//
// Env: STRIPE_SECRET_KEY, STRIPE_SEAT_PACK_PRICE_ID (a ONE-TIME price, not
// recurring), and either URL (Netlify sets it) or PUBLIC_APP_URL for the return
// redirects.

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

  // One +5 pack by default. Additive only — a negative or zero count is a refund
  // request, not a purchase.
  const packs = Number.isInteger(body.packs) && body.packs > 0 ? body.packs : 1;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const packPrice = process.env.STRIPE_SEAT_PACK_PRICE_ID;
  if (!secretKey || !packPrice) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Billing is not configured (missing STRIPE_SEAT_PACK_PRICE_ID)." }) };
  }

  const appUrl = process.env.PUBLIC_APP_URL || process.env.URL;
  if (!appUrl) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Billing is not configured (missing PUBLIC_APP_URL)." }) };
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
    // Reuse the Stripe customer created for the base plan, so the pack lands on the
    // same customer record and can be charged against a card already on file.
    const { data: secrets } = await admin
      .from("company_secrets")
      .select("stripe_customer_id")
      .eq("company_id", caller.companyId)
      .maybeSingle();

    const customerId = secrets?.stripe_customer_id;
    if (!customerId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "This company has no billing account yet. Start a subscription before buying seats." }),
      };
    }

    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{ price: packPrice, quantity: packs }],
      // The webhook trusts these two fields to decide which company gets seats and
      // how many. purpose distinguishes a pack purchase from the base-plan checkout,
      // which arrives as the same event type.
      metadata: {
        company_id: caller.companyId,
        packs: String(packs),
        purpose: "seat_pack",
      },
      success_url: `${appUrl}/?seats=added`,
      cancel_url: `${appUrl}/?seats=cancelled`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, url: session.url }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
