// Weekly counting, and the period machinery underneath it.
//
// Kept apart from inventoryCounts.test.js, which covers the reconciliation
// arithmetic. That arithmetic is cadence-blind — it takes a period string and
// asks what falls inside it. Everything here is the part that decides what
// "inside" means, which is where an off-by-one costs somebody a week of
// material and tells an owner a crew lost it.
import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase", () => ({
  supabase: {},
  updateRowStrict: vi.fn(),
  getAccessToken: vi.fn(),
}));

const {
  MONTHLY,
  WEEKLY,
  CADENCES,
  cadenceOf,
  isoWeekParts,
  isoWeekStart,
  periodOf,
  currentPeriod,
  periodStart,
  periodEnd,
  periodContains,
  shiftPeriod,
  recentPeriods,
  periodLabel,
  previousClosedCount,
  movementByItem,
  usageByItem,
  buildCountLines,
  bleedTrend,
} = await import("./inventoryCounts");

const receipt = (rcvd, qty, price = 10) => ({
  id: `b_${rcvd}_${qty}`,
  rcvd,
  qty,
  price,
  rem: qty,
  ref: "PO-1",
  by: "u1",
});

describe("the cadence registry", () => {
  it("offers exactly the two cadences the database constraint allows", () => {
    expect(CADENCES).toEqual([MONTHLY, WEEKLY]);
  });
});

describe("cadenceOf", () => {
  it("reads the cadence off the shape, which is the only record of it", () => {
    expect(cadenceOf("2026-10")).toBe(MONTHLY);
    expect(cadenceOf("2026-W41")).toBe(WEEKLY);
  });

  it("rejects every shape supabase/50's constraint also rejects", () => {
    for (const bad of [
      "2026-13",
      "2026-00",
      "2026-W54",
      "2026-W00",
      "2026-W1",
      "Jan 2026",
      "",
      "2026-1",
    ]) {
      expect(cadenceOf(bad)).toBeNull();
    }
    expect(cadenceOf(null)).toBeNull();
    expect(cadenceOf(undefined)).toBeNull();
  });
});

describe("isoWeekParts / isoWeekStart", () => {
  it("puts a date in the ISO week containing it", () => {
    // Wed 7 Oct 2026 is in week 41.
    expect(isoWeekParts(new Date(2026, 9, 7))).toEqual({ isoYear: 2026, week: 41 });
  });

  it("runs Monday to Sunday, not Sunday to Saturday", () => {
    expect(isoWeekParts(new Date(2026, 9, 5)).week).toBe(41); // Mon 5 Oct
    expect(isoWeekParts(new Date(2026, 9, 11)).week).toBe(41); // Sun 11 Oct
    expect(isoWeekParts(new Date(2026, 9, 12)).week).toBe(42); // Mon 12 Oct
  });

  // The whole reason isoWeekParts steps to Thursday instead of reading
  // getFullYear(): at the year boundary the ISO year and the calendar year
  // disagree, and taking the calendar one files a day into a week that does not
  // contain it.
  it("keeps a January day in the previous ISO year when its week began there", () => {
    // Fri 1 Jan 2027's week began Mon 28 Dec 2026, so it is 2026-W53.
    expect(isoWeekParts(new Date(2027, 0, 1))).toEqual({ isoYear: 2026, week: 53 });
  });

  it("moves a December day into the next ISO year when its week ends there", () => {
    // Mon 30 Dec 2024's week contains Thu 2 Jan 2025, so the week is 2025-W01.
    expect(isoWeekParts(new Date(2024, 11, 30))).toEqual({ isoYear: 2025, week: 1 });
  });

  it("round-trips through isoWeekStart, including 53-week years", () => {
    for (const [y, w] of [
      [2026, 1],
      [2026, 41],
      [2026, 53],
      [2025, 1],
      [2025, 52],
      [2027, 1],
    ]) {
      expect(isoWeekParts(isoWeekStart(y, w))).toEqual({ isoYear: y, week: w });
    }
  });

  it("starts every week on a Monday", () => {
    for (const w of [1, 14, 27, 40, 52]) {
      expect(isoWeekStart(2026, w).getDay()).toBe(1);
    }
  });
});

describe("periodOf", () => {
  it("zero pads the week, so periods stay fixed width and compare as strings", () => {
    expect(periodOf("2026-01-07", WEEKLY)).toBe("2026-W02");
    expect(periodOf("2026-10-07", WEEKLY)).toBe("2026-W41");
  });

  it("defaults to monthly, which is what every existing caller expected", () => {
    expect(periodOf("2026-10-07")).toBe("2026-10");
    expect(periodOf("2026-10-07", MONTHLY)).toBe("2026-10");
  });

  it("returns null for no date rather than inventing a period", () => {
    expect(periodOf(null, WEEKLY)).toBeNull();
    expect(periodOf("", WEEKLY)).toBeNull();
  });
});

