import { describe, it, expect } from "vitest";
import { reorderFieldsToWrite } from "./ItemFormModal";

const blank = { reorder_qty: "", supplier_name: "", supplier_email: "" };

describe("reorderFieldsToWrite", () => {
  // The reason this function exists: an update naming a column the database lacks fails
  // whole, so a shop that never touches these fields must not send them at all.
  it("writes nothing when nothing was touched, on a new item", () => {
    expect(reorderFieldsToWrite(blank, null)).toEqual({});
  });

  it("writes nothing when nothing was touched, on an existing item without the columns", () => {
    expect(reorderFieldsToWrite(blank, { id: "i1", name: "x" })).toEqual({});
  });

  it("writes nothing when values are unchanged", () => {
    const item = { reorder_qty: 40, supplier_name: "ABC", supplier_email: "a@b.co" };
    const form = { reorder_qty: "40", supplier_name: "ABC", supplier_email: "a@b.co" };
    expect(reorderFieldsToWrite(form, item)).toEqual({});
  });

  it("writes only the field that changed", () => {
    expect(reorderFieldsToWrite({ ...blank, reorder_qty: "25" }, null)).toEqual({
      reorder_qty: 25,
    });
  });

  it("clears a field back to null rather than saving an empty string", () => {
    const item = { reorder_qty: 40, supplier_name: "ABC", supplier_email: null };
    const form = { reorder_qty: "", supplier_name: "ABC", supplier_email: "" };
    expect(reorderFieldsToWrite(form, item)).toEqual({ reorder_qty: null });
  });

  it("rejects a non-positive or junk quantity as null, matching the table's check", () => {
    expect(reorderFieldsToWrite({ ...blank, reorder_qty: "0" }, null)).toEqual({
      reorder_qty: null,
    });
    expect(reorderFieldsToWrite({ ...blank, reorder_qty: "abc" }, null)).toEqual({
      reorder_qty: null,
    });
  });
});
