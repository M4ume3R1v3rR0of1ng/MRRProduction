// src/views/inventory/BulkReceiveModal.test.js
//
// These are the rules that decide what a job is billed for material received in
// bulk. They lived inside a 150-line handler in InventoryView, behind
// `modal === "bulk"`, and could not be reached by a test at all before the split.
//
// The invariant worth protecting: a blank price must never become a $0 batch.
// FIFO charges each batch at its own price, so a $0 batch bills real material at
// nothing and prints $0 on the customer's job report.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import BulkReceiveModal, { hasQuantity, manifestTotal, resolveBulkPrices } from "./BulkReceiveModal.jsx";
import { NotificationProvider } from "../../context/NotificationContext";

const inv = [
  { id: "i1", name: "Shingle", unit: "bd", cat: "Roofing", batches: [{ rem: 10, price: 32.5, rcvd: "2026-05-01" }, { rem: 5, price: 34, rcvd: "2026-06-01" }] },
  { id: "i2", name: "Ridge Cap", unit: "bx", cat: "Roofing", batches: [] }, // never purchased: no price to fall back on
];

describe("hasQuantity", () => {
  it("accepts a positive quantity", () => {
    expect(hasQuantity({ qty: "5" })).toBe(true);
  });

  it("accepts a negative quantity, which is a correction against an over-receipt", () => {
    expect(hasQuantity({ qty: "-3" })).toBe(true);
  });

  it("rejects zero, blank, and non-numeric", () => {
    expect(hasQuantity({ qty: "0" })).toBe(false);
    expect(hasQuantity({ qty: "" })).toBe(false);
    expect(hasQuantity({ qty: "abc" })).toBe(false);
    expect(hasQuantity({})).toBe(false);
  });

  it("does not throw on a missing row", () => {
    expect(() => hasQuantity(undefined)).not.toThrow();
    expect(hasQuantity(undefined)).toBe(false);
  });
});

describe("manifestTotal", () => {
  it("sums quantity times price across rows", () => {
    expect(manifestTotal([{ qty: "2", price: "10" }, { qty: "3", price: "5" }])).toBe(35);
  });

  it("treats blank quantity or price as zero rather than NaN", () => {
    expect(manifestTotal([{ qty: "", price: "10" }, { qty: "2", price: "" }])).toBe(0);
  });

  it("lets a negative correction row reduce the total", () => {
    expect(manifestTotal([{ qty: "5", price: "10" }, { qty: "-2", price: "10" }])).toBe(30);
  });

  it("is zero for an empty or missing manifest", () => {
    expect(manifestTotal([])).toBe(0);
    expect(manifestTotal()).toBe(0);
  });
});

describe("resolveBulkPrices", () => {
  it("uses the price the receiver typed", () => {
    const [row] = resolveBulkPrices([{ iid: "i1", price: "40" }], inv);
    expect(row.rate).toBe(40);
  });

  it("keeps a typed zero, which is a deliberate free or warranty batch", () => {
    const [row] = resolveBulkPrices([{ iid: "i1", price: "0" }], inv);
    expect(row.rate).toBe(0);
  });

  it("falls back to the item's newest batch price when left blank", () => {
    // Newest by received date is the 2026-06-01 batch at 34, not the first in the array.
    const [row] = resolveBulkPrices([{ iid: "i1", price: "" }], inv);
    expect(row.rate).toBe(34);
  });

  it("returns null, never zero, when blank and there is nothing to fall back on", () => {
    // This is the whole point. A null makes the caller refuse and name the row.
    // A 0 here would silently bill the job nothing for real material.
    const [row] = resolveBulkPrices([{ iid: "i2", price: "" }], inv);
    expect(row.rate).toBeNull();
    expect(row.rate).not.toBe(0);
  });

  it("returns null for an item that is not in the catalog at all", () => {
    const [row] = resolveBulkPrices([{ iid: "does-not-exist", price: "" }], inv);
    expect(row.rate).toBeNull();
  });

  it("carries the rest of the row through untouched", () => {
    const [row] = resolveBulkPrices([{ iid: "i1", iname: "Shingle", qty: "7", price: "40" }], inv);
    expect(row).toMatchObject({ iid: "i1", iname: "Shingle", qty: "7", rate: 40 });
  });

  it("resolves each row independently", () => {
    const out = resolveBulkPrices([{ iid: "i1", price: "" }, { iid: "i2", price: "" }, { iid: "i1", price: "99" }], inv);
    expect(out.map((r) => r.rate)).toEqual([34, null, 99]);
  });
});

describe("BulkReceiveModal render", () => {
  const render = (props) =>
    renderToString(
      h(NotificationProvider, null, h(BulkReceiveModal, { inv, setInv: () => {}, users: [], user: { id: "u1" }, perms: {}, onClose: () => {}, ...props })),
    );

  it("mounts with an empty manifest queue", () => {
    const html = render();
    expect(html).toContain("Receive Bulk Order Manifest");
    expect(html).toContain("Manifest queue is empty");
  });

  it("offers the catalog for selection", () => {
    const html = render();
    expect(html).toContain("Shingle");
    expect(html).toContain("Ridge Cap");
  });

  it("hides the price input from a user without pricing rights", () => {
    // readOnly is only rendered on the locked variant.
    expect(render({ perms: { inv_pricing_edit: false } })).not.toContain('step="0.01"');
  });

  it("renders with no catalog and no props beyond the required ones", () => {
    expect(() => render({ inv: [] })).not.toThrow();
  });
});
