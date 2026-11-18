import { describe, it, expect } from "vitest";
import { resolveFunctionsUrl, FUNCTIONS_ORIGIN } from "./functionsOrigin";

describe("resolveFunctionsUrl", () => {
  it("sends a relative function call to the production origin in the iOS app", () => {
    expect(resolveFunctionsUrl("/.netlify/functions/chat", true)).toBe(
      `${FUNCTIONS_ORIGIN}/.netlify/functions/chat`,
    );
  });

  it("leaves the same call relative on the web", () => {
    expect(resolveFunctionsUrl("/.netlify/functions/chat", false)).toBe("/.netlify/functions/chat");
  });

  it("leaves absolute URLs alone, so Supabase is never rewritten", () => {
    const supabaseUrl = "https://abc.supabase.co/rest/v1/jobs";
    expect(resolveFunctionsUrl(supabaseUrl, true)).toBe(supabaseUrl);
  });

  it("leaves other relative paths and non-string inputs alone", () => {
    expect(resolveFunctionsUrl("/assets/logo.png", true)).toBe("/assets/logo.png");
    const url = new URL("https://example.com/x");
    expect(resolveFunctionsUrl(url, true)).toBe(url);
  });
});
