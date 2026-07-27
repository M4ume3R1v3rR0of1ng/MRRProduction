// netlify/functions/send-email.js
// Generic authenticated email relay. Environment variable RESEND_API_KEY must be set.

import { adminClient, resolveCaller, corsHeaders, platformFromAddress, companyMemberEmails } from "./_shared/tenant.js";

// notifications@<verified platform domain>, company name as the display name. See
// platformFromAddress in _shared/tenant.js for how the domain is resolved.
const MAIL_FROM = platformFromAddress("notifications");

export const handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin || "");

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed. Use POST." }) };
  }

  try {
    const { to, subject, html, accessToken } = JSON.parse(event.body || "{}");

    const admin = adminClient();
    const { caller, error: callerError } = await resolveCaller(admin, accessToken);
    if (callerError) {
      return { statusCode: callerError.status, headers, body: JSON.stringify({ error: callerError.message }) };
    }

    if (!to || !subject || !html) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required fields: 'to', 'subject', or 'html'." }),
      };
    }

    // ── Fence the relay ──
    // Only send to addresses that belong to ACTIVE members of the caller's OWN company.
    // Without this, any authenticated user could send arbitrary HTML to any address in
    // the world from our verified domain — a phishing/spam relay. Every legitimate use
    // (job/trailer notifications) targets a company member, so this costs nothing real.
    const recipients = (Array.isArray(to) ? to : [to])
      .map((r) => String(r || "").trim().toLowerCase())
      .filter(Boolean);
    if (recipients.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No valid recipient." }) };
    }
    // Cheap per-request throttle: no legitimate notification fans out to a crowd.
    if (recipients.length > 10) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: "Too many recipients in one request." }) };
    }
    const allowed = await companyMemberEmails(admin, caller.companyId);
    if (recipients.some((r) => !allowed.has(r))) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Recipients must be members of your company." }) };
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("Missing server-side configuration: RESEND_API_KEY is null.");
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal Server Configuration Error." }) };
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `${caller.companyName} <${MAIL_FROM}>`,
        to: recipients,
        subject,
        html,
      }),
    });

    const data = await resendResponse.json();

    if (!resendResponse.ok) {
      return { statusCode: resendResponse.status, headers, body: JSON.stringify({ error: data?.message || "Email send failed." }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
