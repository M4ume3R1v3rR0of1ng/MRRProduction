// The report that gets filed on the AccuLynx job has to be the same report the office
// prints. Both render from buildJobReportModel(), so these tests pin the model (the
// shared arithmetic) and the fact that the PDF path produces real, uploadable bytes.
import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {}, updateRowStrict: vi.fn(), getAccessToken: vi.fn() }));

const { buildJobReportModel } = await import("./pdfGenerator");
const { buildJobReportPdf, pdfFileNameFor } = await import("./jobReportPdf");

const inv = [{
  id: "i1",
  name: "Architectural Shingles",
  batches: [
    { id: "a", rcvd: "2026-07-01", qty: 10, price: 10, rem: 0 },
    { id: "b", rcvd: "2026-07-10", qty: 10, price: 15, rem: 5 },
  ],
}];

const jobWith = (line, extra = {}) => ({
  id: "j1", title: "Test Job", name: "Test Job", po: "PO-1", addr: "1 Main St",
  notes: "", assignedto: "u1", status: "completed",
  items: [{ iid: "i1", iname: "Architectural Shingles", icat: "Roofing", unit: "bundle", ...line }],
  ...extra,
});
const users = [{ id: "u1", full_name: "Crew", name: "Crew" }];

describe("buildJobReportModel", () => {
  it("prices from the pull-time FIFO snapshot, not today's price", () => {
    const m = buildJobReportModel(jobWith({ planned: 15, pulled: 15, returned: 0, priceAtPull: 175 / 15 }), users, inv);
    expect(m.grandTotal).toBeCloseTo(175, 2);
    expect(m.categories[0].subtotal).toBeCloseTo(175, 2);
  });

  it("bills only what was used", () => {
    const m = buildJobReportModel(jobWith({ planned: 15, pulled: 15, returned: 5, priceAtPull: 11.67 }), users, inv);
    expect(m.grandTotal).toBeCloseTo(116.7, 2);
  });

  it("carries the tenant's tax rate and label onto the totals", () => {
    const m = buildJobReportModel(
      jobWith({ planned: 1, pulled: 1, returned: 0, priceAtPull: 100 }),
      users, inv,
      { name: "Sunrise", branding: { taxRate: 0.0725, taxLabel: "Lucas County Tax" } }
    );
    expect(m.taxLabel).toBe("Lucas County Tax");
    expect(m.taxPct).toBe("7.25");
    expect(m.salesTax).toBeCloseTo(7.25, 2);
    expect(m.totalWithTax).toBeCloseTo(107.25, 2);
  });

  it("uses the tenant's display name, never a hardcoded company", () => {
    const m = buildJobReportModel(jobWith({ pulled: 1, priceAtPull: 1 }), users, inv, {
      name: "Legal LLC Name", branding: { displayName: "Cedar & Slate" },
    });
    expect(m.companyName).toBe("Cedar & Slate");
  });
});

describe("pdfFileNameFor", () => {
  it("strips the characters AccuLynx would drop, so the saved name is predictable", () => {
    expect(pdfFileNameFor({ po: "PO 2011850932-001" })).toBe("JobReportPO2011850932001.pdf");
  });

  it("still produces a name when the job has no PO", () => {
    expect(pdfFileNameFor({})).toBe("JobReportjob.pdf");
    expect(pdfFileNameFor({ po: "///" })).toBe("JobReportJob.pdf");
  });
});

describe("buildJobReportPdf", () => {
  it("produces real PDF bytes with a matching model", async () => {
    const { blob, base64, filename, model } = await buildJobReportPdf(
      jobWith({ planned: 15, pulled: 15, returned: 5, priceAtPull: 11.67 }),
      users, null, inv, { name: "Sunrise Roofing" }
    );

    expect(filename).toBe("JobReportPO1.pdf");
    expect(model.grandTotal).toBeCloseTo(116.7, 2);
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);

    // Base64 must be the bare payload — a leftover "data:...;base64," prefix would
    // decode to garbage on the server and upload a corrupt file.
    expect(base64).not.toMatch(/^data:/);
    const bytes = Buffer.from(base64, "base64");
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("survives a logo it cannot decode rather than losing the upload", async () => {
    const { blob } = await buildJobReportPdf(
      jobWith({ pulled: 1, priceAtPull: 10 }),
      users, "data:image/png;base64,not-actually-an-image", inv, null
    );
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("renders a job with no materials without throwing", async () => {
    const job = { id: "j2", title: "Empty", po: "PO-2", addr: "x", items: [] };
    const { model, blob } = await buildJobReportPdf(job, users, null, inv, null);
    expect(model.grandTotal).toBe(0);
    expect(blob.size).toBeGreaterThan(500);
  });
});
