// netlify/functions/anvil-pro.js
//
// Turn the Anvil Pro add-on on or off from the Billing tab.
//
// Anvil Pro is a RECURRING line item on the company's existing Stripe subscription, exactly
// like a crew pack (see add-seats.js): there is nothing to redirect to, the charge is
// guaranteed by the subscription already on file, and Stripe prorates it onto the next
// invoice in both directions.
//
// WHY THIS DOES NOT WRITE companies.anvil_pro
//
// Same rule as seat capacity. Editing the subscription makes Stripe emit
// customer.subscription.updated, and stripe-webhook mirrors the line item into
// companies.anvil_pro. A second writer here would race the first, and would drift the moment
// a customer dropped the add-on from Stripe's hosted billing portal instead of from our UI.
// So the toggle edits Stripe and the UI reloads once the webhook has landed.
//
// BILLING INTERVAL
//
// Every recurring item in one subscription must share an interval, so the monthly Pro price
// cannot ride on an annual base plan. The cadence is read off the company's own base-plan
// item and the matching Pro price is used, as add-seats.js does for packs.
//
// Admin-only, and only for the caller's OWN company. Comped companies (anvil_pro_comped) are
// told there is nothing to turn on: their access is Steadwerk's to change, not theirs.
//
// POST { accessToken, enabled: boolean }
// Env: STRIPE_SECRET_KEY, STRIPE_ANVIL_PRO_PRICE_ID (monthly), STRIPE_ANVIL_PRO_ANNUAL_PRICE_ID
// (yearly), STRIPE_BASE_PRICE_ID, STRIPE_ANNUAL_PRICE_ID.
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

/**
 * @param {number} statusCode
 * @param {Record<string, string>} headers
 * @param {Record<string, unknown>} payload
 */
const json = (statusCode, headers, payload) => ({
  statusCode,
  headers,
  body: JSON.stringify(payload),
});

/** @param {NetlifyEvent} event */
const rawHandler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin || "");
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, headers, { error: "Method not allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, headers, { error: "Invalid JSON body" });
  }
  if (typeof body.enabled !== "boolean") {
    return json(400, headers, { error: "Say whether to turn Anvil Pro on or off." });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return json(500, headers, { error: "Billing is not configured (missing STRIPE_SECRET_KEY)." });
  }
  const monthlyPro = process.env.STRIPE_ANVIL_PRO_PRICE_ID;
  const annualPro = process.env.STRIPE_ANVIL_PRO_ANNUAL_PRICE_ID;
  const proPriceIds = [monthlyPro, annualPro].filter(Boolean);
  if (proPriceIds.length === 0) {
    return json(500, headers, { error: "Anvil Pro is not available for purchase yet." });
  }

  const admin = adminClient();
  const { caller, error: callerError } = await resolveCaller(admin, body.accessToken);
  if (callerError) return json(callerError.status, headers, { error: callerError.message });
  if (!isCompanyAdmin(caller)) return json(403, headers, { error: "Admin access required" });

  try {
    const { data: company } = await admin
      .from("companies")
      .select("anvil_pro_comped")
      .eq("id", caller.companyId)
      .maybeSingle();
    if (company?.anvil_pro_comped) {
      return json(409, headers, {
        error:
          "Anvil Pro is included with your account at no charge. Contact Steadwerk to change it.",
      });
    }

    const { data: secrets } = await admin
      .from("company_secrets")
      .select("stripe_subscription_id")
      .eq("company_id", caller.companyId)
      .maybeSingle();
    const subscriptionId = secrets?.stripe_subscription_id;
    if (!subscriptionId) {
      return json(400, headers, {
        error: "This company has no active subscription. Start a subscription first.",
      });
    }

    const stripe = new Stripe(secretKey);
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (!sub || ["canceled", "incomplete_expired"].includes(sub.status)) {
      return json(400, headers, { error: "This company's subscription is not active." });
    }

    const items = sub.items?.data || [];
    const existing = items.find((it) => proPriceIds.includes(it.price?.id));

    if (body.enabled) {
      if (existing) return json(200, headers, { ok: true, unchanged: true });

      const basePriceIds = [
        process.env.STRIPE_BASE_PRICE_ID,
        process.env.STRIPE_ANNUAL_PRICE_ID,
      ].filter(Boolean);
      const baseItem = items.find((it) => basePriceIds.includes(it.price?.id));
      const interval = baseItem?.price?.recurring?.interval || "month";
      const priceId = interval === "year" ? annualPro : monthlyPro;
      if (!priceId) {
        return json(400, headers, {
          error:
            interval === "year"
              ? "Annual Anvil Pro is not configured yet (missing STRIPE_ANVIL_PRO_ANNUAL_PRICE_ID)."
              : "Monthly Anvil Pro is not configured yet (missing STRIPE_ANVIL_PRO_PRICE_ID).",
        });
      }
      await stripe.subscriptionItems.create({
        subscription: subscriptionId,
        price: priceId,
        quantity: 1,
        proration_behavior: "create_prorations",
      });
      return json(200, headers, { ok: true, enabled: true, interval });
    }

    if (!existing) return json(200, headers, { ok: true, unchanged: true });
    await stripe.subscriptionItems.del(existing.id, { proration_behavior: "create_prorations" });
    return json(200, headers, { ok: true, enabled: false });
  } catch (err) {
    return json(500, headers, { error: errorMessage(err) });
  }
};

export const handler = withSentry("anvil-pro", rawHandler);
