// netlify/functions/weather.js
// Server-side proxy for the warehouse weather forecast. Uses Open-Meteo, which is
// free and needs no API key, so there's no secret to hide here — but we still verify
// the caller's Supabase session to match the other functions and avoid an open proxy.
// Going through a function (not a direct browser fetch) also keeps it inside the
// app's Content-Security-Policy, which only allows connect-src to 'self' + Supabase.

const { createClient } = require("@supabase/supabase-js");

// Saint Joe Road warehouse — Fort Wayne, IN area. Adjust these if the warehouse moves.
const WAREHOUSE_LAT = 41.0793;
const WAREHOUSE_LON = -85.1394;

const ALLOWED_ORIGINS = [
  "https://mrrproduction.netlify.app",
  "http://localhost:5173",
  "http://localhost:8888",
  "http://localhost:3000",
];

function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

exports.handler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(requestOrigin);

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

  const { accessToken } = body;
  if (!accessToken) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Not authenticated" }) };
  }

  try {
    const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Not authenticated" }) };
    }

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${WAREHOUSE_LAT}&longitude=${WAREHOUSE_LON}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
      `&timezone=America/New_York&forecast_days=5`;

    const resp = await fetch(url);
    if (!resp.ok) {
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: `Weather provider error ${resp.status}` }) };
    }
    const data = await resp.json();

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
