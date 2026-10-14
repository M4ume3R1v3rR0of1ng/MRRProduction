import { describe, it, expect } from "vitest";
import {
  decideNoticeAction,
  isSameUtcDay,
  buildHeadsUpMessage,
  buildUrgentMessage,
  buildManagerMessage,
  wholeDaysSince,
  REQUEST_EXPIRY_DAYS,
} from "../send-maintenance-push-notices.js";

// A truck whose mileage log projects a due date exactly `daysOut` days after
// `todayStr`, by construction: 100 mi/day, remaining = daysOut * 100.
function truckDueIn(daysOut, todayStr, over = {}) {
  const remaining = daysOut * 100;
  return {
    id: "v1",
    name: "Truck 1",
    type: "truck",
    mi: 2000,
    lomi: 0,
    oii: 2000 + remaining,
    mil: [
      { dt: "2026-01-01", mi: 1000 },
      { dt: "2026-01-11", mi: 2000 }, // 100 mi/day
    ],
    ...over,
  };
}
const TODAY = "2026-02-01";

describe("isSameUtcDay", () => {
  it("compares only the calendar day, ignoring time of day", () => {
    expect(isSameUtcDay("2026-02-01T23:59:00.000Z", "2026-02-01")).toBe(true);
    expect(isSameUtcDay("2026-02-01T00:00:00.000Z", "2026-02-02")).toBe(false);
  });

  it("is false for a missing timestamp", () => {
    expect(isSameUtcDay(null, "2026-02-01")).toBe(false);
    expect(isSameUtcDay(undefined, "2026-02-01")).toBe(false);
  });
});

describe("decideNoticeAction", () => {
  it("sends the heads-up exactly at the 7-day mark with no prior notice", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(7, TODAY),
      todayStr: TODAY,
      existingNotice: null,
      resolvingRequestAt: null,
    });
    expect(decision.action).toBe("heads_up");
    expect(decision.projectedDueDate).toBe("2026-02-08");
  });

  it("still catches the heads-up window if the job skipped the exact 7-day day", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(3, TODAY),
      todayStr: TODAY,
      existingNotice: null,
      resolvingRequestAt: null,
    });
    expect(decision.action).toBe("heads_up");
  });

  it("does nothing more than 7 days out", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(10, TODAY),
      todayStr: TODAY,
      existingNotice: null,
      resolvingRequestAt: null,
    });
    expect(decision.action).toBe("none");
  });

  it("does not repeat the heads-up once already sent this cycle", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(5, TODAY),
      todayStr: TODAY,
      existingNotice: {
        cycle_lomi: 0,
        cycle_started_at: "2026-01-29T00:00:00.000Z",
        heads_up_sent_at: "2026-01-30T00:00:00.000Z",
        urgent_last_sent_at: null,
        paused_at: null,
        stall_last_sent_at: null,
      },
      resolvingRequestAt: null,
    });
    expect(decision.action).toBe("none");
  });

  it("fires urgent on the due date with nothing sent yet", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(0, TODAY),
      todayStr: TODAY,
      existingNotice: null,
      resolvingRequestAt: null,
    });
    expect(decision.action).toBe("urgent");
  });

  it("fires urgent again on a later day (daily escalation)", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(-2, TODAY, { oii: 1800 }),
      todayStr: TODAY,
      existingNotice: {
        cycle_lomi: 0,
        cycle_started_at: "2026-01-30T13:00:00.000Z",
        heads_up_sent_at: "2026-01-25T13:00:00.000Z",
        urgent_last_sent_at: "2026-01-31T13:00:00.000Z", // yesterday, not today
        paused_at: null,
        stall_last_sent_at: null,
      },
      resolvingRequestAt: null,
    });
    expect(decision.action).toBe("urgent");
  });

  it("does not send urgent twice in the same UTC day", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(-2, TODAY, { oii: 1800 }),
      todayStr: TODAY,
      existingNotice: {
        cycle_lomi: 0,
        cycle_started_at: "2026-01-30T13:00:00.000Z",
        heads_up_sent_at: null,
        urgent_last_sent_at: `${TODAY}T13:00:00.000Z`,
        paused_at: null,
        stall_last_sent_at: null,
      },
      resolvingRequestAt: null,
    });
    expect(decision.action).toBe("none");
  });

  it("pauses an unpaused cycle once a matching request shows up", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(0, TODAY),
      todayStr: TODAY,
      existingNotice: {
        cycle_lomi: 0,
        cycle_started_at: "2026-01-29T00:00:00.000Z",
        heads_up_sent_at: "2026-01-25T00:00:00.000Z",
        urgent_last_sent_at: `${TODAY}T09:00:00.000Z`,
        paused_at: null,
        stall_last_sent_at: null,
      },
      resolvingRequestAt: `${TODAY}T08:00:00.000Z`,
    });
    expect(decision.action).toBe("pause");
  });

  it("resumes the full escalation when the request is gone and no oil change was recorded", () => {
    // THE BUG supabase/53 FIXES. paused_at is set from a request that has since
    // been closed, cancelled or auto-expired, and lomi has not moved — so no
    // oil change happened. This used to return "none" forever.
    const decision = decideNoticeAction({
      vehicle: truckDueIn(0, TODAY),
      todayStr: TODAY,
      existingNotice: {
        cycle_lomi: 0,
        cycle_started_at: "2026-01-29T00:00:00.000Z",
        heads_up_sent_at: "2026-01-25T00:00:00.000Z",
        urgent_last_sent_at: "2026-01-31T00:00:00.000Z",
        paused_at: "2026-01-31T12:00:00.000Z",
        stall_last_sent_at: null,
      },
      resolvingRequestAt: null,
    });
    expect(decision.action).toBe("urgent");
  });

  it("clears a stale cycle once the oil was actually changed (lomi moved on)", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(20, TODAY, { lomi: 2000, oii: 2000 }), // fresh cycle (mi === lomi), far out
      todayStr: TODAY,
      existingNotice: {
        cycle_lomi: 0, // stale baseline from before the oil change
        cycle_started_at: "2026-01-10T00:00:00.000Z",
        heads_up_sent_at: "2026-01-10T00:00:00.000Z",
        urgent_last_sent_at: "2026-01-20T00:00:00.000Z",
        paused_at: null,
        stall_last_sent_at: null,
      },
      resolvingRequestAt: null,
    });
    // Far from due again post-change, so no new push today — but the stale
    // row from the OLD cycle must not keep suppressing a future heads-up.
    expect(decision.action).toBe("clear_cycle");
  });

  it("treats a stale cycle as a fresh start, not a suppressed one", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(7, TODAY, { lomi: 2000, oii: 700 }), // fresh cycle (mi === lomi), 7 days out
      todayStr: TODAY,
      existingNotice: {
        cycle_lomi: 0, // stale baseline — oil was changed since
        cycle_started_at: "2026-01-10T00:00:00.000Z",
        heads_up_sent_at: "2026-01-10T00:00:00.000Z", // was already sent last cycle
        urgent_last_sent_at: "2026-01-20T00:00:00.000Z",
        paused_at: null,
        stall_last_sent_at: null,
      },
      resolvingRequestAt: null,
    });
    // Even though heads_up_sent_at is set on the stored row, it belongs to
    // the OLD cycle — this cycle hasn't sent anything yet.
    expect(decision.action).toBe("heads_up");
  });

  it("returns 'none' for a vehicle with no usable mileage projection", () => {
    const decision = decideNoticeAction({
      vehicle: { id: "v2", type: "truck", mi: 500, lomi: 0, oii: 3000, mil: [] },
      todayStr: TODAY,
      existingNotice: null,
      resolvingRequestAt: null,
    });
    expect(decision).toEqual({ action: "none", projectedDueDate: null });
  });
});

