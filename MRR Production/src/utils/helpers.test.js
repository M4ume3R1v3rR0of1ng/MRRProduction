// FIFO is where job costing is decided, so these are money tests, not unit-test hygiene.
// Every case below is something that actually went wrong on 2026-07-16 — see the batch
// history of "Atlas Rolled Ridge Vent" for the live version of `charges $0`.
import { describe, it, expect, vi } from "vitest";

// helpers.js imports the Supabase client at module scope, which builds a real client
// from import.meta.env. These functions never touch it — stub it so the suite stays
// hermetic and doesn't need a .env to run (CI won't have one).
vi.mock("./supabase", () => ({
  supabase: {},
  updateRowStrict: vi.fn(),
  getAccessToken: vi.fn(),
}));

const { doFifo, newestPrice } = await import("./helpers");

const batch = (rcvd, qty, price, rem = qty) => ({ id: `b_${rcvd}_${price}`, rcvd, qty, price, rem });

describe("doFifo — consumption order and cost", () => {
  it("drains the oldest batch first and blends the cost across batches", () => {
    // 10 @ $10 received Jul 1, then 10 @ $15 on Jul 10. Pull 15.
    const res = doFifo({ batches: [batch("2026-07-01", 10, 10), batch("2026-07-10", 10, 15)] }, 15);

    // 10 × $10 + 5 × $15. Getting this wrong misprices every job report.
    expect(res.cost).toBe(175);
    expect(res.shortfall).toBe(0);
    expect(res.batches.find((b) => b.price === 10).rem).toBe(0); // older one emptied first
    expect(res.batches.find((b) => b.price === 15).rem).toBe(5);
  });

  it("orders by received date, not by position in the array", () => {
    // Same stock, newest listed first. Sorting on array order would bill $200.
    const res = doFifo({ batches: [batch("2026-07-10", 10, 15), batch("2026-07-01", 10, 10)] }, 15);
    expect(res.cost).toBe(175);
  });

  it("skips depleted batches rather than counting them", () => {
    const res = doFifo({ batches: [{ ...batch("2026-07-01", 10, 10), rem: 0 }, batch("2026-07-10", 10, 15)] }, 5);
    expect(res.cost).toBe(75); // all from the $15 batch
  });

  it("charges the newest price for a shortfall and records it as a negative batch", () => {
    const res = doFifo({ batches: [batch("2026-07-01", 10, 10), batch("2026-07-10", 10, 15)] }, 25);
    expect(res.shortfall).toBe(5);
    expect(res.cost).toBe(100 + 150 + 5 * 15); // the 5 you don't have, at the newest price
    const short = res.batches.find((b) => b.short);
    expect(short.rem).toBe(-5);
    expect(short.price).toBe(15);
  });

  it("leaves a negative batch to be offset by later stock, not re-consumed", () => {
    // A shortfall row has rem < 0; a later pull must not treat it as available stock.
    const res = doFifo({ batches: [{ id: "neg", rcvd: "2026-07-01", qty: -10, price: 15, rem: -10, short: true }, batch("2026-07-10", 20, 15)] }, 5);
    expect(res.batches.find((b) => b.id === "neg").rem).toBe(-10); // untouched
    expect(res.batches.find((b) => b.qty === 20).rem).toBe(15);
    expect(res.cost).toBe(75);
  });

  it("charges $0 for an unpriced batch — the bug that billed 24 rolls free", () => {
    // Documents real, dangerous behaviour rather than asserting it's correct: FIFO
    // faithfully bills what the batch says. A $0 batch bills nothing, and the job
    // report prints $0 for real material. The defence is refusing $0 AT RECEIVE
    // (InventoryView.confirmBulk), not patching it here.
    const res = doFifo({ batches: [batch("2026-07-01", 10, 10), batch("2026-07-10", 10, 0)] }, 15);
    expect(res.cost).toBe(100); // 5 units billed at nothing
  });

  it("does not mutate the batches it was handed", () => {
    const batches = [batch("2026-07-01", 10, 10)];
    doFifo({ batches }, 5);
    expect(batches[0].rem).toBe(10);
  });
});

describe("newestPrice", () => {
  it("returns the most recently received batch's price", () => {
    expect(newestPrice({ batches: [batch("2026-07-01", 10, 10), batch("2026-07-10", 1, 84.2)] })).toBe(84.2);
  });

  it("returns 0 when there is no price history", () => {
    expect(newestPrice({ batches: [] })).toBe(0);
    expect(newestPrice(null)).toBe(0);
    expect(newestPrice({})).toBe(0);
  });
});
