// netlify/functions/acculynx-correction-notice.js
//
// "AccuLynx out of date": called by the browser right after a material correction
// (Correct Return, Correct Pulled Materials, a late top-up, removing a pulled line).
//
// Steadwerk posts a job's material cost to AccuLynx once. A correction afterwards
// fixes the job here and, deliberately, never posts again (see supabase/68 for why a
// second post double-books). So this closes the loop by telling a person:
//
//   1. Re-reads the job and recomputes its cost ON THE SERVER, from the same
//      buildCostPayload the original post used. The browser's numbers are not
//      trusted for the amount.
//   2. If AccuLynx's figure no longer matches, flags the job, files a REVISED report
//      and emails everyone who can close jobs (_shared/acculynxOutOfDate.js).
//
// This is the fast path. The hourly retry does the same check for every job the
// supabase/69 trigger marked, so a correction whose call never arrived (no signal)
// is still caught. Calling it twice for the same figure does nothing the second time.

import { adminClient, corsHeaders, errorMessage, resolveCaller } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { checkRateLimit, rateLimitedResponse } from "./_shared/rateLimit.js";
import { loadReportContext } from "./_shared/acculynxCompany.js";
import { cleanChanges, planCorrectionNotice } from "./_shared/acculynxCorrection.js";
import { clearCheckDue, clearOutOfDate, flagOutOfDate } from "./_shared/acculynxOutOfDate.js";
import { buildCostPayload } from "../../src/features/jobs/accuLynxPayload.js";

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

    // supabase/68 not run yet: nothing to record into.
    if (!("acculynx_correct_amount" in job)) {
      return reply(200, { ok: true, skipped: "Run supabase/68_acculynx_out_of_date.sql." });
    }

    const ctx = await loadReportContext(admin, caller.companyId);
    const { amount } = buildCostPayload(job, ctx.users, ctx.inv, ctx.company);
    const plan = planCorrectionNotice({ job, newAmount: amount, beforeAmount });
    const done = (payload) =>
      clearCheckDue(admin, {
        jobId: job.id,
        companyId: caller.companyId,
        seq: job.acculynx_check_seq,
      }).then(() => reply(200, payload));

    if (plan.action === "none") return done({ ok: true, skipped: plan.reason });

    if (plan.action === "clear") {
      const r = await clearOutOfDate(admin, { jobId: job.id, companyId: caller.companyId });
      if (!r.ok) return reply(500, { error: r.error });
      return done({ ok: true, cleared: true, posted: plan.posted });
    }

    const me = ctx.users.find((u) => u.id === caller.userId);
    const r = await flagOutOfDate(admin, {
      job,
      companyId: caller.companyId,
      companyName: caller.companyName,
      ctx,
      posted: plan.posted,
      correct: plan.correct,
      changes: cleanChanges(changes),
      byName: me?.full_name || me?.name || caller.email,
      replyTo: caller.email,
    });
    if (!r.ok) return reply(500, { error: r.error });

    return done({
      ok: true,
      outOfDate: true,
      posted: plan.posted,
      correct: plan.correct,
      diff: plan.diff,
      at: r.at,
      revised: r.revised,
      emailed: r.emailed,
      emailError: r.emailError,
    });
  } catch (err) {
    return reply(500, { error: errorMessage(err) });
  }
};

export const handler = withSentry("acculynx-correction-notice", rawHandler);
