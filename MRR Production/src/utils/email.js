const RESEND_KEY = import.meta.env.VITE_RESEND_KEY;

export async function sendEmail({ to, subject, html }) {
  // Point to your function endpoint mapping (adjusting route matching to match your framework setup)

  try {
    const response = await fetch(proxyEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, subject, html }),
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
