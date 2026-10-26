// netlify/functions/__tests__/acculynx-retry-sync.test.js
//
// Two kinds of test here, and the second kind is the important one.
//
// The first covers the backoff, which is ordinary arithmetic.
//
// The second covers two things that CANNOT be caught by running the code under
// Vitest, because Vitest resolves modules through Vite — with the "@/" alias loaded
// and extensionless specifiers resolved. Netlify's bundler and plain Node have
// neither. So a refactor that puts `from "@/shared/utils/helpers"` back into
// pdfGenerator.js, or drops a ".js", leaves every suite green and breaks the deploy:
// the cron is the only consumer that resolves those paths for real, and it does so
// on Netlify, at build time, where nobody is watching. These tests read the source
// text instead, which is the one check that does not go through a resolver.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { nextAttemptDue, MAX_ATTEMPTS } from "../acculynx-retry-sync.js";

const FUNCTIONS_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel) => readFileSync(join(REPO, rel), "utf8");

const H = 3600_000;
const ago = (ms, now) => new Date(now - ms).toISOString();

describe("nextAttemptDue", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");

  it("sends a job the server has never tried, immediately", () => {
    expect(nextAttemptDue({ sync_attempts: 0 }, now)).toBe(true);
  });

  it("treats a missing attempt count as never tried", () => {
    // Every pre-existing row before supabase/58 ran, and anything the select missed.
    expect(nextAttemptDue({}, now)).toBe(true);
    expect(nextAttemptDue({ sync_attempts: null }, now)).toBe(true);
  });

  it("waits an hour after the first failure, then doubles", () => {
    expect(nextAttemptDue({ sync_attempts: 1, sync_last_attempt_at: ago(0.5 * H, now) }, now)).toBe(
      false,
    );
    expect(nextAttemptDue({ sync_attempts: 1, sync_last_attempt_at: ago(1 * H, now) }, now)).toBe(
      true,
    );
    expect(nextAttemptDue({ sync_attempts: 2, sync_last_attempt_at: ago(1 * H, now) }, now)).toBe(
      false,
    );
    expect(nextAttemptDue({ sync_attempts: 2, sync_last_attempt_at: ago(2 * H, now) }, now)).toBe(
      true,
    );
    expect(nextAttemptDue({ sync_attempts: 4, sync_last_attempt_at: ago(7 * H, now) }, now)).toBe(
      false,
    );
    expect(nextAttemptDue({ sync_attempts: 4, sync_last_attempt_at: ago(8 * H, now) }, now)).toBe(
      true,
    );
  });

  it("caps the wait at a day rather than doubling forever", () => {
    // Without the cap, attempt 7 would wait 64 hours and attempt 8 over five days —
    // so a job could sit "in the queue" for a week with nothing happening.
    expect(nextAttemptDue({ sync_attempts: 7, sync_last_attempt_at: ago(23 * H, now) }, now)).toBe(
      false,
    );
    expect(nextAttemptDue({ sync_attempts: 7, sync_last_attempt_at: ago(24 * H, now) }, now)).toBe(
      true,
    );
  });

  it("retries rather than stalls when the timestamp is unreadable", () => {
    // A row with a corrupt stamp must not be parked forever: a job that never gets
    // picked up is the failure this whole function exists to end.
    expect(nextAttemptDue({ sync_attempts: 3, sync_last_attempt_at: "" }, now)).toBe(true);
    expect(nextAttemptDue({ sync_attempts: 3, sync_last_attempt_at: "soon" }, now)).toBe(true);
    expect(nextAttemptDue({ sync_attempts: 3, sync_last_attempt_at: null }, now)).toBe(true);
  });

  it("gives up after a bounded number of attempts", () => {
    // The SQL side applies this (sync_attempts < max_attempts in
    // acculynx_sync_candidates), so the constant has to be a real number the
    // function actually passes, not a comment.
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ATTEMPTS).toBeLessThan(50);
    expect(read("netlify/functions/acculynx-retry-sync.js")).toContain(
      "max_attempts: MAX_ATTEMPTS",
    );
  });
});

describe("the modules the cron shares with the browser stay Node-resolvable", () => {
  // Everything the cron pulls out of src/, directly or transitively.
  const SHARED = [
    "src/features/jobs/accuLynxPayload.js",
    "src/features/jobs/jobReportPdf.js",
    "src/features/jobs/pdfGenerator.js",
    "src/features/jobs/poCollisions.js",
    "src/shared/utils/helpers.js",
  ];

  it.each(SHARED)("%s uses no Vite-only alias", (rel) => {
    // "@/" is defined in vite.config.js and jsconfig.json and nowhere else. Under
    // Node — which is what runs the scheduled function — it resolves to nothing.
    const offending = read(rel)
      .split("\n")
      .filter((l) => /^\s*(import|export)\b[^\n]*from\s+["']@\//.test(l));
    expect(offending).toEqual([]);
  });

  it.each(SHARED)("%s imports its own neighbours with a file extension", (rel) => {
    // Node ESM does not guess extensions. `from "./pdfGenerator"` works in the
    // bundle and throws ERR_MODULE_NOT_FOUND under Node.
    const offending = read(rel)
      .split("\n")
      .filter((l) => {
        const m = /^\s*(?:import|export)\b[^\n]*from\s+["'](\.[^"']*)["']/.exec(l);
        return m && !/\.(js|mjs|json|css)$/.test(m[1]);
      });
    expect(offending).toEqual([]);
  });

  it("imports nothing from src that reaches React or the DOM at module scope", () => {
    // A scheduled function has no window and no React. The guard is on the IMPORTS
    // rather than on the file's text, because pdfGenerator legitimately calls
    // window.open INSIDE generatePDF — which the cron never invokes.
    for (const rel of SHARED) {
      expect(read(rel)).not.toMatch(/^\s*import\s[^\n]*from\s+["'](react|react-dom)/m);
    }
  });
});

describe("there is exactly one implementation of each AccuLynx write", () => {
  const functionFiles = readdirSync(FUNCTIONS_DIR).filter(
    (n) => n.endsWith(".js") && !n.endsWith(".test.js"),
  );

  // The two calls that change a customer's AccuLynx account. A second copy of
  // either — a cron that posts expenses its own way, say — is how a retry stops
  // recognising its own earlier posting and books the material cost twice. There is
  // no error when that happens; there is just a customer billed twice.
  it.each([["/payments/expense"], ["/documents`"]])(
    "%s is only ever called from _shared/acculynxWrites.js",
    (fragment) => {
      const callers = functionFiles.filter((n) =>
        readFileSync(join(FUNCTIONS_DIR, n), "utf8").includes(fragment),
      );
      expect(callers).toEqual([]);
    },
  );

  it("and the de-duplication guard lives there too", () => {
    const writes = read("netlify/functions/_shared/acculynxWrites.js");
    expect(writes).toContain("additionalExpenses");
    expect(writes).toContain("findPriorExpense");
    // Both senders must derive the reference the guard matches on the same way.
    expect(writes).toContain("expenseRefFor");
  });
});
