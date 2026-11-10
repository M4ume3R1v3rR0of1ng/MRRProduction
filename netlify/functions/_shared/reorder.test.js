import { describe, it, expect } from "vitest";
import {
  onHand,
  alertLevel,
  findReorderCandidates,
  buildReorderEmail,
  findLowStockItems,
  buildLowStockEmail,
  wantsFreeLowStockNotice,
} from "./reorder.js";

const item = (over = {}) => ({
  id: "i1",
  name: "OSB 7/16",
  unit: "sheets",
  alrt: 10,
  batches: [{ rem: 4 }, { rem: "3" }],
  ...over,
});

describe("onHand / alertLevel", () => {
  it("sums batch remainders, tolerating strings and junk", () => {
    expect(onHand(item({ batches: [{ rem: 2 }, { rem: "1.5" }, { rem: "x" }, {}] }))).toBe(3.5);
    expect(onHand({ batches: null })).toBe(0);
  });
  it("treats an empty or zero threshold as no threshold", () => {
    expect(alertLevel({ alrt: "" })).toBeNull();
    expect(alertLevel({ alrt: 0 })).toBeNull();
    expect(alertLevel({ alrt: "5" })).toBe(5);
  });
});

describe("findReorderCandidates", () => {
  it("proposes an item at or below its line", () => {
    const out = findReorderCandidates([item({ reorder_qty: 40 })], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      inventory_id: "i1",
      on_hand: 7,
      alert_level: 10,
      suggested_qty: 40,
    });
  });

  it("includes an item sitting exactly on its line", () => {
    expect(findReorderCandidates([item({ batches: [{ rem: 10 }] })], [])).toHaveLength(1);
  });

  it("leaves a healthy item alone", () => {
    expect(findReorderCandidates([item({ batches: [{ rem: 11 }] })], [])).toHaveLength(0);
  });

  it("never proposes an item with no threshold, however empty", () => {
    expect(findReorderCandidates([item({ alrt: null, batches: [] })], [])).toHaveLength(0);
  });

  it("skips an item that already has a pending proposal", () => {
    expect(findReorderCandidates([item()], [{ inventory_id: "i1" }])).toHaveLength(0);
  });

  it("compares ids as strings, since inventory ids are free text", () => {
    expect(findReorderCandidates([item({ id: 7 })], [{ inventory_id: "7" }])).toHaveLength(0);
  });

  it("leaves the quantity null when none is configured, rather than inventing one", () => {
    expect(findReorderCandidates([item()], [])[0].suggested_qty).toBeNull();
    expect(findReorderCandidates([item({ reorder_qty: 0 })], [])[0].suggested_qty).toBeNull();
  });

  it("puts the emptiest first", () => {
    const out = findReorderCandidates(
      [
        item({ id: "a", name: "A", batches: [{ rem: 8 }] }),
        item({ id: "b", name: "B", batches: [{ rem: 0 }] }),
      ],
      [],
    );
    expect(out.map((o) => o.item_name)).toEqual(["B", "A"]);
  });
});

describe("buildReorderEmail", () => {
  const proposals = findReorderCandidates([item({ name: "Nails <b>", reorder_qty: 5 })], []);

  it("escapes item names, which are user-typed", () => {
    const { html } = buildReorderEmail({
      companyName: "Acme",
      proposals,
      appUrl: "https://x.test",
    });
    expect(html).not.toContain("<b>");
    expect(html).toContain("Nails &lt;b&gt;");
  });

  it("says nothing has been ordered", () => {
    const { html } = buildReorderEmail({
      companyName: "Acme",
      proposals,
      appUrl: "https://x.test",
    });
    expect(html).toMatch(/Nothing has been ordered/);
  });

  it("pluralises the subject", () => {
    expect(buildReorderEmail({ companyName: "Acme", proposals, appUrl: "u" }).subject).toMatch(
      /^1 item needs reordering/,
    );
    const two = findReorderCandidates([item(), item({ id: "i2" })], []);
    expect(buildReorderEmail({ companyName: "Acme", proposals: two, appUrl: "u" }).subject).toMatch(
      /^2 items need reordering/,
    );
  });
});

describe("Free low-stock notice", () => {
  const USABLE = ["trialing", "active", "past_due"];
  const co = (over = {}) => ({
    subscription_status: "active",
    is_platform_company: false,
    ...over,
  });

  it("lists only items at or below their line, emptiest first", () => {
    const out = findLowStockItems([
      item({ id: "a", name: "A", batches: [{ rem: 9 }] }),
      item({ id: "b", name: "B", batches: [{ rem: 2 }] }),
      item({ id: "c", name: "C", batches: [{ rem: 50 }] }),
      item({ id: "d", name: "D", alrt: null, batches: [] }),
    ]);
    expect(out.map((i) => i.item_name)).toEqual(["B", "A"]);
  });

  it("carries no reorder or supplier fields", () => {
    expect(Object.keys(findLowStockItems([item()])[0]).sort()).toEqual(
      ["alert_level", "item_name", "on_hand", "unit"].sort(),
    );
  });

  it("goes to an ordinary active company", () => {
    expect(wantsFreeLowStockNotice(co(), false, USABLE)).toBe(true);
  });

  it("skips a company whose Pro reorder email already covers it", () => {
    expect(wantsFreeLowStockNotice(co(), true, USABLE)).toBe(false);
  });

  it("skips the platform company and a lapsed subscription", () => {
    expect(wantsFreeLowStockNotice(co({ is_platform_company: true }), false, USABLE)).toBe(false);
    expect(wantsFreeLowStockNotice(co({ subscription_status: "canceled" }), false, USABLE)).toBe(
      false,
    );
  });

  it("writes a plain email that does not mention ordering", () => {
    const { subject, html } = buildLowStockEmail({
      companyName: "Acme Roofing",
      items: [{ item_name: "OSB", unit: "sheets", on_hand: 2, alert_level: 10 }],
      appUrl: "https://app.example",
    });
    expect(subject).toBe("1 item is low on stock — Acme Roofing");
    expect(html).toContain("2 sheets left (line: 10)");
    expect(html).not.toMatch(/suggest|approve|reorder|ordered/i);
  });
});