describe("currentPeriod", () => {
  it("returns a shape matching the cadence asked for", () => {
    expect(cadenceOf(currentPeriod(MONTHLY))).toBe(MONTHLY);
    expect(cadenceOf(currentPeriod(WEEKLY))).toBe(WEEKLY);
    expect(cadenceOf(currentPeriod())).toBe(MONTHLY);
  });
});

describe("periodStart / periodEnd", () => {
  it("bounds a month by its real last day, leap years included", () => {
    expect(periodStart("2026-10")).toBe("2026-10-01");
    expect(periodEnd("2026-10")).toBe("2026-10-31");
    expect(periodEnd("2026-02")).toBe("2026-02-28");
    expect(periodEnd("2028-02")).toBe("2028-02-29");
  });

  it("bounds a week Monday to Sunday", () => {
    expect(periodStart("2026-W41")).toBe("2026-10-05");
    expect(periodEnd("2026-W41")).toBe("2026-10-11");
  });

  it("bounds a week that straddles the new year", () => {
    expect(periodStart("2026-W53")).toBe("2026-12-28");
    expect(periodEnd("2026-W53")).toBe("2027-01-03");
  });

  it("returns null for a shape it cannot read, rather than a wrong date", () => {
    expect(periodStart("2026-W54")).toBeNull();
    expect(periodEnd("nonsense")).toBeNull();
    expect(periodStart(null)).toBeNull();
  });
});

describe("periodContains", () => {
  it("includes both endpoints of a week", () => {
    expect(periodContains("2026-W41", "2026-10-05")).toBe(true);
    expect(periodContains("2026-W41", "2026-10-11")).toBe(true);
    expect(periodContains("2026-W41", "2026-10-04")).toBe(false);
    expect(periodContains("2026-W41", "2026-10-12")).toBe(false);
  });

  it("includes both endpoints of a month", () => {
    expect(periodContains("2026-10", "2026-10-01")).toBe(true);
    expect(periodContains("2026-10", "2026-10-31")).toBe(true);
    expect(periodContains("2026-10", "2026-09-30")).toBe(false);
    expect(periodContains("2026-10", "2026-11-01")).toBe(false);
  });

  // Why the date goes through formatDay(parseDay(x)) rather than being sliced:
  // job timestamps are UTC ISO strings, and a late-evening local time has
  // already rolled over in UTC.
  it("files a late-evening timestamp by its local calendar day", () => {
    const sundayNight = new Date(2026, 9, 11, 23, 30).toISOString();
    expect(periodContains("2026-W41", sundayNight)).toBe(true);
    expect(periodContains("2026-W42", sundayNight)).toBe(false);
  });

  it("is false for a missing date or an unreadable period", () => {
    expect(periodContains("2026-W41", null)).toBe(false);
    expect(periodContains("2026-W54", "2026-10-05")).toBe(false);
  });
});

describe("shiftPeriod", () => {
  it("shifts a week by weeks", () => {
    expect(shiftPeriod("2026-W41", -1)).toBe("2026-W40");
    expect(shiftPeriod("2026-W41", 1)).toBe("2026-W42");
    expect(shiftPeriod("2026-W41", -4)).toBe("2026-W37");
  });

  it("underflows into the previous ISO year's last week, not a week 0", () => {
    expect(shiftPeriod("2026-W01", -1)).toBe("2025-W52");
    expect(shiftPeriod("2027-W01", -1)).toBe("2026-W53");
  });

  it("still shifts a month by months", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
  });

  it("leaves an unreadable period alone rather than returning NaN", () => {
    expect(shiftPeriod("nonsense", -1)).toBe("nonsense");
  });
});

describe("recentPeriods", () => {
  it("walks back one week at a time, newest first", () => {
    expect(recentPeriods("2026-W03", 4)).toEqual(["2026-W03", "2026-W02", "2026-W01", "2025-W52"]);
  });

  it("stays at whatever cadence it was given", () => {
    expect(recentPeriods("2026-02", 3)).toEqual(["2026-02", "2026-01", "2025-12"]);
  });
});

describe("periodLabel", () => {
  it("names a month in full", () => {
    expect(periodLabel("2026-10")).toBe("October 2026");
  });

  it("names a week by number and the days it covers", () => {
    expect(periodLabel("2026-W41")).toBe("Week 41 · Oct 5–11, 2026");
  });

  it("repeats the month when a week straddles two of them", () => {
    expect(periodLabel("2026-W53")).toBe("Week 53 · Dec 28–Jan 3, 2027");
  });

  it("hands back the raw string for a shape it cannot read", () => {
    expect(periodLabel("whatever")).toBe("whatever");
  });
});

