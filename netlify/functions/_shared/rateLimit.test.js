import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit, clientIp, rateLimitedResponse, _resetForTests } from "./rateLimit.js";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetForTests();
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const opts = { max: 3, windowMs: 60_000 };
    expect(checkRateLimit("k", opts).allowed).toBe(true);
    expect(checkRateLimit("k", opts).allowed).toBe(true);
    expect(checkRateLimit("k", opts).allowed).toBe(true);
  });

  it("blocks the request that exceeds the limit", () => {
    const opts = { max: 2, windowMs: 60_000 };
    checkRateLimit("k", opts);
    checkRateLimit("k", opts);
    const third = checkRateLimit("k", opts);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keys are independent — hammering one key never blocks another", () => {
    const opts = { max: 1, windowMs: 60_000 };
    checkRateLimit("a", opts);
    expect(checkRateLimit("a", opts).allowed).toBe(false);
    expect(checkRateLimit("b", opts).allowed).toBe(true);
  });

  it("lets requests back in once the window has fully elapsed", () => {
    vi.useFakeTimers();
    const opts = { max: 1, windowMs: 1000 };
    expect(checkRateLimit("k", opts).allowed).toBe(true);
    expect(checkRateLimit("k", opts).allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(checkRateLimit("k", opts).allowed).toBe(true);
    vi.useRealTimers();
  });

  it("retryAfterSeconds counts down toward the moment the oldest hit expires, not the newest", () => {
    vi.useFakeTimers();
    const opts = { max: 1, windowMs: 10_000 };
    checkRateLimit("k", opts); // t=0, the one hit allowed in this window
    vi.advanceTimersByTime(4000); // t=4000, still inside the window
    const blocked = checkRateLimit("k", opts);
    expect(blocked.allowed).toBe(false);
    // Window clears 10s after the t=0 hit, i.e. 6s from now — not 10s.
    expect(blocked.retryAfterSeconds).toBe(6);
    vi.useRealTimers();
  });
});

describe("clientIp", () => {
  it("prefers the first address in x-forwarded-for", () => {
    const event = { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } };
    expect(clientIp(event)).toBe("203.0.113.5");
  });

  it("falls back to Netlify's own connection-ip header", () => {
    const event = { headers: { "x-nf-client-connection-ip": "198.51.100.7" } };
    expect(clientIp(event)).toBe("198.51.100.7");
  });

  it("never throws on a request with no identifying headers at all", () => {
    expect(clientIp({ headers: {} })).toBe("unknown");
    expect(clientIp({})).toBe("unknown");
  });
});

describe("rateLimitedResponse", () => {
  it("returns 429 with Retry-After and preserves the caller's CORS headers", () => {
    const res = rateLimitedResponse(12, { "Access-Control-Allow-Origin": "https://steadwerk.com" });
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("12");
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://steadwerk.com");
    expect(JSON.parse(res.body).error).toMatch(/too many requests/i);
  });
});
