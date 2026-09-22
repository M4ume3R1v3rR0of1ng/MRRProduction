// netlify/functions/billing-status.js
//
// Small read-only companion to billing-portal.js: details the Billing tab needs
// to render WITHOUT sending the admin through a portal redirect first — right now
// just the default card's brand/last4/expiry, so a card expiring soon can be
// flagged before it causes a failed charge instead of after.
//
// Admin-only, own company only. Returns { hasCard: false } for a comped company
// (no Stripe customer) or one that never finished adding a card.
//
// Env: STRIPE_SECRET_KEY.
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

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, headers, { error: "Invalid JSON body" });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return json(500, headers, { error: "Billing is not configured." });

  const admin = adminClient();
  const { caller, error: callerError } = await resolveCaller(admin, body.accessToken);
  if (callerError) return json(callerError.status, headers, { error: callerError.message });
  if (!isCompanyAdmin(caller)) return json(403, headers, { error: "Admin access required" });

  try {
    const { data: secrets } = await admin
      .from("company_secrets")
      .select("stripe_customer_id")
      .eq("company_id", caller.companyId)
      .maybeSingle();

    const customerId = secrets?.stripe_customer_id;
    if (!customerId) return json(200, headers, { hasCard: false });

    const stripe = new Stripe(secretKey);
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ["invoice_settings.default_payment_method"],
    });

    let pm =
      !customer.deleted && customer.invoice_settings?.default_payment_method
        ? customer.invoice_settings.default_payment_method
        : null;

    // No default set explicitly (common for an account that has only ever had one
    // card) — fall back to whatever card is actually on file.
    if (!pm || typeof pm === "string") {
      const methods = await stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 1,
      });
      pm = methods.data[0] || null;
    }

    if (!pm || !pm.card) return json(200, headers, { hasCard: false });

    return json(200, headers, {
      hasCard: true,
      brand: pm.card.brand,
      last4: pm.card.last4,
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year,
    });
  } catch (err) {
    return json(500, headers, { error: errorMessage(err) });
  }
};

export const handler = withSentry("billing-status", rawHandler);
