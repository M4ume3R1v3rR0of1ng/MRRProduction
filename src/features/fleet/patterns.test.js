// Dates are the whole point of these tests. learnServiceIntervals both MEASURES
// a span (which must happen in a frame where every day is 24h) and PROJECTS one
// forward (which must happen in calendar days, because what it produces is a
// calendar date) — two different frames. The cases below are the ones that used
// to come out a day wrong.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { learnServiceIntervals, detectChronicIssues, detectFleetTrends } from "./patterns";

// The projection assertions below only BITE in a zone that observes daylight
// saving: in UTC the broken millisecond arithmetic and the correct calendar
// arithmetic agree on every date, so a CI box running UTC would have gone green
// against the bug. Node re-reads process.env.TZ per Date operation, so pinning
// it here is enough to make the guard real everywhere. America/Chicago because
// that is where this fleet is, and it both springs forward and falls back.
const realTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Chicago";
});
afterAll(() => {
  process.env.TZ = realTZ;
});

const svc = (dt, mi, type = "Oil Change") => ({ id: dt, type, dt, mi });
const veh = (sl) => ({ id: "v1", type: "truck", sl });
const oilChange = (v) => learnServiceIntervals(v).find((p) => p.type === "Oil Change");

describe("learnServiceIntervals — what it takes to get a prediction at all", () => {
  it("says nothing with fewer than two records on the vehicle", () => {
    expect(learnServiceIntervals(veh([]))).toEqual([]);
    expect(learnServiceIntervals(veh([svc("2026-01-01", 1000)]))).toEqual([]);
    expect(learnServiceIntervals(null)).toEqual([]);
  });

  it("says nothing when the two records are of different types", () => {
    expect(
      learnServiceIntervals(
        veh([svc("2026-01-01", 1000), svc("2026-04-01", 4000, "Tire Rotation")]),
      ),
    ).toEqual([]);
  });

  it("predicts per type, so one repeated type is enough even among others", () => {
    const out = learnServiceIntervals(
      veh([
        svc("2026-01-01", 1000),
        svc("2026-01-15", 1200, "Inspection"),
        svc("2026-04-01", 4000),
      ]),
    );
    expect(out.map((p) => p.type)).toEqual(["Oil Change"]);
  });

  it("ignores a record whose date is not a date, rather than poisoning the average", () => {
    const out = oilChange(
      veh([svc("2026-01-01", 1000), svc("2026-04-01", 4000), svc("whenever", 5000)]),
    );
    expect(out.serviceCount).toBe(2);
    expect(out.predictedNextDate).toBe("2026-06-30"); // Apr 1 + 90d
  });

  it("drops a type whose records all share one date (no interval to learn)", () => {
    expect(learnServiceIntervals(veh([svc("2026-01-01", 1000), svc("2026-01-01", 1000)]))).toEqual(
      [],
    );
  });
});

describe("learnServiceIntervals — the date arithmetic", () => {
  it("counts the services, not the gaps between them", () => {
    const two = oilChange(veh([svc("2026-01-01", 1000), svc("2026-04-01", 4000)]));
    expect(two.serviceCount).toBe(2);
    expect(two.sampleSize).toBe(1);

    const three = oilChange(
      veh([svc("2026-01-01", 1000), svc("2026-04-01", 4000), svc("2026-07-01", 7000)]),
    );
    expect(three.serviceCount).toBe(3);
    expect(three.sampleSize).toBe(2);
  });

  it("measures a span crossing BOTH US daylight-saving changes as whole days", () => {
    // 2026-03-08 springs forward, 2026-11-01 falls back. Subtracting local
    // midnights would make this 364.96 days; in UTC it is exactly 365.
    const out = oilChange(veh([svc("2026-01-01", 1000), svc("2027-01-01", 13000)]));
    expect(out.avgIntervalDays).toBe(365);
  });

  it("projects across a fall-back transition without losing the day", () => {
    // Sep 1 + 92d = Dec 2. Adding 92 * 86,400,000ms to LOCAL midnight lands at
    // 23:00 on Dec 1 in any zone that falls back in November, and formatDay
    // reads local components — so the card named Dec 1. That is the bug.
    const out = oilChange(veh([svc("2026-06-01", 1000), svc("2026-09-01", 4000)]));
    expect(out.avgIntervalDays).toBe(92);
    expect(out.predictedNextDate).toBe("2026-12-02");
  });

  it("projects across a spring-forward transition without gaining the day", () => {
    const out = oilChange(veh([svc("2025-12-01", 1000), svc("2026-01-01", 4000)]));
    expect(out.avgIntervalDays).toBe(31);
    expect(out.predictedNextDate).toBe("2026-02-01");
  });

  it("lands lastServiceDate + avgIntervalDays exactly on predictedNextDate", () => {
    // A 90/91-day pair averages 90.5. The raw average drove the projection
    // while the rounded one was displayed, so the card showed Sep 29 under a
    // stated interval of 91 days from Jul 1 — a date that interval never
    // reaches.
    const out = oilChange(
      veh([svc("2026-01-01", 1000), svc("2026-04-01", 4000), svc("2026-07-01", 7000)]),
    );
    expect(out.avgIntervalDays).toBe(91);
    expect(out.lastServiceDate).toBe("2026-07-01");
    expect(out.predictedNextDate).toBe("2026-09-30"); // Jul 1 + 91d
  });

  it("rolls a projection over a year boundary", () => {
    const out = oilChange(veh([svc("2026-07-15", 1000), svc("2026-10-15", 4000)]));
    expect(out.predictedNextDate).toBe("2027-01-15"); // Oct 15 + 92d
  });

  it("orders several predictions by the date each one projects", () => {
    const out = learnServiceIntervals(
      veh([
        svc("2026-01-01", 1000, "Detail"),
        svc("2026-02-01", 2000, "Detail"),
        svc("2026-01-01", 1000),
        svc("2026-06-01", 6000),
      ]),
    );
    expect(out.map((p) => p.type)).toEqual(["Detail", "Oil Change"]);
  });
});

