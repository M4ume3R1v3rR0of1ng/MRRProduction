// netlify/functions/create-checkout.js
//
// Self-serve signup, step 1 of 2. Provisions a NEW company in the 'incomplete'
// (locked) state and returns a Stripe Checkout URL. The company stays locked until
// stripe-webhook.js sees the first payment clear and flips it to 'active'.
//
// This is the PUBLIC "start a company" path — distinct from invite-only join, which
// still runs through create-user.js. It creates an auth account server-side (like
// create-user does) so there's no email-confirmation detour before payment.
//
// Abuse note: this endpoint creates an auth user + a locked company row without a
// prior session, so it's a spam surface. The blast radius is limited — every company
// it makes is 'incomplete' (invisible, unusable) until a real card clears at Stripe —
// but a captcha or rate limit belongs here before a big public launch. Flagged, not
// yet added.
//
// Pricing: the base plan is $99/mo and includes 10 users (STRIPE_BASE_PRICE_ID).
// Extra seats are sold in +5 packs at $10/mo (STRIPE_ADDON_PRICE_ID), added later
// from the Billing tab — checkout starts with the base plan only.
//
// Env: STRIPE_SECRET_KEY, STRIPE_BASE_PRICE_ID, and either URL (Netlify sets it) or
// PUBLIC_APP_URL for the success/cancel redirects.

import Stripe from "stripe";
import { adminClient, corsHeaders } from "./_shared/tenant.js";

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

async function uniqueSlug(admin, base) {
  const root = slugify(base) || "company";
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const { data } = await admin.from("companies").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

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

  const companyName = (body.companyName || "").trim();
  const fullName = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!companyName || !fullName || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Company name, your name, and email are required." }) };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Enter a valid email address." }) };
  }

  const basePriceId = process.env.STRIPE_BASE_PRICE_ID;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!basePriceId || !secretKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Billing is not configured (missing STRIPE_BASE_PRICE_ID / STRIPE_SECRET_KEY)." }) };
  }

  const admin = adminClient();
  const stripe = new Stripe(secretKey);

  try {
    // Existing account? Then this is someone starting a SECOND company. Attach them;
    // ignore any password they typed (we must never reset an existing user's password
    // from an unauthenticated endpoint — that's account takeover).
    const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();

    let userId = existing?.id || null;
    if (!userId) {
      if (!password || password.length < 8) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Choose a password of at least 8 characters." }) };
      }
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: createErr.message }) };
      }
      userId = created.user.id;
    }

    // Provision the company LOCKED. It cannot see or touch anything until the webhook
    // marks it active — active_company_id() excludes 'incomplete'.
    const slug = await uniqueSlug(admin, companyName);
    const { data: company, error: coErr } = await admin
      .from("companies")
      .insert({
        name: companyName,
        slug,
        subscription_status: "incomplete",
        branding: { displayName: companyName },
      })
      .select("id")
      .single();
    if (coErr) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Could not create company: ${coErr.message}` }) };
    }

    // The signer-up is this company's first admin.
    await admin.from("memberships").upsert(
      { user_id: userId, company_id: company.id, role: "admin", active: true },
      { onConflict: "user_id,company_id" },
    );
    await admin.from("profiles").update({ role: "admin" }).eq("id", userId);
    await admin.from("profiles").update({ active_company_id: company.id }).eq("id", userId).is("active_company_id", null);

    // A Stripe customer, remembered on the (secret) row so the webhook can map back.
    const customer = await stripe.customers.create({ email, name: companyName, metadata: { company_id: company.id } });
    await admin.from("company_secrets").upsert(
      { company_id: company.id, stripe_customer_id: customer.id },
      { onConflict: "company_id" },
    );

    const appUrl = process.env.PUBLIC_APP_URL || process.env.URL || "https://steadwerk.com";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: basePriceId, quantity: 1 }], // base plan: $99, 10 seats
      // client_reference_id is echoed back on checkout.session.completed — the primary
      // link from a paid session to the company it provisioned.
      client_reference_id: company.id,
      subscription_data: { metadata: { company_id: company.id } },
      success_url: `${appUrl}/?checkout=success`,
      cancel_url: `${appUrl}/?checkout=cancel`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
