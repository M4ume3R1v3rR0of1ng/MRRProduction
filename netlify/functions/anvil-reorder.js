// netlify/functions/anvil-reorder.js
//
// The browser's only door to the reorder queue: change settings, approve, dismiss.
//
// The tables (supabase/65) have no write policy, so everything that mutates them comes
// through here, and every action below checks, in this order:
//
//   1. a valid session                           (resolveCaller)
//   2. the company has Anvil Pro                  (hasAnvilPro — NOT read from the client)
//   3. the caller may edit inventory              (inv_edit, resolved server-side)
//   4. the row belongs to the caller's company    (.eq("company_id") on every statement)
//
// WHAT "APPROVE" MEANS
//
// It records that a person with inv_edit said yes to this quantity, and by whom. It does
// not place an order with a supplier: that step is not built, and approval is the
// hand-off point for it. The queue shows approved items so nothing is lost in the gap.
//
// Actions (POST { action, accessToken, ... }):
//   list      → { enabled, notifyEmails, pending[], recent[] }
//   settings  → { enabled?, notifyEmails? }
//   approve   → { id, qty? }
//   dismiss   → { id }
// @ts-check

import { adminClient, resolveCaller, corsHeaders, errorMessage } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { getEffectivePerms } from "./_shared/anvilPerms.js";
import { hasAnvilPro, proRequiredResponse } from "./_shared/anvilPro.js";
import { checkRateLimit, rateLimitedResponse } from "./_shared/rateLimit.js";

/** @typedef {import("./_shared/types.js").NetlifyEvent} NetlifyEvent */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {number} statusCode
 * @param {Record<string, string>} headers
 * @param {Record<string, unknown>} payload
 */
const json = (statusCode, headers, payload) => ({
  statusCode,
  headers,
  body: JSON.stringify(payload),
});

/** @param {NetlifyEvent} event */
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

  try {
    const admin = adminClient();
    const { caller, error: callerError } = await resolveCaller(admin, body.accessToken);
    if (callerError) return json(callerError.status, headers, { error: callerError.message });

    const rl = checkRateLimit(`anvil-reorder:${caller.userId}`, { max: 60, windowMs: 60 * 1000 });
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds, headers);

    if (!(await hasAnvilPro(admin, caller.companyId))) return proRequiredResponse(headers);

    const perms = await getEffectivePerms(admin, caller.userId, caller.companyId, caller.role);
    if (!perms.inv_edit) {
      return json(403, headers, { error: "You do not have permission to manage reorders." });
    }
    const companyId = caller.companyId;

    switch (body.action) {
      case "list": {
        const [{ data: settings }, { data: pending }, { data: recent }] = await Promise.all([
          admin
            .from("anvil_reorder_settings")
            .select("enabled, notify_emails")
            .eq("company_id", companyId)
            .maybeSingle(),
          admin
            .from("anvil_reorder_proposals")
            .select("*")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .order("created_at", { ascending: true }),
          admin
            .from("anvil_reorder_proposals")
            .select("*")
            .eq("company_id", companyId)
            .neq("status", "pending")
            .order("decided_at", { ascending: false })
            .limit(20),
        ]);
        return json(200, headers, {
          enabled: settings?.enabled === true,
          notifyEmails: settings?.notify_emails || [],
          pending: pending || [],
          recent: recent || [],
        });
      }

      case "settings": {
        /** @type {Record<string, unknown>} */
        const patch = {
          company_id: companyId,
          updated_at: new Date().toISOString(),
          updated_by: caller.userId,
        };
        if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
        if (Array.isArray(body.notifyEmails)) {
          const cleaned = [
            ...new Set(
              body.notifyEmails
                .map((/** @type {unknown} */ e) =>
                  String(e || "")
                    .trim()
                    .toLowerCase(),
                )
                .filter((/** @type {string} */ e) => EMAIL_RE.test(e)),
            ),
          ].slice(0, 10);
          patch.notify_emails = cleaned;
        }
        const { error } = await admin
          .from("anvil_reorder_settings")
          .upsert(patch, { onConflict: "company_id" });
        if (error) throw new Error(error.message);
        return json(200, headers, { ok: true });
      }

      case "approve":
      case "dismiss": {
        if (typeof body.id !== "string" || !body.id) {
          return json(400, headers, { error: "Missing proposal id." });
        }
        const approving = body.action === "approve";
        /** @type {Record<string, unknown>} */
        const patch = {
          status: approving ? "approved" : "dismissed",
          decided_at: new Date().toISOString(),
          decided_by: caller.userId,
        };
        if (approving) {
          const qty = Number(body.qty);
          if (body.qty !== undefined && !(Number.isFinite(qty) && qty > 0)) {
            return json(400, headers, { error: "Quantity must be a positive number." });
          }
          if (body.qty !== undefined) patch.approved_qty = qty;
        }
        // .eq status pending: a double-click, or two approvers racing, decides it once.
        const { data, error } = await admin
          .from("anvil_reorder_proposals")
          .update(patch)
          .eq("id", body.id)
          .eq("company_id", companyId)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) {
          return json(409, headers, {
            error: "That reorder was already decided or no longer exists.",
          });
        }
        return json(200, headers, { ok: true });
      }

      default:
        return json(400, headers, { error: "Unknown action." });
    }
  } catch (err) {
    return json(500, headers, { error: errorMessage(err) });
  }
};

export const handler = withSentry("anvil-reorder", rawHandler);
