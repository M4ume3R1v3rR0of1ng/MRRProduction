// src/views/inventory/inventoryModals.test.js
//
// The five dialogs pulled out of InventoryView in this pass. None of the logic
// below was reachable from a test before: it lived inside handlers that only ran
// behind `modal === "..."`, internal state nothing outside the view could set.
//
// The batch arithmetic is the part that matters. It decides which units leave
// the shelf and at what price, which is what a job is ultimately billed.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { NotificationProvider } from "../../context/NotificationContext";
import { tot, newestPrice, fd } from "../../utils/helpers";

import ItemDetailModal, { batchesOldestFirst } from "./ItemDetailModal.jsx";
import ItemFormModal, { isPriceChange, applyPriceToBatches, CATEGORIES, UNITS } from "./ItemFormModal.jsx";
import ReceiveBatchModal, { missingReceiveFields } from "./ReceiveBatchModal.jsx";
import AdjustStockModal, { applyStockCorrection } from "./AdjustStockModal.jsx";
import BatchCorrectionModal, { lineFor, usedOf, hasSplit, jobsUsingBatch } from "./BatchCorrectionModal.jsx";

const item = {
  id: "i1", name: "Shingle", cat: "Roofing Materials", unit: "bd", alrt: 40,
  batches: [
    { id: "b2", rcvd: "2026-06-10", qty: 60, rem: 42, price: 34, by: "u1" },
    { id: "b1", rcvd: "2026-05-01", qty: 120, rem: 100, price: 32.5, by: "u1", vendor: "ABC Supply", ref: "PO-1001" },
  ],
};
const user = { id: "u1", name: "Sam Schwartz", email: "sam@example.com" };
const users = [user];
const fetchLiveBatches = async () => item.batches;

const render = (Comp, props) =>
  renderToString(h(NotificationProvider, null, h(Comp, { user, users, perms: {}, fetchLiveBatches, onClose: () => {}, ...props })));

