// The reconciliation is the only place the app compares its own books against an
// outside fact. If the arithmetic is wrong it does not just report a wrong number,
// it tells an owner that a crew is losing material they never lost.
import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase", () => ({
  supabase: {},
  updateRowStrict: vi.fn(),
  getAccessToken: vi.fn(),
}));

const {
  periodOf,
  shiftPeriod,
  recentPeriods,
  usageByItem,
  movementByItem,
  buildCountLines,
  summarizeCount,
  flaggedLines,
  bleedTrend,
} = await import("./inventoryCounts");

const receipt = (rcvd, qty, price, rem = qty) => ({ id: `b_${rcvd}_${qty}`, rcvd, qty, price, rem, ref: "PO-1", by: "u1" });
const adjustment = (rcvd, qty, price) => ({ id: `b_adj_${rcvd}`, rcvd, qty, price, rem: qty, ref: "Manual Adjustment — found a pallet", by: "u1" });
const shortRow = (rcvd, qty, price) => ({ id: `neg_${rcvd}`, rcvd, qty: -qty, price, rem: -qty, short: true, by: "u2" });

const item = (id, name, batches, unit = "ea") => ({ id, name, unit, cat: "Vents", batches });

describe("periodOf — filing a movement in the right month", () => {
  it("reads a calendar-day batch date as that day", () => {
    expect(periodOf("2026-07-31")).toBe("2026-07");
  });

  it("does not push a late-evening job into next month", () => {
    // The trap: a UTC ISO string sliced directly. Jan 31 8pm at UTC-5 is Feb 1 in
    // UTC, and slicing would file a whole day's usage into the wrong period.
    const local = new Date(2026, 0, 31, 20, 0, 0);
    expect(periodOf(local.toISOString())).toBe("2026-01");
  });

  it("returns null rather than a fake period for a missing date", () => {
    expect(periodOf(null)).toBe(null);
    expect(periodOf("")).toBe(null);
  });
});

describe("shiftPeriod — month arithmetic across a year boundary", () => {
  it("steps back over January into the previous year", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
  });

  it("steps forward over December", () => {
    expect(shiftPeriod("2025-12", 1)).toBe("2026-01");
  });

  it("lists recent periods newest first", () => {
    expect(recentPeriods("2026-03", 4)).toEqual(["2026-03", "2026-02", "2026-01", "2025-12"]);
  });
});

describe("usageByItem — what actually left the yard", () => {
  it("counts a pull in the month it was pulled, not the month the job closed", () => {
    // Pulled Jan 20, job closed Feb 3. The material left in January.
    const jobs = [{
      id: "j1", status: "completed", completed: "2026-02-03T15:00:00",
      items: [{ iid: "i1", pulled: 10, returned: 0, pulledAt: "2026-01-20" }],
    }];
    expect(usageByItem(jobs, "2026-01").get("i1")).toEqual({ pulled: 10, returned: 0 });
    expect(usageByItem(jobs, "2026-02").has("i1")).toBe(false);
  });

  it("credits a return in the month it came back", () => {
    const jobs = [{
      id: "j1", status: "completed", completed: "2026-02-03T15:00:00",
      items: [{ iid: "i1", pulled: 10, returned: 4, pulledAt: "2026-01-20" }],
    }];
    // 10 out in January, 4 back in February. Netting both to one month would
    // understate January usage by 4 and hide the January bleed.
    expect(usageByItem(jobs, "2026-01").get("i1")).toEqual({ pulled: 10, returned: 0 });
    expect(usageByItem(jobs, "2026-02").get("i1")).toEqual({ pulled: 0, returned: 4 });
  });

  it("falls back to job dates for rows written before pulledAt existed", () => {
    const jobs = [{
      id: "j1", status: "completed", approved: "2026-01-15", completed: "2026-01-28T12:00:00",
      items: [{ iid: "i1", pulled: 6, returned: 0 }],
    }];
    expect(usageByItem(jobs, "2026-01").get("i1")).toEqual({ pulled: 6, returned: 0 });
  });

  it("ignores drafts, which have pulled nothing", () => {
    const jobs = [{ id: "j1", status: "draft", approved: "2026-01-15", items: [{ iid: "i1", pulled: 99 }] }];
    expect(usageByItem(jobs, "2026-01").has("i1")).toBe(false);
  });

  it("sums the same item across several jobs", () => {
    const jobs = [
      { id: "j1", status: "active", items: [{ iid: "i1", pulled: 3, pulledAt: "2026-01-04" }] },
      { id: "j2", status: "completed", items: [{ iid: "i1", pulled: 5, pulledAt: "2026-01-19" }] },
    ];
    expect(usageByItem(jobs, "2026-01").get("i1").pulled).toBe(8);
  });
});

