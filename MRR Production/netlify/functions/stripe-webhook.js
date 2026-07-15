// netlify/functions/stripe-webhook.js
//
// The billing brain. Stripe POSTs here on every subscription event; this function's
// only job is to translate those into our companies.subscription_status. It is the
// bridge between "did they pay" and "can they see their data".
//
// SECURITY: this endpoint is public (Stripe has no session) but every request is
// verified against STRIPE_WEBHOOK_SECRET. An unsigned or mis-signed request is
// rejected — otherwise anyone could POST a fake "payment succeeded" and unlock a
// company for free. The signature check IS the auth here.
//
// RAW BODY: Stripe signs the exact bytes it sent. Netlify may hand us the body
// base64-encoded, so we reconstruct the raw string before verifying — a parsed/
// re-stringified body would fail the signature every time.
//
// THE ONE INVARIANT: a webhook NEVER moves a company OUT of 'suspended'. That status
// is the owner's manual kill switch (owner console), and a stray billing event must
// not quietly reopen a company you deliberately cut off.
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.

import Stripe from "stripe";
import { adminClient } from "./_shared/tenant.js";

// Seat ceiling from a subscription's line items: base plan includes 10, each $10
// add-on pack (quantity) adds 5. Returns null if we can't read items (leave as-is).
function capacityFromSubscription(sub) {
  const items = sub?.items?.data;
  if (!Array.isArray(items)) return null;
  const basePrice = process.env.STRIPE_BASE_PRICE_ID;
  const addonPrice = process.env.STRIPE_ADDON_PRICE_ID;
  let capacity = 0;
  for (const it of items) {
    const priceId = it.price?.id;
    const qty = it.quantity || 0;
    if (priceId === basePrice) capacity += 10 * (qty || 1);
    else if (priceId === addonPrice) capacity += 5 * qty;
  }
  // Every real subscription has the base plan; if we somehow matched nothing, assume
  // the base 10 rather than accidentally capping a paying company at 0.
  return capacity > 0 ? capacity : 10;
}

// Stripe subscription.status  →  our companies.subscription_status
function mapStripeStatus(stripeStatus) {
  switch (stripeStatus) {
    case "trialing":            return "trialing";
    case "active":              return "active";
    case "past_due":            return "past_due";
    case "unpaid":              return "past_due";
    case "canceled":            return "canceled";
    case "incomplete":          return "incomplete";
    case "incomplete_expired":  return "canceled";
    default:                    return null; // unknown → leave the company untouched
  }
}

// Apply a status (and optionally a seat capacity) to the company behind a Stripe
// subscription/customer, unless the company is manually suspended (owner's lever wins).
async function applyStatus(admin, { companyId, stripeCustomerId, stripeSubscriptionId, seatCapacity }, status) {
  if (!status) return;

  // Resolve the company: explicit id first, else by the stored Stripe ids.
  let id = companyId || null;
  if (!id && stripeSubscriptionId) {
    const { data } = await admin.from("company_secrets").select("company_id").eq("stripe_subscription_id", stripeSubscriptionId).maybeSingle();
    id = data?.company_id || null;
  }
  if (!id && stripeCustomerId) {
    const { data } = await admin.from("company_secrets").select("company_id").eq("stripe_customer_id", stripeCustomerId).maybeSingle();
    id = data?.company_id || null;
  }
  if (!id) {
    console.warn("stripe-webhook: could not map event to a company", { stripeCustomerId, stripeSubscriptionId });
    return;
  }

  const { data: co } = await admin.from("companies").select("subscription_status").eq("id", id).single();
  if (co?.subscription_status === "suspended") {
    console.log(`stripe-webhook: company ${id} is suspended; ignoring billing status '${status}'.`);
    return;
  }

  const patch = { subscription_status: status };
  // Only touch seat_capacity when we actually derived one from a subscription. Never
  // overwrite a comped company's NULL (unlimited) here — that only happens for a
  // company that has a Stripe subscription, i.e. a paying one.
  if (typeof seatCapacity === "number") patch.seat_capacity = seatCapacity;

  await admin.from("companies").update(patch).eq("id", id);

  if (stripeSubscriptionId) {
    await admin.from("company_secrets")
      .update({ stripe_subscription_id: stripeSubscriptionId })
      .eq("company_id", id);
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error("stripe-webhook: missing STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET");
    return { statusCode: 500, body: "Billing not configured" };
  }

  const stripe = new Stripe(secretKey);
  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    // Bad signature = not really Stripe. Refuse.
    console.error("stripe-webhook: signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook signature verification failed: ${err.message}` };
  }

  const admin = adminClient();

  try {
    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const s = stripeEvent.data.object;
        // client_reference_id is the company we provisioned in create-checkout.
        await applyStatus(admin, {
          companyId: s.client_reference_id,
          stripeCustomerId: s.customer,
          stripeSubscriptionId: s.subscription,
        }, "active");
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = stripeEvent.data.object;
        await applyStatus(admin, {
          companyId: sub.metadata?.company_id || null,
          stripeCustomerId: sub.customer,
          stripeSubscriptionId: sub.id,
          seatCapacity: capacityFromSubscription(sub),
        }, mapStripeStatus(sub.status));
        break;
      }

      case "customer.subscription.deleted": {
        const sub = stripeEvent.data.object;
        await applyStatus(admin, {
          companyId: sub.metadata?.company_id || null,
          stripeCustomerId: sub.customer,
          stripeSubscriptionId: sub.id,
        }, "canceled");
        break;
      }

      case "invoice.payment_failed": {
        const inv = stripeEvent.data.object;
        // A failed charge → past_due (grace period). Stripe keeps retrying; if it
        // ultimately gives up it fires subscription.updated/deleted, handled above.
        await applyStatus(admin, {
          stripeCustomerId: inv.customer,
          stripeSubscriptionId: inv.subscription,
        }, "past_due");
        break;
      }

      default:
        // Ignore the dozens of event types we don't act on.
        break;
    }

    // Always 200 on a handled event so Stripe stops retrying.
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    // 500 tells Stripe to retry later — right for a transient DB hiccup.
    console.error("stripe-webhook: handler error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
