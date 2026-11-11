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
// not place an order. The order is a separate, second step on purpose:
//
//   pending -> approved -> ordered -> received      (or pending -> dismissed)
//
//   send_po   emails a purchase order for an APPROVED reorder to the supplier, once.
//   receive   marks the delivery as arrived (from ordered, or from approved when the order
//             was phoned in).
//
// WHY send_po IS TIGHT
//
// It mails an outside address from our verified domain, and a sent email cannot be taken
// back. So: the body is built from fixed fields only (no free text from the caller), it only
// works on an approved row of the caller's own company, the row is CLAIMED (status ->
// ordered) before the send so a double-click cannot send two, a failed send puts the row back
// to approved so it can be retried, and it is rate limited harder than the other actions.
//
// Actions (POST { action, accessToken, ... }):
//   list      → { enabled, notifyEmails, pending[], approved[], ordered[], recent[] }
//   settings  → { enabled?, notifyEmails? }
//   approve   → { id, qty? }
//   dismiss   → { id }
//   send_po   → { id, to? }   (to: only needed when the item has no supplier email)
//   receive   → { id }
// @ts-check

import {
  adminClient,
  resolveCaller,
  corsHeaders,
  errorMessage,
  platformFromAddress,
} from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { getEffectivePerms } from "./_shared/anvilPerms.js";
import { hasAnvilPro, proRequiredResponse } from "./_shared/anvilPro.js";
import { checkRateLimit, rateLimitedResponse } from "./_shared/rateLimit.js";
import { makePoNumber, buildPurchaseOrderEmail } from "./_shared/reorder.js";

const MAIL_FROM = platformFromAddress("orders");

/**
 * @param {{ from: string, to: string, replyTo: string, subject: string, html: string }} mail
 */
async function sendEmail({ from, to, replyTo, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Email is not configured (RESEND_API_KEY is not set).");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html }),
  });
  if (!res.ok) {
    const data = /** @type {{ message?: string }} */ (await res.json().catch(() => ({})));
    throw new Error(data?.message || `Email service returned HTTP ${res.status}`);
  }
}

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
        const [
          { data: settings },
          { data: pending },
          { data: approved },
          { data: ordered },
          { data: recent },
        ] = await Promise.all([
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
            .eq("status", "approved")
            .order("decided_at", { ascending: true }),
          admin
            .from("anvil_reorder_proposals")
            .select("*")
            .eq("company_id", companyId)
            .eq("status", "ordered")
            .order("ordered_at", { ascending: true }),
          // Finished business only: dismissed and received. Open orders have their own lists.
          admin
            .from("anvil_reorder_proposals")
            .select("*")
            .eq("company_id", companyId)
            .in("status", ["dismissed", "received"])
            .order("decided_at", { ascending: false })
            .limit(20),
        ]);
        return json(200, headers, {
          enabled: settings?.enabled === true,
          notifyEmails: settings?.notify_emails || [],
          pending: pending || [],
          approved: approved || [],
          ordered: ordered || [],
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

      case "send_po": {
        if (typeof body.id !== "string" || !body.id) {
          return json(400, headers, { error: "Missing proposal id." });
        }
        // Mailing outsiders is the expensive thing to get wrong, so it has its own, much
        // lower limit than the 60/minute above.
        const sendRl = checkRateLimit(`anvil-reorder-po:${caller.userId}`, {
          max: 10,
          windowMs: 10 * 60 * 1000,
        });
        if (!sendRl.allowed) return rateLimitedResponse(sendRl.retryAfterSeconds, headers);

        const { data: row, error: rowError } = await admin
          .from("anvil_reorder_proposals")
          .select("id, item_name, unit, approved_qty, suggested_qty, supplier_name, supplier_email")
          .eq("id", body.id)
          .eq("company_id", companyId)
          .eq("status", "approved")
          .maybeSingle();
        if (rowError) throw new Error(rowError.message);
        if (!row) {
          return json(409, headers, {
            error: "That reorder is not approved, was already ordered, or no longer exists.",
          });
        }

        const to = String(body.to || row.supplier_email || "")
          .trim()
          .toLowerCase();
        if (!EMAIL_RE.test(to)) {
          return json(400, headers, {
            error: "Add the supplier's email address to send the purchase order.",
          });
        }
        const qty = Number(row.approved_qty ?? row.suggested_qty);
        if (!(Number.isFinite(qty) && qty > 0)) {
          return json(400, headers, { error: "This reorder has no approved quantity." });
        }

        const now = new Date();
        const poNumber = makePoNumber(row.id, now);

        // Claim it BEFORE sending, so a double-click or two people pressing Send cannot mail
        // the supplier twice. Only one update can move approved -> ordered.
        const { data: claimed, error: claimError } = await admin
          .from("anvil_reorder_proposals")
          .update({
            status: "ordered",
            po_number: poNumber,
            ordered_at: now.toISOString(),
            ordered_by: caller.userId,
            ordered_to: to,
          })
          .eq("id", row.id)
          .eq("company_id", companyId)
          .eq("status", "approved")
          .select("id")
          .maybeSingle();
        if (claimError) throw new Error(claimError.message);
        if (!claimed) {
          return json(409, headers, { error: "That purchase order was already sent." });
        }

        const { data: profile } = await admin
          .from("profiles")
          .select("full_name, name")
          .eq("id", caller.userId)
          .maybeSingle();
        // An account with no email cannot receive the supplier's reply, so refuse rather than send.
        const callerEmail = caller.email || "";
        if (!callerEmail) {
          await admin
            .from("anvil_reorder_proposals")
            .update({
              status: "approved",
              po_number: null,
              ordered_at: null,
              ordered_by: null,
              ordered_to: null,
            })
            .eq("id", row.id)
            .eq("company_id", companyId)
            .eq("status", "ordered");
          return json(400, headers, {
            error: "Your account has no email address for the supplier to reply to.",
          });
        }
        const sentByName = profile?.full_name || profile?.name || caller.email || "our office";
        const { subject, html } = buildPurchaseOrderEmail({
          companyName: caller.companyName,
          poNumber,
          itemName: row.item_name,
          unit: row.unit,
          qty,
          supplierName: row.supplier_name,
          sentByName,
          sentByEmail: callerEmail,
          dateLabel: now.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "America/New_York",
          }),
        });

        try {
          await sendEmail({
            from: `${caller.companyName} <${MAIL_FROM}>`,
            to,
            replyTo: callerEmail,
            subject,
            html,
          });
        } catch (sendError) {
          // Put it back so it can be retried, rather than leaving a row that says "ordered"
          // for an order the supplier never received.
          await admin
            .from("anvil_reorder_proposals")
            .update({
              status: "approved",
              po_number: null,
              ordered_at: null,
              ordered_by: null,
              ordered_to: null,
            })
            .eq("id", row.id)
            .eq("company_id", companyId)
            .eq("status", "ordered");
          throw new Error(`The purchase order was not sent: ${errorMessage(sendError)}`);
        }
        return json(200, headers, { ok: true, poNumber, to });
      }

      case "receive": {
        if (typeof body.id !== "string" || !body.id) {
          return json(400, headers, { error: "Missing proposal id." });
        }
        const { data, error } = await admin
          .from("anvil_reorder_proposals")
          .update({
            status: "received",
            received_at: new Date().toISOString(),
            received_by: caller.userId,
          })
          .eq("id", body.id)
          .eq("company_id", companyId)
          .in("status", ["approved", "ordered"])
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) {
          return json(409, headers, {
            error: "That reorder is not waiting on a delivery, or no longer exists.",
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
