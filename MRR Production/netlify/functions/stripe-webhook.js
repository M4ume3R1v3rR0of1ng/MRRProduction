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

// Seats included in the BASE plan only.
//
// Returns null if we can't read items, which means "leave capacity alone" rather
// than "this company has no seats".
function baseSeatsFromSubscription(sub) {
  const items = sub?.items?.data;
  if (!Array.isArray(items)) return null;
  // The base plan bills as EITHER the monthly or the annual Price (same product,
  // two cadences). Both grant the same 10 included seats, so match either id —
  // otherwise an annual subscriber would fall through to the fallback below.
  const basePriceIds = [process.env.STRIPE_BASE_PRICE_ID, process.env.STRIPE_ANNUAL_PRICE_ID].filter(Boolean);
  let seats = 0;
  for (const it of items) {
    if (basePriceIds.includes(it.price?.id)) seats += 10 * (it.quantity || 1);
  }
  // Every real subscription carries the base plan; if we matched nothing, assume
  // the base 10 rather than accidentally capping a paying company at 0.
  return seats > 0 ? seats : 10;
}

// Crew packs currently BILLED on the subscription, monthly or annual cadence.
//
// This is a mirror of Stripe's line-item quantity, not a running total: a customer can
// change it from the hosted billing portal without touching our UI, so the subscription
// is the truth and we re-read it on every event. Packs bought under the old ONE-TIME
// pricing are NOT here — they live on companies.purchased_seat_packs, are grandfathered
// permanently, and are added on top in applyStatus below. See supabase/27.
//
// Returns null when items are unreadable, so the caller can leave the stored value alone
// rather than zeroing a paying customer's seats on a malformed event.
function recurringPacksFromSubscription(sub) {
  const items = sub?.items?.data;
  if (!Array.isArray(items)) return null;
  const packPriceIds = [
    process.env.STRIPE_SEAT_PACK_PRICE_ID,
    process.env.STRIPE_SEAT_PACK_ANNUAL_PRICE_ID,
  ].filter(Boolean);
  if (packPriceIds.length === 0) return null;
  let packs = 0;
  for (const it of items) {
    if (packPriceIds.includes(it.price?.id)) packs += it.quantity || 0;
  }
  return packs;
}

// Which cadence is this subscription billed on, 'monthly' or 'annual'?
//
// create-checkout records the customer's choice in the subscription metadata, but
// metadata is only set on subscriptions WE opened and a customer can switch cadence
// from the hosted billing portal afterwards. So read it off the base plan's Price
// instead, which is true in both cases. Every recurring item in one Stripe
// subscription must share an interval (see add-seats.js), so the base item answers
// for the whole subscription.
//
// Returns null when unreadable, so the caller leaves the stored value alone rather
// than flipping a paying annual customer to monthly on a malformed event.
function billingIntervalFromSubscription(sub) {
  const items = sub?.items?.data;
  if (!Array.isArray(items) || items.length === 0) return null;
  const basePriceIds = [process.env.STRIPE_BASE_PRICE_ID, process.env.STRIPE_ANNUAL_PRICE_ID].filter(Boolean);
  const base = items.find((it) => basePriceIds.includes(it.price?.id)) || items[0];
  switch (base?.price?.recurring?.interval) {
    case "year":  return "annual";
    case "month": return "monthly";
    default:      return null;
  }
}

// Packs only count while the company is actually paying for the base plan. A lapsed
// subscription drops the ceiling back to the base allowance.
const SUBSCRIBED_STATUSES = ["trialing", "active", "past_due"];
const PACK_SEATS = 5;

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

// Unwrap a supabase-js result, or throw with enough context to find it.
//
// WHY THIS EXISTS
//
// Every query in this file used to destructure `{ data }` and drop `{ error }` on
// the floor. That is quietly catastrophic here specifically, because this file is
// where money turns into access: a failed write means somebody paid and got
// nothing, and the handler still answered Stripe with 200, so Stripe never
// retried and no one ever found out.
//
// It is not hypothetical. Migrations 16 and 27 were never applied to production,
// so `companies` had neither purchased_seat_packs nor recurring_seat_packs. The
// select below returned an error and null data, the suspended-company guard
// silently stopped guarding, and any update carrying a pack count failed against
// the missing column without a word. It took a schema audit to find, months
// later. See supabase/33_migration_ledger.sql.
//
// Throwing routes it to the handler's catch, which logs and returns 500, which
// tells Stripe to retry. That is right for a transient database fault and, for a
// permanent one like a missing column, turns an invisible failure into a loud
// repeating one. Loud and repeating is strictly better than silent.
// Exported only so it can be tested. It is the one thing standing between a
// failed write and a payment that bought nothing, which makes it worth covering
// even at three lines.
export function must(what, result) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

