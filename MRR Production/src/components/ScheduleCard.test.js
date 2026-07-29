// src/components/ScheduleCard.test.js
//
// The week-ahead strip. Its job is to put jobs, trailers and shop time on one
// set of days, which no existing calendar can do — each of the three lives in a
// different view and sees only its own data.
//
// Date handling is the risk here, so the tests build their fixtures from
// todayLocal() rather than hardcoding days. The suite is also run under several
// timezones in CI-by-hand; see src/utils/dates.test.js for why that matters.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import ScheduleCard, { dayKeys, dayKeyOf, buildSchedule } from "./ScheduleCard.jsx";
import { todayLocal, parseDay, formatDay } from "../utils/helpers";

const plusDays = (n) => {
  const d = parseDay(todayLocal());
  return formatDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};

const vehs = [
  { id: "v1", name: "Truck 3", type: "truck" },
  { id: "v2", name: "Trailer 1", type: "trailer" },
];
const users = [{ id: "u1", name: "Sam Schwartz" }];

describe("dayKeys", () => {
  it("returns seven consecutive days starting today", () => {
    const keys = dayKeys();
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe(todayLocal());
    expect(keys[6]).toBe(plusDays(6));
  });

  it("has no duplicate or skipped days", () => {
    // Stepping a local Date rather than adding 86400000 is what makes this hold
    // across a DST boundary, where a day is 23 or 25 hours long.
    const keys = dayKeys("2026-03-05", 10);
    expect(new Set(keys).size).toBe(10);
  });

  it("crosses a month boundary correctly", () => {
    expect(dayKeys("2026-01-30", 3)).toEqual(["2026-01-30", "2026-01-31", "2026-02-01"]);
  });

  it("crosses a leap day", () => {
    expect(dayKeys("2028-02-28", 3)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("honours a custom length", () => {
    expect(dayKeys("2026-05-01", 3)).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
  });
});

describe("dayKeyOf", () => {
  it("passes a bare day through", () => {
    expect(dayKeyOf("2026-05-01")).toBe("2026-05-01");
  });

  it("strips the time off a full timestamp", () => {
    // Maintenance stores scheduled_date as a timestamp on some rows.
    expect(dayKeyOf("2026-05-01T14:30:00Z")).toBe("2026-05-01");
  });

  it("returns null for nothing", () => {
    expect(dayKeyOf(null)).toBeNull();
    expect(dayKeyOf("")).toBeNull();
    expect(dayKeyOf(undefined)).toBeNull();
  });
});

describe("buildSchedule", () => {
  it("places a job on its scheduled day", () => {
    const jobs = [{ id: "j1", title: "Re-roof", status: "active", scheduledDate: plusDays(2), assignedto: "u1" }];
    const week = buildSchedule({ jobs, users });
    expect(week[2].jobs).toHaveLength(1);
    expect(week[2].jobs[0].title).toBe("Re-roof");
    expect(week[2].jobs[0].supervisor).toBe("Sam Schwartz");
  });

  it("ignores an unscheduled job rather than guessing a day for it", () => {
    const jobs = [{ id: "j1", title: "No date", status: "active", createdAt: todayLocal() }];
    expect(buildSchedule({ jobs }).every((d) => d.jobs.length === 0)).toBe(true);
  });

  it("ignores finished work", () => {
    const jobs = [
      { id: "j1", title: "Done", status: "completed", scheduledDate: plusDays(1) },
      { id: "j2", title: "Closed", status: "closed", scheduledDate: plusDays(1) },
    ];
    expect(buildSchedule({ jobs })[1].jobs).toHaveLength(0);
  });

  it("ignores anything outside the seven-day window", () => {
    const jobs = [
      { id: "past", title: "Yesterday", status: "active", scheduledDate: plusDays(-1) },
      { id: "far", title: "Next week", status: "active", scheduledDate: plusDays(9) },
    ];
    expect(buildSchedule({ jobs }).every((d) => d.jobs.length === 0)).toBe(true);
  });

  it("attaches the trailers going out with a job", () => {
    const jobs = [{ id: "j1", title: "Re-roof", status: "active", scheduledDate: plusDays(0) }];
    const jobTrailers = [{ job_id: "j1", trailer_id: "v2" }];
    const week = buildSchedule({ jobs, jobTrailers, vehs });
    expect(week[0].jobs[0].trailers).toEqual(["Trailer 1"]);
    expect(week[0].trailerCount).toBe(1);
  });

  it("counts a trailer once even when two jobs share it that day", () => {
    const jobs = [
      { id: "j1", title: "A", status: "active", scheduledDate: plusDays(0) },
      { id: "j2", title: "B", status: "active", scheduledDate: plusDays(0) },
    ];
    const jobTrailers = [{ job_id: "j1", trailer_id: "v2" }, { job_id: "j2", trailer_id: "v2" }];
    expect(buildSchedule({ jobs, jobTrailers, vehs })[0].trailerCount).toBe(1);
  });

  it("places scheduled maintenance and names the vehicle", () => {
    const reqs = [{ id: "r1", vehicle_id: "v1", status: "scheduled", scheduled_date: plusDays(3), type: "Oil Change" }];
    const week = buildSchedule({ reqs, vehs });
    expect(week[3].maint).toHaveLength(1);
    expect(week[3].maint[0].vehicle).toBe("Truck 3");
  });

  it("ignores a pending request that has no date yet", () => {
    const reqs = [{ id: "r1", vehicle_id: "v1", status: "pending", scheduled_date: null }];
    expect(buildSchedule({ reqs, vehs }).every((d) => d.maint.length === 0)).toBe(true);
  });

  it("ignores completed maintenance", () => {
    const reqs = [{ id: "r1", vehicle_id: "v1", status: "completed", scheduled_date: plusDays(1) }];
    expect(buildSchedule({ reqs, vehs })[1].maint).toHaveLength(0);
  });

  it("flags a vehicle booked out and in the shop the same day", () => {
    // The whole reason this card exists. No single existing calendar can see
    // both sides of this: trailers live in Fleet, shop time lives in Maintenance.
    const jobs = [{ id: "j1", title: "Re-roof", status: "active", scheduledDate: plusDays(1) }];
    const jobTrailers = [{ job_id: "j1", trailer_id: "v2" }];
    const reqs = [{ id: "r1", vehicle_id: "v2", status: "scheduled", scheduled_date: plusDays(1), type: "Brakes" }];
    const week = buildSchedule({ jobs, reqs, jobTrailers, vehs });
    expect(week[1].conflicts).toEqual(["Trailer 1"]);
  });

  it("does not flag a conflict when the shop day is a different day", () => {
    const jobs = [{ id: "j1", title: "Re-roof", status: "active", scheduledDate: plusDays(1) }];
    const jobTrailers = [{ job_id: "j1", trailer_id: "v2" }];
    const reqs = [{ id: "r1", vehicle_id: "v2", status: "scheduled", scheduled_date: plusDays(2) }];
    expect(buildSchedule({ jobs, reqs, jobTrailers, vehs }).every((d) => d.conflicts.length === 0)).toBe(true);
  });

  it("does not flag a vehicle in the shop that is not booked out", () => {
    const reqs = [{ id: "r1", vehicle_id: "v1", status: "scheduled", scheduled_date: plusDays(1) }];
    expect(buildSchedule({ reqs, vehs })[1].conflicts).toEqual([]);
  });

  it("matches vehicle ids across string and number forms", () => {
    const numericVehs = [{ id: 7, name: "Trailer 7" }];
    const reqs = [{ id: "r1", vehicle_id: "7", status: "scheduled", scheduled_date: plusDays(0) }];
    expect(buildSchedule({ reqs, vehs: numericVehs })[0].maint[0].vehicle).toBe("Trailer 7");
  });

  it("returns seven empty days when given nothing at all", () => {
    const week = buildSchedule();
    expect(week).toHaveLength(7);
    expect(week.every((d) => d.jobs.length === 0 && d.maint.length === 0)).toBe(true);
  });
});

describe("ScheduleCard render", () => {
  const render = (props) => renderToString(h(ScheduleCard, { onNav: () => {}, ...props }));

  it("renders the week with a heading", () => {
    expect(render({})).toContain("The week ahead");
  });

  it("shows an empty-state hint when nothing is scheduled", () => {
    expect(render({})).toContain("Nothing scheduled this week");
  });

  it("lists a scheduled job", () => {
    const jobs = [{ id: "j1", title: "Maumee Re-roof", status: "active", scheduledDate: plusDays(1) }];
    const html = render({ jobs });
    expect(html).toContain("Maumee Re-roof");
    expect(html).not.toContain("Nothing scheduled this week");
  });

  it("warns in the header when a vehicle is double-booked", () => {
    const jobs = [{ id: "j1", title: "Re-roof", status: "active", scheduledDate: plusDays(1) }];
    const jobTrailers = [{ job_id: "j1", trailer_id: "v2" }];
    const reqs = [{ id: "r1", vehicle_id: "v2", status: "scheduled", scheduled_date: plusDays(1) }];
    expect(render({ jobs, reqs, jobTrailers, vehs })).toContain("in the shop on the same day");
  });

  it("renders in Spanish when asked", () => {
    expect(render({ lang: "es" })).toContain("La semana que viene");
  });
});
