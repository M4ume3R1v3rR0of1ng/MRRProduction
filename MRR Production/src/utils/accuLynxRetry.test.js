// Creating an AccuLynx expense is not idempotent. The old fetchWithRetry retried
// EVERYTHING up to three times, including that write, and retried a non-ok response
// with no delay — so a single 502 from a request that had already created the
// expense booked the material cost onto the job three times.
//
// These pin the rule: the cost sync fires exactly one HTTP request, whatever
// happens. Lookups may still retry, because a read has no consequences.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getAccessToken = vi.fn(async () => "tok");
const updateRowStrict = vi.fn(async () => ({ error: null }));
vi.mock("./supabase", () => ({
  supabase: {},
  getAccessToken: (...a) => getAccessToken(...a),
  updateRowStrict: (...a) => updateRowStrict(...a),
}));

const { attemptAccuLynxSync, fetchAccuLynxJob } = await import("./accuLynxSync");

const config = { enabled: true, proxyUrl: "https://example.test/sync", apiKey: "k" };
const job = {
  id: "j1", po: "22450", name: "Test", acculynx_job_id: "ax-1",
  items: [{ iid: "i1", iname: "OSB", icat: "Materials", unit: "each", pulled: 1, returned: 0, priceAtPull: 15.5 }],
};

beforeEach(() => {
  vi.restoreAllMocks();
  updateRowStrict.mockClear().mockResolvedValue({ error: null });
  getAccessToken.mockClear().mockResolvedValue("tok");
});

describe("cost sync is sent exactly once", () => {
  it("does not retry when the server returns an error", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await attemptAccuLynxSync(job, [], config, null);

    // One request. A retry here could book a second expense for the same job.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the request throws", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("Failed to fetch"); });
    vi.stubGlobal("fetch", fetchMock);

    await attemptAccuLynxSync(job, [], config, null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records a timeout as an unknown outcome, not a clean failure", async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    vi.stubGlobal("fetch", fetchMock);

    await attemptAccuLynxSync(job, [], config, null);

    const [, , fields] = updateRowStrict.mock.calls[0];
    expect(fields.syncStatus).toBe("failed");
    // The person about to press Retry has to know the cost may already be posted.
    expect(fields.syncNote).toMatch(/may or may not have posted/i);
  });

  it("persists a success so the badge survives a reload", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, message: "done" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await attemptAccuLynxSync(job, [], config, null);

    const [table, id, fields] = updateRowStrict.mock.calls[0];
    expect(table).toBe("jobs");
    expect(id).toBe("j1");
    expect(fields.syncStatus).toBe("synced");
    expect(fields.syncedAt).toBeTruthy();
  });
});

describe("lookups may still retry", () => {
  it("retries a failing job lookup, because a read costs nothing", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls < 3) return new Response("nope", { status: 500 });
      return new Response(JSON.stringify({ ok: true, job: { id: "ax-1" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAccuLynxJob({ poNumber: "22450" }, config);
    expect(result).toEqual({ id: "ax-1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15000);
});
