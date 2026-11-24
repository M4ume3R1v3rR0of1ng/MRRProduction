import { describe, it, expect, vi, beforeEach } from "vitest";

const getAccessToken = vi.fn(async () => "tok");
const updateRowStrict = vi.fn(async () => ({ error: null }));
vi.mock("@/shared/utils/supabase", () => ({
  supabase: {},
  getAccessToken: (...a) => getAccessToken(...a),
  updateRowStrict: (...a) => updateRowStrict(...a),
}));

const { correctionChanges, mayHavePostedCost, reportAccuLynxCorrection, markAccuLynxUpdated } =
  await import("./accuLynxCorrection");

const line = (over = {}) => ({
  iid: "osb",
  iname: "OSB",
  icat: "Materials",
  unit: "sheets",
  pulled: 5,
  returned: 3,
  priceAtPull: 100,
  ...over,
});
const job = (items, extra = {}) => ({ id: "j1", po: "22562", items, ...extra });

beforeEach(() => {
  vi.restoreAllMocks();
  updateRowStrict.mockClear().mockResolvedValue({ error: null });
});

describe("correctionChanges", () => {
  it("lists each count that changed", () => {
    expect(correctionChanges(job([line()]), job([line({ pulled: 4, returned: 2 })]))).toEqual([
      { iname: "OSB", unit: "sheets", field: "pulled", from: 5, to: 4 },
      { iname: "OSB", unit: "sheets", field: "returned", from: 3, to: 2 },
    ]);
  });

  it("counts a removed line as going to zero", () => {
    expect(correctionChanges(job([line()]), job([]))).toEqual([
      { iname: "OSB", unit: "sheets", field: "pulled", from: 5, to: 0 },
      { iname: "OSB", unit: "sheets", field: "returned", from: 3, to: 0 },
    ]);
  });

  it("is empty when nothing changed", () => {
    expect(correctionChanges(job([line()]), job([line()]))).toEqual([]);
  });
});

describe("mayHavePostedCost", () => {
  it("is true for a synced job or one with a stored posted figure", () => {
    expect(mayHavePostedCost({ syncStatus: "synced" })).toBe(true);
    expect(mayHavePostedCost({ syncStatus: "failed", acculynx_posted_amount: 10 })).toBe(true);
    expect(mayHavePostedCost({ syncStatus: "failed" })).toBe(false);
    expect(mayHavePostedCost({})).toBe(false);
  });
});

describe("reportAccuLynxCorrection", () => {
  it("does not call the server for a job whose cost never reached AccuLynx", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await reportAccuLynxCorrection({
      before: job([line()]),
      after: job([line({ pulled: 4 })]),
    });
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the before-cost and the changes, and applies the flag it gets back", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            outOfDate: true,
            posted: 214,
            correct: 107,
            at: "t",
            emailed: 2,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    let jobs = [job([line()], { syncStatus: "synced" })];
    const setJobs = (fn) => (jobs = fn(jobs));

    const r = await reportAccuLynxCorrection({
      before: job([line()], { syncStatus: "synced" }),
      after: job([line({ pulled: 4 })], { syncStatus: "synced" }),
      company: { branding: { taxRate: 0.07 } },
      setJobs,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // 2 used at $100 + 7% = $214.00, from the job as it stood before.
    expect(body.beforeAmount).toBe(214);
    expect(body.changes).toEqual([
      { iname: "OSB", unit: "sheets", field: "pulled", from: 5, to: 4 },
    ]);
    expect(r.emailed).toBe(2);
    expect(jobs[0].acculynx_correct_amount).toBe(107);
    expect(jobs[0].acculynx_posted_amount).toBe(214);
  });

  it("reports a failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const r = await reportAccuLynxCorrection({
      before: job([line()], { syncStatus: "synced" }),
      after: job([line({ pulled: 4 })]),
    });
    expect(r.error).toBe("HTTP 500");
  });
});

describe("markAccuLynxUpdated", () => {
  it("makes the corrected figure the posted one and clears the flag", async () => {
    const r = await markAccuLynxUpdated({
      id: "j1",
      acculynx_posted_amount: 214,
      acculynx_correct_amount: 107,
    });
    expect(r.ok).toBe(true);
    expect(updateRowStrict).toHaveBeenCalledWith("jobs", "j1", {
      acculynx_posted_amount: 107,
      acculynx_correct_amount: null,
      acculynx_out_of_date_at: null,
    });
  });
});
