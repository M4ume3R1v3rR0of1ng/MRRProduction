// The hourly watch pass (supabase/69) and the "our earlier line at another amount"
// guard. Both exist for the same reason: AccuLynx must never get a second material
// line for one job, and must never be left silently wrong.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const flagOutOfDate = vi.fn(async () => ({ ok: true, at: "t", emailed: 2 }));
const clearOutOfDate = vi.fn(async () => ({ ok: true }));
const clearCheckDue = vi.fn(async () => {});
const mailPoMoved = vi.fn(async () => ({ emailed: 3, emailError: null }));
vi.mock("../_shared/acculynxOutOfDate.js", () => ({
  flagOutOfDate: (...a) => flagOutOfDate(...a),
  clearOutOfDate: (...a) => clearOutOfDate(...a),
  clearCheckDue: (...a) => clearCheckDue(...a),
  mailPoMoved: (...a) => mailPoMoved(...a),
}));

const resolveAccuLynxJobId = vi.fn();
vi.mock("../_shared/acculynxWrites.js", async (orig) => ({
  ...(await orig()),
  resolveAccuLynxJobId: (...a) => resolveAccuLynxJobId(...a),
}));

const { checkChangedJob, handlePoMove, poMovedResetFields } =
  await import("../acculynx-retry-sync.js");
const { findOurEarlierLine, postJobExpense } = await import("../_shared/acculynxWrites.js");

// A stand-in for the supabase query builder: every call chains, and awaiting it
// resolves to `result`. Records each update and its filters.
function fakeAdmin(result = { data: [{ id: "j1" }], error: null }) {
  const updates = [];
  const builder = (entry) => {
    const b = {
      eq: (col, val) => {
        entry.filters.push([col, val]);
        return b;
      },
      select: () => b,
      then: (res, rej) => Promise.resolve(result).then(res, rej),
    };
    return b;
  };
  return {
    updates,
    from: () => ({
      update: (fields) => {
        const entry = { fields, filters: [] };
        updates.push(entry);
        return builder(entry);
      },
    }),
  };
}

const ctx = { users: [], inv: [], company: { branding: { taxRate: 0 } } };
const line = (pulled, returned = 0) => [
  { iid: "osb", iname: "OSB", icat: "M", unit: "sheets", pulled, returned, priceAtPull: 10 },
];

beforeEach(() => {
  for (const m of [flagOutOfDate, clearOutOfDate, clearCheckDue, mailPoMoved, resolveAccuLynxJobId])
    m.mockClear();
});

describe("checkChangedJob", () => {
  it("flags a synced legacy job using the materials from before the change", async () => {
    const job = {
      id: "j1",
      company_id: "c1",
      syncStatus: "synced",
      items: line(4),
      acculynx_items_before: line(5),
      acculynx_check_seq: 7,
    };
    const r = await checkChangedJob(fakeAdmin(), { job, ctx, companyName: "MRR" });
    expect(r).toMatchObject({ action: "flag", posted: 50, correct: 40 });
    expect(flagOutOfDate.mock.calls[0][1].changes).toEqual([
      { iname: "OSB", unit: "sheets", field: "pulled", from: 5, to: 4 },
    ]);
    expect(clearCheckDue).toHaveBeenCalledWith(expect.anything(), {
      jobId: "j1",
      companyId: "c1",
      seq: 7,
    });
  });

  it("clears the flag when the change puts the cost back", async () => {
    const job = {
      id: "j1",
      company_id: "c1",
      syncStatus: "synced",
      items: line(5),
      acculynx_items_before: line(4),
      acculynx_posted_amount: 50,
      acculynx_correct_amount: 40,
      acculynx_check_seq: 2,
    };
    expect((await checkChangedJob(fakeAdmin(), { job, ctx, companyName: "MRR" })).action).toBe(
      "clear",
    );
    expect(clearOutOfDate).toHaveBeenCalled();
    expect(flagOutOfDate).not.toHaveBeenCalled();
  });

  it("keeps the mark when the flag could not be written, so the next run retries", async () => {
    flagOutOfDate.mockResolvedValueOnce({ ok: false, error: "db down" });
    const job = {
      id: "j1",
      company_id: "c1",
      syncStatus: "synced",
      items: line(4),
      acculynx_items_before: line(5),
      acculynx_check_seq: 1,
    };
    expect((await checkChangedJob(fakeAdmin(), { job, ctx, companyName: "MRR" })).action).toBe(
      "error",
    );
    expect(clearCheckDue).not.toHaveBeenCalled();
  });
});

