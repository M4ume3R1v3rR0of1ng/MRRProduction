// netlify/functions/acculynx-sync.js

const ALLOWED_ORIGINS = [
  "https://mrrproduction.netlify.app",      // production (no trailing slash)
  "http://localhost:5173",                  // Vite dev
  "http://localhost:3000",                  // CRA / fallback dev
];

function getCorsHeaders(requestOrigin) {
  // Reflect the caller's origin if it's on the allowlist; otherwise fall back
  // to the primary production origin so the function doesn't hard-fail.
  const origin = ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400", // cache preflight for 24 h
  };
}

exports.handler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(requestOrigin);

  // ── Handle CORS preflight ────────────────────────────────────────────────
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // ── Only allow POST ──────────────────────────────────────────────────────
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  // ── Resolve API key: prefer env var, fall back to body (Settings ping only) ──
  const apiKey = process.env.ACCULYNX_API_KEY || body.apiKey;

  if (!apiKey) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing AccuLynx API key" }),
    };
  }

  // ── Validate / connection-test ping ─────────────────────────────────────
  if (body.action === "validate") {
    try {
      const res = await fetch("https://api.acculynx.com/api/v2/jobs?page=1&pageSize=1", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) throw new Error(`AccuLynx responded with HTTP ${res.status}`);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, message: "Connection validated" }),
      };
    } catch (err) {
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: err.message }),
      };
    }
  }

  // ── Real sync payload ────────────────────────────────────────────────────
  try {
    // Example: forward the full payload to AccuLynx webhook/API.
    // Adjust the endpoint URL and body shape to match your AccuLynx setup.
    const res = await fetch("https://api.acculynx.com/api/v2/your-endpoint", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    if (!res.ok) throw new Error(`AccuLynx error ${res.status}: ${text}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, acculynxResponse: text }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};