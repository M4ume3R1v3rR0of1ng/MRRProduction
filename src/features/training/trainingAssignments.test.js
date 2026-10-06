import { describe, it, expect } from "vitest";
import {
  daysUntilDue,
  assignmentStatus,
  dueDescriptor,
  formatDue,
  assignmentRows,
  outstandingFor,
  rosterFor,
  assignableUsers,
  roleShortcuts,
  alreadyAssigned,
  DUE_SOON_DAYS,
} from "./trainingAssignments";
import { translations } from "@/shared/utils/translations";

// A fixed "today" so none of this depends on when the suite runs.
const TODAY = "2026-10-06";
const a = (over = {}) => ({
  id: "a1",
  media_id: "m1",
  user_id: "u1",
  due_on: null,
  completed_at: null,
  assigned_at: "2026-10-01T12:00:00Z",
  ...over,
});

describe("daysUntilDue", () => {
  it("counts whole days forward and backward", () => {
    expect(daysUntilDue("2026-10-09", TODAY)).toBe(3);
    expect(daysUntilDue("2026-10-06", TODAY)).toBe(0);
    expect(daysUntilDue("2026-10-04", TODAY)).toBe(-2);
  });

  it("distinguishes no deadline from due today", () => {
    // Both would be falsy as numbers, which is exactly the bug this guards.
    expect(daysUntilDue(null, TODAY)).toBeNull();
    expect(daysUntilDue("2026-10-06", TODAY)).toBe(0);
  });

  it("crosses a month boundary without drifting", () => {
    expect(daysUntilDue("2026-11-01", "2026-10-30")).toBe(2);
  });

  it("returns null on junk rather than NaN", () => {
    expect(daysUntilDue("not-a-date", TODAY)).toBeNull();
  });
});

describe("assignmentStatus", () => {
  it("treats an undated assignment as open, never overdue", () => {
    expect(assignmentStatus(a(), TODAY)).toBe("open");
  });

  it("flags a past deadline as overdue", () => {
    expect(assignmentStatus(a({ due_on: "2026-10-05" }), TODAY)).toBe("overdue");
  });

  it("warns inside the due-soon window and not outside it", () => {
    expect(assignmentStatus(a({ due_on: "2026-10-06" }), TODAY)).toBe("due-soon");
    expect(assignmentStatus(a({ due_on: "2026-10-09" }), TODAY)).toBe("due-soon");
    expect(assignmentStatus(a({ due_on: "2026-10-10" }), TODAY)).toBe("open");
    expect(DUE_SOON_DAYS).toBe(3);
  });

  it("counts a late finish as watched, not as overdue", () => {
    // Someone who finished after the deadline has still finished. Showing them
    // "overdue" afterwards is a reprimand, not information.
    const late = a({ due_on: "2026-09-01", completed_at: "2026-10-05T09:00:00Z" });
    expect(assignmentStatus(late, TODAY)).toBe("watched");
  });
});

describe("dueDescriptor", () => {
  it("classifies each side of the deadline without naming a language", () => {
    // The words live in translations.js; this only decides which one and how
    // many. The app ships Spanish too.
    expect(dueDescriptor(a({ due_on: "2026-10-06" }), TODAY)).toEqual({ key: "today", n: 0 });
    expect(dueDescriptor(a({ due_on: "2026-10-07" }), TODAY)).toEqual({ key: "tomorrow", n: 1 });
    expect(dueDescriptor(a({ due_on: "2026-10-11" }), TODAY)).toEqual({ key: "days", n: 5 });
    expect(dueDescriptor(a({ due_on: "2026-10-05" }), TODAY)).toEqual({ key: "overdue", n: 1 });
    expect(dueDescriptor(a({ due_on: "2026-10-01" }), TODAY)).toEqual({ key: "overdue", n: 5 });
  });

  it("always reports n as a positive count, direction being in the key", () => {
    expect(dueDescriptor(a({ due_on: "2026-09-01" }), TODAY).n).toBeGreaterThan(0);
  });

  it("says nothing for an undated or finished assignment", () => {
    expect(dueDescriptor(a(), TODAY)).toBeNull();
    expect(dueDescriptor(a({ due_on: "2026-10-01", completed_at: "x" }), TODAY)).toBeNull();
  });
});