// Apply a status (and optionally a seat capacity) to the company behind a Stripe
// subscription/customer, unless the company is manually suspended (owner's lever wins).
async function applyStatus(admin, { companyId, stripeCustomerId, stripeSubscriptionId, baseSeats, recurringPacks, billingInterval }, status) {
  if (!status) return;

  // Resolve the company: explicit id first, else by the stored Stripe ids.
  let id = companyId || null;
  // maybeSingle: no match is a legitimate answer here (the next lookup may find
  // it, or this really is an event for a company we do not have), so only a real
  // failure throws. Without the check, a broken read looked exactly like "no such
  // company" and the event was dropped as unmappable.
  if (!id && stripeSubscriptionId) {
    const data = must(
      "look up company by stripe_subscription_id",
      await admin.from("company_secrets").select("company_id").eq("stripe_subscription_id", stripeSubscriptionId).maybeSingle(),
    );
    id = data?.company_id || null;
  }
  if (!id && stripeCustomerId) {
    const data = must(
      "look up company by stripe_customer_id",
      await admin.from("company_secrets").select("company_id").eq("stripe_customer_id", stripeCustomerId).maybeSingle(),
    );
    id = data?.company_id || null;
  }
  if (!id) {
    console.warn("stripe-webhook: could not map event to a company", { stripeCustomerId, stripeSubscriptionId });
    return;
  }

  // maybeSingle, not single, on purpose. single() treats "no rows" as an error,
  // so wrapping it in must() would make a company deleted between the secrets
  // lookup and here throw, and Stripe would retry that forever. A missing row is
  // reported once and dropped; a genuine query failure throws.
  const co = must(
    "read company for status apply",
    await admin
      .from("companies")
      .select("subscription_status, purchased_seat_packs, recurring_seat_packs")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!co) {
    console.warn(`stripe-webhook: company ${id} referenced by Stripe no longer exists; ignoring '${status}'.`);
    return;
  }
  if (co.subscription_status === "suspended") {
    console.log(`stripe-webhook: company ${id} is suspended; ignoring billing status '${status}'.`);
    return;
  }

  const patch = { subscription_status: status };

  // Mirror the billed pack quantity whenever we could read it, even if capacity itself
  // is not being recomputed on this event, so the stored mirror never lags Stripe.
  // `co.` rather than `co?.` from here down: the guard above already returned on
  // a missing row, so optional chaining would only suggest a null that cannot
  // reach this point.
  const billedPacks = typeof recurringPacks === "number" ? recurringPacks : co.recurring_seat_packs || 0;
  if (typeof recurringPacks === "number") patch.recurring_seat_packs = recurringPacks;

  // Same mirror discipline as the pack count: write it only when we actually read a
  // cadence off the subscription. Without this the owner console prices an annual
  // company at the monthly rate, overstating its MRR by $16.50. See supabase/30.
  if (billingInterval === "monthly" || billingInterval === "annual") {
    patch.billing_interval = billingInterval;
  }

  // Only touch seat_capacity when we actually read a base allowance off a
  // subscription. Never overwrite a comped company's NULL (unlimited) here — that
  // only happens for a company that has a Stripe subscription, i.e. a paying one.
  if (typeof baseSeats === "number") {
    // Grandfathered one-time packs plus packs currently billed. Both grant the same
    // seats; only the second kind stops when the subscription does — and when it
    // lapses the whole lot drops to base anyway. See supabase/27.
    const grandfathered = co.purchased_seat_packs || 0;
    patch.seat_capacity = SUBSCRIBED_STATUSES.includes(status)
      ? baseSeats + PACK_SEATS * (grandfathered + billedPacks)
      : baseSeats;
  }

  // THE write. Everything above only decides what this says. If it fails and we
  // swallow it, the company keeps whatever status it had while Stripe believes
  // the change landed: a paid signup stays locked out, or a cancelled account
  // keeps working. This is the single most important error check in the file.
  must("apply company status/capacity", await admin.from("companies").update(patch).eq("id", id));

  if (stripeSubscriptionId) {
    // Losing this quietly is how a company ends up unreachable by later events:
    // applyStatus resolves the company from these stored ids, so a subscription
    // id that never got written means the next webhook cannot find them.
    must(
      "store stripe_subscription_id",
      await admin.from("company_secrets")
        .update({ stripe_subscription_id: stripeSubscriptionId })
        .eq("company_id", id),
    );
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

        // LEGACY: a one-time crew pack under the pre-27 pricing. Nothing creates these
        // sessions any more (add-seats now edits the subscription directly), but a
        // checkout opened just before the switch can still complete and land here, and
        // Stripe replays events for up to three days. Dropping this branch would take
        // money and hand over no seats.
        if (s.metadata?.purpose === "seat_pack") {
          const companyId = s.metadata.company_id;
          const packs = parseInt(s.metadata.packs, 10);
          if (!companyId || !Number.isInteger(packs) || packs <= 0) {
            console.warn("stripe-webhook: seat_pack session missing usable metadata", s.id);
            break;
          }

          // Increment in the database rather than read-modify-write here, so two
          // packs bought at once can't overwrite each other.
          // This one already checked its error. It is the reason the missing
          // record_seat_pack_purchase() would at least have been noticed here,
          // had anyone still been opening these sessions.
          const newTotal = must(
            "record_seat_pack_purchase",
            await admin.rpc("record_seat_pack_purchase", { target: companyId, packs }),
          );

          // Raise the ceiling to match, but never touch a comped company's NULL
          // (unlimited) capacity — adding a number there would cap them.
          const co = must(
            "read company for seat pack capacity",
            await admin
              .from("companies")
              .select("seat_capacity, subscription_status, recurring_seat_packs")
              .eq("id", companyId)
              .maybeSingle(),
          );

          if (typeof co?.seat_capacity === "number" && SUBSCRIBED_STATUSES.includes(co.subscription_status)) {
            // Include the recurring packs. The pre-27 version of this line was
            // `10 + 5 * newTotal`, which would now wipe out every pack the company is
            // currently paying for the moment a late one-time session settled.
            //
            // Checked, because the packs are already paid for and recorded by the
            // RPC above. Failing here without a word would take the money, bank the
            // pack count, and never raise the ceiling it bought.
            must(
              "raise seat capacity after seat pack purchase",
              await admin
                .from("companies")
                .update({ seat_capacity: 10 + PACK_SEATS * (newTotal + (co.recurring_seat_packs || 0)) })
                .eq("id", companyId),
            );
          }
          break;
        }

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
          baseSeats: baseSeatsFromSubscription(sub),
          recurringPacks: recurringPacksFromSubscription(sub),
          billingInterval: billingIntervalFromSubscription(sub),
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
