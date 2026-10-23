import { describe, it, expect } from "vitest";
import {
  CORRECTABLE_STATES,
  blockedReason,
  canCorrectPull,
  correctableLines,
  correctionsFrom,
  floorFor,
  hasBatchHistory,
  invalidRows,
} from "./correctPull";

// A line as the job row carries it: pulled, returned, and the per-batch split
// doFifo records, which is what 51 credits against.
const line = (iid, over = {}) => ({
  iid,
  iname: iid.toUpperCase(),
  unit: "tubes",
  planned: 10,
  pulled: 10,
  returned: 0,
  consumed: [{ bid: "b1", rcvd: "2025-05-01", qty: 10, price: 18 }],
  ...over,
});
const job = (status, items) => ({ id: "j1", status, items });
const qtyMap = (m) => (iid) => m[iid];

describe("canCorrectPull", () => {
  // 51's note to the UI, enforced: `warehouse` pulls, so `warehouse` mis-pulls,
  // and it holds jobs_pull and none of the three alternatives.
  it("needs only jobs_pull, not jobs_edit_pull, jobs_build or inv_adjust", () => {
    expect(canCorrectPull(job("active", [line("i1")]), { jobs_pull: true })).toBe(true);
    expect(
      canCorrectPull(job("active", [line("i1")]), {
        jobs_build: true,
        jobs_edit_pull: true,
        inv_adjust: true,
        jobs_pull: false,
      }),
    ).toBe(false);
  });

  it("offers it only on a job that has been pulled and is not closed", () => {
    const perms = { jobs_pull: true };
    const items = [line("i1")];
    expect(canCorrectPull(job("active", items), perms)).toBe(true);
    expect(canCorrectPull(job("completed", items), perms)).toBe(true);
    // Nothing has gone out on an approved job yet, so there is no pull to fix.
    expect(canCorrectPull(job("approved", items), perms)).toBe(false);
    expect(canCorrectPull(job("draft", items), perms)).toBe(false);
    // A closed job is reopened first — 51 refuses it too.
    expect(canCorrectPull(job("closed", items), perms)).toBe(false);
  });

  it("matches the states the RPC accepts", () => {
    expect(CORRECTABLE_STATES).toEqual(["active", "completed"]);
  });

  // The button would otherwise open a dialog with an empty table on every job
  // whose material has not gone out yet.
  it("stays hidden when no line has anything pulled", () => {
    const perms = { jobs_pull: true };
    expect(canCorrectPull(job("active", [line("i1", { pulled: 0 })]), perms)).toBe(false);
    expect(canCorrectPull(job("active", []), perms)).toBe(false);
  });

  it("does not throw on a missing job or missing perms", () => {
    expect(canCorrectPull(null, { jobs_pull: true })).toBe(false);
    expect(canCorrectPull(job("active", [line("i1")]))).toBe(false);
  });
});

describe("correctableLines", () => {
  it("takes only lines something actually went out on", () => {
    const j = job("active", [line("i1"), line("i2", { pulled: 0 }), line("i3", { pulled: 2 })]);
    expect(correctableLines(j).map((l) => l.iid)).toEqual(["i1", "i3"]);
  });

  it("reads `materials` when a job carries that instead of `items`", () => {
    expect(correctableLines({ materials: [line("i1")] }).map((l) => l.iid)).toEqual(["i1"]);
  });

  it("survives a null in the array", () => {
    expect(correctableLines({ items: [null, line("i1")] })).toHaveLength(1);
  });
});

describe("blockedReason", () => {
  // 51:251 refuses a line with no `consumed` split rather than guessing which
  // batches to credit, so the dialog says so against the row instead of letting
  // someone meet that exception on save.
  it("blocks a line pulled before batch tracking", () => {
    expect(blockedReason(line("i1", { consumed: [] }))).toBe("noHistory");
    expect(blockedReason(line("i1", { consumed: undefined }))).toBe("noHistory");
    expect(hasBatchHistory(line("i1"))).toBe(true);
  });

  // Correcting below `returned` is 51:237, and with everything already back
  // there is no room to correct into at all.
  it("blocks a line whose pull has entirely come back", () => {
    expect(blockedReason(line("i1", { pulled: 10, returned: 10 }))).toBe("allReturned");
  });

  it("allows an ordinary pulled line", () => {
    expect(blockedReason(line("i1"))).toBeNull();
    expect(blockedReason(line("i1", { pulled: 10, returned: 4 }))).toBeNull();
  });
});