describe("learnServiceIntervals — mileage", () => {
  it("averages mileage gaps alongside the day gaps", () => {
    const out = oilChange(veh([svc("2026-01-01", 1000), svc("2026-04-01", 4000)]));
    expect(out.avgIntervalMiles).toBe(3000);
    expect(out.predictedNextMileage).toBe(7000);
  });

  it("gives a date-only prediction when the records carry no mileage", () => {
    const out = oilChange(
      veh([{ id: "a", type: "Oil Change", dt: "2026-01-01" }, svc("2026-04-01", undefined)]),
    );
    expect(out.avgIntervalMiles).toBeNull();
    expect(out.predictedNextMileage).toBeNull();
    expect(out.predictedNextDate).toBe("2026-06-30");
  });

  it("ignores a mileage gap that runs backwards (a corrected odometer)", () => {
    const out = oilChange(
      veh([svc("2026-01-01", 5000), svc("2026-04-01", 1000), svc("2026-07-01", 4000)]),
    );
    expect(out.avgIntervalMiles).toBe(3000); // only the 1000 → 4000 gap counted
  });
});

describe("detectChronicIssues", () => {
  const at = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

  it("flags a vehicle+type seen at least minCount times inside the window", () => {
    const out = detectChronicIssues([
      { vid: "v1", vname: "Truck 1", type: "Brakes", at: at(5) },
      { vid: "v1", vname: "Truck 1", type: "Brakes", at: at(20) },
      { vid: "v1", vname: "Truck 1", type: "Brakes", at: at(40) },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ vid: "v1", issueType: "Brakes", count: 3 });
  });

  it("does not flag the same count spread outside the window", () => {
    expect(
      detectChronicIssues([
        { vid: "v1", type: "Brakes", at: at(5) },
        { vid: "v1", type: "Brakes", at: at(90) },
        { vid: "v1", type: "Brakes", at: at(120) },
      ]),
    ).toEqual([]);
  });

  it("splits a comma-joined type into separate issues", () => {
    const out = detectChronicIssues(
      [
        { vid: "v1", type: "Brakes, Tires", at: at(1) },
        { vid: "v1", type: "Brakes", at: at(2) },
      ],
      { minCount: 2 },
    );
    expect(out.map((g) => g.issueType)).toEqual(["Brakes"]);
  });
});

describe("detectFleetTrends", () => {
  const at = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

  it("flags a type that is entirely new versus the baseline", () => {
    const out = detectFleetTrends([
      { vid: "v1", type: "Coolant", at: at(1) },
      { vid: "v2", type: "Coolant", at: at(2) },
      { vid: "v3", type: "Coolant", at: at(3) },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ issueType: "Coolant", isNew: true, recentCount: 3 });
  });

  it("stays quiet below minRecentCount however new the type is", () => {
    expect(detectFleetTrends([{ vid: "v1", type: "Coolant", at: at(1) }])).toEqual([]);
  });
});
