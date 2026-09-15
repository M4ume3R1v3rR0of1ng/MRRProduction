// netlify/functions/_shared/apns.js
//
// Sends one push through Apple's HTTP/2 provider API. No push-sending library
// exists in this repo yet, and node-apn (the usual pick) is effectively
// unmaintained, so this signs the provider JWT itself with `jsonwebtoken`
// (ES256 — the algorithm APNs requires for token-based auth) and posts over
// Node's built-in http2 module, which is all the HTTP/2 provider API needs.
//
// Env (all from the user's Apple Developer account — Certificates, IDs &
// Profiles → Keys → create an APNs Auth Key):
//   APNS_KEY          - the .p8 key file contents, PEM format, literal newlines
//                        (a Netlify env var value with \n escapes works too —
//                        see the replace() below)
//   APNS_KEY_ID        - the 10-character Key ID for that key
//   APNS_TEAM_ID       - the 10-character Apple Developer Team ID
//   APNS_BUNDLE_ID     - the app's bundle id, e.g. "com.steadwerk.app"
//   APNS_PRODUCTION    - "true" once shipped via TestFlight/App Store; unset
//                        (or anything else) sends to the sandbox host, which is
//                        what a Simulator/debug build's device token needs.
//
// Until all five are set, sendPush() throws on first use — callers (the daily
// job) should catch that once per run and log it, not per vehicle.

import http2 from "node:http2";
import jwt from "jsonwebtoken";

const PRODUCTION_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";

// The provider JWT is valid up to an hour and cheap to regenerate; APNs
// documents reusing one for repeated calls, but a fresh token per cold start
// of this module is simpler than tracking expiry across warm-container reuse,
// and this job only sends a handful of pushes a day.
let cachedToken = null;
let cachedTokenAt = 0;
const TOKEN_TTL_MS = 45 * 60 * 1000; // regenerate well inside APNs' 1-hour cap

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`apns: missing ${name} environment variable.`);
  return value;
}

function providerToken() {
  const now = Date.now();
  if (cachedToken && now - cachedTokenAt < TOKEN_TTL_MS) return cachedToken;

  const keyId = requireEnv("APNS_KEY_ID");
  const teamId = requireEnv("APNS_TEAM_ID");
  // Netlify's env var UI can't hold a literal newline reliably, so accept the
  // common \n-escaped form and unescape it here.
  const key = requireEnv("APNS_KEY").replace(/\\n/g, "\n");

  cachedToken = jwt.sign({ iss: teamId, iat: Math.floor(now / 1000) }, key, {
    algorithm: "ES256",
    keyid: keyId,
  });
  cachedTokenAt = now;
  return cachedToken;
}

/**
 * @param {string} deviceToken - the APNs device token from device_push_tokens.token
 * @param {{ title: string, body: string, data?: Record<string, unknown> }} payload
 * @returns {Promise<{ ok: boolean, statusCode: number, apnsId?: string, reason?: string }>}
 */
export function sendPush(deviceToken, { title, body, data = {} }) {
  const bundleId = requireEnv("APNS_BUNDLE_ID");
  const host = process.env.APNS_PRODUCTION === "true" ? PRODUCTION_HOST : SANDBOX_HOST;
  const token = providerToken();

  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: "default" },
    ...data,
  });

  return new Promise((resolve, reject) => {
    const client = http2.connect(host);
    client.on("error", (err) => {
      client.close();
      reject(err);
    });

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${token}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let responseHeaders = {};
    let responseBody = "";
    req.on("response", (headers) => {
      responseHeaders = headers;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      responseBody += chunk;
    });
    req.on("end", () => {
      client.close();
      const statusCode = Number(responseHeaders[":status"]) || 0;
      if (statusCode === 200) {
        resolve({ ok: true, statusCode, apnsId: responseHeaders["apns-id"] });
        return;
      }
      let reason;
      try {
        reason = JSON.parse(responseBody || "{}").reason;
      } catch {
        reason = responseBody || undefined;
      }
      resolve({ ok: false, statusCode, reason });
    });
    req.on("error", (err) => {
      client.close();
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

// A dead-token response APNs will keep sending for every future push until the
// row is removed — the caller should delete device_push_tokens on these.
export function isDeadTokenResponse({ statusCode, reason }) {
  return (
    statusCode === 410 ||
    (statusCode === 400 && (reason === "BadDeviceToken" || reason === "Unregistered"))
  );
}