describe("floorFor", () => {
  it("is what has already been returned", () => {
    expect(floorFor(line("i1", { returned: 4 }))).toBe(4);
    expect(floorFor(line("i1"))).toBe(0);
  });

  it("never goes negative on junk", () => {
    expect(floorFor(line("i1", { returned: -3 }))).toBe(0);
    expect(floorFor({})).toBe(0);
  });
});

describe("correctionsFrom", () => {
  it("sends only the rows whose total actually changed", () => {
    const lines = [line("i1"), line("i2", { pulled: 6 })];
    expect(correctionsFrom(lines, qtyMap({ i1: "4", i2: "6" }))).toEqual({ i1: 4 });
  });

  // 0 is how a pull that should never have happened is backed out entirely, so
  // it has to survive as a real value rather than read as "unset".
  it("treats a corrected total of 0 as a correction, not a blank", () => {
    expect(correctionsFrom([line("i1")], qtyMap({ i1: "0" }))).toEqual({ i1: 0 });
  });

  it("ignores a blank or unparseable box rather than reading it as 0", () => {
    expect(correctionsFrom([line("i1")], qtyMap({ i1: "" }))).toEqual({});
    expect(correctionsFrom([line("i1")], qtyMap({ i1: "abc" }))).toEqual({});
    expect(correctionsFrom([line("i1")], qtyMap({}))).toEqual({});
  });

  it("skips a row the RPC would refuse outright", () => {
    const lines = [line("i1", { consumed: [] }), line("i2", { pulled: 5, returned: 5 })];
    expect(correctionsFrom(lines, qtyMap({ i1: "2", i2: "1" }))).toEqual({});
  });
});

describe("invalidRows", () => {
  // This screen reduces a pull and nothing else, so a raise belongs next door.
  // Saying so on the row is what stops someone bouncing between the two — which
  // is exactly what happened while 52 refused a pulled line and named this
  // screen, and this screen refused a raise and named that one (now supabase/57).
  it("flags an attempt to raise a pull and points back at Need More Materials", () => {
    const rows = invalidRows([line("i1", { pulled: 10 })], qtyMap({ i1: "11" }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ iid: "i1", kind: "increase", pulled: 10 });
  });

  it("flags a total below what has already been returned, with the floor", () => {
    const rows = invalidRows([line("i1", { pulled: 10, returned: 4 })], qtyMap({ i1: "2" }));
    expect(rows[0]).toMatchObject({ iid: "i1", kind: "belowReturned", floor: 4 });
  });

  it("flags blanks and negatives separately", () => {
    expect(invalidRows([line("i1")], qtyMap({ i1: "" }))[0].kind).toBe("blank");
    expect(invalidRows([line("i1")], qtyMap({ i1: "-1" }))[0].kind).toBe("negative");
  });

  it("passes a correction that sits inside the allowed range", () => {
    const lines = [line("i1", { pulled: 10, returned: 4 })];
    expect(invalidRows(lines, qtyMap({ i1: "4" }))).toEqual([]);
    expect(invalidRows(lines, qtyMap({ i1: "10" }))).toEqual([]);
    expect(invalidRows([line("i2")], qtyMap({ i2: "0" }))).toEqual([]);
  });

  // Those rows render disabled with their own explanation; reporting them as
  // invalid as well would block the save button over a box nobody can type in.
  it("says nothing about a row that is already blocked", () => {
    const lines = [line("i1", { consumed: [] }), line("i2", { pulled: 5, returned: 5 })];
    expect(invalidRows(lines, qtyMap({ i1: "", i2: "" }))).toEqual([]);
  });

  it("reports every bad row at once, not just the first", () => {
    const lines = [line("i1", { pulled: 2 }), line("i2", { pulled: 2 })];
    expect(invalidRows(lines, qtyMap({ i1: "5", i2: "-1" })).map((r) => r.kind)).toEqual([
      "increase",
      "negative",
    ]);
  });
});
