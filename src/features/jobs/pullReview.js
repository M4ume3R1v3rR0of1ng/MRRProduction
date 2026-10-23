// src/features/jobs/pullReview.js
//
// One definition of "this pull does not match the plan", shared by the dialog
// that stops a pull before it commits (PullInventoryView.confirmPull) and the
// Reports list that finds the ones that already went through
// (ReportsView.PullReviewReport).
//
// It has to be ONE definition. If the dialog warned at 25% over and the report
// listed at 10%, every pull in the band between them would be waved through at
// the warehouse and then surface on a manager's screen as a problem nobody at
// the warehouse was ever told about. Two thresholds for the same judgement is
// how a review list loses its credibility.
//
// Exported pure, and tested, because the numbers here decide whether a crew
// standing on a roof gets stopped.

const num = (v) => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// How far over plan a line may go before it is worth a second look.
//
// 25%, not any overage at all, because small overages are normal: a bundle count
// rounds up, a square comes up short, the crew takes one spare. Warning on those
// teaches people to click through the dialog without reading it, which is the one
// outcome that makes the whole thing useless. The point of this number is that
// crossing it should feel unusual.
//
// If it ever needs to vary per company it belongs in company settings next to the
// inventory count cadence, not as a second constant alongside this one.
export const OVER_PULL_RATIO = 1.25;

// `qty` is the Build Jobs field; `planned` is what Pull Inventory writes. Older
// rows carry only the former, and a line read as planned-0 would be reported as
// off-plan on every job in the archive.
export const plannedOf = (line) => num(line?.planned ?? line?.qty);

// What one line's quantity says about the plan, or null when it agrees with it.
//
//   "off_plan"  nothing was planned for this line, material is going out anyway
//   "over"      more than OVER_PULL_RATIO x the planned quantity
//   "skipped"   the plan wanted some and none is going out
//
// "skipped" is the tell for the mistake that started all of this: the quantity
// typed into the wrong row leaves the right row sitting at zero, so the two
// anomalies appear together and the dialog shows both.
export const lineAnomaly = (line, actual) => {
  const qty = num(actual);
  const planned = plannedOf(line);
  if (planned <= 0) return qty > 0 ? "off_plan" : null;
  if (qty === 0) return "skipped";
  if (qty > planned * OVER_PULL_RATIO) return "over";
  return null;
};

const rowOf = (line, actual, kind) => ({
  iid: line.iid,
  name: line.iname || line.name || "",
  unit: line.unit || "",
  planned: plannedOf(line),
  actual: num(actual),
  kind,
});

// The rows the pre-commit dialog shows. `qtyOf` resolves what the operator has
// actually typed, which is not on the line yet — the whole point is to catch it
// before it is.
export const planAnomalies = (lines, qtyOf) =>
  (lines || [])
    .filter(Boolean)
    .map((line) => {
      const actual = num(qtyOf(line));
      const kind = lineAnomaly(line, actual);
      return kind ? rowOf(line, actual, kind) : null;
    })
    .filter(Boolean);

// Was this line's pull corrected after the fact? Written onto the line by
// correct_job_pull (supabase/51) rather than only into audit_logs, because that
// is purged at 30 days and this list is most of the reason the stamp exists.
export const wasCorrected = (line) => Boolean(line?.pullCorrection);

// Each time this line was topped up after its pull, oldest first — written by
// add_and_pull_job_materials (supabase/57). An ARRAY, unlike the two stamps
// beside it, because a roof can come up short twice and the earlier reason is
// the half a cost reconciliation reads.
export const topUps = (line) => (Array.isArray(line?.toppedUp) ? line.toppedUp : []);

// Did topping this line up take it past what was APPROVED for it?
//
// Not every top-up did. A line planned for 20 and pulled at 6 can take 9 more
// and still be inside its plan — nothing was revised, and listing it would be
// listing a job for having used the material it was approved to use.
//
// The ones that went past it are the margin question ("we approved 6 and the
// roof ate 15"), and they are only answerable from the stamp: supabase/57 raises
// `planned` to the new total, deliberately — see its header — so by the time
// anything reads the line, `planned` and `pulled` agree and lineAnomaly below
// has nothing left to notice. `prevPlanned` is where the approved number went.
export const toppedUpOverPlan = (line) =>
  topUps(line).some((e) => num(e?.newPulled) > num(e?.prevPlanned));

// Why one job's pulls deserve a look, or [] when they do not.
//
// "skipped" is deliberately NOT raised here, though the pre-commit dialog does
// raise it. A line added to a job AFTER its initial pull legitimately sits at
// pulled: 0 until Pull Added Materials runs (supabase/36), so listing skipped
// lines would flag healthy jobs continuously — and this list is only worth
// having if everything on it is worth opening.
//
// Three kinds come out of here, and the first two that match win: "corrected" (a
// pull put right, 51), "topped_up" (more material sent out than was approved,
// 57), then whatever lineAnomaly makes of the quantities themselves.
export const jobPullFlags = (job) =>
  (job?.items || job?.materials || []).filter(Boolean).reduce((out, line) => {
    const pulled = num(line.pulled);
    if (wasCorrected(line)) {
      out.push({
        ...rowOf(line, pulled, "corrected"),
        prevPulled: num(line.pullCorrection?.prevPulled),
      });
      return out;
    }
    // Listed for the same reason "corrected" is: it is explained, and it still
    // changes what the job cost. Reported as its own kind rather than as "over"
    // — the label for a mistake — because somebody asked for this material on
    // purpose and said why, and `planned` has moved to match.
    if (toppedUpOverPlan(line)) {
      const entries = topUps(line);
      out.push({
        ...rowOf(line, pulled, "topped_up"),
        // The quantity on the APPROVED plan, before any of this. First entry,
        // not last: the second top-up's prevPlanned is already the first one's
        // revision.
        prevPlanned: num(entries[0]?.prevPlanned),
        addedAfter: entries.reduce((s, e) => s + num(e?.qty), 0),
        reasons: entries.map((e) => e?.reason).filter(Boolean),
      });
      return out;
    }
    const kind = lineAnomaly(line, pulled);
    if (kind && kind !== "skipped") out.push(rowOf(line, pulled, kind));
    return out;
  }, []);

// Only jobs whose materials have actually been pulled. An `approved` job has
// planned lines and no pulls, so every line on it would read as "skipped", and a
// `draft` is not even a commitment yet.
const PULLED_STATES = ["active", "completed", "closed"];

// Deliberately not limited to completed jobs, unlike the profitability report
// beside it. A wrong pull is worth catching while the crew is still on the roof
// and the material is still on the truck — by the time the job is completed the
// cheap fix is gone.
export const jobsNeedingPullReview = (jobs = []) =>
  (jobs || [])
    .filter((j) => j && PULLED_STATES.includes(j.status))
    .map((job) => ({ job, flags: jobPullFlags(job) }))
    .filter((r) => r.flags.length > 0);
