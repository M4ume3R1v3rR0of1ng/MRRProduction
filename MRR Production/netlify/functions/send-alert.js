// netlify/functions/send-alert.js
// Low-stock alert email. Runs on Netlify's servers, never in the browser.

import { Resend } from "resend";
import { adminClient, resolveCaller, corsHeaders, platformFromAddress } from "./_shared/tenant.js";

// alerts@<verified platform domain> — shares the domain with send-email, keeps its own
// local part. See platformFromAddress in _shared/tenant.js.
const MAIL_FROM = platformFromAddress("alerts");

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin || "");

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    const { email, itemName, currentStock, unit, alertThreshold, accessToken } = JSON.parse(event.body || "{}");

    // Require a verified, active session in a paid-up company — this previously
    // accepted any unauthenticated request and sent from a verified company domain.
    const admin = adminClient();
    const { caller, error: callerError } = await resolveCaller(admin, accessToken);
    if (callerError) {
      return { statusCode: callerError.status, headers, body: JSON.stringify({ error: callerError.message }) };
    }

    if (!email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing recipient email." }) };
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const safeItemName = escapeHtml(itemName);
    const data = await resend.emails.send({
      from: `${caller.companyName} Alerts <${MAIL_FROM}>`,
      to: email,
      subject: `⚠️ Low Stock Alert — ${itemName}`,
      html: `
        <h2>Inventory Item Running Low</h2>
        <p><strong>Company:</strong> ${escapeHtml(caller.companyName)}</p>
        <p><strong>Item:</strong> ${safeItemName}</p>
        <p><strong>Current Stock:</strong> ${escapeHtml(currentStock)} ${escapeHtml(unit)}</p>
        <p><strong>Alert Threshold:</strong> ${escapeHtml(alertThreshold)} ${escapeHtml(unit)}</p>
        <p>Please log into the portal to place a reorder.</p>
      `,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