describe("message builders", () => {
  it("heads-up names the vehicle and the projected date", () => {
    const msg = buildHeadsUpMessage({ id: "v1", name: "Truck 12" }, "2026-02-08");
    expect(msg.body).toContain("Truck 12");
    expect(msg.body).toContain("2026-02-08");
    expect(msg.data).toEqual({ type: "oil_due", vehicleId: "v1" });
  });

  it("urgent message says URGENT and carries the escalation data type", () => {
    const msg = buildUrgentMessage({ id: "v1", name: "Truck 12" }, "2026-02-01");
    expect(msg.title).toMatch(/urgent/i);
    expect(msg.data).toEqual({ type: "oil_due_urgent", vehicleId: "v1" });
  });

  it("falls back to plate or id when the vehicle has no name", () => {
    expect(buildHeadsUpMessage({ id: "v9", plate: "ABC-123" }, "2026-02-08").body).toContain(
      "ABC-123",
    );
    expect(buildHeadsUpMessage({ id: "v9" }, "2026-02-08").body).toContain("v9");
  });
});

describe("wholeDaysSince", () => {
  it("counts whole calendar days", () => {
    expect(wholeDaysSince("2026-02-01", "2026-02-04")).toBe(3);
    expect(wholeDaysSince("2026-02-01", "2026-02-01")).toBe(0);
  });

  it("uses only the calendar day of a full timestamp", () => {
    // A request filed at 11pm is one day old the next morning, not 0.42 — and
    // 0.42 < 3 would quietly hand it a fourth day of grace.
    expect(wholeDaysSince("2026-02-01T23:30:00.000Z", "2026-02-02")).toBe(1);
  });

  it("counts across a daylight-saving change without drifting", () => {
    // 2026-03-08 springs forward, 2026-11-01 falls back. Both ends are parsed
    // in one UTC frame, so these are 7 days and not 6.96 rounding to 7 by luck.
    expect(wholeDaysSince("2026-03-05", "2026-03-12")).toBe(7);
    expect(wholeDaysSince("2026-10-29", "2026-11-05")).toBe(7);
  });

  it("never goes negative, and survives a missing date", () => {
    expect(wholeDaysSince("2026-02-10", "2026-02-01")).toBe(0);
    expect(wholeDaysSince(null, "2026-02-01")).toBe(0);
    expect(wholeDaysSince("2026-02-01", null)).toBe(0);
  });
});

