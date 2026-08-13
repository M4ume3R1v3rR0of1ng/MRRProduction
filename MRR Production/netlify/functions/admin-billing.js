// netlify/functions/admin-billing.js
//
// Read-only billing detail for ONE company, for the platform owner's console:
// subscription state, what it actually charges, the card on file, and recent
// invoices with links to Stripe's hosted copy and PDF.
//
// WHY THIS EXISTS ALONGSIDE supabase/30
//
// admin_revenue_summary() computes MRR from columns the webhook mirrors, using
// price constants written into the SQL by hand. It is fast and needs no Stripe
// call, which is what makes it usable on every console load — but it is a MODEL of
// the billing, not the billing. This endpoint is the ground truth to check it
// against. If the MRR column and the latest invoice disagree, the constants in 30
// are wrong (or a price changed in Stripe and nobody updated them).
//
// PLATFORM ADMIN ONLY, and deliberately not scoped to the caller's own company —
// that is the whole point. Which means the is_platform_admin check below is the
// entire security boundary: without it this hands any authenticated user the
// billing history of every company on the platform.
//
// Read-only by construction: nothing here writes to Stripe or to Postgres. To
// CHANGE a company's billing, use the hosted portal link from billing-portal.js.
//
// Env: STRIPE_SECRET_KEY.

import Stripe from "stripe";
import { adminClient, resolveCaller, corsHeaders } from "./_shared/tenant.js";

const json = (statusCode, headers, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

// Stripe money is in the currency's minor unit. Everything downstream wants
// dollars, so convert once here rather than in the React component.
const toMajor = (amount) => (typeof amount === "number" ? amount / 100 : null);

const unixToIso = (s) => (typeof s === "number" ? new Date(s * 1000).toISOString() : null);

export const handler = async (event) => {
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

  const companyId = body.companyId;
  if (!companyId) return json(400, headers, { error: "companyId is required" });

  const admin = adminClient();
  const { caller, error: callerError } = await resolveCaller(admin, body.accessToken);
  if (callerError) return json(callerError.status, headers, { error: callerError.message });

  // THE security boundary for this endpoint. Not isCompanyAdmin — that would let a
  // customer's own admin read any other company's invoices by passing an id.
  if (!caller.isPlatformAdmin) {
    return json(403, headers, { error: "Platform admin access required" });
  }

  try {
    const { data: secrets } = await admin
      .from("company_secrets")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("company_id", companyId)
      .maybeSingle();

    const customerId = secrets?.stripe_customer_id;
    if (!customerId) {
      // Not an error: comped companies legitimately have no Stripe customer. The
      // console renders this as "not billed" rather than a failure.
      return json(200, headers, { ok: true, billed: false, subscription: null, invoices: [] });
    }

    const stripe = new Stripe(secretKey);

    // Expand the default payment method so the card can be shown without a second
    // round trip, and the price product so line items can be named.
    const [subs, invoiceList, customer] = await Promise.all([
      stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 1,
        expand: ["data.default_payment_method"],
      }),
      stripe.invoices.list({ customer: customerId, limit: 12 }),
      stripe.customers.retrieve(customerId),
    ]);

    const sub = subs.data?.[0] || null;
    const card =
      sub?.default_payment_method?.card ||
      customer?.invoice_settings?.default_payment_method?.card ||
      null;

    const subscription = sub
      ? {
          id: sub.id,
          status: sub.status,
          currentPeriodEnd: unixToIso(sub.current_period_end),
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
          trialEnd: unixToIso(sub.trial_end),
          // What Stripe will actually charge on the next invoice, derived from the
          // live line items rather than from our own price constants.
          items: (sub.items?.data || []).map((it) => ({
            description: it.price?.nickname || it.price?.product || it.price?.id,
            quantity: it.quantity || 1,
            unitAmount: toMajor(it.price?.unit_amount),
            interval: it.price?.recurring?.interval || null,
          })),
          total: (sub.items?.data || []).reduce(
            (s, it) => s + (toMajor(it.price?.unit_amount) || 0) * (it.quantity || 1),
            0,
          ),
          currency: sub.currency || "usd",
        }
      : null;

    const invoices = (invoiceList.data || []).map((inv) => ({
      id: inv.id,
      number: inv.number,
      created: unixToIso(inv.created),
      status: inv.status, // paid | open | void | uncollectible | draft
      amountDue: toMajor(inv.amount_due),
      amountPaid: toMajor(inv.amount_paid),
      currency: inv.currency,
      // Stripe hosts both. Linking out beats rebuilding an invoice renderer, and
      // the URLs are signed and short-lived rather than public.
      hostedUrl: inv.hosted_invoice_url || null,
      pdfUrl: inv.invoice_pdf || null,
    }));

    return json(200, headers, {
      ok: true,
      billed: true,
      card: card ? { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year } : null,
      subscription,
      invoices,
    });
  } catch (err) {
    return json(500, headers, { error: err.message });
  }
};
