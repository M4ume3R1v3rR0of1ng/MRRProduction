// These numbers get shown to an owner as profit and exported to a spreadsheet.
// The rule under test throughout: when revenue is unknown, return null. Never
// guess, never fall back to zero.
import { describe, it, expect } from "vitest";
import {
  actualMaterialCost,
  plannedMaterialCost,
  materialsVariancePct,
  contractValue,
  hasRevenue,
  grossProfit,
  grossMarginPct,
  materialCostRatioPct,
  summarizeJobs,
} from "./jobCosting";

// 10 planned, 10 pulled, 2 returned, $25 each → 8 used = $200 actual, $250 planned.
const job = (over = {}) => ({
  id: "j1",
  status: "completed",
  items: [{ iid: "i1", planned: 10, pulled: 10, returned: 2, priceAtPull: 25 }],
  ...over,
});

describe("material cost", () => {
  it("charges what was used, not what was pulled", () => {
    // Returned stock went back on the shelf. Billing the pull would overstate
    // every job that sent material back.
    expect(actualMaterialCost(job())).toBe(200);
  });

  it("prices the plan at the same rate, so variance is quantity not price", () => {
    expect(plannedMaterialCost(job())).toBe(250);
  });

  it("reads the legacy `materials` key as well as `items`", () => {
    const legacy = { materials: [{ iid: "i1", planned: 4, pulled: 4, priceAtPull: 10 }] };
    expect(actualMaterialCost(legacy)).toBe(40);
  });

  it("survives null lines and missing arrays", () => {
    expect(actualMaterialCost({ items: [null, undefined] })).toBe(0);
    expect(actualMaterialCost({})).toBe(0);
    expect(actualMaterialCost(null)).toBe(0);
  });

  it("treats an unpriced pull as zero rather than NaN", () => {
    // A batch received without a price bills nothing. That is a real, known hole
    // defended at receive time — but it must not poison the arithmetic here.
    expect(actualMaterialCost({ items: [{ pulled: 5 }] })).toBe(0);
  });
});

describe("materialsVariancePct — the honest version of the old metric", () => {
  it("reports coming in under plan as negative", () => {
    expect(materialsVariancePct(job())).toBeCloseTo(-20, 10); // 200 vs 250
  });

  it("reports an overrun as positive", () => {
    const over = job({ items: [{ planned: 10, pulled: 13, returned: 0, priceAtPull: 25 }] });
    expect(materialsVariancePct(over)).toBeCloseTo(30, 10);
  });

  it("is null when there was no plan, rather than a misleading zero", () => {
    // Zero would read as "exactly on plan" for a job that was never planned.
    expect(materialsVariancePct({ items: [{ pulled: 5, priceAtPull: 10 }] })).toBe(null);
  });
});

describe("revenue is entered, never derived", () => {
  it("returns null when no contract value is set", () => {
    // The whole point. The old code returned estimate * 3.2 here.
    expect(contractValue(job())).toBe(null);
    expect(hasRevenue(job())).toBe(false);
    expect(grossProfit(job())).toBe(null);
    expect(grossMarginPct(job())).toBe(null);
    expect(materialCostRatioPct(job())).toBe(null);
  });

  it("treats zero as unset, because an empty field saves as 0", () => {
    // A genuinely free roof is far rarer than a blank input, and reporting a
    // -100% margin on every unfilled job would make the whole report useless.
    expect(contractValue(job({ contract_value: 0 }))).toBe(null);
    expect(grossMarginPct(job({ contract_value: 0 }))).toBe(null);
  });

  it("ignores junk in the column", () => {
    expect(contractValue(job({ contract_value: "not a number" }))).toBe(null);
    expect(contractValue(job({ contract_value: null }))).toBe(null);
  });

  it("accepts a numeric string, which is what a form input gives you", () => {
    expect(contractValue(job({ contract_value: "12000.50" }))).toBe(12000.5);
  });
});

describe("profit, once revenue is real", () => {
  const priced = job({ contract_value: 12000 });

  it("computes gross profit as revenue minus material actually used", () => {
    expect(grossProfit(priced)).toBe(11800); // 12000 - 200
  });

  it("computes margin against revenue, not against cost", () => {
    expect(grossMarginPct(priced)).toBeCloseTo(98.333, 3);
  });

  it("reports material cost as a share of the contract", () => {
    expect(materialCostRatioPct(priced)).toBeCloseTo(1.667, 3);
  });

  it("no longer returns 68.75% for every on-plan job", () => {
    // The signature of the old bug: revenue = 3.2 x estimate made margin a
    // constant. Two jobs with identical material performance and different
    // contracts must now report different margins.
    const cheap = job({ contract_value: 1000 });
    const dear = job({ contract_value: 50000 });
    expect(grossMarginPct(cheap)).not.toBeCloseTo(grossMarginPct(dear), 1);
    expect(grossMarginPct(cheap)).not.toBeCloseTo(68.75, 1);
  });

  it("can report a loss", () => {
    // The old formula could not: revenue was defined as a multiple of cost, so
    // profit was positive by construction. A job that overruns must be able to
    // show red.
    const bad = job({ contract_value: 100, items: [{ planned: 1, pulled: 10, priceAtPull: 25 }] });
    expect(grossProfit(bad)).toBe(-150);
    expect(grossMarginPct(bad)).toBeLessThan(0);
  });
});

describe("summarizeJobs", () => {
  const jobs = [
    job({ id: "a", contract_value: 10000 }),                       // cost 200
    job({ id: "b", contract_value: 5000 }),                        // cost 200
    job({ id: "c" }),                                              // cost 200, unpriced
  ];

  it("counts how many jobs still have no contract value", () => {
    const s = summarizeJobs(jobs);
    expect(s.jobCount).toBe(3);
    expect(s.pricedCount).toBe(2);
    expect(s.unpricedCount).toBe(1);
  });

  it("excludes unpriced jobs from margin instead of folding them in at zero", () => {
    // Including job c at zero revenue would drag portfolio margin down by a third
    // for a job whose revenue is simply unknown. That is a wrong number, not a
    // cautious one.
    const s = summarizeJobs(jobs);
    expect(s.revenue).toBe(15000);
    expect(s.materialCostOfPriced).toBe(400);
    expect(s.grossProfit).toBe(14600);
    expect(s.grossMarginPct).toBeCloseTo(97.333, 3);
  });

  it("still totals material spend across every job, priced or not", () => {
    // Material cost comes from the batches, so it is knowable even when revenue
    // is not. Hiding it would lose real information.
    expect(summarizeJobs(jobs).materialCost).toBe(600);
  });

  it("returns null margin rather than 0 when nothing is priced", () => {
    const s = summarizeJobs([job({ id: "x" })]);
    expect(s.grossProfit).toBe(null);
    expect(s.grossMarginPct).toBe(null);
    expect(s.materialCost).toBe(200);
  });

  it("handles an empty list", () => {
    const s = summarizeJobs([]);
    expect(s.jobCount).toBe(0);
    expect(s.grossMarginPct).toBe(null);
  });
});
