// src/features/jobs/pullReview.test.js
//
// The thresholds that decide whether a crew gets stopped mid-pull, and whether a
// job turns up on a manager's review list. Both screens read them from one
// module on purpose, so these tests are the only place the numbers are pinned.
import { describe, it, expect } from "vitest";
import {
  OVER_PULL_RATIO,
  plannedOf,
  lineAnomaly,
  planAnomalies,
  wasCorrected,
  topUps,
  toppedUpOverPlan,
  jobPullFlags,
  jobsNeedingPullReview,
} from "./pullReview";
import { job, line } from "@/test/fixtures/jobs";

describe("lineAnomaly", () => {
  it("passes a pull that matches the plan, and one a little under it", () => {
    expect(lineAnomaly({ planned: 10 }, 10)).toBeNull();
    expect(lineAnomaly({ planned: 10 }, 8)).toBeNull();
  });

  it("allows a small overage but flags a large one", () => {
    // The ratio is the contract between this module and both screens: 25% over
    // is routine (a bundle rounds up, the crew takes a spare), well past it is
    // what a wrong row looks like.
    expect(OVER_PULL_RATIO).toBe(1.25);
    expect(lineAnomaly({ planned: 10 }, 12.5)).toBeNull();
    expect(lineAnomaly({ planned: 10 }, 13)).toBe("over");
  });

  it("flags material going out on a line nothing was planned for", () => {
    expect(lineAnomaly({ planned: 0 }, 5)).toBe("off_plan");
    // Nothing planned and nothing pulled is just an empty line, not a problem.
    expect(lineAnomaly({ planned: 0 }, 0)).toBeNull();
  });

  it("flags a planned line left at zero", () => {
    expect(lineAnomaly({ planned: 10 }, 0)).toBe("skipped");
  });

  it("reads the legacy `qty` field when `planned` is absent", () => {
    // Older job rows carry only `qty`. Treating those as planned-0 would report
    // every line in the archive as off-plan.
    expect(plannedOf({ qty: 10 })).toBe(10);
    expect(lineAnomaly({ qty: 10 }, 10)).toBeNull();
  });

  it("treats unparseable quantities as zero rather than throwing", () => {
    expect(lineAnomaly({ planned: "10" }, "")).toBe("skipped");
    expect(lineAnomaly({ planned: undefined }, undefined)).toBeNull();
  });
});

describe("planAnomalies", () => {
  // The mistake that started all of this: 20 typed into the wrong row. Both
  // halves have to show up, because either one alone is ambiguous and the two
  // together are unmistakable.
  it("reports the wrong-row pair: one line off-plan, the other planned and skipped", () => {
    const lines = [
      line("i1", "Synthetic Underlayment", { planned: 20 }),
      line("i2", "Sheathing", { planned: 0 }),
    ];
    const typed = { i1: 0, i2: 20 };

    const rows = planAnomalies(lines, (l) => typed[l.iid]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ iid: "i1", name: "Synthetic Underlayment", kind: "skipped" });
    expect(rows[1]).toMatchObject({ iid: "i2", name: "Sheathing", kind: "off_plan", actual: 20 });
  });

  it("returns nothing when every line matches its plan", () => {
    const lines = [line("i1", "Shingle", { planned: 10 })];
    expect(planAnomalies(lines, () => 10)).toEqual([]);
  });

  it("survives a null line in the list", () => {
    expect(planAnomalies([null, line("i1", "Shingle", { planned: 10 })], () => 10)).toEqual([]);
  });
});

