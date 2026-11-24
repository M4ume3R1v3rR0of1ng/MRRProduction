// netlify/functions/_shared/acculynxCorrection.js
//
// The pure half of acculynx-correction-notice.js: given a job whose materials were
// just corrected, is AccuLynx now wrong, and what does the person who fixes it need
// to be told? No I/O here, so every branch is tested without a database.
//
// Steadwerk never edits or adds to an expense it already posted (the duplicate guard
// matches on amount, so a second post of a corrected total sits beside the first).
// It records the difference and tells a person precisely what to change instead.

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

export const money = (n) =>
  (Number(n) < 0 ? "-$" : "$") +
  Math.abs(Number(n))
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * What to do about one corrected job.
 *
 * `beforeAmount` is the cost the browser computed from the job as it stood BEFORE
 * the correction. It is only used for a job synced before supabase/68, which has no
 * acculynx_posted_amount; from then on the stored figure wins, so a correction the
 * browser never reported is still caught by the next one.
 *
 * @returns {{ action: "none", reason: string }
 *   | { action: "clear", posted: number }
 *   | { action: "flag", posted: number, correct: number, diff: number }}
 */
export function planCorrectionNotice({ job, newAmount, beforeAmount }) {
  let posted = num(job?.acculynx_posted_amount);
  if (posted === null) {
    // Only "synced" proves the cost reached AccuLynx. Any other state is still in
    // the retry queue, and the retry posts whatever the job says now, so the
    // correction will land without anyone's help.
    if (job?.syncStatus !== "synced") return { action: "none", reason: "not-posted" };
    const before = num(beforeAmount);
    if (before === null || !Number.isFinite(before)) {
      return { action: "none", reason: "no-baseline" };
    }
    posted = round2(before);
  }

  const correct = round2(newAmount);
  if (!Number.isFinite(correct)) return { action: "none", reason: "no-amount" };

  const flagged = num(job?.acculynx_correct_amount);
  if (same(correct, posted)) {
    // Corrected back to what AccuLynx already says: nothing is owed any more.
    return flagged === null ? { action: "none", reason: "matches" } : { action: "clear", posted };
  }
  // Already told everyone this exact figure. A repeat call (a double click, a retry)
  // must not file a second revised report or send a second email.
  if (flagged !== null && same(flagged, correct)) {
    return { action: "none", reason: "already-flagged" };
  }
  return { action: "flag", posted, correct, diff: round2(correct - posted) };
}

/**
 * The browser's description of what changed, cleaned for an email. It is display
 * text only; the amounts are always computed on the server.
 */
