// Guards the rule Kindja set on 2026-07-16: the job report follows the price of the
// inventory it actually consumed, and is never hand-editable. Before this, the PDF
// re-priced finished jobs at TODAY's rate — so a 15-unit job that cost $175 printed
// $225, and Reports and the PDF disagreed about the same job.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({ supabase: {}, updateRowStrict: vi.fn(), getAccessToken: vi.fn() }));

const { generatePDF } = await import("./pdfGenerator");

// generatePDF writes into a popup. Capture the HTML instead of opening one.
let html = "";
beforeEach(() => {
  html = "";
  globalThis.window = {
    open: () => ({
      document: { write: (h) => { html += h; }, close: () => {}, getElementById: () => null },
      focus: () => {},
      print: () => {},
    }),
  };
});

// Older batch drained, newest batch priced $15 → newestPrice() is $15.
const inv = [{
  id: "i1",
  name: "Architectural Shingles",
  batches: [
    { id: "a", rcvd: "2026-07-01", qty: 10, price: 10, rem: 0 },
    { id: "b", rcvd: "2026-07-10", qty: 10, price: 15, rem: 5 },
  ],
}];

const jobWith = (line) => ({
  id: "j1", title: "Test Job", name: "Test Job", po: "PO-1", addr: "1 Main St",
  notes: "", assignedto: "u1", status: "completed",
  items: [{ iid: "i1", iname: "Architectural Shingles", icat: "Roofing", unit: "bundle", ...line }],
});
const users = [{ id: "u1", full_name: "Crew", name: "Crew" }];

describe("generatePDF — material pricing", () => {
  it("prices from the pull-time FIFO snapshot, not today's price", () => {
    // 15 pulled, FIFO cost $175 → $11.67/ea. Today's price is $15 (would give $225).
    generatePDF(jobWith({ planned: 15, pulled: 15, returned: 0, priceAtPull: 175 / 15, pullCost: 175 }), users, null, inv);
    expect(html).toMatch(/175\.00/);
    expect(html).not.toMatch(/225\.00/);
    expect(html).toMatch(/11\.67/);
  });

  it("bills only what was used, so a returned item costs nothing", () => {
    generatePDF(jobWith({ planned: 15, pulled: 15, returned: 15, priceAtPull: 11.67, pullCost: 175 }), users, null, inv);
    expect(html).not.toMatch(/175\.00/);
  });

  it("subtracts returns from the pulled quantity", () => {
    // 15 pulled, 5 back → 10 used × $11.67 = $116.70.
    generatePDF(jobWith({ planned: 15, pulled: 15, returned: 5, priceAtPull: 11.67, pullCost: 175 }), users, null, inv);
    expect(html).toMatch(/116\.70/);
  });

  it("falls back to the current price only when no snapshot was ever recorded", () => {
    // Legacy/imported rows predate priceAtPull. They're the ONLY case where the live
    // price is allowed to decide, since there's nothing else to go on.
    generatePDF(jobWith({ planned: 10, pulled: 10, returned: 0 }), users, null, inv);
    expect(html).toMatch(/150\.00/); // 10 × today's $15
  });

  it("escapes job text so a crafted name can't inject markup", () => {
    const job = jobWith({ planned: 1, pulled: 1, returned: 0, priceAtPull: 10, pullCost: 10 });
    job.title = '<script>alert(1)</script>';
    generatePDF(job, users, null, inv);
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toMatch(/&lt;script&gt;/);
  });
});
