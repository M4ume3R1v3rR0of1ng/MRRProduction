// AccuLynx caps AdditionalExpense.Notes at 250 characters and rejects the whole
// call past it. This used to truncate at 1900, so any job with more than a handful
// of materials failed to sync with a 400 and no cost was ever recorded.
import { describe, it, expect } from "vitest";
import { buildExpenseNotes, MAX_EXPENSE_NOTES } from "./expenseNotes.js";

const item = (name, qty = 1, unit = "each", price = 10) => ({
  name, quantity: qty, unit, unitPrice: price, totalCost: qty * price,
});

describe("buildExpenseNotes", () => {
  it("keeps the whole breakdown when it fits", () => {
    const notes = buildExpenseNotes("Material Cost - 22450", [item("OSB", 1, "each", 15.5)]);
    expect(notes).toBe("Material Cost - 22450\nOSB 1 each @ $15.50 = $15.50");
    expect(notes.length).toBeLessThanOrEqual(MAX_EXPENSE_NOTES);
  });

  it("never exceeds the cap, however many materials the job has", () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`Material Number ${i}`, 12, "bundles", 199.99));
    const notes = buildExpenseNotes("Material Cost - 22450: Luisa Noblecilla", many);
    expect(notes.length).toBeLessThanOrEqual(MAX_EXPENSE_NOTES);
  });

  it("says how many items it left out, and where to find them", () => {
    const many = Array.from({ length: 40 }, (_, i) => item(`Material ${i}`, 3, "rolls", 83));
    const notes = buildExpenseNotes("Material Cost - 22450", many);
    expect(notes).toMatch(/\+\d+ more, see the job report PDF/);
    // The count has to be the real remainder, not a guess.
    const omitted = Number(/\+(\d+) more/.exec(notes)[1]);
    const kept = notes.split("\n").filter((l) => /@ \$/.test(l)).length;
    expect(kept + omitted).toBe(40);
  });

  it("never cuts a line mid-number", () => {
    // A sliced "= $1,2" reads as a different figure than the real one. Every money
    // line present must be complete.
    const many = Array.from({ length: 30 }, (_, i) => item(`Item ${i}`, 7, "each", 1234.56));
    const notes = buildExpenseNotes("Material Cost - 22450", many);
    for (const line of notes.split("\n")) {
      if (line.includes("@ $")) expect(line).toMatch(/= \$\d+\.\d{2}$/);
    }
  });

  it("handles a job with no line items", () => {
    expect(buildExpenseNotes("Material Cost - 22450", [])).toBe("Material Cost - 22450");
    expect(buildExpenseNotes("Material Cost - 22450", null)).toBe("Material Cost - 22450");
  });

  it("falls back to a label when there is no description", () => {
    expect(buildExpenseNotes("", [])).toBe("Material cost");
    expect(buildExpenseNotes(undefined, [])).toBe("Material cost");
  });

  it("truncates even a pathological header rather than sending an over-cap field", () => {
    const notes = buildExpenseNotes("x".repeat(400), [item("OSB")]);
    expect(notes.length).toBeLessThanOrEqual(MAX_EXPENSE_NOTES);
  });
});
