// src/features/inventory/jobsForItem.js
//
// "Was this a job's miscount?" Adjust Stock fixes the shelf and nothing else. When
// the real mistake was on a job (logged as taking 5, really 4; logged as returning
// 3, really 2), fixing it here leaves that job's cost wrong and AccuLynx with it.
// The job's own correction tools move the stock AND fix the job, and the job then
// tells AccuLynx (supabase/68, 69). So Adjust Stock lists the jobs that recently
// pulled this item and sends people there.

// Only jobs whose pull can still be corrected (see correctPull.js and
// addPullMaterials.js). A closed job has to be reopened first, which is a
// bookkeeper's decision, so it is not offered as a one-click route.
const CORRECTABLE = ["active", "completed"];

const whenOf = (job) =>
  Date.parse(job?.completed || job?.completedAt || "") ||
  Date.parse(job?.created || job?.createdAt || "") ||
  0;

/**
 * Recent correctable jobs that pulled `itemId`, newest first.
 * @returns {Array<{ id, po, title, status, pulled, returned, unit }>}
 */
export function jobsThatPulled(jobs, itemId, { limit = 5, days = 60, now = Date.now() } = {}) {
  const since = now - days * 86400_000;
  const out = [];
  for (const job of jobs || []) {
    if (!job || !CORRECTABLE.includes(job.status)) continue;
    const line = (job.items || job.materials || []).find(
      (l) => l && l.iid === itemId && (parseFloat(l.pulled) || 0) > 0,
    );
    if (!line) continue;
    const when = whenOf(job);
    if (when && when < since) continue;
    out.push({
      id: job.id,
      po: job.po || "",
      title: job.title || job.name || "",
      status: job.status,
      pulled: parseFloat(line.pulled) || 0,
      returned: parseFloat(line.returned) || 0,
      unit: line.unit || "",
      when,
    });
  }
  return out.sort((a, b) => b.when - a.when).slice(0, limit);
}
