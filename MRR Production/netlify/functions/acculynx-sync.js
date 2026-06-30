// netlify/functions/acculynx-sync.js

const ALLOWED_ORIGINS = [
  "https://mrrproduction.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization", // 🟢 CORS allows Authorization headers
    "Access-Control-Max-Age": "86400",
  };
}

exports.handler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(requestOrigin);

  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders, body: "" };
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON body" }) };
    }

    // ── 🟢 FIXED: Extract Key from Server-side Environment, fallback to header extraction ──
    let apiKey = process.env.ACCULYNX_API_KEY;

    if (!apiKey && event.headers?.authorization) {
      const parts = event.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        apiKey = parts[1];
      }
    }

    if (!apiKey) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Missing AccuLynx API key configuration" }) };
    }

    // Connection validation handling
    if (body.action === "validate") {
      try {
        const res = await fetch("https://api.acculynx.com/api/v2/jobs?page=1&pageSize=1", {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error(`AccuLynx connection rejected: HTTP ${res.status}`);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, message: "Connection validated" }) };
      } catch (err) {
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ ok: false, error: err.message }) };
      }
    }

    // ── Search action: used by the Build Jobs "Find Job" wizard step ──
    if (body.action === "search") {
      const q = (body.query || "").trim();
      if (!q) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing search query" }) };
      }
      try {
        const searchRes = await fetch(
          `https://api.acculynx.com/api/v2/jobs?search=${encodeURIComponent(q)}&page=1&pageSize=10`,
          { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
        );
        if (!searchRes.ok) throw new Error(`AccuLynx search failed: HTTP ${searchRes.status}`);
        const searchData = await searchRes.json();
        const jobs = (searchData?.data || []).map((j) => ({
          acculynxJobId: j.id,
          po: j.jobNumber || j.poNumber || j.id,
          name: j.jobName || j.customer?.name || "Untitled Job",
          addr: j.address?.line1 ? `${j.address.line1}${j.address.city ? ", " + j.address.city : ""}` : "",
        }));
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, jobs }) };
      } catch (err) {
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ ok: false, error: err.message }) };
      }
    }

    // ── FIX 1: Look up AccuLynx internal numeric Job ID via your specification query ──
    const searchRes = await fetch(
      `https://api.acculynx.com/api/v2/jobs?search=${encodeURIComponent(body.poNumber)}&page=1&pageSize=5`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`, 
          'Content-Type': 'application/json', 
        },
      }
    );

    if (!searchRes.ok) {
      const txt = await searchRes.text();
      throw new Error(`AccuLynx job lookup failed ${searchRes.status}: ${txt}`); 
    }

    const searchData = await searchRes.json(); 
    const acculynxJob = searchData?.data?.[0]; // Grab first array match

    if (!acculynxJob?.id) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ 
          ok: false, 
          error: `No AccuLynx job found matching PO: ${body.poNumber}` 
        }),
      };
    }

    const acculynxJobId = acculynxJob.id; 

    // ── FIX 2: Send clean, precisely schema-matched body down to official endpoint ──
    const lineItemRes = await fetch(
      `https://api.acculynx.com/api/v2/jobs/${acculynxJobId}/lineitems`, 
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`, 
          'Content-Type': 'application/json', 
        },
        body: JSON.stringify({
          description: body.paymentDescription,
          amount: body.totalMaterialCost, 
          lineItems: body.lineItems, 
        }),
      }
    );

    if (!lineItemRes.ok) {
      const txt = await lineItemRes.text(); 
      throw new Error(`AccuLynx line item error ${lineItemRes.status}: ${txt}`); 
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, acculynxJobId }), 
    };

  } catch (globalError) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: globalError.message }),
    };
  }
};