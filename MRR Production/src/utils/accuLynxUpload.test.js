// Sync Upload sends two things to AccuLynx for one job: the completion report PDF
// as a document, and the material cost as an Additional Job Expense.
//
// The cost is TAX-INCLUSIVE and comes from the same buildJobReportModel call the PDF
// renders from. Before this it posted the pre-tax subtotal, so the expense and the
// report attached to the same job disagreed by the tax on every single job.
//
// The other rule: the two halves never gate each other, and neither is retried,
// because both are creates. A retried expense bills twice; a retried upload files a
// second copy, and AccuLynx has no replace-document call.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getAccessToken = vi.fn(async () => "tok");
const updateRowStrict = vi.fn(async () => ({ error: null }));
vi.mock("./supabase", () => ({
  supabase: {},
  getAccessToken: (...a) => getAccessToken(...a),
  updateRowStrict: (...a) => updateRowStrict(...a),
}));

// jsPDF is heavy and irrelevant here — the upload path only needs bytes and a name.
vi.mock("./jobReportPdf", () => ({
  buildJobReportPdf: vi.fn(async () => ({ base64: "JVBERi0=", filename: "JobReportPO1.pdf" })),
}));

const { syncJobReportToAccuLynx } = await import("./accuLynxSync");

const inv = [{ id: "i1", name: "OSB", batches: [{ id: "a", rcvd: "2026-07-01", qty: 10, price: 100, rem: 10 }] }];
// One unit at $100 keeps the tax arithmetic exact: 7% -> $7.00 -> $107.00 total.
const jobWithMaterials = {
  id: "j1", po: "22450", name: "Test", acculynx_job_id: "ax-1",
  items: [{ iid: "i1", iname: "OSB", icat: "Materials", unit: "each", planned: 1, pulled: 1, returned: 0, priceAtPull: 100 }],
};
const emptyJob = { id: "j2", po: "22451", name: "Empty", acculynx_job_id: "ax-2", items: [] };
const config = { enabled: true, proxyUrl: "https://example.test/sync", apiKey: "k" };
const okJson = (body) => new Response(JSON.stringify(body), { status: 200 });

const bodiesOf = (m) => m.mock.calls.map((c) => JSON.parse(c[1].body));

beforeEach(() => {
  vi.restoreAllMocks();
  updateRowStrict.mockClear().mockResolvedValue({ error: null });
  getAccessToken.mockClear().mockResolvedValue("tok");
});

describe("what Sync Upload sends", () => {
  it("sends the document AND the cost expense", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true, message: "done" }));
    vi.stubGlobal("fetch", fetchMock);

    await syncJobReportToAccuLynx({ job: jobWithMaterials, config, inv });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = bodiesOf(fetchMock);
    expect(bodies[0].action).toBe("uploadDocument");
    // The expense uses the default action, so it carries no `action` field.
    expect(bodies[1].action).toBeUndefined();
    expect(bodies[1].totalMaterialCost).toBeDefined();
  });

  it("posts the TAX-INCLUSIVE total, not the subtotal", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await syncJobReportToAccuLynx({ job: jobWithMaterials, config, inv, company: { name: "X" } });

    const expense = bodiesOf(fetchMock)[1];
    // $100 materials + 7% default tax = $107.00. The old code posted $100.
    expect(expense.totalMaterialCost).toBeCloseTo(107, 2);
    expect(expense.totalMaterialCost).not.toBeCloseTo(100, 2);
  });

  it("uses the tenant's own tax rate", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await syncJobReportToAccuLynx({
      job: jobWithMaterials, config, inv,
      company: { name: "Sunrise", branding: { taxRate: 0.0725, taxLabel: "Lucas County Tax" } },
    });

    const expense = bodiesOf(fetchMock)[1];
    expect(expense.totalMaterialCost).toBeCloseTo(107.25, 2);
    // The description spells the tax out so the figure is auditable from AccuLynx alone.
    expect(expense.paymentDescription).toContain("Lucas County Tax");
    expect(expense.paymentDescription).toContain("$107.25");
  });

  it("sends the line items behind the total", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await syncJobReportToAccuLynx({ job: jobWithMaterials, config, inv });

    const expense = bodiesOf(fetchMock)[1];
    expect(expense.lineItems).toHaveLength(1);
    expect(expense.lineItems[0]).toMatchObject({ name: "OSB", quantity: 1, unitPrice: 100, totalCost: 100 });
  });

  it("skips the expense when the job consumed nothing, but still files the report", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await syncJobReportToAccuLynx({ job: emptyJob, config, inv });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodiesOf(fetchMock)[0].action).toBe("uploadDocument");
    expect(r.cost.skipped).toBe(true);
    expect(r.ok).toBe(true);
  });
});

describe("the halves do not gate each other", () => {
  it("still posts the cost when the upload fails", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      if (n === 1) return new Response(JSON.stringify({ error: "doc refused" }), { status: 502 });
      return okJson({ ok: true, message: "cost ok" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await syncJobReportToAccuLynx({ job: jobWithMaterials, config, inv });

    expect(r.cost.ok).toBe(true);
    expect(r.report.ok).toBe(false);
    const fields = updateRowStrict.mock.calls[0][2];
    expect(fields.syncStatus).toBe("failed");
    // A failed upload must NOT claim the report is filed, or the next sync would
    // skip it and the paperwork would never reach AccuLynx.
    expect(fields.report_uploaded_at).toBeUndefined();
    expect(fields.syncNote).toMatch(/Report failed/);
  });

  it("still files the report when the cost is refused", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      if (n === 1) return okJson({ ok: true, message: "filed" });
      return new Response(JSON.stringify({ error: "expense refused" }), { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await syncJobReportToAccuLynx({ job: jobWithMaterials, config, inv });

    expect(r.report.ok).toBe(true);
    expect(r.cost.ok).toBe(false);
    const fields = updateRowStrict.mock.calls[0][2];
    expect(fields.report_uploaded_at).toBeTruthy();
    expect(fields.report_file_name).toBe("JobReportPO1.pdf");
    expect(fields.syncNote).toMatch(/Cost failed/);
  });

  it("records both successes so the badge survives a reload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ ok: true, message: "ok" })));
    const setJobs = vi.fn();

    await syncJobReportToAccuLynx({ job: jobWithMaterials, config, inv, setJobs });

    const [table, id, fields] = updateRowStrict.mock.calls[0];
    expect(table).toBe("jobs");
    expect(id).toBe("j1");
    expect(fields.syncStatus).toBe("synced");
    expect(fields.report_uploaded_at).toBeTruthy();

    const applied = setJobs.mock.calls.at(-1)[0]([{ id: "j1" }, { id: "j9" }]);
    expect(applied[0].report_uploaded_at).toBeTruthy();
    expect(applied[1].report_uploaded_at).toBeUndefined();
  });
});

describe("neither half is ever retried", () => {
  it("makes exactly one attempt per endpoint on failure", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await syncJobReportToAccuLynx({ job: jobWithMaterials, config, inv });

    // One upload + one expense. Any more and a single blip bills the job twice.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names the session, not AccuLynx, when the token has gone", async () => {
    getAccessToken.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await syncJobReportToAccuLynx({ job: jobWithMaterials, config, inv });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.error).toMatch(/session expired/i);
  });

  it("marks an unconfigured company as manual without calling out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await syncJobReportToAccuLynx({ job: jobWithMaterials, config: { enabled: false }, inv });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateRowStrict.mock.calls[0][2].syncStatus).toBe("manual");
    expect(r.skipped).toBe(true);
  });
});