describe("movementByItem — reading the batch list by kind", () => {
  it("separates receipts from corrections and shortfalls", () => {
    const it1 = item("i1", "Vent", [
      receipt("2026-01-05", 20, 10),
      adjustment("2026-01-11", 5, 10),
      shortRow("2026-01-22", 3, 10),
      receipt("2025-12-30", 50, 9), // previous period, must not count
    ]);
    expect(movementByItem(it1, "2026-01")).toEqual({ received: 20, adjusted: 5, shortfall: 3 });
  });

  it("counts an adjustment that carries a typed reason", () => {
    // The prefix-vs-equality bug: "Manual Adjustment — damaged in yard" used to fall
    // through and be booked as a supplier receipt, inflating received.
    const it1 = item("i1", "Vent", [{ id: "b_x", rcvd: "2026-01-09", qty: 4, price: 10, rem: 4, ref: "Manual Adjustment — damaged in yard" }]);
    expect(movementByItem(it1, "2026-01")).toEqual({ received: 0, adjusted: 4, shortfall: 0 });
  });
});

describe("buildCountLines — expected on hand", () => {
  const jobs = [{ id: "j1", status: "completed", items: [{ iid: "i1", pulled: 12, returned: 2, pulledAt: "2026-01-15", unit: "ea" }], completed: "2026-01-20T12:00:00" }];

  it("derives opening by rolling the book back through the period when there is no prior count", () => {
    // Book now: 20 received minus 12 pulled plus 2 returned = 10 on hand.
    const inv = [item("i1", "Vent", [{ ...receipt("2026-01-05", 20, 10), rem: 10 }])];
    const [line] = buildCountLines(inv, jobs, "2026-01");

    expect(line.onHand).toBe(10);
    expect(line.received).toBe(20);
    expect(line.used).toBe(10); // 12 out, 2 back
    expect(line.opening).toBe(0); // 10 - 20 + 10
    expect(line.openingSource).toBe("derived");
    expect(line.expected).toBe(10);
  });

  it("prefers last period's counted number over the book", () => {
    const inv = [item("i1", "Vent", [{ ...receipt("2026-01-05", 20, 10), rem: 10 }])];
    const [line] = buildCountLines(inv, jobs, "2026-01", {
      previousLines: [{ iid: "i1", counted: 4 }],
    });
    // A count is a fact, the book is a claim. Opening 4 + 20 in - 10 used = 14
    // expected, against 10 actually on the shelf. That 4-unit gap is the point.
    expect(line.openingSource).toBe("counted");
    expect(line.opening).toBe(4);
    expect(line.expected).toBe(14);
  });

  it("leaves an uncounted line null rather than zero", () => {
    // "Nobody has counted this yet" must never render as "we have none" — that
    // would report the entire stock of every unvisited shelf as bled.
    const inv = [item("i1", "Vent", [receipt("2026-01-05", 20, 10)])];
    const [line] = buildCountLines(inv, jobs, "2026-01");
    expect(line.counted).toBe(null);
    expect(line.variance).toBe(null);
  });

  it("treats a typed zero as a real count", () => {
    const inv = [item("i1", "Vent", [{ ...receipt("2026-01-05", 20, 10), rem: 10 }])];
    const [line] = buildCountLines(inv, jobs, "2026-01", { entries: { i1: { counted: 0 } } });
    expect(line.counted).toBe(0);
    expect(line.variance).toBe(-10);
  });

  it("computes variance as counted minus expected", () => {
    const inv = [item("i1", "Vent", [{ ...receipt("2026-01-05", 20, 10), rem: 10 }])];
    const [line] = buildCountLines(inv, jobs, "2026-01", { entries: { i1: { counted: 8 } } });
    expect(line.expected).toBe(10);
    expect(line.variance).toBe(-2); // two units gone with no record
  });

  it("surfaces a negative book balance as its own signal", () => {
    // The -1 Atlas vent case: more was issued than existed.
    const inv = [item("i1", "Vent", [{ ...receipt("2026-01-05", 11, 10), rem: 0 }, shortRow("2026-01-15", 1, 10)])];
    const [line] = buildCountLines(inv, [], "2026-01");
    expect(line.onHand).toBe(-1);
    expect(line.shortfall).toBe(1);
  });

  it("sorts by name so the sheet matches a walk down the rack", () => {
    const inv = [item("i2", "Zinc Strip", []), item("i1", "Atlas Vent", [])];
    expect(buildCountLines(inv, [], "2026-01").map((l) => l.name)).toEqual(["Atlas Vent", "Zinc Strip"]);
  });
});

