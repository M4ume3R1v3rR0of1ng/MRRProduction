// netlify/functions/_shared/rateLimit.js
//
// Best-effort, per-container throttle. Netlify Functions are stateless across
// cold starts, and one deploy can be backed by many warm containers at once, so
// this is NOT a distributed rate limit — an attacker spread across enough
// containers/IPs will not be fully stopped by this alone. What it does stop is
// the common case: a single script hammering one endpoint from one place. That
// was the actual gap — reset-password, chat, create-checkout, and the AccuLynx
// import secret guesser had no throttle of any kind before this existed.
//
// A real distributed limit needs shared state (a Supabase table keyed by
// caller/IP, or Netlify's own edge-level rate limiting product) and is a
// deliberate follow-up, not a blocker for this first layer.

/** @type {Map<string, number[]>} key -> sorted array of hit timestamps (ms), oldest first */
const buckets = new Map();

/**
 * @param {string} key - identifies what's being limited, e.g. "chat:1.2.3.4"
 * @param {{max: number, windowMs: number}} opts
 * @returns {{allowed: boolean, retryAfterSeconds: number}}
 */
export function checkRateLimit(key, { max, windowMs }) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);

  if (hits.length >= max) {
    // hits[0] is the oldest surviving hit — the window clears that many ms after it.
    const retryAfterMs = windowMs - (now - hits[0]);
    buckets.set(key, hits);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  hits.push(now);
  buckets.set(key, hits);

  // Cheap, occasional cleanup so `buckets` doesn't grow unbounded in a
  // long-lived warm container. Only sweeps once the map is already large,
  // rather than on every call.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

// Exposed for tests only, so a suite can reset state between cases instead of
// picking unique keys to dodge cross-test pollution.
export function _resetForTests() {
  buckets.clear();
}

/**
 * Best-effort caller IP from the headers Netlify actually sets. Never trust
 * this for authorization — only for throttling, where a spoofed value just
 * costs the attacker their own bucket instead of sharing everyone else's.
 * @param {{headers?: Record<string, string | undefined>}} event
 * @returns {string}
 */
export function clientIp(event) {
  const xff = event.headers?.["x-forwarded-for"] || event.headers?.["X-Forwarded-For"];
  if (xff) return xff.split(",")[0].trim();
  return event.headers?.["x-nf-client-connection-ip"] || event.headers?.["client-ip"] || "unknown";
}

/**
 * Standard 429 response body, ready to spread with the caller's own CORS headers.
 * @param {number} retryAfterSeconds
 * @param {Record<string, string>} corsHeaders
 * @returns {{statusCode: number, headers: Record<string, string>, body: string}}
 */
export function rateLimitedResponse(retryAfterSeconds, corsHeaders) {
  return {
    statusCode: 429,
    headers: { ...corsHeaders, "Retry-After": String(retryAfterSeconds) },
    body: JSON.stringify({ error: "Too many requests. Please try again shortly." }),
  };
}