export function cleanChanges(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).flatMap((c) => {
    const from = Number(c?.from);
    const to = Number(c?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return [];
    const field = c?.field === "pulled" ? "pulled" : "returned";
    return [
      {
        iname: String(c?.iname || "Item").slice(0, 120),
        unit: String(c?.unit || "").slice(0, 20),
        field,
        from,
        to,
      },
    ];
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The email sent when a job's PO changed after its cost or report reached AccuLynx
 * under the old one. Steadwerk cannot delete from AccuLynx, so a person removes the
 * old filing; Steadwerk files again under the new PO itself.
 *
 * @param {{ companyName: string, job: object, oldPo: string, newPo: string,
 *   posted: number | null, reportFile: string | null, newPoFound: boolean,
 *   appUrl: string }} p
 */
export function buildPoMovedEmail({
  companyName,
  job,
  oldPo,
  newPo,
  posted,
  reportFile,
  newPoFound,
  appUrl,
}) {
  const title = job?.title || job?.name || "Job";
  const filed = [
    posted !== null && posted !== undefined && Number(posted) > 0
      ? `the expense <strong>"Material Cost - ${escapeHtml(title)}"</strong> (${money(posted)})`
      : null,
    reportFile ? `the report <strong>${escapeHtml(reportFile)}</strong>` : null,
  ].filter(Boolean);
  const what = filed.length ? filed.join(" and ") : "anything Steadwerk filed for this job";

  const next = newPoFound
    ? `<p>Steadwerk will file the cost and report on AccuLynx job <strong>${escapeHtml(newPo)}</strong> within the hour. Nothing needs adding there by hand.</p>`
    : `<p><strong>PO ${escapeHtml(newPo)} matches no job in AccuLynx</strong>, so nothing can be filed under it yet. Correct the PO in Build Jobs and Steadwerk will file it on the next hourly run.</p>`;

  return {
    subject: `AccuLynx: remove ${title} from job ${oldPo} (PO changed to ${newPo})`,
    html:
      `<p>The PO on <strong>${escapeHtml(title)}</strong> was changed from <strong>${escapeHtml(oldPo)}</strong> ` +
      `to <strong>${escapeHtml(newPo)}</strong> after it had been sent to AccuLynx under the old PO.</p>` +
      `<p style="font-size:16px">In AccuLynx, open job <strong>${escapeHtml(oldPo)}</strong> and remove ${what}. ` +
      `They belong to a different job.</p>` +
      next +
      (appUrl ? `<p><a href="${escapeHtml(appUrl)}">Open Steadwerk</a></p>` : "") +
      `<p style="color:#64748b;font-size:12px">Sent by Steadwerk for ${escapeHtml(companyName)} to people who can close jobs.</p>`,
  };
}

/**
 * The email to the people who close jobs.
 *
 * @param {{ companyName: string, job: object, posted: number, correct: number,
 *   changes: Array<{iname:string, unit:string, field:string, from:number, to:number}>,
 *   byName: string, revised: { ok: boolean, filename?: string, error?: string } | null,
 *   appUrl: string }} p
 */
export function buildCorrectionEmail({
  companyName,
  job,
  posted,
  correct,
  changes = [],
  byName,
  revised,
  appUrl,
}) {
  const po = job?.po || "no PO";
  const title = job?.title || job?.name || "Job";
  const diff = round2(correct - posted);
  const sign = diff > 0 ? "+" : "";

  const instruction =
    posted > 0
      ? `In AccuLynx, open job <strong>${escapeHtml(po)}</strong>, find the expense ` +
        `<strong>"Material Cost - ${escapeHtml(title)}"</strong> and change its amount from ` +
        `<strong>${money(posted)}</strong> to <strong>${money(correct)}</strong>.`
      : `In AccuLynx, open job <strong>${escapeHtml(po)}</strong> and add a material cost ` +
        `expense of <strong>${money(correct)}</strong>. Steadwerk posted none, because the ` +
        `job had no material cost when it was completed.`;

  const rows = changes
    .map(
      (c) =>
        `<tr><td style="padding:4px 10px">${escapeHtml(c.iname)}</td>` +
        `<td style="padding:4px 10px">${c.field === "pulled" ? "Pulled" : "Returned"}</td>` +
        `<td style="padding:4px 10px;text-align:right">${c.from} ${escapeHtml(c.unit)}</td>` +
        `<td style="padding:4px 10px;text-align:right"><strong>${c.to} ${escapeHtml(c.unit)}</strong></td></tr>`,
    )
    .join("");
  const table = rows
    ? `<table style="border-collapse:collapse;margin:8px 0 14px;font-size:14px">` +
      `<tr style="background:#EEF2FA"><th style="padding:4px 10px;text-align:left">Item</th>` +
      `<th style="padding:4px 10px;text-align:left">Count</th><th style="padding:4px 10px">Was</th>` +
      `<th style="padding:4px 10px">Now</th></tr>${rows}</table>`
    : "";

  const report = !revised
    ? ""
    : revised.ok
      ? `<p>A revised report (<strong>${escapeHtml(revised.filename)}</strong>) has been filed on the AccuLynx job beside the original.</p>`
      : `<p>The revised report could not be filed on the AccuLynx job: ${escapeHtml(revised.error || "unknown error")}. You can print it from the job in Steadwerk.</p>`;

  return {
    subject: `AccuLynx needs updating: ${po} material cost ${money(posted)} → ${money(correct)}`,
    html:
      `<p>${escapeHtml(byName || "Someone")} corrected the materials on <strong>${escapeHtml(title)}</strong> ` +
      `(PO ${escapeHtml(po)}) after its cost was already sent to AccuLynx. AccuLynx still shows the old cost.</p>` +
      table +
      `<p style="font-size:16px">${instruction}<br>Difference: <strong>${sign}${money(diff)}</strong> (tax included).</p>` +
      report +
      `<p>When it is done, press <strong>Updated in AccuLynx</strong> on the job in Build Jobs so it stops showing as out of date.</p>` +
      (appUrl ? `<p><a href="${escapeHtml(appUrl)}">Open Steadwerk</a></p>` : "") +
      `<p style="color:#64748b;font-size:12px">Sent by Steadwerk for ${escapeHtml(companyName)} to people who can close jobs.</p>`,
  };
}
