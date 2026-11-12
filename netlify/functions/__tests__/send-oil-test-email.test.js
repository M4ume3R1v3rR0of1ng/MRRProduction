import { describe, it, expect } from "vitest";
import { silenceReason } from "../send-oil-test-email.js";

const truck = (over) => ({ type: "truck", oii: "5000", mi: "163350", lomi: "0", mil: [], ...over });

describe("silenceReason", () => {
  it("explains an overdue truck the job cannot project (truck 008's case)", () => {
    const v = truck({ mil: [{ dt: "2026-10-01", mi: 163350 }] });
    const reason = silenceReason(v, { action: "none", projectedDueDate: null });
    expect(reason).toMatch(/overdue by mileage/);
    expect(reason).toMatch(/fewer than 2 mileage log entries/);
  });

  it("explains a flat mileage log", () => {
    const v = truck({
      mil: [
        { dt: "2026-10-01", mi: 163350 },
        { dt: "2026-10-05", mi: 163350 },
      ],
    });
    expect(silenceReason(v, { action: "none", projectedDueDate: null })).toMatch(
      /does not show the truck accruing miles|does not show it accruing miles/,
    );
  });

  it("says nothing when the job did project a date", () => {
    expect(silenceReason(truck(), { action: "urgent", projectedDueDate: "2026-01-01" })).toBeNull();
    expect(silenceReason(truck(), { action: "none", projectedDueDate: "2027-01-01" })).toBeNull();
  });

  it("flags a missing interval", () => {
    expect(silenceReason(truck({ oii: "" }), { action: "none", projectedDueDate: null })).toBe(
      "no oil interval set",
    );
  });
});