describe("batchesOldestFirst", () => {
  it("sorts by received date regardless of array order", () => {
    expect(batchesOldestFirst(item).map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("does not mutate the item's batch array", () => {
    const before = item.batches.map((b) => b.id);
    batchesOldestFirst(item);
    expect(item.batches.map((b) => b.id)).toEqual(before);
  });

  it("copes with no batches and no item", () => {
    expect(batchesOldestFirst({ batches: [] })).toEqual([]);
    expect(batchesOldestFirst({})).toEqual([]);
    expect(batchesOldestFirst()).toEqual([]);
  });
});

describe("isPriceChange", () => {
  it("is false without pricing rights, whatever was typed", () => {
    expect(isPriceChange("99", 34, false)).toBe(false);
  });

  it("is false when the field was left blank", () => {
    expect(isPriceChange("", 34, true)).toBe(false);
    expect(isPriceChange(null, 34, true)).toBe(false);
  });

  it("is false when the typed value matches what is already recorded", () => {
    expect(isPriceChange("34", 34, true)).toBe(false);
  });

  it("is false for junk that does not parse", () => {
    expect(isPriceChange("abc", 34, true)).toBe(false);
  });

  it("is true only for a real, different, numeric price", () => {
    expect(isPriceChange("40", 34, true)).toBe(true);
    // Zero is a legitimate price (warranty stock), so it must count as a change.
    expect(isPriceChange("0", 34, true)).toBe(true);
  });
});

describe("applyPriceToBatches", () => {
  it("rewrites the newest batch by date, not the last in the array", () => {
    const out = applyPriceToBatches(item.batches, 99, "u1");
    expect(out.find((b) => b.id === "b2").price).toBe(99);
    expect(out.find((b) => b.id === "b1").price).toBe(32.5);
  });

  it("seeds a zero-quantity batch when there is no receipt history to price", () => {
    const out = applyPriceToBatches([], 45, "u1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ price: 45, qty: 0, rem: 0, by: "u1" });
    // Zero quantity matters: it must carry a price without inventing stock.
    expect(tot({ batches: out })).toBe(0);
  });

  it("does not mutate the batches it was given", () => {
    const original = JSON.parse(JSON.stringify(item.batches));
    applyPriceToBatches(item.batches, 99, "u1");
    expect(item.batches).toEqual(original);
  });
});

describe("missingReceiveFields", () => {
  it("names every blank field at once rather than one at a time", () => {
    expect(missingReceiveFields({})).toEqual(["quantity", "price", "received date"]);
  });

  it("is empty when the form is complete", () => {
    expect(missingReceiveFields({ qty: "5", price: "10", date: "2026-07-01" })).toEqual([]);
  });

  it("reports only what is actually missing", () => {
    expect(missingReceiveFields({ qty: "5", date: "2026-07-01" })).toEqual(["price"]);
  });
});

describe("applyStockCorrection", () => {
  const batches = [
    { id: "b1", rcvd: "2026-05-01", qty: 100, rem: 100, price: 10 },
    { id: "b2", rcvd: "2026-06-01", qty: 50, rem: 50, price: 20 },
  ]; // 150 on hand

  it("adds a single correction batch when counting up", () => {
    const out = applyStockCorrection(batches, 170, { byUserId: "u1" });
    expect(out).toHaveLength(3);
    expect(tot({ batches: out })).toBe(170);
    expect(out[2]).toMatchObject({ qty: 20, rem: 20 });
  });

  it("prices found stock at the newest known price, not zero", () => {
    // Valuing it at zero would let real material bill a job nothing.
    const out = applyStockCorrection(batches, 170, { byUserId: "u1" });
    expect(out[2].price).toBe(newestPrice({ batches }));
    expect(out[2].price).toBe(20);
  });

  it("falls back to the supplied price when no batch has one", () => {
    const out = applyStockCorrection([], 10, { fallbackPrice: 7 });
    expect(out[0].price).toBe(7);
  });

  it("records the reason on the correction batch", () => {
    const out = applyStockCorrection(batches, 160, { reasonSuffix: " — physical count" });
    expect(out[2].ref).toBe("Manual Adjustment — physical count");
  });

  it("drains oldest first when counting down", () => {
    // Draining newest first would strand the oldest, cheapest units on the shelf
    // forever and quietly inflate the cost of every later job.
    const out = applyStockCorrection(batches, 100, {});
    expect(out.find((b) => b.id === "b1").rem).toBe(50);
    expect(out.find((b) => b.id === "b2").rem).toBe(50);
    expect(tot({ batches: out })).toBe(100);
  });

  it("drains across several batches when the shortfall exceeds the oldest", () => {
    const out = applyStockCorrection(batches, 30, {});
    expect(out.find((b) => b.id === "b1").rem).toBe(0);
    expect(out.find((b) => b.id === "b2").rem).toBe(30);
    expect(tot({ batches: out })).toBe(30);
  });

  it("empties every batch when corrected to zero", () => {
    const out = applyStockCorrection(batches, 0, {});
    expect(tot({ batches: out })).toBe(0);
  });

  it("returns the batches in oldest-first order after a drain", () => {
    const out = applyStockCorrection(batches, 100, {});
    expect(out.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("handles an empty batch list on the way up", () => {
    expect(tot({ batches: applyStockCorrection([], 25, {}) })).toBe(25);
  });
});

describe("job line helpers", () => {
  const job = { id: "j1", items: [{ iid: "i1", pulled: 10, returned: 3, priceAtPull: 32.5 }] };

  it("reads the line from items or from legacy materials", () => {
    expect(lineFor(job, "i1").pulled).toBe(10);
    expect(lineFor({ materials: job.items }, "i1").pulled).toBe(10);
    expect(lineFor(job, "nope")).toBeUndefined();
  });

  it("nets returns off the pulled quantity", () => {
    expect(usedOf(job, "i1")).toBe(7);
  });

  it("never reports negative usage", () => {
    expect(usedOf({ items: [{ iid: "i1", pulled: 2, returned: 9 }] }, "i1")).toBe(0);
  });

  it("is zero for an item the job never touched", () => {
    expect(usedOf(job, "other")).toBe(0);
  });

  it("detects a recorded batch split", () => {
    expect(hasSplit({ consumed: [{ bid: "b1", qty: 5 }] })).toBe(true);
    expect(hasSplit({ consumed: [] })).toBe(false);
    expect(hasSplit({})).toBe(false);
    expect(hasSplit()).toBe(false);
  });
});

describe("jobsUsingBatch", () => {
  // The classification that decides whose finished job cost gets restated.
  const withSplit = { id: "split-hit", items: [{ iid: "i1", pulled: 5, consumed: [{ bid: "b1", qty: 5 }], priceAtPull: 32.5 }] };
  const splitElsewhere = { id: "split-miss", items: [{ iid: "i1", pulled: 5, consumed: [{ bid: "bZ", qty: 5 }], priceAtPull: 99 }] };
  const legacyMatch = { id: "legacy-match", items: [{ iid: "i1", pulled: 5, priceAtPull: 32.5 }] };
  const legacyBlend = { id: "legacy-blend", items: [{ iid: "i1", pulled: 5, priceAtPull: 33.2 }] };
  const untouched = { id: "untouched", items: [{ iid: "i1", pulled: 0, priceAtPull: 32.5 }] };
  const otherItem = { id: "other", items: [{ iid: "i9", pulled: 5, priceAtPull: 32.5 }] };

  const all = [withSplit, splitElsewhere, legacyMatch, legacyBlend, untouched, otherItem];
  const { exact, blended } = jobsUsingBatch(all, "i1", "b1", 32.5);

  it("treats a job that names this batch in its split as exact", () => {
    expect(exact.map((j) => j.id)).toContain("split-hit");
  });

  it("leaves a job whose split names a different batch entirely alone", () => {
    // It recorded exactly where its material came from, and it was not here.
    expect(exact.map((j) => j.id)).not.toContain("split-miss");
    expect(blended.map((j) => j.id)).not.toContain("split-miss");
  });

  it("treats a legacy job whose price matches as exact", () => {
    expect(exact.map((j) => j.id)).toContain("legacy-match");
  });

  it("flags a legacy job with a blended price as un-restatable", () => {
    // Its cost came from several batches at different prices and can no longer
    // be taken apart, so it is surfaced to the user rather than guessed at.
    expect(blended.map((j) => j.id)).toEqual(["legacy-blend"]);
  });

  it("skips jobs that pulled nothing and jobs about other items", () => {
    const ids = [...exact, ...blended].map((j) => j.id);
    expect(ids).not.toContain("untouched");
    expect(ids).not.toContain("other");
  });

  it("returns empty lists for no jobs at all", () => {
    expect(jobsUsingBatch([], "i1", "b1", 10)).toEqual({ exact: [], blended: [] });
    expect(jobsUsingBatch(undefined, "i1", "b1", 10)).toEqual({ exact: [], blended: [] });
  });
});

describe("renders", () => {
  it("ItemDetailModal shows specs and batch history oldest first", () => {
    const html = render(ItemDetailModal, { item, perms: { inv_pricing_view: true, inv_edit: true } });
    expect(html).toContain("Shingle");
    expect(html).toContain("Batch History");
    expect(html).toContain("ABC Supply");
    // The older batch must render above the newer one. Compared on dates because
    // React SSR splits {b.rem}/{b.qty} into separate text nodes, so "42/60"
    // never appears contiguously in the markup.
    //
    // Expected strings come from fd() rather than being written out, because
    // fd() shifts date-only strings by a day west of UTC: new Date("2026-05-01")
    // is UTC midnight, which is Apr 30 locally. Hardcoding "May 1, 2026" would
    // make this test pass only in UTC or ahead of it.
    const older = fd(item.batches[1].rcvd);
    const newer = fd(item.batches[0].rcvd);
    expect(html).toContain(older);
    expect(html.indexOf(older)).toBeLessThan(html.indexOf(newer));
  });

  it("ItemDetailModal marks the batch FIFO will draw from next", () => {
    expect(render(ItemDetailModal, { item, perms: {} })).toContain("ACTIVE");
  });

  it("ItemFormModal opens blank in create mode", () => {
    const html = render(ItemFormModal, { item: null });
    expect(html).toContain("Add New Catalog Position");
    for (const c of CATEGORIES.slice(0, 3)) expect(html).toContain(c);
    for (const u of UNITS.slice(0, 3)) expect(html).toContain(u);
  });

  it("ItemFormModal pre-fills in edit mode and titles itself with the item", () => {
    const html = render(ItemFormModal, { item });
    expect(html).toContain("Modify Specifications: Shingle");
    expect(html).toContain("Roofing Materials");
  });

  it("ItemFormModal hides the price field without pricing rights", () => {
    expect(render(ItemFormModal, { item, perms: { inv_pricing_edit: false } })).not.toContain("Current Price Per Unit");
  });

  it("ReceiveBatchModal warns when pricing is locked", () => {
    expect(render(ReceiveBatchModal, { item, perms: {} })).toContain("lock-restricted");
  });

  it("AdjustStockModal shows the current on-hand total", () => {
    const html = render(AdjustStockModal, { item });
    expect(html).toContain("Current on-hand");
    expect(html).toContain("142"); // 100 + 42
  });

  it("BatchCorrectionModal opens on the edit form, not the recalc preview", () => {
    const html = render(BatchCorrectionModal, { item, batch: item.batches[1], jobs: [], perms: { inv_pricing_edit: true } });
    expect(html).toContain("Correct Batch");
    expect(html).toContain("Adjust Stock"); // the "quantities live elsewhere" note
    expect(html).not.toContain("finished job");
  });
});
