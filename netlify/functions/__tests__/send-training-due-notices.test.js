import { describe, it, expect } from "vitest";
import {
  decideTrainingNotice,
  parseDueDay,
  isSameUtcDay,
  buildHeadsUpMessage,
  buildOverdueMessage,
} from "../send-training-due-notices.js";

const TODAY = "2026-10-06";

// An assignment due `daysOut` days after TODAY, unfinished and unnotified.
const dueIn = (daysOut, over = {}) => {
  const due = new Date(Date.UTC(2026, 9, 6 + daysOut)).toISOString().slice(0, 10);
  return {
    id: "a1",
    media_id: "m1",
    user_id: "u1",
    due_on: due,
    completed_at: null,
    heads_up_sent_at: null,
    overdue_last_sent_at: null,
    ...over,
  };
};

describe("parseDueDay", () => {
  it("reads a DATE column as UTC midnight", () => {
    expect(parseDueDay("2026-10-06").toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });

  it("tolerates a full timestamp and rejects junk", () => {
    expect(parseDueDay("2026-10-06T12:30:00Z").toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(parseDueDay("nope")).toBeNull();
    expect(parseDueDay(null)).toBeNull();
  });
});

describe("isSameUtcDay", () => {
  it("matches only the same calendar day", () => {
    expect(isSameUtcDay("2026-10-06T23:59:00Z", TODAY)).toBe(true);
    expect(isSameUtcDay("2026-10-05T23:59:00Z", TODAY)).toBe(false);
    expect(isSameUtcDay(null, TODAY)).toBe(false);
  });
});

describe("decideTrainingNotice", () => {
  it("says nothing for an assignment with no deadline", () => {
    // The whole reason due_on is nullable. "Watch this when you get a minute"
    // must never become a nightly nudge, or every optional clip is urgent.
    expect(decideTrainingNotice({ assignment: dueIn(2, { due_on: null }), todayStr: TODAY })).toBe(
      "none",
    );
  });

  it("says nothing once it has been watched, however late", () => {
    const watchedLate = dueIn(-30, { completed_at: "2026-10-05T10:00:00Z" });
    expect(decideTrainingNotice({ assignment: watchedLate, todayStr: TODAY })).toBe("none");
  });

  it("stays quiet while the deadline is still far off", () => {
    expect(decideTrainingNotice({ assignment: dueIn(4), todayStr: TODAY })).toBe("none");
    expect(decideTrainingNotice({ assignment: dueIn(30), todayStr: TODAY })).toBe("none");
  });

  it("sends the heads-up anywhere inside the window, including the due day", () => {
    // A range, not an equality. An assignment created two days before its
    // deadline would never equal exactly 3 and would go straight to overdue
    // with no warning at all — which is the bug this case exists for.
    expect(decideTrainingNotice({ assignment: dueIn(3), todayStr: TODAY })).toBe("heads_up");
    expect(decideTrainingNotice({ assignment: dueIn(2), todayStr: TODAY })).toBe("heads_up");
    expect(decideTrainingNotice({ assignment: dueIn(1), todayStr: TODAY })).toBe("heads_up");
    expect(decideTrainingNotice({ assignment: dueIn(0), todayStr: TODAY })).toBe("heads_up");
  });

  it("sends the heads-up once, ever", () => {
    const already = dueIn(2, { heads_up_sent_at: "2026-10-04T13:00:00Z" });
    expect(decideTrainingNotice({ assignment: already, todayStr: TODAY })).toBe("none");
  });

  it("nudges once a day while overdue", () => {
    expect(decideTrainingNotice({ assignment: dueIn(-1), todayStr: TODAY })).toBe("overdue");

    const sentToday = dueIn(-1, { overdue_last_sent_at: "2026-10-06T13:00:00Z" });
    expect(decideTrainingNotice({ assignment: sentToday, todayStr: TODAY })).toBe("none");

    const sentYesterday = dueIn(-1, { overdue_last_sent_at: "2026-10-05T13:00:00Z" });
    expect(decideTrainingNotice({ assignment: sentYesterday, todayStr: TODAY })).toBe("overdue");
  });

  it("still nudges an overdue row that never got its heads-up", () => {
    // Assigned the day it was due, or assigned retroactively: the heads-up
    // window was never open, and that must not suppress the overdue nudge.
    const neverWarned = dueIn(-5, { heads_up_sent_at: null });
    expect(decideTrainingNotice({ assignment: neverWarned, todayStr: TODAY })).toBe("overdue");
  });

  it("is safe on a missing assignment", () => {
    expect(decideTrainingNotice({ assignment: null, todayStr: TODAY })).toBe("none");
  });
});

describe("message builders", () => {
  it("names the clip when there is only one", () => {
    const m = buildHeadsUpMessage(["Ladder Safety"], "2026-10-09");
    expect(m.title).toBe("Training due soon");
    expect(m.body).toContain("Ladder Safety");
    expect(m.body).toContain("2026-10-09");
    expect(m.data.type).toBe("training_due_soon");
  });

  it("counts and lists them when there are several", () => {
    // Grouped per person on purpose: five clips assigned with one deadline must
    // be one notice, not five emails on the same morning.
    const m = buildHeadsUpMessage(["A", "B", "C"], "2026-10-09");
    expect(m.title).toBe("3 training clips due soon");
    expect(m.body).toContain("A, B, C");
  });

  it("phrases the overdue notice in the past tense, singular and plural", () => {
    expect(buildOverdueMessage(["Ladder Safety"], "2026-10-01").body).toContain("was due");
    expect(buildOverdueMessage(["A", "B"], "2026-10-01").body).toContain("are past their due date");
    expect(buildOverdueMessage(["A", "B"], "2026-10-01").title).toBe("2 training clips overdue");
  });

  it("tags each kind for the push payload", () => {
    expect(buildOverdueMessage(["A"], "2026-10-01").data.type).toBe("training_overdue");
  });
});
