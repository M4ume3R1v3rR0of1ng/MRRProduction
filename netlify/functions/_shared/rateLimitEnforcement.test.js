// netlify/functions/_shared/rateLimitEnforcement.test.js
//
// Section 23 of the README calls this out as a known gap: rateLimit.js is
// wired into specific functions by hand, and "any new endpoint reachable
// without an established session needs to remember to add it; nothing
// enforces that automatically." This test is that enforcement.
//
// A function is exempt from needing checkRateLimit() only if it never runs
// for an unauthenticated caller in the first place:
//   - it calls resolveCaller(), which requires a verified Supabase Auth
//     session before anything else happens (see _shared/tenant.js), or
//   - it's a scheduled function (`export const config = { schedule: ... }`),
//     which Netlify refuses to invoke from outside its own cron trigger.
// Everything else is, by definition, an endpoint the public internet can hit
// with no credential at all — exactly the case rateLimit.js exists for.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTIONS_DIR = fileURLToPath(new URL("..", import.meta.url));

const functionFiles = readdirSync(FUNCTIONS_DIR).filter(
  (name) => name.endsWith(".js") && !name.endsWith(".test.js"),
);

export function needsRateLimit(src) {
  const sessionGated = /\bresolveCaller\s*\(/.test(src);
  const cronOnly = /export const config\s*=\s*\{[^}]*\bschedule\b/s.test(src);
  return !sessionGated && !cronOnly;
}

describe("rate limiting is wired into every session-less endpoint", () => {
  it("scanned a real set of function files", () => {
    expect(functionFiles.length).toBeGreaterThan(15);
  });

  it("every function reachable without a session calls checkRateLimit", () => {
    const offenders = functionFiles
      .map((name) => [name, readFileSync(join(FUNCTIONS_DIR, name), "utf8")])
      .filter(([, src]) => needsRateLimit(src) && !/\bcheckRateLimit\s*\(/.test(src))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it("would catch a new unauthenticated endpoint that forgets the throttle", () => {
    const forgotten = `
      export const handler = async (event) => {
        // no resolveCaller, no schedule config, no checkRateLimit
        return { statusCode: 200, body: "ok" };
      };`;
    expect(needsRateLimit(forgotten)).toBe(true);
  });

  it("does not flag a session-gated function", () => {
    const gated = `
      const { caller } = await resolveCaller(admin, accessToken);
      export const handler = rawHandler;`;
    expect(needsRateLimit(gated)).toBe(false);
  });

  it("does not flag a scheduled/cron function", () => {
    const cron = `
      export const handler = rawHandler;
      export const config = { schedule: "0 10 * * *" };`;
    expect(needsRateLimit(cron)).toBe(false);
  });
});
