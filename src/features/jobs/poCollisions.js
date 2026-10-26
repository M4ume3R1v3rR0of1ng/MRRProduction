// src/features/jobs/poCollisions.js
//
// Two internal jobs, one AccuLynx job, and a cost that silently never posts.
//
// THE PROBLEM
//
// supabase/17 removed the unique constraint on (company_id, acculynx_job_id) so one
// AccuLynx job can carry several internal jobs — real multi-crew work, two crews on
// one roof, each pulling their own materials against the same PO.
//
// The expense de-duplication guard in netlify/functions/_shared/acculynxWrites.js
// matches a prior expense on AMOUNT + refNumber, and refNumber is the PO. That is
// exactly right for its actual job, which is stopping a retry of a timed-out post
// from booking the cost twice. But on a shared PO it cannot tell our own earlier
// post from a SIBLING job's post of the same amount — and two crews drawing the
// same materials off the same truck for the same roof land on equal totals far more
// often than the arithmetic suggests.
//
// When that happens AccuLynx answers "already recorded", the sync reports success,
// the job goes green, and the second crew's material cost is never on the job at
// all. A failure that announces itself is cheap; this one doesn't.
//
// WHY A WARNING AND NOT A FIX
//
// The fix that suggests itself — put the internal job id in refNumber so the two
// lines cannot collide — would be a double-billing bug on the way in. Every expense
// already in AccuLynx is stamped with the bare PO, so the guard would stop
// recognising its own earlier posts and the first retry of any already-posted job
// would book the cost a second time. Against real money, in a customer's books.
//
// So this detects the collision BEFORE the second job is finished, while there is
// still a person there to tell. They can split the PO, merge the two jobs, or post
// the second cost by hand — all decisions that need a human who knows what the two
// crews actually did.

import { buildJobReportModel } from "./pdfGenerator.js";

// Is this the same AccuLynx job? The id when both jobs carry one (the wizard linked
// them), otherwise the PO, which is what the server matches on when they don't.
// Compared case- and space-insensitively because a PO typed twice by two people is
// typed two ways.
const samePo = (a, b) => {
  const idA = a?.acculynx_job_id || null;
  const idB = b?.acculynx_job_id || null;
  if (idA && idB) return idA === idB;
  const poA = String(a?.po ?? "")
    .trim()
    .toLowerCase();
  const poB = String(b?.po ?? "")
    .trim()
    .toLowerCase();
  return !!poA && poA === poB;
};

/**
 * Other jobs that would post onto the same AccuLynx job as `job`.
 *
 * Drafts are excluded: nothing has been pulled against them, so they have no cost
 * to collide with and warning about one would be noise on every re-used PO.
 */
export function siblingJobsOnPo(job, jobs = []) {
  if (!job) return [];
  return jobs.filter((j) => j && j.id !== job.id && j.status !== "draft" && samePo(job, j));
}

// The amount as AccuLynx will hold it, and as the guard compares it: cents, after
// tax. Two jobs "the same" to the penny is the whole question, so the rounding has
// to match postJobExpense's own (Math.round(x * 100) / 100) rather than be near it.
const costOf = (job, users, inv, company) => {
  const m = buildJobReportModel(job, users, inv, company);
  return Math.round(m.totalWithTax * 100) / 100;
};

/**
 * Would this job's cost be mistaken for a sibling's?
 *
 * Returns null when there is nothing to say, or the colliding sibling plus the
 * amount both jobs land on. Only a sibling that has ALREADY SENT its cost can
 * shadow this one — a sibling still in progress has posted nothing for the guard to
 * match, and warning about it would be a warning about the future.
 *
 * @returns {{ sibling: object, amount: number } | null}
 */
export function collidingSibling({ job, jobs = [], users = [], inv = [], company = null }) {
  if (!job) return null;

  const amount = costOf(job, users, inv, company);
  // No cost to post means no collision to have: postJobExpense skips the call.
  if (!(amount > 0)) return null;

  const sibling = siblingJobsOnPo(job, jobs).find((s) => {
    // "Has sent something" is the report being filed or the status reaching a
    // terminal state — the same two facts the sync itself writes down. A sibling
    // that merely exists is not a problem.
    const hasSent =
      !!s.report_uploaded_at || s.syncStatus === "synced" || s.syncStatus === "failed";
    if (!hasSent) return false;
    return Math.abs(costOf(s, users, inv, company) - amount) < 0.005;
  });

  return sibling ? { sibling, amount } : null;
}