describe("handlePoMove", () => {
  const job = { id: "j1", company_id: "c1", po: "22526", acculynx_po_moved_from: "22562" };

  it("does nothing but clear the mark when both POs are the same AccuLynx job", async () => {
    resolveAccuLynxJobId.mockResolvedValue({ ok: true, acculynxJobId: "ax1" });
    const admin = fakeAdmin();
    expect((await handlePoMove(admin, { job, apiKey: "k", companyName: "MRR" })).action).toBe(
      "same-job",
    );
    expect(admin.updates[0].fields).toEqual({ acculynx_po_moved_from: null });
    expect(mailPoMoved).not.toHaveBeenCalled();
  });

  it("resets the sync and emails when the PO now points at another AccuLynx job", async () => {
    resolveAccuLynxJobId
      .mockResolvedValueOnce({ ok: true, acculynxJobId: "ax-old" })
      .mockResolvedValueOnce({ ok: true, acculynxJobId: "ax-new" });
    const admin = fakeAdmin();
    const r = await handlePoMove(admin, { job, apiKey: "k", companyName: "MRR" });
    expect(r.action).toBe("moved");
    expect(admin.updates[0].fields).toEqual(poMovedResetFields("22562", "22526"));
    // Guarded on the PO it checked, so a further edit mid-run is not stomped.
    expect(admin.updates[0].filters).toContainEqual(["po", "22526"]);
    expect(mailPoMoved.mock.calls[0][1]).toMatchObject({ oldPo: "22562", newPoFound: true });
  });

  it("still moves, and says so, when the new PO matches nothing", async () => {
    resolveAccuLynxJobId
      .mockResolvedValueOnce({ ok: true, acculynxJobId: "ax-old" })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    const r = await handlePoMove(fakeAdmin(), { job, apiKey: "k", companyName: "MRR" });
    expect(r.action).toBe("moved");
    expect(mailPoMoved.mock.calls[0][1].newPoFound).toBe(false);
  });

  it("waits when AccuLynx cannot be reached", async () => {
    resolveAccuLynxJobId.mockRejectedValue(new Error("network"));
    const admin = fakeAdmin();
    expect((await handlePoMove(admin, { job, apiKey: "k", companyName: "MRR" })).action).toBe(
      "retry",
    );
    expect(admin.updates).toEqual([]);
  });

  it("does not email when the PO changed again during the check", async () => {
    resolveAccuLynxJobId
      .mockResolvedValueOnce({ ok: true, acculynxJobId: "ax-old" })
      .mockResolvedValueOnce({ ok: true, acculynxJobId: "ax-new" });
    const admin = fakeAdmin({ data: [], error: null });
    expect((await handlePoMove(admin, { job, apiKey: "k", companyName: "MRR" })).action).toBe(
      "retry",
    );
    expect(mailPoMoved).not.toHaveBeenCalled();
  });

  it("re-sends everything under the new PO", () => {
    const f = poMovedResetFields("1", "2");
    expect(f).toMatchObject({
      syncStatus: null,
      report_uploaded_at: null,
      acculynx_posted_amount: null,
      sync_attempts: 0,
    });
  });
});

describe("findOurEarlierLine", () => {
  const prior = [
    { amount: 623.44, notes: "Material Cost - Smith\n$582.65 + Sales Tax 7% = $623.44" },
    { amount: 400, notes: "Material Cost - Jones crew 2\n..." },
    { amount: 90, notes: "Dumpster" },
  ];
  it("finds this job's line by its header, whatever the amount", () => {
    expect(findOurEarlierLine(prior, "Material Cost - Smith\n$1 + tax = $2").amount).toBe(623.44);
  });
  it("does not take a sibling job on the same PO for it", () => {
    expect(findOurEarlierLine(prior, "Material Cost - Jones crew 1\n...")).toBeNull();
  });
  it("ignores descriptions that are not ours", () => {
    expect(findOurEarlierLine(prior, "Dumpster")).toBeNull();
  });
});

describe("postJobExpense with our line already there at another amount", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts nothing and reports a conflict", async () => {
    const fetchMock = vi.fn(async (url, opts) => {
      if (String(url).endsWith("/payments") && !opts?.method) {
        return {
          ok: true,
          json: async () => ({
            additionalExpenses: {
              payments: [{ amount: 623.44, notes: "Material Cost - Smith\nold" }],
            },
          }),
        };
      }
      throw new Error(`unexpected call ${opts?.method || "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await postJobExpense("k", {
      acculynxJobId: "ax1",
      poNumber: "22562",
      paymentDescription: "Material Cost - Smith\n$466.12 + tax = $498.75",
      totalMaterialCost: 498.75,
      lineItems: [],
    });
    expect(r).toMatchObject({ ok: false, status: 409, conflict: true, priorAmount: 623.44 });
    expect(r.error).toContain("$623.44");
    // Only the read happened: no POST.
    expect(fetchMock.mock.calls.every(([, o]) => !o?.method || o.method === "GET")).toBe(true);
  });
});
