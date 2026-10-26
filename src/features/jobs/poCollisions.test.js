// src/features/jobs/poCollisions.test.js
//
// The collision this detects is silent in production: AccuLynx answers "already
// recorded", the sync reports success, and a crew's material cost is simply never
// on the job. There is no error to notice and no badge to read, so if this logic is
// wrong nothing downstream will tell us. Hence the fixtures are built from real
// quantities and prices rather than hand-written totals — the whole question is
// whether two jobs land on the same figure to the penny, and a test that asserts
// against a number it made up is not testing that.
import { describe, it, expect } from "vitest";
import { siblingJobsOnPo, collidingSibling } from "./poCollisions";

const COMPANY = { name: "Maumee River Roofing", branding: { taxRate: 0.07 } };

// pulled - returned, priced at the pull-time snapshot: 10 @ $10.00 = $100.00,
// plus 7% = $107.00.
const line = (qty, price) => ({
  iid: "i1",
  iname: "Shingles",
  icat: "Roofing",
  unit: "sq",
  pulled: qty,
  returned: 0,
  priceAtPull: price,
});

const job = (over = {}) => ({
  id: "a",
  po: "22311",
  title: "Jones Reroof",
  status: "completed",
  materials: [line(10, 10)],
  ...over,
});

// A sibling that has actually sent something. Only those can shadow a later post —
// the guard in AccuLynx matches against expenses that exist.
const sent = (over = {}) => job({ id: "b", syncStatus: "synced", ...over });

describe("siblingJobsOnPo", () => {
  it("finds another job on the same PO", () => {
    const a = job();
    const b = sent();
    expect(siblingJobsOnPo(a, [a, b]).map((j) => j.id)).toEqual(["b"]);
  });

  it("never returns the job itself", () => {
    const a = job();
    expect(siblingJobsOnPo(a, [a])).toEqual([]);
  });

  it("matches a PO typed with different spacing and case", () => {
    const a = job({ po: "ab-1201" });
    const b = sent({ po: "  AB-1201 " });
    expect(siblingJobsOnPo(a, [a, b])).toHaveLength(1);
  });

  it("prefers the AccuLynx id when both jobs carry one", () => {
    // Same PO text, different AccuLynx jobs: two genuinely separate files that
    // happen to share an internal number. Not a collision.
    const a = job({ acculynx_job_id: "ax-1" });
    const b = sent({ acculynx_job_id: "ax-2" });
    expect(siblingJobsOnPo(a, [a, b])).toEqual([]);

    // Different PO text, same AccuLynx job: a collision the PO alone would miss.
    const c = job({ po: "22311", acculynx_job_id: "ax-9" });
    const d = sent({ po: "22311-crew2", acculynx_job_id: "ax-9" });
    expect(siblingJobsOnPo(c, [c, d])).toHaveLength(1);
  });

  it("ignores drafts, which have pulled nothing and so owe nothing", () => {
    const a = job();
    const draft = sent({ status: "draft" });
    expect(siblingJobsOnPo(a, [a, draft])).toEqual([]);
  });

  it("ignores a job with no PO rather than grouping every blank one together", () => {
    const a = job({ po: "" });
    const b = sent({ po: "" });
    expect(siblingJobsOnPo(a, [a, b])).toEqual([]);
  });
});

describe("collidingSibling", () => {
  const find = (jobs, target) =>
    collidingSibling({ job: target, jobs, users: [], inv: [], company: COMPANY });

  it("flags a sibling whose cost matches to the penny", () => {
    const a = job();
    const b = sent();
    const clash = find([a, b], a);
    expect(clash?.sibling.id).toBe("b");
    // 10 @ $10 = $100, +7% = $107.00. The figure AccuLynx would compare.
    expect(clash?.amount).toBe(107);
  });

  it("says nothing when the two amounts differ", () => {
    const a = job();
    const b = sent({ materials: [line(9, 10)] });
    expect(find([a, b], a)).toBeNull();
  });

  it("says nothing about a sibling that has not sent anything yet", () => {
    // Same PO, same amount, but nothing is in AccuLynx for the guard to match, so
    // this job's post will land. Warning here would be a warning about the future.
    const a = job();
    const b = job({ id: "b", syncStatus: null, report_uploaded_at: null });
    expect(find([a, b], a)).toBeNull();
  });

  it("counts a sibling whose report filed but whose cost failed", () => {
    // The commonest state in this app's history: report filed, expense refused. The
    // cost may yet be retried by the cron, and if it lands first it shadows this one.
    const a = job();
    const b = job({
      id: "b",
      syncStatus: "failed",
      report_uploaded_at: "2026-10-20T10:00:00Z",
    });
    expect(find([a, b], a)?.sibling.id).toBe("b");
  });

  it("says nothing when there is no cost to post", () => {
    // Everything pulled came back. postJobExpense skips the call outright, so there
    // is no expense to be mistaken for anything.
    const a = job({ materials: [{ ...line(10, 10), returned: 10 }] });
    const b = sent({ materials: [{ ...line(10, 10), returned: 10 }] });
    expect(find([a, b], a)).toBeNull();
  });

  it("handles a missing job without throwing", () => {
    expect(collidingSibling({ job: null, jobs: [job()] })).toBeNull();
  });

  it("uses the company's own tax rate, not a hardcoded one", () => {
    // A tenant at 6% and a tenant at 7% do not collide on the same pre-tax figure.
    const a = job();
    const b = sent();
    const at6 = collidingSibling({
      job: a,
      jobs: [a, b],
      users: [],
      inv: [],
      company: { branding: { taxRate: 0.06 } },
    });
    expect(at6?.amount).toBe(106);
  });
});
