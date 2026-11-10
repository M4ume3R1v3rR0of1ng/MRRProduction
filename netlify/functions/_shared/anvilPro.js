// netlify/functions/_shared/anvilPro.js
//
// Does this company have Anvil Pro? The one server-side answer.
//
// Effective Pro = (anvil_pro OR anvil_pro_comped) AND the subscription is usable.
//
//   anvil_pro         mirrored from the Stripe subscription by stripe-webhook (supabase/65)
//   anvil_pro_comped  granted by Steadwerk, no charge
//   usable status     a company whose subscription lapsed has lost the product entirely;
//                     resolveCaller already 402s them, but the cron jobs here do not go
//                     through resolveCaller, so the status is checked again.
//
// The browser reads the same two columns to decide what to SHOW, but it never decides
// what is ALLOWED. Every Pro path re-checks here, because a hidden button is not a lock.
// @ts-check

import { USABLE_SUBSCRIPTION_STATES } from "./tenant.js";
import { capabilityTier } from "./anvilCapabilities.js";

/** @typedef {import("@supabase/supabase-js").SupabaseClient<any, any, any, any, any>} SupabaseClient */

/**
 * Pure: the rule itself, separate from the lookup so it can be tested without a database.
 * @param {{ anvil_pro?: boolean | null, anvil_pro_comped?: boolean | null, subscription_status?: string | null } | null | undefined} company
 * @returns {boolean}
 */
export function isEffectivePro(company) {
  if (!company) return false;
  const entitled = company.anvil_pro === true || company.anvil_pro_comped === true;
  return entitled && USABLE_SUBSCRIPTION_STATES.includes(company.subscription_status ?? "");
}

/**
 * @param {SupabaseClient} admin
 * @param {string} companyId
 * @returns {Promise<boolean>}
 */
export async function hasAnvilPro(admin, companyId) {
  const { data, error } = await admin
    .from("companies")
    .select("anvil_pro, anvil_pro_comped, subscription_status")
    .eq("id", companyId)
    .maybeSingle();
  // A failed lookup is "no": the cost of a wrongly-withheld feature is a retry, the cost of
  // a wrongly-granted one is giving away something billed.
  if (error) return false;
  return isEffectivePro(data);
}

/**
 * Whether a capability may be used by a company, given its Pro state.
 * @param {string} capabilityId
 * @param {boolean} pro
 */
export function capabilityAllowed(capabilityId, pro) {
  return capabilityTier(capabilityId) === "free" || pro;
}

export const PRO_REQUIRED_MESSAGE =
  "This is part of Anvil Pro, which is not turned on for your company. An admin can add it from the Billing tab.";

/**
 * The shape every Pro-gated HTTP endpoint answers with. 402 is the honest status and the
 * `code` lets the UI show an upgrade prompt instead of a generic error.
 * @param {Record<string, string>} headers
 */
export function proRequiredResponse(headers) {
  return {
    statusCode: 402,
    headers,
    body: JSON.stringify({ error: PRO_REQUIRED_MESSAGE, code: "anvil_pro_required" }),
  };
}
