// A.N.V.I.L. said "Not authenticated" to people sitting in a logged-in app. The widget read
// the token with a bare supabase.auth.getSession(), which hands back a stale or missing token
// once the hour is up (backgrounded tab, resumed laptop) because the background refresh has
// not run. getAccessToken() in utils/supabase.js forces that refresh and is what every other
// caller of a Netlify function uses.
//
// The widget is not rendered in tests, so this reads its source, the same approach
// anvilCapabilities.test.js takes with chat.js.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./ChatWidget.jsx", import.meta.url), "utf8");

describe("ChatWidget auth", () => {
  it("gets its token from getAccessToken, which refreshes an expired session", () => {
    expect(source).toMatch(/getAccessToken/);
  });

  it("never reads the token straight off getSession()", () => {
    expect(source).not.toMatch(/auth\.getSession\(\)/);
  });

  it("tells the person their session expired instead of showing a bare 'Not authenticated'", () => {
    expect(source).toMatch(/session expired/i);
  });
});
