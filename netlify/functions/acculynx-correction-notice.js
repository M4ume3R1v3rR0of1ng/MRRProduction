// netlify/functions/acculynx-correction-notice.js
//
// "AccuLynx out of date": called by the browser right after a material correction
// (Correct Return, Correct Pulled Materials, a late top-up) on a job.
//
// Steadwerk posts a job's material cost to AccuLynx once. A correction afterwards
// fixes the job here and, deliberately, never posts again (see supabase/68 for why a
// second post double-books). So this function closes the loop by telling a person:
//
//   1. Re-reads the job and recomputes its cost ON THE SERVER, from the same
//      buildCostPayload the original post used. The browser's numbers are not
//      trusted for the amount.
//   2. If AccuLynx's figure no longer matches, records both on the job
//      (acculynx_posted_amount / acculynx_correct_amount), which puts the
//      "AccuLynx out of date" badge on it in Build Jobs.
//   3. Files a REVISED report on the AccuLynx job beside the original.
//   4. Emails everyone who can close jobs (jobs_close) the exact change to make.
//
// Calling it twice for the same figure does nothing the second time, and a job whose
// cost never reached AccuLynx is left to the hourly retry, which posts the corrected
// figure by itself.

import { Resend } from "resend";
import {
  adminClient,
  appOrigin,
  corsHeaders,
  errorMessage,
  platformFromAddress,
  resolveCaller,
} from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { checkRateLimit, rateLimitedResponse } from "./_shared/rateLimit.js";
import { uploadJobDocument } from "./_shared/acculynxWrites.js";
import { loadAccuLynxConfig, loadReportContext } from "./_shared/acculynxCompany.js";
import { loadFleetManagers } from "./_shared/fleetRecipients.js";
import {
  buildCorrectionEmail,
  cleanChanges,
  money,
  planCorrectionNotice,
} from "./_shared/acculynxCorrection.js";
// Same two functions the original post and report came from, so the "correct" figure
// is computed exactly as the posted one was.
import { buildCostPayload } from "../../src/features/jobs/accuLynxPayload.js";
import { buildJobReportPdf } from "../../src/features/jobs/jobReportPdf.js";

const MAIL_FROM = platformFromAddress("notifications");

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

const rawHandler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin || "");
  const reply = (statusCode, payload) => ({
    statusCode,
    headers,
    body: JSON.stringify(payload),
  });

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });

  try {
    const { accessToken, jobId, beforeAmount, changes } = JSON.parse(event.body || "{}");

    const admin = adminClient();
    const { caller, error: callerError } = await resolveCaller(admin, accessToken);
    if (callerError) return reply(callerError.status, { error: callerError.message });

    // A person saves a correction a few times a day at most. Each flagged call can
    // file a report and send mail, so keep a lid on it.
    const rl = checkRateLimit(`acculynx-correction-notice:${caller.userId}`, {
      max: 30,
      windowMs: 10 * 60 * 1000,
    });
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds, headers);

    if (!jobId) return reply(400, { error: "Missing jobId." });

    // Service-role client: the company_id filter is the only thing keeping this to
    // the caller's own company.
    const { data: job, error: jobError } = await admin
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("company_id", caller.companyId)
      .maybeSingle();
    if (jobError) return reply(500, { error: jobError.message });
    if (!job) return reply(404, { error: "Job not found." });

    // supabase/68 not run yet: nothing to record into. Not an error the person who
    // saved the correction can do anything about.
    if (!("acculynx_correct_amount" in job)) {
      return reply(200, { ok: true, skipped: "Run supabase/68_acculynx_out_of_date.sql." });
    }

    const ctx = await loadReportContext(admin, caller.companyId);
    const { amount } = buildCostPayload(job, ctx.users, ctx.inv, ctx.company);
    const plan = planCorrectionNotice({ job, newAmount: amount, beforeAmount });

    if (plan.action === "none") return reply(200, { ok: true, skipped: plan.reason });

    if (plan.action === "clear") {
      const { error } = await admin
        .from("jobs")
        .update({ acculynx_correct_amount: null, acculynx_out_of_date_at: null })
        .eq("id", job.id)
        .eq("company_id", caller.companyId);
      if (error) return reply(500, { error: error.message });
      return reply(200, { ok: true, cleared: true, posted: plan.posted });
    }

    const at = new Date().toISOString();
    const { error: flagError } = await admin
      .from("jobs")
      .update({
        acculynx_posted_amount: plan.posted,
        acculynx_correct_amount: plan.correct,
        acculynx_out_of_date_at: at,
      })
      .eq("id", job.id)
      .eq("company_id", caller.companyId);
    if (flagError) return reply(500, { error: flagError.message });

    // The flag is the part that matters, and it is written. The report and the email
    // are best effort from here: either failing is reported, not fatal.
    const revised = await fileRevisedReport(admin, {
      job,
      ctx,
      posted: plan.posted,
      correct: plan.correct,
      at,
    });

    let emailed = 0;
    let emailError = null;
    const recipients = await loadFleetManagers(admin, caller.companyId, { perm: "jobs_close" });
    if (recipients.length && process.env.RESEND_API_KEY) {
      const me = ctx.users.find((u) => u.id === caller.userId);
      const message = buildCorrectionEmail({
        companyName: caller.companyName,
        job,
        posted: plan.posted,
        correct: plan.correct,
        changes: cleanChanges(changes),
        byName: me?.full_name || me?.name || caller.email,
        revised,
        // Never the request's own origin: from the iOS app that is capacitor://,
        // which is no use as a link in an email.
        appUrl: appOrigin(""),
      });
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error } = await resend.emails.send({
          from: `${caller.companyName} <${MAIL_FROM}>`,
          to: recipients.map((r) => r.email),
          replyTo: caller.email || undefined,
          subject: message.subject,
          html: message.html,
        });
        if (error) emailError = error.message;
        else emailed = recipients.length;
      } catch (err) {
        emailError = errorMessage(err);
      }
    } else if (!recipients.length) {
      emailError = "Nobody in the company can close jobs, so no email was sent.";
    } else {
      emailError = "Email is not configured on the server.";
    }

    return reply(200, {
      ok: true,
      outOfDate: true,
      posted: plan.posted,
      correct: plan.correct,
      diff: plan.diff,
      at,
      revised,
      emailed,
      emailError,
    });
  } catch (err) {
    return reply(500, { error: errorMessage(err) });
  }
};

export const handler = withSentry("acculynx-correction-notice", rawHandler);
