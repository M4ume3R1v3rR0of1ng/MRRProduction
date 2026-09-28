// netlify/functions/update-billing-contact.js
//
// Lets a company admin set or correct the "billing contact name" shown in the
// Billing tab — see supabase/47 for why this exists (Stripe only ever knows the
// company name, never the person, and comped companies never collect a name at
// all). create-checkout.js stamps it once at self-serve signup time; this is the
// only way to set or fix it afterward, for every other company.
//
// Writes both places it lives: companies.billing_contact_name (source of truth
// for the app) and, when the company has a real Stripe customer, that customer's
// metadata.contact_name (so it travels with the record for anyone pulling data
// on the Stripe side).
//
// Admin-only, own company only. Env: STRIPE_SECRET_KEY.
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
 * @param {NetlifyEvent} event
 * @returns {Promise<NetlifyResponse>}
 */
const rawHandler = async (event) => {
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

  const name = (body.name || "").trim().slice(0, 200);
  if (!name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Enter a name." }) };
  }

  const admin = adminClient();
  const { caller, error: callerError } = await resolveCaller(admin, body.accessToken);
  if (callerError) {
    return {
      statusCode: callerError.status,
      headers,
      body: JSON.stringify({ error: callerError.message }),
    };
  }
  if (!isCompanyAdmin(caller)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Admin access required" }) };
  }

  try {
    const { error: updateErr } = await admin
      .from("companies")
      .update({ billing_contact_name: name })
      .eq("id", caller.companyId);
    if (updateErr) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: updateErr.message }) };
    }

    // Mirror onto Stripe when there's a customer to mirror it onto — a comped
    // company with no billing yet just gets the DB write above.
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (secretKey) {
      const { data: secrets } = await admin
        .from("company_secrets")
        .select("stripe_customer_id")
        .eq("company_id", caller.companyId)
        .maybeSingle();
      if (secrets?.stripe_customer_id) {
        const stripe = new Stripe(secretKey);
        await stripe.customers.update(secrets.stripe_customer_id, {
          metadata: { contact_name: name },
        });
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, name }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: errorMessage(err) }) };
  }
};

export const handler = withSentry("update-billing-contact", rawHandler);
