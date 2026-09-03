// netlify/functions/start-company-billing.js
//
// Platform-owner-only: converts a COMPED company (Maumee River Roofing, or any
// company admin_create_company made by hand) onto real Stripe billing.
//
// THE GAP THIS FILLS
//
// There is currently no other way to do this. create-checkout.js only ever
// provisions a BRAND NEW company (see its own header comment) — it has no path for
// an existing company. billing-portal.js has nothing to open for a company with no
// Stripe customer yet (see the "capacity == null" branch in BillingView.jsx). A
// comped company's admin_set_company_status('active') sets subscription_status by
// hand and stops there; nothing ever gives it a stripe_subscription_id.
//
// HOW IT WORKS
//
// This opens a real Stripe Checkout Session against the EXISTING company's id,
// exactly the way create-checkout.js opens one for a company it just inserted —
// same client_reference_id convention, same base/annual Price ids. That's what lets
// the SAME webhook (stripe-webhook.js, checkout.session.completed /
// customer.subscription.created) pick it up when the card clears: it looks the
// company up by client_reference_id / subscription metadata exactly as it does for
// a self-serve signup, so nothing on the receiving end needed to change.
//
// Deliberately NO free trial here, unlike create-checkout.js: a company reaching
// this endpoint is already using the product day to day (that is what "comped"
// means), so billing starts on the first charge instead of granting another 14
// free days on top of however long it has already been comped.
//
// GUARDRAILS
//
//   • Caller must be a platform admin (resolveCaller -> isPlatformAdmin) — same
//     gate as every other owner-console action (delete-company.js, admin_* RPCs).
//   • Target company must exist.
//   • Target must NOT already have a stripe_subscription_id — refuses to open a
//     second subscription for a company that is already really billed.

import Stripe from "stripe";
import { adminClient, resolveCaller, corsHeaders } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";

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

  const { accessToken, companyId } = body;
  const email = (body.billingEmail || "").trim().toLowerCase();
  // Anything other than an explicit "annual" falls back to monthly, same rule
  // create-checkout.js uses for the same field.
  const interval = body.billingInterval === "annual" ? "annual" : "monthly";

  if (!companyId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing companyId" }) };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Enter a valid billing email address." }),
    };
  }

  const basePriceId = process.env.STRIPE_BASE_PRICE_ID;
  const annualPriceId = process.env.STRIPE_ANNUAL_PRICE_ID;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || !basePriceId || (interval === "annual" && !annualPriceId)) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Billing is not configured on the server." }),
    };
  }
  const priceId = interval === "annual" ? annualPriceId : basePriceId;

  const admin = adminClient();

  // ── 1. Auth: platform owner only ──────────────────────────────────────────
  const { caller, error: callerError } = await resolveCaller(admin, accessToken);
  if (callerError) {
    return {
      statusCode: callerError.status,
      headers,
      body: JSON.stringify({ error: callerError.message }),
    };
  }
  if (!caller.isPlatformAdmin) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: "Platform admin access required" }),
    };
  }

  // ── 2. Load the target + enforce the guardrails ───────────────────────────
  const { data: company, error: coErr } = await admin
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .single();
  if (coErr || !company) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "No such company" }) };
  }

  // company_secrets always exists by this point — the companies AFTER INSERT
  // trigger (supabase/04) creates it for every company row, comped ones included.
  const { data: secrets } = await admin
    .from("company_secrets")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("company_id", companyId)
    .maybeSingle();

  if (secrets?.stripe_subscription_id) {
    return {
      statusCode: 409,
      headers,
      body: JSON.stringify({ error: `${company.name} already has a real Stripe subscription.` }),
    };
  }

  try {
    const stripe = new Stripe(secretKey);

    // Reuse a Stripe customer if one already exists (a previous attempt here that
    // never finished checkout leaves one behind); otherwise create one and store
    // it right away, the same way create-checkout.js does — so stripe-webhook.js
    // can map an event back to this company by customer id even before a
    // subscription exists yet.
    let customerId = secrets?.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: company.name,
        metadata: { company_id: company.id },
      });
      customerId = customer.id;
      await admin
        .from("company_secrets")
        .upsert(
          { company_id: company.id, stripe_customer_id: customerId },
          { onConflict: "company_id" },
        );
    }

    const appUrl = process.env.PUBLIC_APP_URL || process.env.URL || "https://steadwerk.com";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      // The exact field checkout.session.completed already reads to find its
      // company (see create-checkout.js) — this is what lets an EXISTING company
      // receive that event instead of the handler only ever provisioning new ones.
      client_reference_id: company.id,
      subscription_data: { metadata: { company_id: company.id, billing_interval: interval } },
      success_url: `${appUrl}/?checkout=success`,
      cancel_url: `${appUrl}/?checkout=cancel`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

export const handler = withSentry("start-company-billing", rawHandler);
