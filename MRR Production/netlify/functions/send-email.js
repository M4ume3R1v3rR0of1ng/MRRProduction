// Example Netlify Edge / Serverless Function handler configuration
// Environment Variable 'RESEND_API_KEY' must be configured in your hosting dashboard

export async function handler(event, context) {
  // 1. Enforce strict POST request routing
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed. Use POST." }),
    };
  }

  try {
    // 2. Extract client delivery properties
    const { to, subject, html } = JSON.parse(event.body || "{}");

    if (!to || !subject || !html) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields: 'to', 'subject', or 'html'." }),
      };
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("Missing server-side configuration: RESEND_API_KEY is null.");
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Internal Server Configuration Error." }),
      };
    }

    // 3. Execute the secure server-to-server transaction directly to Resend
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "Maumee River Roofing <notifications@maumeeriverroofing.com>",
        to: Array.isArray(to) ? to : [to],
        subject: subject,
        html: html,
      }),
    });

    const responseData = await resendResponse.json();

    if (!resendResponse.ok) {
      throw new Error(responseData.message || `Resend HTTP Error: ${resendResponse.status}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, id: responseData.id }),
    };

  } catch (err) {
    console.error("Email Edge Dispatch Failure:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}