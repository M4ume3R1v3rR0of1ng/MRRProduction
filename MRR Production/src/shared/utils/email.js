import { getAccessToken } from "./supabase";

const proxyEndpoint = "/.netlify/functions/send-email";

// Escape user-controlled values before interpolating them into email HTML, so a
// job name / address / note like "<a href=...>" can't inject markup or links into
// the email a coworker receives.
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendEmail({ to, subject, html }) {
  try {
    const accessToken = await getAccessToken();
    const response = await fetch(proxyEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, subject, html, accessToken }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || `Proxy gateway returned error code: ${response.status}`,
      );
    }

    console.log(
      "📨 Serverless email transaction completed successfully:",
      result.id,
    );
    return { success: true, id: result.id };
  } catch (err) {
    console.error(
      "🔒 Security Proxy Alert: System aborted email dispatch:",
      err.message,
    );
    // Suppressing aggressive blocking alerts so downstream application state maps don't lock up if a webhook lags
    return { success: false, error: err.message };
  }
}
