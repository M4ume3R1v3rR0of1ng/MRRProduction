// netlify/functions/request-account-deletion.js
//
// "Delete my account", as a request rather than an instant delete.
//
// WHY A REQUEST
//
// Every account in Steadwerk is a WORK account: a company admin creates it on
// the web, and the person's jobs, inspections and time records belong to the
// company, not to them. Deleting the login on the spot would leave the company
// mid-job with records pointing at nobody, and an owner could delete
// themselves out of their own paid subscription. So the person asks, and the
// people who already manage users (delete-user.js, admin only) act on it.
//
// Apple accepts this shape for organization-managed accounts (App Review
// Guideline 5.1.1(v)): the user can start deletion from inside the app, and is
// told what happens next.
//
// WHO IS EMAILED
//
//   * Every other active admin of the caller's company. They do the removal.
//   * Only when there are none (the caller is the company's sole admin): the
//     platform admins (profiles.is_platform_admin), because removing a
//     company's last admin is not something anyone inside the company can do.
//   * The caller, a receipt saying what was asked and who was told.
//
// Admins only. No shared inbox is copied (privacy@ was, until 2026-11-19).

import { Resend } from "resend";
import {
  adminClient,
  resolveCaller,
  corsHeaders,
  platformFromAddress,
  errorMessage,
} from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { checkRateLimit, rateLimitedResponse } from "./_shared/rateLimit.js";

const MAIL_FROM = platformFromAddress("notifications");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Pure: who acts on the request. The company's other admins, de-duplicated and
 * lowercased, never the caller themselves. Exported for the test.
 *
 * @param {Array<string | null | undefined>} adminEmails
 * @param {string | undefined} callerEmail
 * @returns {string[]}
 */
export function pickAdminRecipients(adminEmails, callerEmail) {
  const self = String(callerEmail || "")
    .trim()
    .toLowerCase();
  const seen = new Set();
  for (const raw of adminEmails || []) {
    const email = String(raw || "")
      .trim()
      .toLowerCase();
    if (email && email !== self) seen.add(email);
  }
  return [...seen];
}

/**
 * Pure: the email the admins receive. Exported for the test.
 *
 * @param {{ name: string, email: string, role: string | undefined, companyName: string, hasAdmins: boolean, reason: string }} req
 * @returns {{ subject: string, html: string }}
 */
export function buildRequestEmail({ name, email, role, companyName, hasAdmins, reason }) {
  const who = name ? `${name} (${email})` : email;
  const nextStep = hasAdmins
    ? `<p>An admin of ${escapeHtml(companyName)} should remove this person under <strong>Users</strong> in Steadwerk on the web. That deletes their login; their company records stay with the company.</p>`
    : `<p><strong>This person is the only admin of ${escapeHtml(companyName)}.</strong> Removing them leaves the company with no admin, so this came to you as a Steadwerk platform admin to handle directly with them.</p>`;
  return {
    subject: `Account deletion request: ${who}`,
    html:
      `<p>${escapeHtml(who)} asked to delete their Steadwerk account from inside the app.</p>` +
      `<p><strong>Company:</strong> ${escapeHtml(companyName)}<br>` +
      `<strong>Role:</strong> ${escapeHtml(role || "member")}</p>` +
      (reason ? `<p><strong>Reason given:</strong> ${escapeHtml(reason)}</p>` : "") +
      nextStep +
      `<p>Please act on this within 30 days.</p>`,
  };
}

const rawHandler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin || "");

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    const { accessToken, reason } = JSON.parse(event.body || "{}");

    const admin = adminClient();
    const { caller, error: callerError } = await resolveCaller(admin, accessToken);
    if (callerError) {
      return {
        statusCode: callerError.status,
        headers,
        body: JSON.stringify({ error: callerError.message }),
      };
    }

    // A person asks once. A few retries cover a flaky connection; more than
    // that is someone using this to mail the admins.
    const rl = checkRateLimit(`request-account-deletion:${caller.userId}`, {
      max: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds, headers);

    if (!caller.email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Your account has no email address on file." }),
      };
    }
    if (!process.env.RESEND_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Email is not configured, so the request could not be sent.",
        }),
      };
    }

    // The company's active admins. Scoped by company_id: this is the
    // service-role client, so nothing in the database would stop a missing
    // filter from reaching another tenant (see _shared/tenant.js).
    const { data: adminMemberships } = await admin
      .from("memberships")
      .select("user_id")
      .eq("company_id", caller.companyId)
      .eq("role", "admin")
      .eq("active", true);
    const adminIds = (adminMemberships || []).map((m) => m.user_id);

    let adminEmails = [];
    if (adminIds.length) {
      const { data: profs } = await admin.from("profiles").select("email").in("id", adminIds);
      adminEmails = (profs || []).map((p) => p.email);
    }
    const recipients = pickAdminRecipients(adminEmails, caller.email);

    // Sole admin: nobody in the company can act, so it goes to the platform.
    let to = recipients;
    if (!to.length) {
      const { data: platformAdmins } = await admin
        .from("profiles")
        .select("email")
        .eq("is_platform_admin", true);
      to = pickAdminRecipients(
        (platformAdmins || []).map((p) => p.email),
        caller.email,
      );
    }
    if (!to.length) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "No admin was found to send this request to. Please contact your company.",
        }),
      };
    }

    const { data: me } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", caller.userId)
      .maybeSingle();

    const trimmedReason = String(reason || "")
      .trim()
      .slice(0, 1000);
    const message = buildRequestEmail({
      name: me?.full_name || "",
      email: caller.email,
      role: caller.role,
      companyName: caller.companyName,
      hasAdmins: recipients.length > 0,
      reason: trimmedReason,
    });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: sendError } = await resend.emails.send({
      from: `Steadwerk <${MAIL_FROM}>`,
      to,
      replyTo: caller.email,
      subject: message.subject,
      html: message.html,
    });
    if (sendError) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `The request could not be sent: ${sendError.message}` }),
      };
    }

    // The receipt is a courtesy. The request already went out, so a failure
    // here is logged and the person is still told it was sent.
    try {
      await resend.emails.send({
        from: `Steadwerk <${MAIL_FROM}>`,
        to: [caller.email],
        subject: "We received your account deletion request",
        html:
          `<p>Your request to delete your Steadwerk account was sent to ${
            recipients.length
              ? `the admins of ${escapeHtml(caller.companyName)}`
              : "Steadwerk support"
          }.</p>` +
          `<p>They will remove your login within 30 days. Records you created for ${escapeHtml(
            caller.companyName,
          )}, such as jobs and inspections, belong to the company and stay with it.</p>` +
          `<p>Questions? Ask your company's admin.</p>`,
      });
    } catch (err) {
      console.error("request-account-deletion: receipt failed:", errorMessage(err));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, sentToAdmins: recipients.length }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: errorMessage(err) }) };
  }
};

export const handler = withSentry("request-account-deletion", rawHandler);
