// The duplicate-expense guard must keep working when AccuLynx's GET /payments does
// not echo refNumber back on additional-expense lines — which the live API does not
// (verified 2026-11-12: lines carry id, to, amount, notes, accountTypeId only).
import { describe, it, expect, vi, afterEach } from "vitest";
import { findPriorExpense } from "../_shared/acculynxWrites.js";

const respond = (body) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => body })),
  );

afterEach(() => vi.unstubAllGlobals());

const ours = {
  to: "MRR Warehouse",
  amount: 623.44,
  notes: "Material Cost - 22562: Someone\n$582.65 + Indiana Sales Tax 7% = $623.44",
  accountTypeId: "x",
};

describe("findPriorExpense", () => {
  it("recognises our own earlier line when refNumber is not returned", async () => {
    respond({ additionalExpenses: { payments: [ours] } });
    expect(await findPriorExpense("k", "job", 623.44, "22562")).toBeTruthy();
  });

  it("still matches on refNumber when AccuLynx does return it", async () => {
    respond({
      additionalExpenses: { payments: [{ amount: 10, refNumber: "22562", notes: "hand typed" }] },
    });
    expect(await findPriorExpense("k", "job", 10, "22562")).toBeTruthy();
  });

  it("does not mistake someone else's same-amount expense for ours", async () => {
    respond({
      additionalExpenses: { payments: [{ ...ours, notes: "Dumpster fee", amount: 623.44 }] },
    });
    expect(await findPriorExpense("k", "job", 623.44, "22562")).toBeNull();
  });

  it("does not match a different amount", async () => {
    respond({ additionalExpenses: { payments: [ours] } });
    expect(await findPriorExpense("k", "job", 100, "22562")).toBeNull();
  });

  it("reads the list under either key the API has been documented with", async () => {
    respond({ additionalExpenses: { additionalExpenses: [ours] } });
    expect(await findPriorExpense("k", "job", 623.44, "22562")).toBeTruthy();
  });
});