describe("previousClosedCount", () => {
  const closed = (period) => ({ period, status: "closed", lines: [] });

  it("finds the immediately preceding period when one exists", () => {
    expect(previousClosedCount([closed("2026-09"), closed("2026-08")], "2026-10").period).toBe(
      "2026-09",
    );
  });

  // The bug this replaced. An exact match on shiftPeriod(period, -1) looked for
  // "2026-09", found nothing, and silently re-derived October from the book --
  // discarding a perfectly good August count.
  it("reaches past a skipped period instead of falling back to the book", () => {
    expect(previousClosedCount([closed("2026-08")], "2026-10").period).toBe("2026-08");
  });

  it("ignores an open count, whose lines stay empty until it closes", () => {
    const counts = [{ period: "2026-09", status: "open", lines: [] }, closed("2026-08")];
    expect(previousClosedCount(counts, "2026-10").period).toBe("2026-08");
  });

  it("never returns a period that overlaps or follows the one being opened", () => {
    const counts = [closed("2026-10"), closed("2026-11"), closed("2026-09")];
    expect(previousClosedCount(counts, "2026-10").period).toBe("2026-09");
  });

  it("bridges a switch from monthly to weekly", () => {
    // Mon 2 Nov 2026 starts W45. The last monthly count closed for October.
    expect(previousClosedCount([closed("2026-10")], "2026-W45").period).toBe("2026-10");
  });

  it("bridges a switch from weekly back to monthly", () => {
    // W44 of 2026 ends Sun 1 Nov.
    expect(previousClosedCount([closed("2026-W44")], "2026-12").period).toBe("2026-W44");
  });

  it("prefers the latest-ENDING count when both cadences are in the history", () => {
    // W44 ends 2026-11-01; October ends 2026-10-31. The week is later, even
    // though "2026-10" sorts after "2026-W44" would not.
    expect(previousClosedCount([closed("2026-10"), closed("2026-W44")], "2026-12").period).toBe(
      "2026-W44",
    );
  });

  it("returns null when nothing has closed, so the sheet derives from the book", () => {
    expect(previousClosedCount([], "2026-10")).toBeNull();
    expect(previousClosedCount(null, "2026-10")).toBeNull();
    expect(previousClosedCount([closed("2026-10")], "nonsense")).toBeNull();
  });
});

describe("the reconciliation at weekly cadence", () => {
  it("counts only receipts dated inside that week", () => {
    const item = {
      id: "i1",
      name: "Ridge vent",
      batches: [
        receipt("2026-10-05", 40), // Mon of W41
        receipt("2026-10-11", 10), // Sun of W41
        receipt("2026-10-12", 99), // Mon of W42 -- must not appear
        receipt("2026-10-04", 99), // Sun of W40 -- must not appear
      ],
    };
    expect(movementByItem(item, "2026-W41").received).toBe(50);
  });

  it("counts only job usage inside that week", () => {
    const jobs = [
      {
        id: "j1",
        status: "completed",
        pulledAt: "2026-10-06",
        completed: "2026-10-09",
        items: [{ iid: "i1", pulled: 12, returned: 2 }],
      },
      {
        id: "j2",
        status: "completed",
        pulledAt: "2026-10-13", // W42
        completed: "2026-10-14",
        items: [{ iid: "i1", pulled: 99, returned: 0 }],
      },
    ];
    const usage = usageByItem(jobs, "2026-W41");
    expect(usage.get("i1")).toEqual({ pulled: 12, returned: 2 });
  });

  it("opens a week from the previous week's counted number", () => {
    const item = { id: "i1", name: "Ridge vent", batches: [receipt("2026-10-05", 10)] };
    const [line] = buildCountLines([item], [], "2026-W41", {
      previousLines: [{ iid: "i1", counted: 30 }],
      entries: { i1: { counted: 38 } },
    });
    expect(line.openingSource).toBe("counted");
    expect(line.opening).toBe(30);
    expect(line.expected).toBe(40); // 30 opening + 10 received
    expect(line.variance).toBe(-2); // counted 38, so two units short
  });
});

describe("bleedTrend across a cadence switch", () => {
  it("orders by the period's start date, not by its name", () => {
    const counts = [
      {
        period: "2026-W44", // starts 2026-10-26
        status: "closed",
        lines: [{ iid: "i1", counted: 5, variance: -3, price: 10 }],
      },
      {
        period: "2026-09", // starts 2026-09-01
        status: "closed",
        lines: [{ iid: "i1", counted: 9, variance: -1, price: 10 }],
      },
    ];
    // Lexically "2026-W44" sorts after "2026-09", which happens to be right
    // here; the point is that it is sorted by date, so September comes first.
    expect(bleedTrend(counts, "i1").map((p) => p.period)).toEqual(["2026-09", "2026-W44"]);
  });

  it("keeps a week before a later month in the right order", () => {
    const counts = [
      {
        period: "2026-12",
        status: "closed",
        lines: [{ iid: "i1", counted: 1, variance: -1, price: 10 }],
      },
      {
        period: "2026-W05", // starts 2026-01-26 -- early in the year
        status: "closed",
        lines: [{ iid: "i1", counted: 2, variance: -2, price: 10 }],
      },
    ];
    // By string, "2026-W05" would sort AFTER "2026-12" and draw the trend
    // backwards. By date it is ten months earlier.
    expect(bleedTrend(counts, "i1").map((p) => p.period)).toEqual(["2026-W05", "2026-12"]);
  });
});