// The policy: filing an oil-change request pauses escalation for
// REQUEST_GRACE_DAYS (3), after which the manager is told daily until the oil
// change is actually recorded; at REQUEST_EXPIRY_DAYS (14) the request itself
// is auto-closed and the full driver+manager escalation resumes.
describe("decideNoticeAction — a request pauses, it does not silence", () => {
  // Overdue since TODAY - 2, so there is something to escalate throughout.
  const overdueTruck = () => truckDueIn(-2, TODAY, { oii: 1800 });
  const notice = (over = {}) => ({
    cycle_lomi: 0,
    cycle_started_at: "2026-01-25T13:00:00.000Z",
    heads_up_sent_at: "2026-01-25T13:00:00.000Z",
    urgent_last_sent_at: "2026-01-30T13:00:00.000Z",
    paused_at: null,
    stall_last_sent_at: null,
    ...over,
  });
  // A request filed `n` whole days before TODAY, at 9am UTC.
  const filedDaysAgo = (n) => {
    const day = new Date(Date.parse(`${TODAY}T00:00:00.000Z`) - n * 86400000)
      .toISOString()
      .slice(0, 10);
    return `${day}T09:00:00.000Z`;
  };

  it("stays quiet on days 1, 2 and 3 of an open request", () => {
    for (const age of [0, 1, 2]) {
      const decision = decideNoticeAction({
        vehicle: overdueTruck(),
        todayStr: TODAY,
        existingNotice: notice({ paused_at: "2026-01-30T13:00:00.000Z" }),
        resolvingRequestAt: filedDaysAgo(age),
      });
      expect(decision.action, `age ${age}`).toBe("none");
    }
  });

  it("stalls on day 4, the first day past the grace window", () => {
    const decision = decideNoticeAction({
      vehicle: overdueTruck(),
      todayStr: TODAY,
      existingNotice: notice({ paused_at: "2026-01-29T13:00:00.000Z" }),
      resolvingRequestAt: filedDaysAgo(3),
    });
    expect(decision.action).toBe("stalled");
    expect(decision.daysRequestOpen).toBe(3);
    expect(decision.daysOverdue).toBe(2);
  });

  it("stalls again the next day, and the next (daily, not once)", () => {
    const decision = decideNoticeAction({
      vehicle: overdueTruck(),
      todayStr: TODAY,
      existingNotice: notice({
        paused_at: "2026-01-29T13:00:00.000Z",
        stall_last_sent_at: "2026-01-31T13:00:00.000Z", // yesterday
      }),
      resolvingRequestAt: filedDaysAgo(5),
    });
    expect(decision.action).toBe("stalled");
  });

  it("does not stall twice in the same UTC day", () => {
    const decision = decideNoticeAction({
      vehicle: overdueTruck(),
      todayStr: TODAY,
      existingNotice: notice({
        paused_at: "2026-01-29T13:00:00.000Z",
        stall_last_sent_at: `${TODAY}T13:00:00.000Z`,
      }),
      resolvingRequestAt: filedDaysAgo(5),
    });
    expect(decision.action).toBe("none");
  });

  it("reports the age needed to expire the request at the two-week mark", () => {
    const decision = decideNoticeAction({
      vehicle: overdueTruck(),
      todayStr: TODAY,
      existingNotice: notice({ paused_at: "2026-01-19T13:00:00.000Z" }),
      resolvingRequestAt: "2026-01-18T09:00:00.000Z", // 14 days before TODAY
    });
    expect(decision.action).toBe("stalled");
    expect(decision.daysRequestOpen).toBe(14);
    expect(decision.daysRequestOpen).toBeGreaterThanOrEqual(REQUEST_EXPIRY_DAYS);
  });

  it("measures the grace window from the OLDEST request, not a newer duplicate", () => {
    // The caller passes the oldest `at`. Filing a second request for the same
    // truck must not buy another three days of silence — this asserts the
    // decision escalates on the old date it was handed.
    const decision = decideNoticeAction({
      vehicle: overdueTruck(),
      todayStr: TODAY,
      existingNotice: notice({ paused_at: "2026-01-26T13:00:00.000Z" }),
      resolvingRequestAt: "2026-01-25T09:00:00.000Z",
    });
    expect(decision.action).toBe("stalled");
    expect(decision.daysRequestOpen).toBe(7);
  });

  it("ends the cycle on a recorded oil change even mid-stall", () => {
    // lomi moved, so the oil WAS changed — the open request becomes irrelevant
    // and the stall must stop regardless of how long it has been open.
    const decision = decideNoticeAction({
      vehicle: truckDueIn(20, TODAY, { lomi: 2000, oii: 2000 }),
      todayStr: TODAY,
      existingNotice: notice({
        cycle_lomi: 0,
        paused_at: "2026-01-20T13:00:00.000Z",
        stall_last_sent_at: "2026-01-31T13:00:00.000Z",
      }),
      resolvingRequestAt: "2026-01-18T09:00:00.000Z",
    });
    expect(decision.action).toBe("clear_cycle");
  });

  it("does not stall a truck that is not due yet", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(5, TODAY),
      todayStr: TODAY,
      existingNotice: notice({ heads_up_sent_at: "2026-01-30T13:00:00.000Z" }),
      resolvingRequestAt: "2026-01-01T09:00:00.000Z", // ancient, but nothing is overdue
    });
    expect(decision.action).toBe("none");
  });
});

