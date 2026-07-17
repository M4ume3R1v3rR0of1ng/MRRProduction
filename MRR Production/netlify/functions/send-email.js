// netlify/functions/send-email.js
// Generic authenticated email relay. Environment variable RESEND_API_KEY must be set.

import { adminClient, resolveCaller, corsHeaders, platformFromAddress } from "./_shared/tenant.js";

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
        to: Array.isArray(to) ? to : [to],
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
