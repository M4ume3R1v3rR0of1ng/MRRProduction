// Tests for the inventory library's copy rules — see supabase/61 and
// ./inventoryCatalog. The dialog is thin; these are the parts that would cause
// real damage if they were wrong: offering a company something they already
// carry, or building an inventory row that carries a price or a foreign id.
import { describe, it, expect } from "vitest";
import {
  normalizeName,
  availableCatalog,
  groupByCategory,
  searchCatalog,
  catalogItemsToRows,
} from "./inventoryCatalog";

const lib = [
  { id: "1", name: "Drip Edge", cat: "Sheet Metal", unit: "each", alrt: 20 },
  { id: "2", name: "Step Flashing", cat: "Sheet Metal", unit: "boxes", alrt: 8 },
  { id: "3", name: "Roofing Cement", cat: "Sealants", unit: "tubes", alrt: 12 },
];

describe("normalizeName", () => {
  it("trims and lowercases so the index and the UI agree", () => {
    expect(normalizeName("  Drip Edge ")).toBe("drip edge");
  });

  it("survives junk", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("availableCatalog", () => {
  it("offers everything to a company with an empty catalog", () => {
    expect(availableCatalog(lib, []).map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  // The unique index in 61 is on lower(name), so the picker has to match that or
  // it will offer a duplicate the company then has two of.
  it("hides a position the company already carries, whatever the casing", () => {
    const out = availableCatalog(lib, [{ name: "drip edge" }, { name: "  STEP FLASHING  " }]);
    expect(out.map((r) => r.id)).toEqual(["3"]);
  });

  it("ignores unrelated items in the company's catalog", () => {
    expect(availableCatalog(lib, [{ name: "Scaffolding" }])).toHaveLength(3);
  });

  // One bad row must not suppress a whole category by matching on "".
  it("does not treat a nameless row as a match for everything", () => {
    expect(availableCatalog(lib, [{ name: "" }, { name: null }, {}])).toHaveLength(3);
    expect(availableCatalog([{ id: "x", name: "   " }], [])).toHaveLength(0);
  });

  it("survives junk input on either side", () => {
    expect(availableCatalog(null, null)).toEqual([]);
    expect(availableCatalog(undefined, undefined)).toEqual([]);
  });
});

describe("groupByCategory", () => {
  it("groups by category, categories alphabetical", () => {
    const g = groupByCategory(lib);
    expect([...g.keys()]).toEqual(["Sealants", "Sheet Metal"]);
    expect(g.get("Sheet Metal").map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("keeps the order the query returned within a category", () => {
    const g = groupByCategory([
      { id: "b", name: "B", cat: "Tools" },
      { id: "a", name: "A", cat: "Tools" },
    ]);
    expect(g.get("Tools").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("buckets a row with no category rather than dropping it", () => {
    const g = groupByCategory([{ id: "z", name: "Mystery" }]);
    expect(g.get("Uncategorized")).toHaveLength(1);
  });
});

describe("searchCatalog", () => {
  it("matches on name", () => {
    expect(searchCatalog(lib, "drip").map((r) => r.id)).toEqual(["1"]);
  });

  it("matches on category too, so typing a category works", () => {
    expect(searchCatalog(lib, "sheet metal").map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("ignores case and surrounding space", () => {
    expect(searchCatalog(lib, "  CEMENT ").map((r) => r.id)).toEqual(["3"]);
  });

  it("returns everything for an empty term", () => {
    expect(searchCatalog(lib, "")).toHaveLength(3);
    expect(searchCatalog(lib, "   ")).toHaveLength(3);
  });
});

describe("catalogItemsToRows", () => {
  it("builds a zero-stock position in ItemFormModal's shape", () => {
    const [row] = catalogItemsToRows([lib[0]]);
    expect(row).toMatchObject({
      name: "Drip Edge",
      cat: "Sheet Metal",
      unit: "each",
      alrt: 20,
      batches: [],
    });
  });

  // The ids are only unique within one company (02 made the primary key
  // composite), so reusing the library's uuid would be wrong as well as confusing.
  it("mints a fresh app-style id per row rather than reusing the library's", () => {
    const rows = catalogItemsToRows(lib);
    rows.forEach((r) => expect(r.id).toMatch(/^i_/));
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(rows.map((r) => r.id)).not.toContain("1");
  });

  // The whole point of "copies, not references": no link back, and no price. A
  // price would be what some other company paid some other week.
  it("carries no price, no batches and no reference to the library row", () => {
    const [row] = catalogItemsToRows([{ ...lib[0], price: 42, catalog_id: "1" }]);
    expect(row.batches).toEqual([]);
    expect(row).not.toHaveProperty("price");
    expect(row).not.toHaveProperty("catalog_id");
  });

  // company_id must come from the column DEFAULT. Sending it from the browser is
  // the one way a client could write into another tenant.
  it("never sets company_id, leaving it to the database default", () => {
    const [row] = catalogItemsToRows([{ ...lib[0], company_id: "someone-else" }]);
    expect(row).not.toHaveProperty("company_id");
  });

  it("falls back to a usable alert threshold when the library row has none", () => {
    expect(catalogItemsToRows([{ name: "X", cat: "Tools", unit: "each" }])[0].alrt).toBe(10);
    expect(catalogItemsToRows([{ name: "X", cat: "Tools", unit: "each", alrt: "7" }])[0].alrt).toBe(
      7,
    );
  });

  it("drops nameless rows instead of inserting a blank position", () => {
    expect(catalogItemsToRows([{ name: "  " }, { name: null }, lib[0]])).toHaveLength(1);
  });

  it("survives junk input", () => {
    expect(catalogItemsToRows(null)).toEqual([]);
    expect(catalogItemsToRows([])).toEqual([]);
  });
});
