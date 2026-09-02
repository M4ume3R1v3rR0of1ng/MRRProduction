import { describe, it, expect } from "vitest";
import { resolveSort } from "./useStickySort";

// The hook itself is plumbing around localStorage. This covers the part that
// decides anything: whether a remembered sort is still safe to use.
describe("resolveSort", () => {
  const INVENTORY = ["name_az", "name_za", "cat_az", "stock_low", "stock_high", "price_low", "price_high"];

  it("uses a remembered sort that is still offered", () => {
    expect(resolveSort("stock_low", INVENTORY, "name_az")).toBe("stock_low");
  });

  it("falls back on a first visit, when nothing is stored", () => {
    expect(resolveSort(null, INVENTORY, "name_az")).toBe("name_az");
  });

  it("falls back when localStorage is unreadable and returns undefined", () => {
    expect(resolveSort(undefined, INVENTORY, "name_az")).toBe("name_az");
  });

  // The bug this whole hook exists to avoid re-introducing. Inventory's price
  // sorts are gated on perms.inv_pricing_view, so a remembered "price_low" can
  // outlive the permission. Trusting it would leave the <select> matching no
  // <option>, which renders blank and sorts by nothing.
  it("falls back when the remembered sort is no longer offered", () => {
    const withoutPricing = INVENTORY.filter((v) => !v.startsWith("price_"));
    expect(resolveSort("price_low", withoutPricing, "name_az")).toBe("name_az");
  });

  it("falls back for a sort that no longer exists at all", () => {
    expect(resolveSort("sort_removed_in_a_past_version", INVENTORY, "name_az")).toBe("name_az");
  });

  it("does not treat an empty string as a valid choice", () => {
    expect(resolveSort("", INVENTORY, "name_az")).toBe("name_az");
  });

  it("keeps each view on its own fallback", () => {
    const jobs = ["oldest", "newest", "name_az", "name_za", "po", "status"];
    expect(resolveSort(null, jobs, "oldest")).toBe("oldest");
    expect(resolveSort(null, INVENTORY, "name_az")).toBe("name_az");
  });
});
