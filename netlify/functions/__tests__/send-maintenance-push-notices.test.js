import { describe, it, expect } from "vitest";
import {
  decideNoticeAction,
  isSameUtcDay,
  buildHeadsUpMessage,
  buildUrgentMessage,
  buildManagerMessage,
  daysOverdueOn,
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
      hasResolvingRequest: false,
    });
    expect(decision.action).toBe("heads_up");
    expect(decision.projectedDueDate).toBe("2026-02-08");
  });

  it("still catches the heads-up window if the job skipped the exact 7-day day", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(3, TODAY),
      todayStr: TODAY,
      existingNotice: null,
      hasResolvingRequest: false,
    });
    expect(decision.action).toBe("heads_up");
  });

  it("does nothing more than 7 days out", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(10, TODAY),
      todayStr: TODAY,
      existingNotice: null,
      hasResolvingRequest: false,
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
        resolved_at: null,
      },
      hasResolvingRequest: false,
    });
    expect(decision.action).toBe("none");
  });

  it("fires urgent on the due date with nothing sent yet", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(0, TODAY),
      todayStr: TODAY,
      existingNotice: null,
      hasResolvingRequest: false,
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
        resolved_at: null,
      },
      hasResolvingRequest: false,
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
        resolved_at: null,
      },
      hasResolvingRequest: false,
    });
    expect(decision.action).toBe("none");
  });

  it("resolves an unresolved cycle once a matching request shows up", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(0, TODAY),
      todayStr: TODAY,
      existingNotice: {
        cycle_lomi: 0,
        cycle_started_at: "2026-01-29T00:00:00.000Z",
        heads_up_sent_at: "2026-01-25T00:00:00.000Z",
        urgent_last_sent_at: `${TODAY}T09:00:00.000Z`,
        resolved_at: null,
      },
      hasResolvingRequest: true,
    });
    expect(decision.action).toBe("resolve");
  });

  it("stays quiet once a cycle is already resolved, even if still overdue", () => {
    const decision = decideNoticeAction({
      vehicle: truckDueIn(0, TODAY),
      todayStr: TODAY,
      existingNotice: {
        cycle_lomi: 0,
        cycle_started_at: "2026-01-29T00:00:00.000Z",
        heads_up_sent_at: "2026-01-25T00:00:00.000Z",
        urgent_last_sent_at: "2026-01-31T00:00:00.000Z",
        resolved_at: "2026-01-31T12:00:00.000Z",
      },
      hasResolvingRequest: false,
    });
    expect(decision.action).toBe("none");
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
        resolved_at: null,
      },
      hasResolvingRequest: false,
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
        resolved_at: null,
      },
      hasResolvingRequest: false,
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
      hasResolvingRequest: false,
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

describe("daysOverdueOn", () => {
  it("counts whole calendar days past the projected date", () => {
    expect(daysOverdueOn("2026-02-01", "2026-02-04")).toBe(3);
    expect(daysOverdueOn("2026-02-01", "2026-02-01")).toBe(0);
  });

  it("counts across a daylight-saving change without drifting", () => {
    // 2026-03-08 springs forward. Both ends are parsed in one UTC frame, so
    // this is 7 days and not 6.96 rounding its way to 7 by luck.
    expect(daysOverdueOn("2026-03-05", "2026-03-12")).toBe(7);
    expect(daysOverdueOn("2026-10-29", "2026-11-05")).toBe(7);
  });

  it("never goes negative, and survives a missing date", () => {
    expect(daysOverdueOn("2026-02-10", "2026-02-01")).toBe(0);
    expect(daysOverdueOn(null, "2026-02-01")).toBe(0);
    expect(daysOverdueOn("2026-02-01", null)).toBe(0);
  });
});

describe("buildManagerMessage", () => {
  const truck = { id: "v1", name: "Truck 12" };

  it("tells a manager whose truck it is on the heads-up", () => {
    const msg = buildManagerMessage(truck, "2026-02-08", {
      urgent: false,
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
    const msg = buildManagerMessage(truck, "2026-02-08", { urgent: false });
    expect(msg.body).toContain("no driver assigned");
  });

  it("leads the urgent subject with how overdue the truck is", () => {
    const msg = buildManagerMessage(truck, "2026-02-01", {
      urgent: true,
      driverName: "Dana Reyes",
      daysOverdue: 5,
    });
    expect(msg.title).toBe("ACTION NEEDED: oil change 5 days overdue — Truck 12");
    expect(msg.body).toMatch(/no maintenance request has been filed/i);
    expect(msg.body).toMatch(/no oil change has been recorded/i);
    expect(msg.data.type).toBe("oil_due_manager_urgent");
  });

  it("says 'due today' rather than '0 days overdue' on the first urgent notice", () => {
    const msg = buildManagerMessage(truck, "2026-02-01", { urgent: true, daysOverdue: 0 });
    expect(msg.title).toBe("ACTION NEEDED: oil change due today — Truck 12");
    expect(msg.title).not.toContain("0 days");
  });

  it("gets the singular right at one day", () => {
    const msg = buildManagerMessage(truck, "2026-02-01", { urgent: true, daysOverdue: 1 });
    expect(msg.title).toContain("1 day overdue");
    expect(msg.title).not.toContain("1 days");
  });

  it("falls back to plate or id like the driver messages do", () => {
    expect(buildManagerMessage({ id: "v9", plate: "ABC-123" }, "2026-02-08", {}).title).toContain(
      "ABC-123",
    );
    expect(buildManagerMessage({ id: "v9" }, "2026-02-08", {}).title).toContain("v9");
  });
});