describe("formatDue", () => {
  // The real dictionaries, so a renamed or missing key fails here rather than
  // rendering "undefined" inside a badge in a language nobody on the team reads.
  const en = translations.en;
  const es = translations.es;

  it("renders every branch in English", () => {
    expect(formatDue({ key: "today", n: 0 }, en)).toBe("Due today");
    expect(formatDue({ key: "tomorrow", n: 1 }, en)).toBe("Due tomorrow");
    expect(formatDue({ key: "days", n: 5 }, en)).toBe("Due in 5 days");
    expect(formatDue({ key: "overdue", n: 1 }, en)).toBe("Overdue by 1 day");
    expect(formatDue({ key: "overdue", n: 3 }, en)).toBe("Overdue by 3 days");
  });

  it("renders every branch in Spanish, with its own singular", () => {
    expect(formatDue({ key: "today", n: 0 }, es)).toBe("Vence hoy");
    expect(formatDue({ key: "overdue", n: 1 }, es)).toBe("Vencido hace 1 día");
    expect(formatDue({ key: "overdue", n: 4 }, es)).toBe("Vencido hace 4 días");
  });

  it("substitutes the count rather than leaving the placeholder", () => {
    for (const dict of [en, es]) {
      expect(formatDue({ key: "days", n: 9 }, dict)).not.toMatch(/\{n\}/);
      expect(formatDue({ key: "overdue", n: 9 }, dict)).not.toMatch(/\{n\}/);
      expect(formatDue({ key: "days", n: 9 }, dict)).toContain("9");
    }
  });

  it("says nothing when there is no descriptor", () => {
    expect(formatDue(null, en)).toBeNull();
  });
});

describe("assignmentRows", () => {
  const user = { id: "admin1", name: "Sam Kabangu", email: "sam@example.com" };

  it("builds one row per person and never sends company_id", () => {
    const rows = assignmentRows({ mediaId: "m1", userIds: ["u1", "u2"], user });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      media_id: "m1",
      user_id: "u1",
      due_on: null,
      assigned_by: "admin1",
      assigned_by_name: "Sam Kabangu",
    });
    // company_id is the column default (active_company_id()); sending it from
    // the client is how a tenant boundary gets crossed by accident.
    expect(rows[0]).not.toHaveProperty("company_id");
  });

  it("de-duplicates, because the role shortcuts overlap the manual ticks", () => {
    const rows = assignmentRows({ mediaId: "m1", userIds: ["u1", "u2", "u1", null], user });
    expect(rows.map((r) => r.user_id)).toEqual(["u1", "u2"]);
  });

  it("turns an untouched date input into null rather than an invalid date", () => {
    expect(
      assignmentRows({ mediaId: "m1", userIds: ["u1"], dueOn: "", user })[0].due_on,
    ).toBeNull();
    expect(
      assignmentRows({ mediaId: "m1", userIds: ["u1"], dueOn: "2026-10-09", user })[0].due_on,
    ).toBe("2026-10-09");
  });

  it("falls back through the name fields for the denormalised assigner", () => {
    expect(
      assignmentRows({ mediaId: "m1", userIds: ["u1"], user: { id: "x", email: "e@x.com" } })[0]
        .assigned_by_name,
    ).toBe("e@x.com");
  });

  it("refuses to build rows with no clip", () => {
    expect(() => assignmentRows({ userIds: ["u1"], user })).toThrow(/mediaId/);
  });
});

