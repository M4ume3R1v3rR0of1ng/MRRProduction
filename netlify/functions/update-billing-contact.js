// netlify/functions/update-billing-contact.js
//
// Lets a company admin set or correct the billing contact shown in the Billing
// tab: the contact NAME, and the billing EMAIL.
//
// NAME — see supabase/47 for why it exists (Stripe only ever knows the company
// name, never the person, and comped companies never collect a name at all).
// create-checkout.js stamps it once at self-serve signup time; this is the only
// way to set or fix it afterward, for every other company. It is written both
// places it lives: companies.billing_contact_name (source of truth for the app)
// and, when the company has a real Stripe customer, that customer's
// metadata.contact_name (so it travels with the record for anyone pulling data
// on the Stripe side).
//
// EMAIL — optional. Written to companies.billing_email (supabase/54), which is
// OUR source of truth: it is what the Billing tab renders and what the receipt
// mail in stripe-webhook.js addresses. It is also mirrored onto the Stripe
// customer's own `email`, because Stripe still needs a valid address for dunning
// and for anything sent from its hosted portal — but Steadwerk no longer depends
// on being able to read it back out of Stripe.
//
// Until this accepted an email there was no way to change that address at all:
// it was set once, by whichever endpoint created the customer, and nothing in the
// app ever wrote it again. A company whose accounting address changed — or whose
// address never arrived in the first place, see start-company-billing.js's reuse
// branch — simply stopped receiving receipts, with no screen admitting it.
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

  // Optional: an absent field leaves the address alone. Same shape check the two
  // checkout endpoints use on the way in.
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Enter a valid billing email address." }),
    };
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
    // Both fields in one write. A comped company with no Stripe customer can set
    // an address perfectly well — it is our column, and it is the one that will
    // be used the moment that company is put onto real billing.
    /** @type {{ billing_contact_name: string, billing_email?: string }} */
    const patch = { billing_contact_name: name };
    if (email) patch.billing_email = email;

    const { error: updateErr } = await admin
      .from("companies")
      .update(patch)
      .eq("id", caller.companyId);
    if (updateErr) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: updateErr.message }) };
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    let customerId = null;
    if (secretKey) {
      const { data: secrets } = await admin
        .from("company_secrets")
        .select("stripe_customer_id")
        .eq("company_id", caller.companyId)
        .maybeSingle();
      customerId = secrets?.stripe_customer_id || null;
    }

    // Mirror onto Stripe when there's a customer to mirror onto — a comped
    // company with no billing yet just gets the DB write above, and picks up a
    // Stripe customer carrying the same address when billing is started.
    // secretKey is re-tested only to narrow its type — customerId can only have
    // been set above when it was present.
    if (customerId && secretKey) {
      const stripe = new Stripe(secretKey);
      await stripe.customers.update(customerId, {
        metadata: { contact_name: name },
        // Spread, not a plain key: sending email: "" or undefined would blank or
        // reject the address the customer already has.
        ...(email ? { email } : {}),
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, name, email: email || null }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: errorMessage(err) }) };
  }
};

export const handler = withSentry("update-billing-contact", rawHandler);
