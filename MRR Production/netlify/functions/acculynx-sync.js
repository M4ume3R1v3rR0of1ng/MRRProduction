// netlify/functions/acculynx-sync.js

exports.handler = async (event, context) => {
  // 1. Enforce CORS protection: Only allow requests from your frontend dashboard
  const headers = {
'Access-Control-Allow-Origin': 'https://mrr-production.netlify.app/',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight OPTIONS request safely
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // 2. Reject anything that isn't a POST request from your dashboard
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // 3. Extract the hidden AccuLynx API key securely from the serverless environment variables
    const ACCULYNX_API_KEY = process.env.ACCULYNX_SECRET_KEY;

    if (!ACCULYNX_API_KEY) {
      console.error("Missing ACCULYNX_SECRET_KEY variable on Netlify server environment.");
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Internal Server Configuration Error' })
      };
    }

    // 4. Parse the payload (PO number, items, costs) sent from your frontend app
    const jobPayload = JSON.parse(event.body);

    // 5. Forward the request to AccuLynx's real API servers using Node's native fetch
    // Note: Replace with the exact AccuLynx API URL endpoint provided in their documentation
    const acculynxResponse = await fetch('https://api.acculynx.com/v1/jobs/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ACCULYNX_API_KEY}` // The key is securely bundled behind the scenes
      },
      body: JSON.stringify(jobPayload)
    });

    const responseData = await acculynxResponse.json().catch(() => ({}));

    if (!acculynxResponse.ok) {
      return {
        statusCode: acculynxResponse.status,
        headers,
        body: JSON.stringify({ error: 'AccuLynx API Error', details: responseData })
      };
    }

    // 6. Return a clean success token back to your frontend dashboard
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Successfully synchronized data payload to AccuLynx!', data: responseData })
    };

  } catch (error) {
    console.error("Serverless Proxy Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', message: error.message })
    };
  }
};