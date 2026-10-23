// src/features/jobs/addPullMaterials.js
//
// The rules behind "this job needs more material than it was planned for",
// separated from the dialog that presents them (AddPullMaterialsModal) so they
// can be tested without rendering anything — same split pullReview.js draws for
// the same reason.
//
// Three different things land in one dialog here, and keeping them straight is
// most of what this module is for:
//
//   an ORPHAN line  already on the job, sitting at pulled = 0. Either it was
//                   added through the Pull screen's Edit Job (which can append a
//                   line and offers no way to pull it), or the crew entered 0
//                   for it during the original pull. It has an approved
//                   `planned` quantity already.
//   a TOP-UP        already on the job and already pulled, and the roof needs
//                   MORE of it: "I pulled 6 osb but now I need 9 more." The
//                   quantity typed for one of these is what to ADD, not the new
//                   total — see topUpLines below.
//   a NEW line      not on the job at all. It has no plan, because nobody
//                   planned it — the need appeared on the roof.
//
// They commit through the same RPC (supabase/52, extended by 57) and differ only
// in whether the line has to be created and whether it already has a pull to add
// to, which is why one dialog covers all three.
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

// Lines the job already carries that nothing has gone out for.
export const orphanLines = (job) => linesOf(job).filter((l) => (l.pulled || 0) === 0);

// Lines something HAS gone out for, which is the case this dialog used to drop
// on the floor.
//
// It was not an oversight so much as a circle. Until supabase/57 a line at
// pulled > 0 was refused by the RPC behind this dialog and told to use Correct
// Pulled Materials, which refuses an increase and tells you to come back here —
// so the item a crew needed more of appeared in NEITHER screen, and the only
// route through was to un-pull the line to 0 in one dialog and re-pull the new
// total in the other. Nobody found it, it rewrote the first pull's history as a
// correction that never happened, and for a pull with no recorded batch split it
// was refused outright (correctPull.hasBatchHistory).
//
// 57 accumulates instead: a top-up is a SECOND pull against the same line, so
// the quantity entered for one of these is what to ADD. Nothing is undone, the
// original pull's date and batch split survive, and a line with no batch history
// can still be topped up.
export const topUpLines = (job) => linesOf(job).filter((l) => (l.pulled || 0) > 0);

// Inventory still offerable as a NEW line: matches the search and is not already
// on the job in any form. An item already on the job is reached through its own
// line above — whether or not it has been pulled — because offering it twice
// would create a second line for the same item, and `iid` is what every lookup
// in the pull path keys on.
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
//
// Neither do top-ups, for the same reason one step removed: supabase/57 raises a
// topped-up line's `planned` to the new total, because somebody has deliberately
// asked for more and been asked why. Warning that the result is over plan would
// be warning them about the revision they just made on purpose.
export const overPullRows = (lines, qtyOf) =>
  planAnomalies(lines, qtyOf).filter((r) => r.kind !== "skipped");
