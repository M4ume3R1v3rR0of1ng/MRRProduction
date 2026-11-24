// src/features/jobs/accuLynxCorrection.js
//
// After a material correction, tell the server so it can flag "AccuLynx out of date",
// file a revised report and email the people who close jobs. The decision and the
// amounts are the server's (netlify/functions/acculynx-correction-notice.js); this
// only supplies what the browser alone knows: the job as it stood BEFORE the
// correction, and which counts changed.
import { getAccessToken, updateRowStrict } from "@/shared/utils/supabase";
import { buildCostPayload } from "./accuLynxPayload";
import { postedAmountOf, correctAmountOf, syncStatusOf } from "./accuLynxSync";

const ENDPOINT = "/.netlify/functions/acculynx-correction-notice";

const linesOf = (job) => (job?.items || job?.materials || []).filter(Boolean);

/**
 * Which pulled/returned counts differ between two versions of a job. A line Edit
 * Job removed counts as going to 0, since its cost leaves the job with it.
 */
export function correctionChanges(before, after) {
  const prior = new Map(linesOf(before).map((i) => [i.iid, i]));
  const now = new Map(linesOf(after).map((i) => [i.iid, i]));
  const out = [];
  for (const iid of new Set([...prior.keys(), ...now.keys()])) {
    const was = prior.get(iid) || {};
    const is = now.get(iid) || {};
    const line = now.get(iid) || was;
    for (const field of ["pulled", "returned"]) {
      const from = parseFloat(was[field]) || 0;
      const to = parseFloat(is[field]) || 0;
      if (from !== to) out.push({ iname: line.iname, unit: line.unit || "", field, from, to });
    }
  }
  return out;
}

/** Could AccuLynx already hold a cost for this job? If not there is nothing to correct. */
export const mayHavePostedCost = (job) =>
  postedAmountOf(job) !== null || syncStatusOf(job) === "synced";

/**
 * Report a correction. Never throws: the correction itself is already saved, and
 * failing to send the notice must not look like failing to save it.
 *
 * Returns null when there was nothing to report, otherwise the server's answer
 * ({ outOfDate, cleared, posted, correct, emailed, emailError, revised }) or
 * { error }.
 */
export async function reportAccuLynxCorrection({
  before,
  after,
  users = [],
  inv = [],
  company = null,
  setJobs,
}) {
  if (!after?.id || !mayHavePostedCost(before)) return null;
  const changes = correctionChanges(before, after);
  if (changes.length === 0) return null;

  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return { error: "Your sign-in session expired." };
    const { amount: beforeAmount } = buildCostPayload(before, users, inv, company);

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, jobId: after.id, beforeAmount, changes }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { error: data.error || `HTTP ${res.status}` };

    if (data.outOfDate || data.cleared) {
      const fields = data.outOfDate
        ? {
            acculynx_posted_amount: data.posted,
            acculynx_correct_amount: data.correct,
            acculynx_out_of_date_at: data.at,
          }
        : { acculynx_correct_amount: null, acculynx_out_of_date_at: null };
      if (typeof setJobs === "function") {
        setJobs((p) => p.map((j) => (j.id === after.id ? { ...j, ...fields } : j)));
      }
      return { ...data, fields };
    }
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Someone changed the expense in AccuLynx by hand. AccuLynx now says the corrected
 * figure, so that becomes the posted amount and the flag clears.
 */
export async function markAccuLynxUpdated(job) {
  const correct = correctAmountOf(job);
  if (correct === null) return { ok: true, fields: {} };
  const fields = {
    acculynx_posted_amount: correct,
    acculynx_correct_amount: null,
    acculynx_out_of_date_at: null,
  };
  const { error } = await updateRowStrict("jobs", job.id, fields);
  return error ? { ok: false, error: error.message } : { ok: true, fields };
}
