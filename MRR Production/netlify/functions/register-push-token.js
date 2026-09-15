// netlify/functions/register-push-token.js
// Registers (or re-confirms) one device's APNs push token for the calling
// user. Called from src/shared/utils/pushRegistration.js after login and
// whenever the Capacitor plugin reports a token refresh.

import { adminClient, resolveCaller, corsHeaders as getCorsHeaders } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { checkRateLimit, rateLimitedResponse } from "./_shared/rateLimit.js";

const rawHandler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(requestOrigin);

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders, body: "" };
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

  const { accessToken, token, platform } = body;
  if (!token || typeof token !== "string") {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing device token" }),
    };
  }

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

    // Registration happens once per login/foreground, not per keystroke, but
    // this still guards against a runaway client retry loop hammering the
    // table — same reasoning as chat.js's per-user cap.
    const rl = checkRateLimit(`register-push-token:${caller.userId}`, {
      max: 20,
      windowMs: 60 * 1000,
    });
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds, corsHeaders);

    // Only "ios" exists today (device_push_tokens_platform_known check
    // constraint) — ignore whatever the client sends rather than trust an
    // unrecognized value into a column the constraint will reject anyway.
    void platform;

    const { error: upsertError } = await admin.from("device_push_tokens").upsert(
      {
        company_id: caller.companyId,
        user_id: caller.userId,
        platform: "ios",
        token,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    if (upsertError) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: upsertError.message }),
      };
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true }) };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export const handler = withSentry("register-push-token", rawHandler);
