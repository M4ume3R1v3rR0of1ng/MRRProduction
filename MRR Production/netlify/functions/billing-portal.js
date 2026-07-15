// netlify/functions/billing-portal.js
//
// Returns a URL to Stripe's hosted Customer Portal for the caller's company — where
// they update their card, download invoices, and see billing history. Stripe builds
// and maintains that whole page; we just mint a short-lived session link to it.
//
// Admin-only, own company only. Env: STRIPE_SECRET_KEY, and URL / PUBLIC_APP_URL.

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

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Billing is not configured." }) };
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
    const { data: secrets } = await admin
      .from("company_secrets")
      .select("stripe_customer_id")
      .eq("company_id", caller.companyId)
      .maybeSingle();

    const customerId = secrets?.stripe_customer_id;
    if (!customerId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No billing account for this company yet." }) };
    }

    const appUrl = process.env.PUBLIC_APP_URL || process.env.URL || "https://steadwerk.com";
    const stripe = new Stripe(secretKey);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