describe("jobPullFlags", () => {
  it("flags a corrected line, and carries what it used to be", () => {
    const j = job("j1", "active", {
      items: [
        line("i1", "Sheathing", {
          planned: 0,
          pulled: 0,
          pullCorrection: { prevPulled: 20, byName: "Dana" },
        }),
      ],
    });

    expect(wasCorrected(j.items[0])).toBe(true);
    expect(jobPullFlags(j)).toEqual([
      expect.objectContaining({ iid: "i1", kind: "corrected", actual: 0, prevPulled: 20 }),
    ]);
  });

  it("does NOT flag a line still waiting on Pull Added Materials", () => {
    // A line added after the initial pull legitimately sits at pulled: 0 until
    // supabase/36 runs for it. Flagging those would put healthy jobs on the
    // review list continuously, which is the one thing that would make the list
    // worth ignoring.
    const j = job("j1", "active", {
      items: [line("i1", "Drip Edge", { planned: 10, pulled: 0 })],
    });
    expect(jobPullFlags(j)).toEqual([]);
  });

  it("flags an over-plan pull and an off-plan pull from the saved quantities", () => {
    const j = job("j1", "completed", {
      items: [
        line("i1", "Shingle", { planned: 10, pulled: 30 }),
        line("i2", "Nails", { planned: 0, pulled: 4 }),
        line("i3", "Ridge Vent", { planned: 6, pulled: 6 }),
      ],
    });
    expect(jobPullFlags(j).map((f) => [f.iid, f.kind])).toEqual([
      ["i1", "over"],
      ["i2", "off_plan"],
    ]);
  });

  // ── Top-ups (supabase/57) ────────────────────────────────────────────────
  // The reported case: 6 OSB approved and pulled, 9 more needed on the roof. 57
  // raises `planned` to the new total on purpose, so by the time this module
  // reads the line the quantities agree and lineAnomaly has nothing to notice —
  // the stamp is the only remaining record that the job outgrew its plan.
  it("flags a line topped up past what was approved, from the stamp", () => {
    const j = job("j1", "active", {
      items: [
        line("i1", "OSB", {
          planned: 15,
          pulled: 15,
          toppedUp: [
            { qty: 9, prevPulled: 6, newPulled: 15, prevPlanned: 6, reason: "roof measured short" },
          ],
        }),
      ],
    });
    expect(lineAnomaly(j.items[0], 15)).toBeNull();
    expect(jobPullFlags(j)).toEqual([
      expect.objectContaining({
        iid: "i1",
        kind: "topped_up",
        planned: 15,
        actual: 15,
        prevPlanned: 6,
        addedAfter: 9,
        reasons: ["roof measured short"],
      }),
    ]);
  });

  it("does NOT flag a top-up that stayed inside the approved plan", () => {
    // Planned 20, pulled 6, 9 more sent out: 15 is still material the job was
    // approved to use, so there is nothing for a manager to open. Listing it
    // would be listing a job for working as intended.
    const j = job("j1", "active", {
      items: [
        line("i1", "OSB", {
          planned: 20,
          pulled: 15,
          toppedUp: [{ qty: 9, prevPulled: 6, newPulled: 15, prevPlanned: 20 }],
        }),
      ],
    });
    expect(toppedUpOverPlan(j.items[0])).toBe(false);
    expect(jobPullFlags(j)).toEqual([]);
  });

  it("totals repeated top-ups and keeps the ORIGINAL approved quantity", () => {
    // A roof can come up short twice. The second entry's prevPlanned is already
    // the first one's revision, so the approved number is the first entry's.
    const l = line("i1", "OSB", {
      planned: 20,
      pulled: 20,
      toppedUp: [
        { qty: 9, prevPulled: 6, newPulled: 15, prevPlanned: 6, reason: "measured short" },
        { qty: 5, prevPulled: 15, newPulled: 20, prevPlanned: 15, reason: "two damaged" },
      ],
    });
    expect(topUps(l)).toHaveLength(2);
    const [flag] = jobPullFlags(job("j1", "active", { items: [l] }));
    expect(flag).toMatchObject({
      kind: "topped_up",
      prevPlanned: 6,
      addedAfter: 14,
      reasons: ["measured short", "two damaged"],
    });
  });

  it("treats a line with no top-up stamp as untouched", () => {
    expect(topUps(line("i1", "OSB"))).toEqual([]);
    expect(toppedUpOverPlan(line("i1", "OSB"))).toBe(false);
    // Older rows and anything that wrote the wrong shape must not throw.
    expect(toppedUpOverPlan({ toppedUp: true })).toBe(false);
    expect(toppedUpOverPlan(null)).toBe(false);
  });

  it("prefers 'corrected' over 'topped_up' on the same line", () => {
    // Both are explained after-the-fact changes, but a correction means someone
    // decided the recorded quantity was WRONG, which is the more actionable of
    // the two.
    const j = job("j1", "active", {
      items: [
        line("i1", "OSB", {
          planned: 15,
          pulled: 12,
          toppedUp: [{ qty: 9, prevPulled: 6, newPulled: 15, prevPlanned: 6 }],
          pullCorrection: { prevPulled: 15 },
        }),
      ],
    });
    expect(jobPullFlags(j)).toHaveLength(1);
    expect(jobPullFlags(j)[0].kind).toBe("corrected");
  });

  it("prefers 'corrected' over the quantity verdict on the same line", () => {
    // A line corrected to 0 also reads as "skipped". The correction is the more
    // actionable fact, and saying both would just be noise.
    const j = job("j1", "active", {
      items: [
        line("i1", "Sheathing", { planned: 10, pulled: 0, pullCorrection: { prevPulled: 10 } }),
      ],
    });
    expect(jobPullFlags(j)).toHaveLength(1);
    expect(jobPullFlags(j)[0].kind).toBe("corrected");
  });

  it("reads `materials` when a job has no `items`", () => {
    const j = { materials: [{ iid: "i1", iname: "Shingle", planned: 0, pulled: 3 }] };
    expect(jobPullFlags(j).map((f) => f.kind)).toEqual(["off_plan"]);
  });
});

describe("jobsNeedingPullReview", () => {
  const over = (id, status) =>
    job(id, status, { items: [line("i1", "Shingle", { planned: 10, pulled: 30 })] });

  it("includes active jobs, not just completed ones", () => {
    // A wrong pull is cheap to fix while the material is still on the truck.
    // Waiting for completion is how it reaches the monthly count instead.
    const found = jobsNeedingPullReview([over("j1", "active"), over("j2", "completed")]);
    expect(found.map((r) => r.job.id)).toEqual(["j1", "j2"]);
  });

  it("ignores jobs whose materials have not been pulled yet", () => {
    // Every line on an approved job reads as "skipped" — nothing has been pulled
    // because pulling is the next step, not a mistake.
    const approved = job("j1", "approved", {
      items: [line("i1", "Shingle", { planned: 10, pulled: 0 })],
    });
    const draft = job("j2", "draft", {
      items: [line("i1", "Shingle", { planned: 10, pulled: 0 })],
    });
    expect(jobsNeedingPullReview([approved, draft])).toEqual([]);
  });

  it("leaves out jobs that match their plan, and survives junk in the list", () => {
    const clean = job("j3", "completed", {
      items: [line("i1", "Shingle", { planned: 10, pulled: 10 })],
    });
    expect(jobsNeedingPullReview([null, clean, undefined])).toEqual([]);
    expect(jobsNeedingPullReview()).toEqual([]);
  });
});
