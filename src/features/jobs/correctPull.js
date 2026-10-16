// src/features/jobs/correctPull.js
//
// The rules behind "that pull was wrong", separated from the dialog that
// presents them (CorrectPullModal) so they can be tested without rendering
// anything — the same split addPullMaterials.js and pullReview.js draw.
//
// correct_job_pull (supabase/51) has existed, installed and granted, since
// phase 51, and until now nothing in the app called it. The gap that left is
// not a cosmetic one: `pulled` is structurally unwritable from anywhere else
// (51's header sets out why), so a wrong pull had no route back, and the two
// halves of the material path pointed at each other in a loop —
// add_and_pull_job_materials (52) refuses a line at pulled > 0 and names
// Correct Pulled Materials, which did not exist.
//
// WHY `jobs_pull`, AND WHY NOT INSIDE EDIT JOB
//
// Verbatim from 51's note to whoever wrote this UI: Correct Return and Pull
// Added Materials are both reached from inside Edit Job, gated on
// `jobs_edit_pull`. Putting this one there too would leave the RPC callable by
// warehouse staff and the only route to it closed to them — `warehouse` is the
// role that pulls, and so the role that mis-pulls, and it holds `jobs_pull`
// and none of `inv_adjust`, `jobs_edit_pull`, `jobs_close`. It belongs on the
// job card and detail drawer, beside Need More Materials, under `jobs_pull`
// alone.
// Deliberately NOT the `num` the pull dialogs keep locally: that one folds
// anything unparseable to 0, and 0 is a meaningful correction here (back the
// line out entirely). A blank box has to stay distinguishable from a typed
// zero, so this returns NaN and every caller below checks for it.
const parseQty = (v) => {
  if (v === "" || v === null || v === undefined) return NaN;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
};

// On-line quantities come from the job row and are already numbers; this is
// just a guard against a null landing in the arithmetic.
const onLine = (v) => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// Same boundary the RPC enforces (51:194). A `closed` job has to be reopened
// first; an `approved` one has not been pulled yet, so there is no pull to put
// right.
export const CORRECTABLE_STATES = ["active", "completed"];

const linesOf = (job) => (job?.items || job?.materials || []).filter(Boolean);

// Only a line something actually went out on can be corrected. A line at
// pulled = 0 is Need More Materials' job, and 51 refuses it by name.
export const correctableLines = (job) => linesOf(job).filter((l) => (l.pulled || 0) > 0);

export const canCorrectPull = (job, perms = {}) =>
  Boolean(job) &&
  Boolean(perms.jobs_pull) &&
  CORRECTABLE_STATES.includes(job?.status) &&
  correctableLines(job).length > 0;

// A line whose material was pulled before doFifo recorded the per-batch split
// cannot be credited back exactly, and 51 refuses it rather than guessing
// (51:251). Saying so in the dialog, against the row, beats letting someone
// type a number and meet the exception on save.
export const hasBatchHistory = (line) => Array.isArray(line?.consumed) && line.consumed.length > 0;

// The floor a line can be corrected to. Units already returned are sitting back
// in stock under their own batch, which 51 deliberately does not touch, so
// correcting `pulled` below `returned` would leave the job claiming more came
// back than ever went out (51:237).
export const floorFor = (line) => Math.max(0, onLine(line?.returned));

// Why a row cannot be corrected at all, or null if it can. One reason per row,
// in the order the RPC would hit them, so the dialog never disables a row for
// one cause while the server would have named another.
export const blockedReason = (line) => {
  if (!hasBatchHistory(line)) return "noHistory";
  if (floorFor(line) >= onLine(line?.pulled)) return "allReturned";
  return null;
};

// The `p_unpull` payload: every row whose corrected total differs from what is
// on the line now. Unchanged rows are dropped rather than sent — 51 skips them
// harmlessly, but sending them makes the audit entry claim work that did not
// happen.
//
// Nothing is clamped here. A quantity above `pulled` or below `returned` is a
// mistake worth a message, not a number to silently round into range, and
// `invalidRows` is what the dialog shows instead.
export const correctionsFrom = (lines, qtyOf) => {
  const out = {};
  for (const line of lines) {
    if (blockedReason(line)) continue;
    const next = parseQty(qtyOf(line.iid));
    if (!Number.isFinite(next)) continue;
    if (next === onLine(line.pulled)) continue;
    out[line.iid] = next;
  }
  return out;
};

// Rows the RPC would refuse, found before the call so all of them surface at
// once rather than one exception at a time.
export const invalidRows = (lines, qtyOf) =>
  lines
    .filter((l) => !blockedReason(l))
    .map((line) => {
      const next = parseQty(qtyOf(line.iid));
      const pulled = onLine(line.pulled);
      const floor = floorFor(line);
      if (!Number.isFinite(next)) return { iid: line.iid, line, kind: "blank" };
      if (next < 0) return { iid: line.iid, line, kind: "negative" };
      // 51 can only reduce a pull. Raising one is a fresh FIFO deduction, which
      // is Need More Materials' job — the error message says so, and so does
      // this dialog rather than letting someone find out on save.
      if (next > pulled) return { iid: line.iid, line, kind: "increase", pulled };
      if (next < floor) return { iid: line.iid, line, kind: "belowReturned", floor };
      return null;
    })
    .filter(Boolean);
