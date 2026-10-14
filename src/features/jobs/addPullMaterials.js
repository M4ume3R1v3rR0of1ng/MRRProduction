// src/features/jobs/addPullMaterials.js
//
// The rules behind "this job needs more material than it was planned for",
// separated from the dialog that presents them (AddPullMaterialsModal) so they
// can be tested without rendering anything — same split pullReview.js draws for
// the same reason.
//
// Two different things land in one dialog here, and keeping them straight is
// most of what this module is for:
//
//   an ORPHAN line  already on the job, sitting at pulled = 0. Either it was
//                   added through the Pull screen's Edit Job (which can append a
//                   line and offers no way to pull it), or the crew entered 0
//                   for it during the original pull. It has an approved
//                   `planned` quantity already.
//   a NEW line      not on the job at all. It has no plan, because nobody
//                   planned it — the need appeared on the roof.
//
// They commit through the same RPC (supabase/52) and differ only in whether the
// line has to be created, which is why one dialog covers both.
import { planAnomalies } from "./pullReview";

// Material can be added to a job that has already been pulled, and only to one:
// an `approved` job still has its normal Pull Materials button, and a `closed`
// one has to be reopened first. Same boundary supabase/52 enforces server-side —
// stated here too so the button is never offered for a call that would be
// refused.
//
// `jobs_pull` alone, deliberately. The roles that hold it (`warehouse`, `field`)
// are the people who pull material and the people who discover the shortfall,
// and gating this on jobs_build or jobs_edit_pull is what made the existing
// Pull Added Materials button unreachable for both of them.
export const ADDABLE_STATES = ["active", "completed"];

export const canAddPull = (job, perms = {}) =>
  Boolean(job) && Boolean(perms.jobs_pull) && ADDABLE_STATES.includes(job.status);

const linesOf = (job) => (job?.items || job?.materials || []).filter(Boolean);

// Lines the job already carries that nothing has gone out for. Anything with
// pulled > 0 is out of scope here and belongs to correct_job_pull (supabase/51),
// which is why supabase/52 refuses it rather than trusting this filter.
export const orphanLines = (job) => linesOf(job).filter((l) => (l.pulled || 0) === 0);

// Inventory still offerable as a NEW line: matches the search and is not already
// on the job in any form. An item already on the job is reached through its own
// line above — offering it twice would create a second line for the same item,
// and `iid` is what every lookup in the pull path keys on.
export const addableForPull = (inv = [], job, query = "") => {
  const onJob = new Set(linesOf(job).map((l) => l.iid));
  const q = query.trim().toLowerCase();
  return (inv || []).filter(
    (i) => i && !onJob.has(i.id) && (i.name || "").toLowerCase().includes(q),
  );
};

// Which of the orphan lines disagree with the plan badly enough to confirm
// before committing — the same judgement, at the same threshold, that
// confirmPull applies to the initial pull. One definition, from pullReview.
//
// "skipped" is dropped, unlike the initial pull. There it means a planned line
// was left at zero, which is the tell for a quantity typed into the wrong row.
// Here leaving a line at zero is the normal case: the dialog lists every orphan
// line on the job and the crew may want exactly one of them. Warning about the
// other two every time is how a confirmation dialog becomes a thing people click
// through without reading.
//
// New lines never reach this. Their `planned` is set to the quantity being
// pulled (see supabase/52 for why), so there is nothing for them to disagree
// with.
export const overPullRows = (lines, qtyOf) =>
  planAnomalies(lines, qtyOf).filter((r) => r.kind !== "skipped");
