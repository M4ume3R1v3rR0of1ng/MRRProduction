import { describe, it, expect } from "vitest";
import {
  ADDABLE_STATES,
  addableForPull,
  canAddPull,
  orphanLines,
  overPullRows,
} from "./addPullMaterials";

const line = (iid, over = {}) => ({
  iid,
  iname: iid.toUpperCase(),
  unit: "ft",
  planned: 10,
  pulled: 0,
  ...over,
});
const job = (status, items) => ({ id: "j1", status, items });

describe("canAddPull", () => {
  // The whole reason this module exists: the capability was gated on jobs_build,
  // which the two roles that pull material do not have.
  it("needs only jobs_pull, not jobs_build or jobs_edit_pull", () => {
    expect(canAddPull(job("active", []), { jobs_pull: true })).toBe(true);
    expect(
      canAddPull(job("active", []), { jobs_build: true, jobs_edit_pull: true, jobs_pull: false }),
    ).toBe(false);
  });

  it("offers it only on a job that has been pulled and is not closed", () => {
    const perms = { jobs_pull: true };
    expect(canAddPull(job("active", []), perms)).toBe(true);
    expect(canAddPull(job("completed", []), perms)).toBe(true);
    // An approved job still has its own Pull Materials button.
    expect(canAddPull(job("approved", []), perms)).toBe(false);
    expect(canAddPull(job("draft", []), perms)).toBe(false);
    // A closed job has to be reopened first — supabase/52 refuses it too.
    expect(canAddPull(job("closed", []), perms)).toBe(false);
  });

  it("matches the states the RPC accepts", () => {
    expect(ADDABLE_STATES).toEqual(["active", "completed"]);
  });

  it("does not throw on a missing job or missing perms", () => {
    expect(canAddPull(null, { jobs_pull: true })).toBe(false);
    expect(canAddPull(job("active", []), undefined)).toBe(false);
  });
});

describe("orphanLines", () => {
  it("returns the lines nothing has gone out for", () => {
    const j = job("active", [line("a"), line("b", { pulled: 4 }), line("c")]);
    expect(orphanLines(j).map((l) => l.iid)).toEqual(["a", "c"]);
  });

  it("treats a line with no `pulled` field as un-pulled", () => {
    const j = job("active", [{ iid: "a", iname: "A" }]);
    expect(orphanLines(j).map((l) => l.iid)).toEqual(["a"]);
  });

  it("reads `materials` when the row has no `items`, and survives nulls", () => {
    expect(orphanLines({ materials: [line("a"), null] }).map((l) => l.iid)).toEqual(["a"]);
    expect(orphanLines({})).toEqual([]);
    expect(orphanLines(null)).toEqual([]);
  });
});

describe("addableForPull", () => {
  const inv = [
    { id: "a", name: "Aluminum Coil", unit: "ft" },
    { id: "b", name: "Bituminous Roll", unit: "rolls" },
    { id: "c", name: "Copper Flashing", unit: "ft" },
  ];

  it("excludes anything already on the job, pulled or not", () => {
    // Both of these are reached through their own row in the dialog. Offering
    // them again would create a second line for one `iid`, which every lookup
    // in the pull path keys on.
    const j = job("active", [line("a"), line("b", { pulled: 3 })]);
    expect(addableForPull(inv, j, "").map((i) => i.id)).toEqual(["c"]);
  });

  it("matches on name, case-insensitively", () => {
    const j = job("active", []);
    expect(addableForPull(inv, j, "coil").map((i) => i.id)).toEqual(["a"]);
    expect(addableForPull(inv, j, "ROLL").map((i) => i.id)).toEqual(["b"]);
    expect(addableForPull(inv, j, "  flash  ").map((i) => i.id)).toEqual(["c"]);
  });

  it("returns nothing on an empty inventory rather than throwing", () => {
    expect(addableForPull(undefined, job("active", []), "x")).toEqual([]);
  });
});

describe("overPullRows", () => {
  const qtyOf = (map) => (l) => map[l.iid] ?? 0;

  it("raises a line pulled well past its approved quantity", () => {
    const rows = overPullRows([line("a")], qtyOf({ a: 20 }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ iid: "a", kind: "over", planned: 10, actual: 20 });
  });

  it("does not raise a small overage", () => {
    // 25% is the shared threshold (pullReview.OVER_PULL_RATIO) — small overages
    // are normal and warning on them teaches people to click through.
    expect(overPullRows([line("a")], qtyOf({ a: 12 }))).toEqual([]);
  });

  it("raises a line that was never planned for", () => {
    const rows = overPullRows([line("a", { planned: 0 })], qtyOf({ a: 5 }));
    expect(rows.map((r) => r.kind)).toEqual(["off_plan"]);
  });

  // The one deliberate difference from the initial pull's dialog. Here the list
  // is every orphan line on the job and the crew may want exactly one of them,
  // so a line left at zero is the normal case, not a misplaced quantity.
  it("never raises a line left at zero", () => {
    expect(overPullRows([line("a"), line("b")], qtyOf({ a: 10 }))).toEqual([]);
  });

  it("stays quiet when every line agrees with the plan", () => {
    expect(overPullRows([line("a"), line("b")], qtyOf({ a: 10, b: 10 }))).toEqual([]);
  });
});