describe("outstandingFor", () => {
  it("returns only that person's unfinished rows", () => {
    const all = [
      a({ id: "1", user_id: "u1" }),
      a({ id: "2", user_id: "u2" }),
      a({ id: "3", user_id: "u1", completed_at: "2026-10-02T00:00:00Z" }),
    ];
    expect(outstandingFor("u1", all, TODAY).map((x) => x.id)).toEqual(["1"]);
  });

  it("puts overdue first, then due-soon, then dated, with undated last", () => {
    // "later" and "undated" are both status open, so the tiebreaker decides:
    // a deadline two months out still arrives, "no deadline" never does, so
    // the dated row leads.
    const all = [
      a({ id: "undated" }),
      a({ id: "soon", due_on: "2026-10-07" }),
      a({ id: "overdue", due_on: "2026-10-01" }),
      a({ id: "later", due_on: "2026-12-01" }),
    ];
    expect(outstandingFor("u1", all, TODAY).map((x) => x.id)).toEqual([
      "overdue",
      "soon",
      "later",
      "undated",
    ]);
  });

  it("orders by deadline inside the overdue bucket, worst first", () => {
    const all = [
      a({ id: "late1", due_on: "2026-10-05" }),
      a({ id: "late2", due_on: "2026-09-20" }),
    ];
    expect(outstandingFor("u1", all, TODAY).map((x) => x.id)).toEqual(["late2", "late1"]);
  });
});

describe("rosterFor", () => {
  const users = [
    { id: "u1", name: "Mike", active: true },
    { id: "u2", name: "Dana", active: true },
  ];

  it("splits watched from outstanding and counts them", () => {
    const all = [
      a({ id: "1", user_id: "u1", completed_at: "2026-10-02T00:00:00Z" }),
      a({ id: "2", user_id: "u2" }),
      a({ id: "3", user_id: "u1", media_id: "other" }),
    ];
    const r = rosterFor("m1", all, users);
    expect(r.total).toBe(2);
    expect(r.watchedCount).toBe(1);
    expect(r.watched[0].person.name).toBe("Mike");
    expect(r.outstanding[0].person.name).toBe("Dana");
  });

  it("keeps an assignment whose person has since been deactivated", () => {
    // Dropping them would quietly turn "1 of 2" into "1 of 1" and hide that
    // somebody left mid-assignment.
    const all = [a({ id: "1", user_id: "gone" })];
    const r = rosterFor("m1", all, users);
    expect(r.total).toBe(1);
    expect(r.outstanding[0].person).toBeNull();
  });

  it("counts the overdue subset of the outstanding", () => {
    const all = [
      a({ id: "1", user_id: "u1", due_on: "1999-01-01" }),
      a({ id: "2", user_id: "u2" }),
    ];
    expect(rosterFor("m1", all, users).overdueCount).toBe(1);
  });
});

describe("assignableUsers", () => {
  it("drops deactivated members and visiting platform admins", () => {
    const users = [
      { id: "u1", name: "Mike", active: true },
      { id: "u2", name: "Gone", active: false },
      { id: "u3", name: "Owner", active: true, isPlatformAdmin: true },
    ];
    expect(assignableUsers(users).map((u) => u.id)).toEqual(["u1"]);
  });

  it("sorts by the name the picker actually shows", () => {
    const users = [
      { id: "u1", name: "Zoe" },
      { id: "u2", email: "aaron@x.com" },
      { id: "u3", full_name: "Mike" },
    ];
    expect(assignableUsers(users).map((u) => u.id)).toEqual(["u2", "u3", "u1"]);
  });
});

describe("roleShortcuts", () => {
  it("groups assignable members by role and omits empty roles", () => {
    const users = [
      { id: "u1", name: "A", role: "field" },
      { id: "u2", name: "B", role: "field" },
      { id: "u3", name: "C", role: "warehouse" },
      { id: "u4", name: "D", role: "field", active: false },
    ];
    const shortcuts = roleShortcuts(users);
    expect(shortcuts.find((s) => s.role === "field").userIds).toEqual(["u1", "u2"]);
    expect(shortcuts.find((s) => s.role === "warehouse").userIds).toEqual(["u3"]);
    expect(shortcuts.some((s) => s.role === "admin")).toBe(false);
  });

  it("files a member with no role under employee rather than dropping them", () => {
    expect(roleShortcuts([{ id: "u1", name: "A" }])[0]).toEqual({
      role: "employee",
      userIds: ["u1"],
    });
  });
});

describe("alreadyAssigned", () => {
  it("names the people who would collide with the unique constraint", () => {
    const all = [a({ user_id: "u1" }), a({ user_id: "u2", media_id: "other" })];
    const set = alreadyAssigned("m1", all);
    expect(set.has("u1")).toBe(true);
    expect(set.has("u2")).toBe(false);
  });
});