describe("buildManagerMessage", () => {
  const truck = { id: "v1", name: "Truck 12" };

  it("tells a manager whose truck it is on the heads-up", () => {
    const msg = buildManagerMessage(truck, "2026-02-08", {
      event: "heads_up",
      driverName: "Dana Reyes",
    });
    expect(msg.title).toContain("Truck 12");
    expect(msg.body).toContain("assigned to Dana Reyes");
    expect(msg.body).toContain("2026-02-08");
    // The manager is told the driver already has it, so they don't chase it.
    expect(msg.body).toMatch(/driver has been notified/i);
    expect(msg.data.type).toBe("oil_due_manager");
  });

  it("says plainly when a truck has nobody on it", () => {
    const msg = buildManagerMessage(truck, "2026-02-08", { event: "heads_up" });
    expect(msg.body).toContain("no driver assigned");
  });

  it("leads the urgent subject with how overdue the truck is", () => {
    const msg = buildManagerMessage(truck, "2026-02-01", {
      event: "urgent",
      driverName: "Dana Reyes",
      daysOverdue: 5,
    });
    expect(msg.title).toBe("ACTION NEEDED: oil change 5 days past due — Truck 12");
    expect(msg.body).toMatch(/no maintenance request has been filed/i);
    expect(msg.body).toMatch(/no oil change has been recorded/i);
    expect(msg.data.type).toBe("oil_due_manager_urgent");
  });

  it("says 'due today' rather than '0 days past due' on the first escalation", () => {
    const msg = buildManagerMessage(truck, "2026-02-01", { event: "urgent", daysOverdue: 0 });
    expect(msg.title).toBe("ACTION NEEDED: oil change due today — Truck 12");
    expect(msg.title).not.toContain("0 days");
  });

  it("gets the singular right at one day", () => {
    const msg = buildManagerMessage(truck, "2026-02-01", { event: "urgent", daysOverdue: 1 });
    expect(msg.title).toContain("1 day past due");
    expect(msg.title).not.toContain("1 days");
  });

  it("distinguishes a stalled request from nobody-knows, in the subject", () => {
    const msg = buildManagerMessage(truck, "2026-01-28", {
      event: "stalled",
      driverName: "Dana Reyes",
      daysOverdue: 4,
      daysRequestOpen: 4,
    });
    expect(msg.title).toBe(
      "ACTION NEEDED: oil change request stalled — Truck 12 " +
        "(4 days past due, request filed but no oil change recorded)",
    );
    expect(msg.body).toContain("open 4 days");
    expect(msg.body).toContain("assigned to Dana Reyes");
    expect(msg.data.type).toBe("oil_due_manager_stalled");
    // Not yet expired, so it must not claim to have closed anything.
    expect(msg.body).not.toMatch(/auto-closed/i);
  });

  it("says so when the stall notice is also the auto-close", () => {
    const msg = buildManagerMessage(truck, "2026-01-18", {
      event: "stalled",
      daysOverdue: 14,
      daysRequestOpen: 14,
      expired: true,
    });
    expect(msg.body).toMatch(/auto-closed as expired/i);
    expect(msg.body).toMatch(/driver included/i);
  });

  it("falls back to plate or id like the driver messages do", () => {
    expect(buildManagerMessage({ id: "v9", plate: "ABC-123" }, "2026-02-08", {}).title).toContain(
      "ABC-123",
    );
    expect(buildManagerMessage({ id: "v9" }, "2026-02-08", {}).title).toContain("v9");
  });
});
