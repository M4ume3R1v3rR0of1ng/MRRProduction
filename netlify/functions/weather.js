// netlify/functions/weather.js
// Server-side proxy for the warehouse weather forecast. Uses Open-Meteo, which is
// free and needs no API key, so there's no secret to hide here — but we still verify
// the caller's Supabase session to match the other functions and avoid an open proxy.
// Going through a function (not a direct browser fetch) also keeps it inside the
// app's Content-Security-Policy, which only allows connect-src to 'self' + Supabase.

import { adminClient, resolveCaller, corsHeaders as getCorsHeaders } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { checkRateLimit, rateLimitedResponse } from "./_shared/rateLimit.js";

import { resolveWeatherLocation, toPlaceResults } from "./_shared/weatherLocation.js";

// Each company picks its own location in Settings > Warehouses — otherwise a roofing
// crew in another state would be looking at Fort Wayne's forecast to decide whether
// to tear off a roof. Fort Wayne stays the fallback; see _shared/weatherLocation.js.
//
// Two requests share this endpoint:
//   { accessToken }                 the forecast for the company's location
//   { accessToken, search: "..." }  place search for the Settings picker
// The search lives here rather than in the browser because the app's CSP only
// allows connect-src to 'self' and Supabase.

// CORS used to be a second, hand-copied ALLOWED_ORIGINS list here, which had
// drifted from _shared/tenant.js's copy and was missing "capacitor://localhost" —
// the iOS app's origin under WKWebView. That silently CORS-blocked the weather
// card for every iOS user. Importing the one shared list means it can't drift again.

const rawHandler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(requestOrigin);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

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

  const { accessToken } = body;

  try {
    const admin = adminClient();
    const { caller, error: callerError } = await resolveCaller(admin, accessToken);
    if (callerError) {
      return {
        statusCode: callerError.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: callerError.message }),
      };
    }

    // Spends a third-party forecast quota shared by every tenant, so one
    // company's loop should not exhaust it for the rest. The dashboard asks
    // once per load and caches, so 30/min is many times normal.
    const rl = checkRateLimit(`weather:${caller.userId}`, {
      max: 30,
      windowMs: 60 * 1000,
    });
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds, corsHeaders);

    if (typeof body.search === "string") {
      const query = body.search.trim().slice(0, 80);
      if (query.length < 2) {
        return {
          statusCode: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ results: [] }),
        };
      }
      const geoResp = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
          `&count=6&language=en&format=json`,
      );
      if (!geoResp.ok) {
        return {
          statusCode: 502,
          headers: corsHeaders,
          body: JSON.stringify({ error: `Place search error ${geoResp.status}` }),
        };
      }
      return {
        statusCode: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ results: toPlaceResults(await geoResp.json()) }),
      };
    }

    // branding holds the location chosen in Settings. resolveCaller does not load
    // it, and every other function that uses resolveCaller has no need for it.
    const { data: companyRow } = await admin
      .from("companies")
      .select("branding")
      .eq("id", caller.companyId)
      .maybeSingle();
    const loc = resolveWeatherLocation(companyRow?.branding, caller.integrations);

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
      `&timezone=${encodeURIComponent(loc.timezone)}&forecast_days=5`;

    const resp = await fetch(url);
    if (!resp.ok) {
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Weather provider error ${resp.status}` }),
      };
    }
    const data = await resp.json();

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      // The card shows this name, so it always matches the forecast beside it.
      body: JSON.stringify({
        ...data,
        location: { label: loc.label, isDefault: loc.isDefault },
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};

export const handler = withSentry("weather", rawHandler);
