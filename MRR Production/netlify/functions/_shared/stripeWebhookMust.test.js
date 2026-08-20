// Lives in _shared/ rather than next to the function it tests, and must stay
// here. Netlify treats every TOP-LEVEL file in netlify/functions/ as a function
// to deploy, and rejects any name that is not alphanumeric, hyphen or
// underscore. A ".test.js" file up there fails the whole production deploy with
// "Incorrect function names", which is not obviously about a test file at all.
// Paths beginning with _ are skipped, which is why expenseNotes.test.js has
// always been fine here. Learned by breaking the deploy on 2026-08-20.
import { describe, it, expect } from "vitest";
import { must } from "../stripe-webhook.js";

// must() is what turns a failed Supabase call into a thrown error, which the
// handler's catch turns into a 500, which makes Stripe retry.
//
// The alternative, and what this file did for months, is `const { data } = await
// ...` with the error dropped: the write fails, the handler still answers 200,
// Stripe never retries, and somebody has paid for access they did not get. That
// is how migrations 16 and 27 stayed missing from production without anyone
// noticing. See supabase/33_migration_ledger.sql.
describe("must", () => {
  it("returns the data when the call succeeded", () => {
    expect(must("read something", { data: { id: "abc" }, error: null })).toEqual({ id: "abc" });
  });

  it("throws when the call failed", () => {
    expect(() => must("apply company status", { data: null, error: { message: "boom" } })).toThrow();
  });

  it("names the operation in the message, so a log line says which call broke", () => {
    expect(() => must("apply company status", { data: null, error: { message: "boom" } })).toThrow(
      /apply company status/,
    );
  });

  it("keeps the database's own message, which is what identifies the cause", () => {
    // The real one that hid: a select naming a column that migration 27 never created.
    const pgError = { message: 'column companies.recurring_seat_packs does not exist' };
    expect(() => must("read company for status apply", { data: null, error: pgError })).toThrow(
      /recurring_seat_packs does not exist/,
    );
  });

  // maybeSingle() reports "no rows" as data null with no error. That is a real
  // answer, not a failure, and callers branch on it themselves.
  it("passes null data through when there is no error", () => {
    expect(must("look up company", { data: null, error: null })).toBeNull();
  });

  it("does not throw on a falsy-but-valid result", () => {
    expect(must("count something", { data: 0, error: null })).toBe(0);
  });
});
