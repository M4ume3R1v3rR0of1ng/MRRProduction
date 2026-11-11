import { describe, it, expect } from "vitest";
import { buildRecap } from "./anvilRecap.js";

const TODAY = "2026-11-11"; // a Wednesday
const TOMORROW = "2026-11-12";
const boss = { jobs_view: true, jobs_approve: true, jobs_pull: true, maint_manage: true };
const crew = { jobs_view: true };
const me = { userId: "u1", name: "Sam Schwartz" };

const job = (over = {}) => ({
  id: "j1",
  title: "Smith roof",
  status: "scheduled",
  scheduledDate: TODAY,
  assignedto: "u1",
  ...over,
});

const recap = (input) =>
  buildRecap({ member: me, perms: boss, today: TODAY, tomorrow: TOMORROW, ...input });

describe("buildRecap", () => {
  it("is silent when nothing happened and nothing is coming", () => {
    expect(recap({})).toBeNull();
  });

  it("lists what was finished today", () => {
    const r = recap({
      jobs: [
        job({ status: "completed", completedAt: "2026-11-11T19:00:00Z", title: "Smith roof" }),
      ],
    });
    expect(r.text).toContain("Done today");
    expect(r.text).toContain("Smith roof");
  });

  it("counts a job finished late in the evening as today, even after UTC has rolled over", () => {
    const r = recap({
      jobs: [job({ status: "completed", completedAt: "2026-11-12T01:30:00Z", title: "Late one" })],
    });
    expect(r.text).toContain("Late one");
  });

  it("does not list a job finished on another day", () => {
    const r = recap({
      jobs: [
        job({ status: "completed", completedAt: "2026-11-10T19:00:00Z", title: "Yesterday's" }),
      ],
    });
    expect(r).toBeNull();
  });

  it("flags a job scheduled for today that was not finished", () => {
    const r = recap({ jobs: [job({ title: "Jones gutters" })] });
    expect(r.text).toContain("Didn't get done");
    expect(r.text).toContain("Jones gutters");
  });

  it("does not call a finished or closed job a slip", () => {
    const r = recap({
      jobs: [
        job({ id: "a", status: "completed", completedAt: "2026-11-11T18:00:00Z" }),
        job({ id: "b", status: "closed", scheduledDate: TODAY }),
      ],
    });
    expect(r.text).not.toContain("Didn't get done");
  });

  it("lists what is on for tomorrow, and which of it still needs a material pull", () => {
    const r = recap({
      jobs: [
        job({ id: "a", scheduledDate: TOMORROW, status: "approved", title: "Lee roof" }),
        job({ id: "b", scheduledDate: TOMORROW, status: "scheduled", title: "Kim siding" }),
      ],
    });
    expect(r.text).toContain("Tomorrow");
    expect(r.text).toContain("Lee roof");
    expect(r.text).toContain("Kim siding");
    expect(r.text).toContain("1 of them still needs a material pull");
  });

  it("calls the next working day by name when it is not tomorrow", () => {
    const r = buildRecap({
      member: me,
      perms: boss,
      today: "2026-11-13",
      tomorrow: "2026-11-16",
      jobs: [job({ scheduledDate: "2026-11-16", title: "Monday job" })],
    });
    expect(r.text).toContain("Monday");
    expect(r.text).not.toContain("Tomorrow");
  });

  it("narrows a crew member to their own jobs", () => {
    const r = buildRecap({
      member: me,
      perms: crew,
      today: TODAY,
      tomorrow: TOMORROW,
      jobs: [
        job({ id: "a", title: "Mine", assignedto: "u1" }),
        job({ id: "b", title: "Someone else's", assignedto: "u2" }),
      ],
    });
    expect(r.text).toContain("Mine");
    expect(r.text).not.toContain("Someone else's");
  });

  it("shows no job lines to someone who cannot view jobs", () => {
    expect(
      buildRecap({ member: me, perms: {}, today: TODAY, tomorrow: TOMORROW, jobs: [job()] }),
    ).toBeNull();
  });

  it("covers the shop: done today, slipped, and tomorrow", () => {
    const r = recap({
      requests: [
        { id: 1, vname: "Truck 4", status: "completed", completed_at: "2026-11-11T20:00:00Z" },
        { id: 2, vname: "Truck 7", status: "scheduled", scheduled_date: TODAY },
        { id: 3, vname: "Trailer 2", status: "scheduled", scheduled_date: TOMORROW },
      ],
    });
    expect(r.text).toContain("Truck 4");
    expect(r.text).toContain("Truck 7");
    expect(r.text).toContain("Trailer 2");
  });

  it("keeps maintenance out of someone who cannot manage it", () => {
    const r = buildRecap({
      member: me,
      perms: crew,
      today: TODAY,
      tomorrow: TOMORROW,
      requests: [{ id: 2, vname: "Truck 7", status: "scheduled", scheduled_date: TODAY }],
    });
    expect(r).toBeNull();
  });

  it("reports only the person's own training", () => {
    const r = buildRecap({
      member: me,
      perms: crew,
      today: TODAY,
      tomorrow: TOMORROW,
      media: [{ id: "m1", title: "Ladder safety" }],
      assignments: [
        { media_id: "m1", user_id: "u1", completed_at: "2026-11-11T15:00:00Z" },
        { media_id: "m1", user_id: "u2", completed_at: "2026-11-11T15:00:00Z" },
      ],
    });
    expect(r.text).toContain("Ladder safety");
    expect((r.text.match(/Ladder safety/g) || []).length).toBe(1);
  });

  it("greets by first name in the evening", () => {
    const r = recap({ jobs: [job()] });
    expect(r.text.startsWith("Evening, Sam.")).toBe(true);
  });
});
