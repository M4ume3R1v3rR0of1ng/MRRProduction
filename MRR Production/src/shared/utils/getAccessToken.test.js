// The Supabase access token expires after an hour. getSession() returns null once
// it has, whenever the background refresh has not run — a backgrounded tab, a
// resumed laptop, a blip during the automatic attempt. Returning null there made
// every Netlify function answer "Not authenticated" to somebody sitting in front of
// a working, logged-in app, which reads as a broken AccuLynx integration and sends
// people to re-enter an API key that was never the problem.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const refreshSession = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getSession, refreshSession } }),
}));

vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");

const { getAccessToken } = await import("./supabase");

beforeEach(() => {
  getSession.mockReset();
  refreshSession.mockReset();
});

describe("getAccessToken", () => {
  it("uses the live session without refreshing", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "live" } } });

    expect(await getAccessToken()).toBe("live");
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes when the stored token has already expired", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    refreshSession.mockResolvedValue({ data: { session: { access_token: "renewed" } }, error: null });

    expect(await getAccessToken()).toBe("renewed");
    expect(refreshSession).toHaveBeenCalledOnce();
  });

  it("returns null only when the refresh token is genuinely dead", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    refreshSession.mockResolvedValue({ data: null, error: new Error("invalid refresh token") });

    // This is the one case that really does mean "sign in again".
    expect(await getAccessToken()).toBeNull();
  });

  it("survives getSession returning an empty payload", async () => {
    getSession.mockResolvedValue({});
    refreshSession.mockResolvedValue({ data: { session: { access_token: "renewed" } }, error: null });

    expect(await getAccessToken()).toBe("renewed");
  });
});
