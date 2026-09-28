// netlify/functions/switch-billing-interval.js
//
// "Switch to annual" button in the Billing tab. One direction only — a monthly
// company can move to the discounted annual prepay; there's no reverse button
// here, same as there's no self-serve way to go from annual back to monthly.
// Someone who wants that can ask, same as any other manual billing change.
//
// Swaps BOTH the base plan item and the crew-pack item (if the company has one)
// to their annual Price, in a single subscription update — mirrors add-seats.js's
// discipline: this never writes companies.billing_interval or seat_capacity
// itself. customer.subscription.updated fires from this call, and
// stripe-webhook.js recomputes both from the line items it finds there.
//
// proration_behavior: 'always_invoice' rather than add-seats.js's
// 'create_prorations' — a seat-pack proration is small and fine to ride on
// whatever invoice comes next, but switching cadence entirely should charge the
// annual amount (prorated for time already used this month) right away rather
// than leave it sitting uncollected until an invoice that, on the new annual
// cadence, might not happen for months.
//
// Admin-only, own company only.
// Env: STRIPE_SECRET_KEY, STRIPE_BASE_PRICE_ID, STRIPE_ANNUAL_PRICE_ID, and
// optionally STRIPE_SEAT_PACK_PRICE_ID / STRIPE_SEAT_PACK_ANNUAL_PRICE_ID if the
// company has crew packs.
// @ts-check

import Stripe from "stripe";
import {
  adminClient,
  resolveCaller,
  isCompanyAdmin,
  corsHeaders,
  errorMessage,
} from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";

/** @typedef {import("./_shared/types.js").NetlifyEvent} NetlifyEvent */
/** @typedef {import("./_shared/types.js").NetlifyResponse} NetlifyResponse */

/**
 * @param {number} statusCode
 * @param {Record<string, string>} headers
 * @param {Record<string, unknown>} payload
 * @returns {NetlifyResponse}
 */
const json = (statusCode, headers, payload) => ({
  statusCode,
  headers,
  body: JSON.stringify(payload),
});

/**
 * @param {NetlifyEvent} event
 * @returns {Promise<NetlifyResponse>}
 */
const rawHandler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin || "");

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, headers, { error: "Method not allowed" });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const monthlyBase = process.env.STRIPE_BASE_PRICE_ID;
  const annualBase = process.env.STRIPE_ANNUAL_PRICE_ID;
  if (!secretKey || !monthlyBase || !annualBase) {
    return json(500, headers, { error: "Annual billing is not configured on the server." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, headers, { error: "Invalid JSON body" });
  }

  const admin = adminClient();
  const { caller, error: callerError } = await resolveCaller(admin, body.accessToken);
  if (callerError) return json(callerError.status, headers, { error: callerError.message });
  if (!isCompanyAdmin(caller)) return json(403, headers, { error: "Admin access required" });

  try {
    const { data: secrets } = await admin
      .from("company_secrets")
      .select("stripe_subscription_id")
      .eq("company_id", caller.companyId)
      .maybeSingle();

    const subscriptionId = secrets?.stripe_subscription_id;
    if (!subscriptionId) {
      return json(400, headers, { error: "This company has no active subscription." });
    }

    const stripe = new Stripe(secretKey);
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (!sub || ["canceled", "incomplete_expired"].includes(sub.status)) {
      return json(400, headers, { error: "This company's subscription is not active." });
    }

    const items = sub.items?.data || [];
    const baseItem = items.find((it) => [monthlyBase, annualBase].includes(it.price?.id));
    if (!baseItem) {
      return json(400, headers, { error: "Could not find the base plan on this subscription." });
    }
    if (baseItem.price?.id === annualBase) {
      return json(400, headers, { error: "This company is already billed annually." });
    }

    const monthlyPack = process.env.STRIPE_SEAT_PACK_PRICE_ID;
    const annualPack = process.env.STRIPE_SEAT_PACK_ANNUAL_PRICE_ID;
    const packItem = items.find(
      (it) => monthlyPack && it.price?.id === monthlyPack,
    );

    const updateItems = [{ id: baseItem.id, price: annualBase }];
    if (packItem) {
      if (!annualPack) {
        return json(500, headers, {
          error: "Annual crew packs are not configured yet (missing STRIPE_SEAT_PACK_ANNUAL_PRICE_ID).",
        });
      }
      updateItems.push({ id: packItem.id, price: annualPack });
    }

    await stripe.subscriptions.update(subscriptionId, {
      items: updateItems,
      proration_behavior: "always_invoice",
    });

    // Capacity and billing_interval land via the customer.subscription.updated
    // webhook this triggers — same discipline as add-seats.js.
    return json(200, headers, { ok: true });
  } catch (err) {
    return json(500, headers, { error: errorMessage(err) });
  }
};

export const handler = withSentry("switch-billing-interval", rawHandler);
