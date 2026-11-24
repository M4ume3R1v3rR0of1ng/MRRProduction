// netlify/functions/_shared/acculynxOutOfDate.js
//
// The I/O half of "AccuLynx out of date": write the flag, file the REVISED report,
// email the people who close jobs. One implementation for the three places that
// discover a job's AccuLynx cost is stale:
//
//   * acculynx-correction-notice.js — the browser, right after a correction
//   * acculynx-sync.js              — a sync that finds our earlier line at another amount
//   * acculynx-retry-sync.js        — the hourly check of jobs supabase/69 marked
//
// Service-role client throughout: every write is filtered by company_id by hand.

import { Resend } from "resend";
import { appOrigin, errorMessage, platformFromAddress } from "./tenant.js";
import { uploadJobDocument } from "./acculynxWrites.js";
import { loadAccuLynxConfig } from "./acculynxCompany.js";
import { loadFleetManagers } from "./fleetRecipients.js";
import { buildCorrectionEmail, buildPoMovedEmail, money } from "./acculynxCorrection.js";
import { buildJobReportPdf } from "../../../src/features/jobs/jobReportPdf.js";

const MAIL_FROM = platformFromAddress("notifications");

// Never the request's own origin: from the iOS app that is capacitor://, which is no
// use as a link in an email.
const APP_URL = () => appOrigin("");

async function fileRevisedReport(admin, { job, ctx, posted, correct, at }) {
  const cfg = await loadAccuLynxConfig(admin, ctx.company || { id: job.company_id });
  if (cfg.skip) return null;
  try {
    const { base64, filename } = await buildJobReportPdf(
      job,
      ctx.users,
      ctx.company?.branding?.logo || null,
      ctx.inv,
      ctx.company,
      { revised: { from: posted, at } },
    );
    const up = await uploadJobDocument(cfg.apiKey, {
      acculynxJobId: job.acculynx_job_id || null,
      poNumber: job.po || null,
      documentFolderId: cfg.config.documentFolderId || null,
      documentFolderName: cfg.config.documentFolderName || "Job Paperwork",
      fileName: filename,
      fileBase64: base64,
      description:
        `REVISED material cost report - ${job.title || job.name || "Job"} ` +
        `(was ${money(posted)}, now ${money(correct)})`,
    });
    return up.ok ? { ok: true, filename } : { ok: false, error: up.error };
  } catch (err) {
    return { ok: false, error: `Could not build the revised report: ${errorMessage(err)}` };
  }
}

// Send one message to everyone in the company who can close jobs.
async function mailJobClosers(admin, { companyId, companyName, replyTo, message }) {
  const recipients = await loadFleetManagers(admin, companyId, { perm: "jobs_close" });
  if (!recipients.length) {
    return {
      emailed: 0,
      emailError: "Nobody in the company can close jobs, so no email was sent.",
    };
  }
  if (!process.env.RESEND_API_KEY) {
    return { emailed: 0, emailError: "Email is not configured on the server." };
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: `${companyName} <${MAIL_FROM}>`,
      to: recipients.map((r) => r.email),
      replyTo: replyTo || undefined,
      subject: message.subject,
      html: message.html,
    });
    return error
      ? { emailed: 0, emailError: error.message }
      : { emailed: recipients.length, emailError: null };
  } catch (err) {
    return { emailed: 0, emailError: errorMessage(err) };
  }
}

/**
 * Flag a job out of date, file the revised report, email the closers.
 *
 * The flag is the part that matters and it is written first; the report and the
 * email are best effort and their failures are reported, not thrown.
 */
export async function flagOutOfDate(
  admin,
  { job, companyId, companyName, ctx, posted, correct, changes = [], byName, replyTo },
) {
  const at = new Date().toISOString();
  const { error } = await admin
    .from("jobs")
    .update({
      acculynx_posted_amount: posted,
      acculynx_correct_amount: correct,
      acculynx_out_of_date_at: at,
    })
    .eq("id", job.id)
    .eq("company_id", companyId);
  if (error) return { ok: false, error: error.message };

  const revised = await fileRevisedReport(admin, { job, ctx, posted, correct, at });
  const message = buildCorrectionEmail({
    companyName,
    job,
    posted,
    correct,
    changes,
    byName,
    revised,
    appUrl: APP_URL(),
  });
  const mail = await mailJobClosers(admin, { companyId, companyName, replyTo, message });
  return { ok: true, at, revised, ...mail };
}

/** The cost is back to what AccuLynx says: take the flag off. */
export async function clearOutOfDate(admin, { jobId, companyId }) {
  const { error } = await admin
    .from("jobs")
    .update({ acculynx_correct_amount: null, acculynx_out_of_date_at: null })
    .eq("id", jobId)
    .eq("company_id", companyId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Mark supabase/69's pending check done, but only if no further change landed
 * since `seq` was read: the trigger bumps the counter on every change, so a
 * correction saved while this check ran keeps its own check.
 */
export async function clearCheckDue(admin, { jobId, companyId, seq }) {
  if (seq === undefined || seq === null) return;
  await admin
    .from("jobs")
    .update({ acculynx_check_due: false, acculynx_items_before: null })
    .eq("id", jobId)
    .eq("company_id", companyId)
    .eq("acculynx_check_seq", seq);
}

/** Email the closers what to remove from the AccuLynx job a changed PO left behind. */
export async function mailPoMoved(admin, { job, companyId, companyName, oldPo, newPoFound }) {
  const posted = job.acculynx_posted_amount;
  const message = buildPoMovedEmail({
    companyName,
    job,
    oldPo,
    newPo: job.po || "(none)",
    posted: posted === null || posted === undefined ? null : Number(posted),
    reportFile: job.report_file_name || null,
    newPoFound,
    appUrl: APP_URL(),
  });
  return mailJobClosers(admin, { companyId, companyName, message });
}
