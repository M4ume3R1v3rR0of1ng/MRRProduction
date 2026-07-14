// netlify/functions/weather.js
// Server-side proxy for the warehouse weather forecast. Uses Open-Meteo, which is
// free and needs no API key, so there's no secret to hide here — but we still verify
// the caller's Supabase session to match the other functions and avoid an open proxy.
// Going through a function (not a direct browser fetch) also keeps it inside the
// app's Content-Security-Policy, which only allows connect-src to 'self' + Supabase.

import { adminClient, resolveCaller } from "./_shared/tenant.js";

// Fallback: the Saint Joe Road warehouse, Fort Wayne IN. Each company sets its own
// coordinates in companies.integrations.weather — otherwise a roofing crew in another
// state would be looking at Fort Wayne's forecast to decide whether to tear off a roof.
const DEFAULT_LAT = 41.0793;
const DEFAULT_LON = -85.1394;
const DEFAULT_TZ = "America/New_York";

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

export const handler = async (event) => {
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

  try {
    const admin = adminClient();
    const { caller, error: callerError } = await resolveCaller(admin, accessToken);
    if (callerError) {
      return { statusCode: callerError.status, headers: corsHeaders, body: JSON.stringify({ error: callerError.message }) };
    }

    const weather = caller.integrations?.weather || {};
    const lat = weather.lat ?? DEFAULT_LAT;
    const lon = weather.lon ?? DEFAULT_LON;
    const tz = weather.timezone ?? DEFAULT_TZ;

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
      `&timezone=${encodeURIComponent(tz)}&forecast_days=5`;

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
