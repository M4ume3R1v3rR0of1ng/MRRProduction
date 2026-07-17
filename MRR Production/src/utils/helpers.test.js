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

const { doFifo, newestPrice, recostLine } = await import("./helpers");

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

describe("doFifo — the consumed breakdown", () => {
  it("records which batch supplied which units, at which price", () => {
    const res = doFifo({ batches: [batch("2026-07-01", 10, 10), batch("2026-07-10", 10, 15)] }, 15);

    // The blended $11.67 is an average of these two lines and can't be traced back.
    expect(res.consumed).toEqual([
      { bid: "b_2026-07-01_10", rcvd: "2026-07-01", qty: 10, price: 10 },
      { bid: "b_2026-07-10_15", rcvd: "2026-07-10", qty: 5, price: 15 },
    ]);
  });

  it("reconciles: the split always sums to the reported cost and quantity", () => {
    // The invariant that makes `consumed` trustworthy as a costing record. If these
    // ever disagree, the breakdown is lying about a number someone is billed for.
    const cases = [
      [[batch("2026-07-01", 10, 10), batch("2026-07-10", 10, 15)], 15],
      [[batch("2026-07-01", 3, 7.5), batch("2026-07-05", 4, 2.25), batch("2026-07-09", 9, 11)], 12],
      [[batch("2026-07-01", 10, 10)], 25], // shortfall
    ];
    for (const [batches, qty] of cases) {
      const res = doFifo({ batches }, qty);
      const splitQty = res.consumed.reduce((s, c) => s + c.qty, 0);
      const splitCost = res.consumed.reduce((s, c) => s + c.qty * c.price, 0);
      expect(splitQty).toBe(qty);
      expect(splitCost).toBeCloseTo(res.cost, 10);
    }
  });

  it("flags shortfall units so a report can show they came from stock that wasn't there", () => {
    const res = doFifo({ batches: [batch("2026-07-01", 10, 10)] }, 15);
    const short = res.consumed.filter((c) => c.short);
    expect(short).toHaveLength(1);
    expect(short[0].qty).toBe(5);
    expect(short[0].price).toBe(10); // newest known price
    expect(res.consumed.reduce((s, c) => s + c.qty, 0)).toBe(15);
  });

  it("names a single batch when one covers the whole pull", () => {
    const res = doFifo({ batches: [batch("2026-07-01", 50, 84.2)] }, 3);
    expect(res.consumed).toHaveLength(1);
    expect(res.consumed[0]).toMatchObject({ qty: 3, price: 84.2 });
  });

  it("skips batches it didn't touch", () => {
    const res = doFifo({ batches: [{ ...batch("2026-07-01", 10, 10), rem: 0 }, batch("2026-07-10", 10, 15)] }, 5);
    expect(res.consumed).toHaveLength(1);
    expect(res.consumed[0].bid).toBe("b_2026-07-10_15"); // the depleted batch isn't listed
  });

  it("is empty when nothing is pulled", () => {
    expect(doFifo({ batches: [batch("2026-07-01", 10, 10)] }, 0).consumed).toEqual([]);
  });
});

describe("recostLine — repricing a job after a batch price correction", () => {
  // The real case: Atlas Rolled Ridge Vent was received unpriced, so 7 jobs recorded
  // it at $0. Correcting the batch to $84.20 has to reach back into those jobs.
  const ridgeVent = {
    pulled: 3, returned: 0, priceAtPull: 0, pullCost: 0,
    consumed: [{ bid: "b_ridge", rcvd: "2026-07-03", qty: 3, price: 0 }],
  };

  it("reprices a single-batch line", () => {
    const r = recostLine(ridgeVent, "b_ridge", 84.2);
    expect(r.pullCost).toBeCloseTo(252.6);
    expect(r.priceAtPull).toBeCloseTo(84.2);
    expect(r.consumed[0].price).toBe(84.2);
  });

  it("moves ONLY the corrected batch's units in a multi-batch pull", () => {
    // 10 from a $0 batch + 5 legitimately at $15. Correcting the $0 batch to $10 must
    // not touch the $15 units — the naive "whole line at the new price" would bill
    // 15 × $10 = $150 and quietly overwrite a price that was already right.
    const line = {
      pulled: 15, returned: 0, priceAtPull: 5, pullCost: 75,
      consumed: [
        { bid: "bad", rcvd: "2026-07-01", qty: 10, price: 0 },
        { bid: "good", rcvd: "2026-07-10", qty: 5, price: 15 },
      ],
    };
    const r = recostLine(line, "bad", 10);
    expect(r.pullCost).toBe(175); // 10 × $10 + 5 × $15
    expect(r.priceAtPull).toBeCloseTo(175 / 15);
    expect(r.consumed.find((c) => c.bid === "good").price).toBe(15); // untouched
  });

  it("leaves a line alone when the corrected batch isn't in its split", () => {
    const line = {
      pulled: 5, returned: 0, priceAtPull: 15, pullCost: 75,
      consumed: [{ bid: "other", rcvd: "2026-07-10", qty: 5, price: 15 }],
    };
    const r = recostLine(line, "not_mine", 99);
    expect(r.pullCost).toBe(75);
    expect(r.priceAtPull).toBe(15);
  });

  it("falls back to whole-line repricing when there's no split (legacy rows)", () => {
    // Rows written before doFifo recorded `consumed`. The caller must already have
    // established the line came from this batch alone (jobsUsingBatch does).
    const r = recostLine({ pulled: 3, priceAtPull: 0, pullCost: 0 }, "b_ridge", 84.2);
    expect(r.pullCost).toBeCloseTo(252.6);
    expect(r.priceAtPull).toBe(84.2);
    expect(r.consumed).toBeUndefined();
  });

  it("keeps the split summing to the new cost", () => {
    const line = {
      pulled: 12, returned: 0, priceAtPull: 3, pullCost: 36,
      consumed: [
        { bid: "a", rcvd: "2026-07-01", qty: 4, price: 2 },
        { bid: "b", rcvd: "2026-07-02", qty: 8, price: 3.5 },
      ],
    };
    const r = recostLine(line, "a", 7.25);
    const sum = r.consumed.reduce((s, c) => s + c.qty * c.price, 0);
    expect(sum).toBeCloseTo(r.pullCost, 10);
    expect(r.priceAtPull).toBeCloseTo(r.pullCost / 12, 10);
  });

  it("does not mutate the line it was given", () => {
    const line = { pulled: 3, consumed: [{ bid: "b_ridge", qty: 3, price: 0 }] };
    recostLine(line, "b_ridge", 84.2);
    expect(line.consumed[0].price).toBe(0);
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