describe("summarizeCount — the bleed rate", () => {
  const lines = [
    { iid: "i1", opening: 10, received: 90, adjusted: 0, expected: 50, counted: 47, variance: -3, price: 10 },
    { iid: "i2", opening: 0, received: 100, adjusted: 0, expected: 40, counted: 41, variance: 1, price: 5 },
    { iid: "i3", opening: 20, received: 0, adjusted: 0, expected: 20, counted: null, variance: null, price: 8 },
  ];

  it("measures variance against throughput, not the closing balance", () => {
    const s = summarizeCount(lines);
    // Throughput of the two counted lines is 100 + 100 = 200. Net variance -2.
    expect(s.throughput).toBe(200);
    expect(s.varianceUnits).toBe(-2);
    expect(s.bleedPct).toBe(-1);
  });

  it("excludes uncounted lines from both sides of the ratio", () => {
    const s = summarizeCount(lines);
    expect(s.countedCount).toBe(2);
    expect(s.total).toBe(3);
  });

  it("reports absolute variance too, so offsetting errors cannot read as control", () => {
    // Net is -2, but 4 units are actually misplaced across the two lines.
    expect(summarizeCount(lines).absVarianceUnits).toBe(4);
  });

  it("values the loss at the current price", () => {
    const s = summarizeCount(lines);
    expect(s.varianceValue).toBe(-25); // -3 × $10 + 1 × $5
    expect(s.shrinkValue).toBe(-30); // losses only, gains do not pay for them
  });

  it("does not divide by zero on an untouched period", () => {
    expect(summarizeCount([]).bleedPct).toBe(0);
    expect(summarizeCount(null).bleedPct).toBe(0);
  });
});

describe("flaggedLines — what is worth chasing", () => {
  it("ignores rounding on a high-throughput bulk item", () => {
    const lines = [{ iid: "i1", name: "Nails", opening: 0, received: 1000, adjusted: 0, counted: 998, variance: -2, price: 1 }];
    expect(flaggedLines(lines)).toHaveLength(0); // 0.2% of throughput
  });

  it("flags a small item with a large proportional loss", () => {
    const lines = [{ iid: "i1", name: "Vent", opening: 10, received: 0, adjusted: 0, counted: 6, variance: -4, price: 40 }];
    expect(flaggedLines(lines)).toHaveLength(1);
  });

  it("ranks by dollars at risk, not by unit count", () => {
    const lines = [
      { iid: "cheap", name: "Cap", opening: 100, received: 0, adjusted: 0, counted: 80, variance: -20, price: 1 },
      { iid: "dear", name: "Coil", opening: 20, received: 0, adjusted: 0, counted: 17, variance: -3, price: 200 },
    ];
    expect(flaggedLines(lines).map((l) => l.iid)).toEqual(["dear", "cheap"]);
  });

  it("says nothing about a line nobody counted", () => {
    expect(flaggedLines([{ iid: "i1", opening: 10, received: 0, adjusted: 0, counted: null, variance: null }])).toHaveLength(0);
  });
});

describe("bleedTrend — one item over several months", () => {
  it("returns closed periods oldest first", () => {
    const counts = [
      { period: "2026-02", status: "closed", lines: [{ iid: "i1", counted: 5, variance: -2, price: 10 }] },
      { period: "2026-01", status: "closed", lines: [{ iid: "i1", counted: 9, variance: -1, price: 10 }] },
    ];
    expect(bleedTrend(counts, "i1")).toEqual([
      { period: "2026-01", variance: -1, value: -10 },
      { period: "2026-02", variance: -2, value: -20 },
    ]);
  });

  it("skips a period still open, whose numbers can still move", () => {
    const counts = [{ period: "2026-03", status: "open", lines: [{ iid: "i1", counted: 1, variance: -9, price: 10 }] }];
    expect(bleedTrend(counts, "i1")).toEqual([]);
  });
});
