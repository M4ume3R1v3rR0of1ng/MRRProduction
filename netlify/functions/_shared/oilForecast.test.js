import { describe, it, expect } from "vitest";
import {
  parseDay,
  oilStatus,
  daysUntilOilDue,
  oilDueDayOffset,
  projectedOilDueDate,
} from "./oilForecast.js";

const truck = (over = {}) => ({
  type: "truck",
  mi: 2000,
  lomi: 0,
  oii: 2700,
  mil: [
    { dt: "2026-01-01", mi: 1000 },
    { dt: "2026-01-11", mi: 2000 }, // 100 mi/day over the 10-day span
  ],
  ...over,
});

describe("parseDay", () => {
  it("parses a plain calendar day as a UTC midnight Date", () => {
    const d = parseDay("2026-03-05");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(2);
    expect(d.getUTCDate()).toBe(5);
  });

  it("truncates an ISO timestamp to its calendar day", () => {
    const d = parseDay("2026-03-05T18:22:01.000Z");
    expect(d.toISOString().split("T")[0]).toBe("2026-03-05");
  });

  it("returns null for empty/garbage input", () => {
    expect(parseDay(null)).toBeNull();
    expect(parseDay("")).toBeNull();
    expect(parseDay("not-a-date")).toBeNull();
  });
});

describe("oilStatus", () => {
  it("returns null for a non-truck", () => {
    expect(oilStatus({ type: "trailer", mi: 5000, lomi: 0, oii: 3000 })).toBeNull();
  });

  it("returns null with no configured interval", () => {
    expect(oilStatus(truck({ oii: null }))).toBeNull();
    expect(oilStatus(truck({ oii: 0 }))).toBeNull();
  });

  it("reports ok/soon/overdue by percent of interval consumed", () => {
    expect(oilStatus(truck({ mi: 1000, lomi: 0, oii: 3000 })).state).toBe("ok"); // 33%
    expect(oilStatus(truck({ mi: 2500, lomi: 0, oii: 3000 })).state).toBe("soon"); // 83%
    expect(oilStatus(truck({ mi: 3200, lomi: 0, oii: 3000 })).state).toBe("overdue"); // 107%
  });
});

describe("daysUntilOilDue", () => {
  it("projects from this truck's own mileage rate, not a fleet guess", () => {
    // 700 mi remaining at 100 mi/day = 7 days.
    expect(daysUntilOilDue(truck({ mi: 2000, lomi: 0, oii: 2700 }))).toBe(7);
  });

  it("returns 0 rather than negative once already overdue", () => {
    expect(daysUntilOilDue(truck({ mi: 2000, lomi: 0, oii: 1500 }))).toBe(0);
  });

  it("returns null without at least two mileage log entries", () => {
    expect(daysUntilOilDue(truck({ mil: [{ dt: "2026-01-01", mi: 1000 }] }))).toBeNull();
    expect(daysUntilOilDue(truck({ mil: [] }))).toBeNull();
  });

  it("returns null with no configured interval, rather than an Invalid Date downstream", () => {
    expect(daysUntilOilDue(truck({ oii: null }))).toBeNull();
    expect(daysUntilOilDue(truck({ oii: 0 }))).toBeNull();
  });

  it("returns null when the mileage log shows no forward progress", () => {
    expect(
      daysUntilOilDue(
        truck({
          mil: [
            { dt: "2026-01-01", mi: 2000 },
            { dt: "2026-01-11", mi: 2000 },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("oilDueDayOffset", () => {
  it("agrees with daysUntilOilDue on a truck that is not due yet", () => {
    expect(oilDueDayOffset(truck({ mi: 2000, lomi: 0, oii: 2700 }))).toBe(7);
  });

  it("goes NEGATIVE once past due, which is the whole point of it", () => {
    // 500 mi over a 1500 mi interval at 100 mi/day = 5 days past due. This is
    // what the escalation notice counts; daysUntilOilDue's floor hid it, so an
    // overdue truck claimed to be due today no matter how long it had been.
    expect(oilDueDayOffset(truck({ mi: 2000, lomi: 0, oii: 1500 }))).toBe(-5);
    expect(daysUntilOilDue(truck({ mi: 2000, lomi: 0, oii: 1500 }))).toBe(0);
  });

  it("is 0 on the day it comes due", () => {
    expect(oilDueDayOffset(truck({ mi: 2000, lomi: 0, oii: 2000 }))).toBe(0);
  });

  it("returns null on the same conditions as daysUntilOilDue", () => {
    expect(oilDueDayOffset(truck({ oii: null }))).toBeNull();
    expect(oilDueDayOffset(truck({ mil: [] }))).toBeNull();
    expect(oilDueDayOffset({ type: "trailer", mil: [], oii: 5000 })).toBeNull();
  });
});

describe("projectedOilDueDate", () => {
  it("adds the projected day count onto the given reference date", () => {
    const v = truck({ mi: 2000, lomi: 0, oii: 2700 }); // 7 days out
    expect(projectedOilDueDate(v, { today: parseDay("2026-01-15") })).toBe("2026-01-22");
  });

  it("names the date an overdue truck actually went past due, not today", () => {
    const v = truck({ mi: 2000, lomi: 0, oii: 1500 }); // 5 days past due
    expect(projectedOilDueDate(v, { today: parseDay("2026-01-15") })).toBe("2026-01-10");
  });

  it("rolls a past-due projection back over a month boundary", () => {
    const v = truck({ mi: 2000, lomi: 0, oii: 1500 });
    expect(projectedOilDueDate(v, { today: parseDay("2026-03-02") })).toBe("2026-02-25");
  });

  it("returns null under the same conditions daysUntilOilDue does", () => {
    expect(projectedOilDueDate(truck({ oii: null }), { today: parseDay("2026-01-15") })).toBeNull();
  });
});
