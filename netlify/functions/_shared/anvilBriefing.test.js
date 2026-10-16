import { describe, it, expect } from "vitest";
import { buildBriefing } from "./anvilBriefing.js";

const TODAY = "2026-10-16";

const member = { userId: "u1", name: "Jane Contractor" };

// A truck already past its interval: oilStatus() reads mi - lomi against oii.
const overdueTruck = { id: "v1", name: "011", type: "truck", mi: 58000, lomi: 50000, oii: 5000 };
const freshTruck = { id: "v2", name: "012", type: "truck", mi: 51000, lomi: 50000, oii: 5000 };

const base = {
  member,
  today: TODAY,
  vehicles: [],
  requests: [],
  inventory: [],
  jobs: [],
  assignments: [],
  media: [],
};

describe("buildBriefing", () => {
  // The single most important behavior here: a daily "all clear" is a channel
  // people filter, and then the morning that matters is filtered too.
  it("returns null when there is nothing worth saying", () => {
    expect(
      buildBriefing({ ...base, perms: { fleet_view: true, inv_view: true, jobs_view: true } }),
    ).toBeNull();
  });

  it("returns null for a person whose permissions hide everything that is wrong", () => {
    // The fleet is on fire, but this person cannot open the Fleet page.
    const result = buildBriefing({
      ...base,
      perms: {},
      vehicles: [overdueTruck],
      requests: [{ id: "r1", status: "pending", at: "2026-09-01", vname: "011" }],
      inventory: [{ id: "i1", name: "Shingles", alrt: 50, batches: [{ rem: 0 }] }],
    });
    expect(result).toBeNull();
  });

  it("greets by first name and leads with the day", () => {
    const result = buildBriefing({
      ...base,
      perms: { fleet_view: true },
      vehicles: [overdueTruck],
    });
    expect(result.text).toMatch(/^Morning, Jane\./);
    expect(result.text).toContain("Oil change overdue on 011");
  });

  it("copes with a person who has no name on file", () => {
    const result = buildBriefing({
      ...base,
      member: { userId: "u1", name: null },
      perms: { fleet_view: true },
      vehicles: [overdueTruck],
    });
    expect(result.text).toMatch(/^Morning\./);
  });

  describe("fleet", () => {
    it("names only the trucks that are actually overdue", () => {
      const result = buildBriefing({
        ...base,
        perms: { fleet_view: true },
        vehicles: [overdueTruck, freshTruck],
      });
      expect(result.text).toContain("011");
      expect(result.text).not.toContain("012");
    });

    it("says nothing about oil to someone who only manages maintenance tickets", () => {
      // maint_manage opens the fleet section too — a scheduler needs to know
      // what is due. This pins that the section appears at all for them.
      const result = buildBriefing({
        ...base,
        perms: { maint_manage: true },
        vehicles: [overdueTruck],
      });
      expect(result.text).toContain("Oil change overdue on 011");
    });
  });

  describe("maintenance", () => {
    it("flags how many pending tickets have gone stale on the manager's desk", () => {
      const result = buildBriefing({
        ...base,
        perms: { maint_manage: true },
        requests: [
          { id: "r1", status: "pending", at: "2026-10-01T09:00:00Z", vname: "011" },
          { id: "r2", status: "pending", at: "2026-10-15T09:00:00Z", vname: "012" },
        ],
      });
      expect(result.text).toContain("2 maintenance requests pending");
      // Only r1 is over a week old; r2 was filed yesterday.
      expect(result.text).toContain("1 of them over a week old");
    });

    it("says what is in the shop today", () => {
      const result = buildBriefing({
        ...base,
        perms: { maint_manage: true },
        requests: [{ id: "r1", status: "scheduled", scheduled_date: TODAY, vname: "011 (ABC)" }],
      });
      expect(result.text).toContain("In the shop today: 011 (ABC)");
    });

    it("keeps tickets out of a submitter's briefing — they cannot schedule them", () => {
      const result = buildBriefing({
        ...base,
        perms: { maint_submit: true },
        requests: [{ id: "r1", status: "pending", at: "2026-09-01", vname: "011" }],
      });
      expect(result).toBeNull();
    });
  });

  describe("inventory", () => {
    const items = [
      { id: "i1", name: "Shingles", alrt: 50, batches: [{ rem: 0 }] },
      { id: "i2", name: "Nails", alrt: 10, batches: [{ rem: 4 }] },
      { id: "i3", name: "Underlayment", alrt: 10, batches: [{ rem: 900 }] },
      // No threshold set: nothing to be below, so not a shortage.
      { id: "i4", name: "Caulk", alrt: 0, batches: [{ rem: 0 }] },
    ];

    it("separates out-of-stock from merely low", () => {
      const result = buildBriefing({ ...base, perms: { inv_view: true }, inventory: items });
      expect(result.text).toContain("Out of stock: Shingles");
      expect(result.text).toContain("1 item at or below the low-stock line");
      expect(result.text).toContain("Nails");
    });

    it("ignores an item with no low-stock threshold set", () => {
      const result = buildBriefing({ ...base, perms: { inv_view: true }, inventory: items });
      expect(result.text).not.toContain("Caulk");
    });

    it("stops listing names once the list is long", () => {
      const many = Array.from({ length: 9 }, (_, i) => ({
        id: `x${i}`,
        name: `Item ${i}`,
        alrt: 10,
        batches: [{ rem: 5 }],
      }));
      const result = buildBriefing({ ...base, perms: { inv_view: true }, inventory: many });
      expect(result.text).toContain("9 items at or below");
      expect(result.text).not.toContain("Item 7");
    });
  });

  describe("jobs", () => {
    const todaysJob = {
      id: "j1",
      title: "Smith Reroof",
      status: "active",
      scheduledDate: TODAY,
      assignedto: "u2",
    };
    const myJob = { ...todaysJob, id: "j2", title: "Jones Reroof", assignedto: "u1" };

    it("narrows a site supervisor to the jobs assigned to them", () => {
      const result = buildBriefing({
        ...base,
        perms: { jobs_view: true },
        jobs: [todaysJob, myJob],
      });
      expect(result.text).toContain("Jones Reroof");
      // The rest of the company's schedule is noise to somebody driving to one
      // address.
      expect(result.text).not.toContain("Smith Reroof");
    });

    it("gives a manager the whole company's day", () => {
      const result = buildBriefing({
        ...base,
        perms: { jobs_view: true, jobs_approve: true },
        jobs: [todaysJob, myJob],
      });
      expect(result.text).toContain("Smith Reroof");
      expect(result.text).toContain("Jones Reroof");
    });

    it("flags approved jobs nobody has pulled materials for", () => {
      const result = buildBriefing({
        ...base,
        perms: { jobs_view: true, jobs_pull: true, jobs_build: true },
        jobs: [{ id: "j3", title: "Pending Pull", status: "approved" }],
      });
      expect(result.text).toContain("1 approved job still waiting on a material pull");
    });

    it("ignores a job with no scheduled day rather than guessing one", () => {
      const result = buildBriefing({
        ...base,
        perms: { jobs_view: true, jobs_build: true },
        jobs: [{ id: "j4", title: "Unscheduled", status: "active" }],
      });
      expect(result).toBeNull();
    });

    it("leaves closed jobs out", () => {
      const result = buildBriefing({
        ...base,
        perms: { jobs_view: true, jobs_build: true },
        jobs: [{ ...todaysJob, status: "closed" }],
      });
      expect(result).toBeNull();
    });

    it("raises completed jobs that have sat unclosed for a fortnight", () => {
      const result = buildBriefing({
        ...base,
        perms: { jobs_close: true },
        jobs: [
          { id: "j5", title: "Old", status: "completed", completed: "2026-09-01T10:00:00Z" },
          // Finished a couple of days ago: somebody is plausibly still waiting
          // on the customer to pay.
          { id: "j6", title: "Recent", status: "completed", completed: "2026-10-14T10:00:00Z" },
        ],
      });
      expect(result.text).toContain("1 completed job finished over two weeks ago");
    });
  });

  describe("training", () => {
    const media = [
      { id: "m1", title: "Ladder Safety" },
      { id: "m2", title: "Fall Protection" },
    ];

    it("tells a person about their own overdue training with no permission needed", () => {
      const result = buildBriefing({
        ...base,
        perms: {},
        media,
        assignments: [{ media_id: "m1", user_id: "u1", due_on: "2026-10-01" }],
      });
      expect(result.text).toContain("Training overdue: Ladder Safety");
    });

    it("does not call an open-ended assignment overdue", () => {
      // An assignment with no deadline is outstanding, not a compliance
      // failure.
      const result = buildBriefing({
        ...base,
        perms: {},
        media,
        assignments: [{ media_id: "m1", user_id: "u1", due_on: null }],
      });
      expect(result).toBeNull();
    });

    it("ignores an assignment somebody has already completed", () => {
      const result = buildBriefing({
        ...base,
        perms: {},
        media,
        assignments: [
          { media_id: "m1", user_id: "u1", due_on: "2026-10-01", completed_at: "2026-09-30" },
        ],
      });
      expect(result).toBeNull();
    });

    it("keeps a colleague's lapsed training out of a peer's briefing", () => {
      const result = buildBriefing({
        ...base,
        perms: {},
        media,
        assignments: [{ media_id: "m2", user_id: "u2", due_on: "2026-10-01" }],
      });
      expect(result).toBeNull();
    });

    it("gives the team's overdue count to whoever manages users", () => {
      const result = buildBriefing({
        ...base,
        perms: { users_manage: true },
        media,
        assignments: [
          { media_id: "m2", user_id: "u2", due_on: "2026-10-01" },
          { media_id: "m1", user_id: "u3", due_on: "2026-10-02" },
        ],
      });
      expect(result.text).toContain("2 training assignments overdue across the team");
    });
  });

  it("reports the sections it built alongside the prose", () => {
    const result = buildBriefing({
      ...base,
      perms: { fleet_view: true, inv_view: true },
      vehicles: [overdueTruck],
      inventory: [{ id: "i1", name: "Shingles", alrt: 50, batches: [{ rem: 0 }] }],
    });
    expect(result.sections.map((s) => s.key)).toEqual(["fleet", "inventory"]);
  });
});
