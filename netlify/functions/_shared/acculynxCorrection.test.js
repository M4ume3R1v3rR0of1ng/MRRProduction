// What happens to AccuLynx when a job's materials are corrected after its cost was
// posted. The user's own example: logged as taking 5, really 4; logged as returning
// 3, really 2. Each correction changes the job's cost, and AccuLynx keeps the old one.
import { describe, it, expect } from "vitest";
import {
  planCorrectionNotice,
  cleanChanges,
  buildCorrectionEmail,
  money,
} from "./acculynxCorrection.js";

const synced = (extra = {}) => ({
  id: "j1",
  po: "22562",
  title: "Smith",
  syncStatus: "synced",
  ...extra,
});

describe("planCorrectionNotice", () => {
  it("flags a synced job whose corrected cost differs, using the stored posted figure", () => {
    const plan = planCorrectionNotice({
      job: synced({ acculynx_posted_amount: 623.44 }),
      newAmount: 498.75,
      beforeAmount: 999, // ignored: the stored figure is what AccuLynx actually holds
    });
    expect(plan).toEqual({ action: "flag", posted: 623.44, correct: 498.75, diff: -124.69 });
  });

  it("falls back to the browser's before-figure for a job synced before supabase/68", () => {
    const plan = planCorrectionNotice({ job: synced(), newAmount: 107, beforeAmount: 214 });
    expect(plan).toMatchObject({ action: "flag", posted: 214, correct: 107 });
  });

  it("leaves a job that never synced to the retry, which posts the corrected cost itself", () => {
    for (const syncStatus of [null, "failed", "manual"]) {
      expect(
        planCorrectionNotice({ job: synced({ syncStatus }), newAmount: 10, beforeAmount: 20 }),
      ).toEqual({ action: "none", reason: "not-posted" });
    }
  });

  it("still flags a job whose report failed but whose cost is known to be posted", () => {
    const job = synced({ syncStatus: "failed", acculynx_posted_amount: 50 });
    expect(planCorrectionNotice({ job, newAmount: 40 }).action).toBe("flag");
  });

  it("does nothing when the cost did not change", () => {
    const job = synced({ acculynx_posted_amount: 100 });
    expect(planCorrectionNotice({ job, newAmount: 100.001 })).toEqual({
      action: "none",
      reason: "matches",
    });
  });

  it("clears the flag when a second correction puts the cost back", () => {
    const job = synced({ acculynx_posted_amount: 100, acculynx_correct_amount: 80 });
    expect(planCorrectionNotice({ job, newAmount: 100 })).toEqual({ action: "clear", posted: 100 });
  });

  it("does not file or email twice for the same figure", () => {
    const job = synced({ acculynx_posted_amount: 100, acculynx_correct_amount: 80 });
    expect(planCorrectionNotice({ job, newAmount: 80 })).toEqual({
      action: "none",
      reason: "already-flagged",
    });
  });

  it("re-flags when a further correction moves the figure again", () => {
    const job = synced({ acculynx_posted_amount: 100, acculynx_correct_amount: 80 });
    expect(planCorrectionNotice({ job, newAmount: 60 })).toMatchObject({
      action: "flag",
      posted: 100,
      correct: 60,
    });
  });

  it("treats a numeric column that PostgREST returns as a string like a number", () => {
    const job = synced({ acculynx_posted_amount: "100.00", acculynx_correct_amount: "80.00" });
    expect(planCorrectionNotice({ job, newAmount: 80 }).reason).toBe("already-flagged");
  });

  it("refuses to guess without a baseline", () => {
    expect(planCorrectionNotice({ job: synced(), newAmount: 10 })).toEqual({
      action: "none",
      reason: "no-baseline",
    });
  });
});

describe("cleanChanges", () => {
  it("keeps real changes and drops junk", () => {
    expect(
      cleanChanges([
        { iname: "OSB", unit: "sheets", field: "pulled", from: 5, to: 4 },
        { iname: "OSB", unit: "sheets", field: "returned", from: 3, to: 2 },
        { iname: "same", field: "pulled", from: 1, to: 1 },
        { iname: "bad", field: "pulled", from: "x", to: 2 },
        null,
      ]),
    ).toEqual([
      { iname: "OSB", unit: "sheets", field: "pulled", from: 5, to: 4 },
      { iname: "OSB", unit: "sheets", field: "returned", from: 3, to: 2 },
    ]);
    expect(cleanChanges("nope")).toEqual([]);
  });
});

describe("buildCorrectionEmail", () => {
  const base = {
    companyName: "Maumee River Roofing",
    job: { po: "22562", title: "Smith <Roof>" },
    posted: 623.44,
    correct: 498.75,
    changes: [{ iname: "OSB", unit: "sheets", field: "pulled", from: 5, to: 4 }],
    byName: "Sam",
    revised: { ok: true, filename: "JobReport22562Revised20261124.pdf" },
    appUrl: "https://steadwerk.com",
  };

  it("says exactly what to change, from and to", () => {
    const { subject, html } = buildCorrectionEmail(base);
    expect(subject).toBe("AccuLynx needs updating: 22562 material cost $623.44 → $498.75");
    expect(html).toContain(
      "change its amount from <strong>$623.44</strong> to <strong>$498.75</strong>",
    );
    expect(html).toContain("-$124.69");
    expect(html).toContain("JobReport22562Revised20261124.pdf");
    expect(html).toContain("Updated in AccuLynx");
  });

  it("escapes what came from people", () => {
    const { html } = buildCorrectionEmail(base);
    expect(html).toContain("Smith &lt;Roof&gt;");
    expect(html).not.toContain("<Roof>");
  });

  it("asks for a new expense when none was posted", () => {
    const { html } = buildCorrectionEmail({ ...base, posted: 0, correct: 50 });
    expect(html).toContain("add a material cost expense of <strong>$50.00</strong>");
    expect(html).toContain("+$50.00");
  });

  it("says when the revised report could not be filed", () => {
    const { html } = buildCorrectionEmail({ ...base, revised: { ok: false, error: "HTTP 500" } });
    expect(html).toContain("could not be filed");
    expect(html).toContain("HTTP 500");
  });

  it("formats money with thousands separators and a sign", () => {
    expect(money(1234.5)).toBe("$1,234.50");
    expect(money(-12)).toBe("-$12.00");
  });
});
