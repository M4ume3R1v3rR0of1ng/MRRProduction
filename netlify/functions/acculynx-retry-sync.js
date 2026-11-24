// netlify/functions/acculynx-retry-sync.js
//
// Finish the AccuLynx paperwork nobody's browser managed to finish.
//
// WHY THIS EXISTS
//
// "Auto sync" used to mean one single attempt, in one browser tab, at the instant a
// crew pressed Complete in Pull Inventory. One shot. If the van was out of signal,
// if the tab was closed, if AccuLynx answered 500, if the person tapped "Complete
// anyway" — that was the end of it. Completed jobs then drop off Pull Inventory by
// design, so the crew had nothing left to press, and the only remaining retry was
// Close Job in Build Jobs, which needs jobs_close. A warehouse lead without that
// permission could watch a job sit unsynced forever and do nothing about it.
//
// So the retry stops being a person's job. This runs hourly, finds every completed
// or closed job that still owes AccuLynx something, and sends it — with no session,
// no permission check and no browser involved. The service-role client also passes
// straight through enforce_job_perms() (it gates `authenticated`, not the backend),
// which is the point: the cron is not acting as anybody.
//
// WHAT IT DOES NOT DO
//
// It does not invent work. A job only becomes a candidate once a human has marked
// it complete, and the company must have the integration enabled with Auto Sync on.
// Turning Auto Sync off in Settings turns this off too, per company.
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (via adminClient),
//      ACCULYNX_API_KEY (legacy fallback for maumee-river-roofing only).

import { adminClient } from "./_shared/tenant.js";
import { loadAccuLynxConfig, loadReportContext } from "./_shared/acculynxCompany.js";
import {
  postJobExpense,
  resolveAccuLynxJobId,
  uploadJobDocument,
} from "./_shared/acculynxWrites.js";
import { planCorrectionNotice } from "./_shared/acculynxCorrection.js";
import {
  clearCheckDue,
  clearOutOfDate,
  flagOutOfDate,
  mailPoMoved,
} from "./_shared/acculynxOutOfDate.js";
import { withSentry } from "./_shared/sentry.js";
// The browser's own report code, imported rather than reimplemented. The cost this
// posts and the PDF it files are byte-for-byte what Pull Inventory would have sent,
// because they come from the same two functions — see the import comment in
// pdfGenerator.js for why those modules use relative, extension-ful specifiers.
//
// This is load-bearing, not tidiness. The expense de-duplication guard matches a
// prior posting on the AMOUNT to the penny, so a retry that computed the figure
// from a second copy of the arithmetic would not recognise itself: it would post
// the material cost onto the job twice.
import { buildCostPayload, materialCountChanges } from "../../src/features/jobs/accuLynxPayload.js";
import { buildJobReportPdf } from "../../src/features/jobs/jobReportPdf.js";

// How many jobs one run will attempt. A job costs up to four AccuLynx round trips
// plus a PDF render, and a scheduled function does not get forever — a backlog is
// better worked through over a few hours than dropped on a timeout halfway, with
// some jobs written back and others not.
const MAX_JOBS_PER_RUN = 8;

// After this many attempts the cron stops offering. Something is wrong that it
// cannot fix by trying again — almost always a PO that matches no AccuLynx job —
// and a human has to look. Editing the job's PO resets the counter (see the
// trigger in supabase/58), so a fix puts the job straight back in the queue.
export const MAX_ATTEMPTS = 8;

// Back off between attempts: 0 is immediate, then 1h, 2h, 4h, 8h… capped at a day.
// AccuLynx 500s have lasted hours before now, and hammering a job every hour for a
// week neither fixes it nor leaves the log readable.
export function nextAttemptDue(job, now = Date.now()) {
  const attempts = Number(job?.sync_attempts) || 0;
  if (attempts === 0) return true;
  const last = Date.parse(job?.sync_last_attempt_at || "");
  if (!Number.isFinite(last)) return true;
  const waitMs = Math.min(2 ** (attempts - 1), 24) * 3600_000;
  return now - last >= waitMs;
}

// A write-back that names a column the database does not have yet is refused whole,
// and losing it is the one failure here that does real harm: report_uploaded_at goes
// unrecorded and the next run files the report a second time. So until supabase/68
// has run, drop the new column and write the rest.
export async function writeBack(admin, jobId, fields) {
  const first = await admin.from("jobs").update(fields).eq("id", jobId);
  if (!first.error || !("acculynx_posted_amount" in fields)) return first;
  if (!/acculynx_posted_amount/.test(first.error.message || "")) return first;
  const rest = { ...fields };
  delete rest.acculynx_posted_amount;
  return admin.from("jobs").update(rest).eq("id", jobId);
}

// Send one job's two halves and return what to write on it.
//
// The halves do not gate each other — different endpoints, different failure modes,
// either can land without the other — and the REPORT IS ONCE-ONLY: AccuLynx has no
// replace-document call, so a second successful upload means a second copy in the
// customer's Job Paperwork. report_uploaded_at is the record of whether that
// already happened, and it is the only thing standing between this cron and a
// folder full of duplicates. The cost, by contrast, must stay retriable: the usual
// failure is a filed report and a refused expense.
async function syncOneJob({ apiKey, config, job, ctx }) {
  const { amount, lineItems, paymentDescription } = buildCostPayload(
    job,
    ctx.users,
    ctx.inv,
    ctx.company,
  );
  const poNumber = job.po || null;
  const acculynxJobId = job.acculynx_job_id || null;

  let report;
  if (job.report_uploaded_at) {
    report = { ok: false, skipped: true, error: "Report was already filed." };
  } else {
    try {
      const { base64, filename } = await buildJobReportPdf(
        job,
        ctx.users,
        ctx.company?.branding?.logo || null,
        ctx.inv,
        ctx.company,
      );
      const up = await uploadJobDocument(apiKey, {
        acculynxJobId,
        poNumber,
        documentFolderId: config.documentFolderId || null,
        documentFolderName: config.documentFolderName || "Job Paperwork",
        fileName: filename,
        fileBase64: base64,
        description: `Material cost report - ${job.title || job.name || "Job"}`,
      });
      report = up.ok
        ? { ok: true, filename, uploadedAt: new Date().toISOString(), status: up.status }
        : { ok: false, error: up.error, status: up.status };
    } catch (err) {
      // A render that throws is a bug in our own code, not an AccuLynx refusal.
      // Say so, rather than filing it under "AccuLynx failed".
      report = { ok: false, error: `Could not build the report PDF: ${err.message}`, status: 500 };
    }
  }

  // Once our expense is on the job it is never posted again. A job whose REPORT
  // failed comes back round with the cost re-sent each time, which the duplicate
  // guard absorbed only while the amount stayed the same; after a correction it
  // would book the new total beside the old one. acculynx-correction-notice.js
  // owns that case (supabase/68).
  const alreadyPosted = job.acculynx_posted_amount != null;

  let cost;
  try {
    const posted = alreadyPosted
      ? { ok: true, skipped: true, message: "Cost was already posted." }
      : amount > 0
        ? await postJobExpense(apiKey, {
            acculynxJobId,
            poNumber,
            paymentDescription,
            totalMaterialCost: amount,
            lineItems,
          })
        : { ok: true, skipped: true, message: "No material cost to post." };
    // A conflict is our earlier line at another amount (see findOurEarlierLine).
    // The cost IS on the job, so it is not a failure to retry; the job is flagged
    // out of date after the write-back.
    cost = posted.conflict
      ? { ok: true, message: posted.error, postedAmount: posted.priorAmount, conflict: posted }
      : posted.skipped
        ? { ok: false, skipped: true, error: posted.message }
        : posted.ok
          ? {
              ok: true,
              message: posted.message,
              alreadyRecorded: !!posted.alreadyRecorded,
              postedAmount: amount,
            }
          : { ok: false, error: posted.error, status: posted.status };
  } catch (err) {
    cost = { ok: false, error: err.message, status: 502 };
  }

  const parts = [
    report.ok ? "Report filed." : report.skipped ? null : `Report failed: ${report.error}`,
    cost.ok ? cost.message : cost.skipped ? null : `Cost failed: ${cost.error}`,
  ].filter(Boolean);

  const reportFailed = !report.ok && !report.skipped;
  const costFailed = !cost.ok && !cost.skipped;
  const anyFailed = reportFailed || costFailed;

  // The failures retrying cannot mend. A 404 means the PO matches no AccuLynx job,
  // and it will still match nothing in an hour; a 400 means the request itself was
  // refused — no PO at all, or a report too large to send — which the next identical
  // request will be refused for too. Both burn the remaining attempts so the cron
  // stops asking and the note says what a person has to do instead. Editing the PO
  // resets the counter (see the trigger in supabase/58), so a fix is picked straight
  // back up. Everything else — a 502, a timeout, AccuLynx having a bad afternoon —
  // keeps its place in the queue and comes round again.
  const terminal = [report.status, cost.status].some((s) => s === 404 || s === 400);

  const fields = {
    sync_attempts: terminal ? MAX_ATTEMPTS : (Number(job.sync_attempts) || 0) + 1,
    sync_last_attempt_at: new Date().toISOString(),
  };

  if (anyFailed) {
    fields.syncStatus = "failed";
    fields.syncNote =
      (parts.join(" ") || "Nothing to send.") +
      (terminal ? " Fix the PO in Build Jobs, or close the job to send it by hand." : "");
  } else {
    fields.syncStatus = "synced";
    fields.syncedAt = report.uploadedAt || new Date().toISOString();
    fields.syncNote = parts.join(" ") || "Nothing to send.";
  }

  // Only ever claim the report is filed when it genuinely is — this column is what
  // stops the next run uploading a second copy.
  if (report.ok) {
    fields.report_uploaded_at = report.uploadedAt;
    fields.report_file_name = report.filename;
  }
  // What our line in AccuLynx now says, so a later correction knows the old figure.
  if (cost.ok) fields.acculynx_posted_amount = cost.postedAmount;

  return {
    fields,
    ok: !anyFailed,
    note: fields.syncNote,
    conflict: cost.conflict ? { posted: cost.conflict.priorAmount, correct: amount } : null,
  };
}

async function runRetries(admin, now) {
  // The candidate set comes from an RPC, not a PostgREST filter, and that is not
  // fussiness: the predicate has to test "syncStatus", a quoted camelCase column,
  // and a mis-spelled column inside an `or=(…)` filter does not error — it matches
  // nothing. A job queue that silently reports "nothing due" forever is the one
  // failure mode worth spending a SQL function to rule out. supabase/58 also keeps
  // the rule itself ("finished, not synced, not given up on") in one named place.
  //
  // Asked for more rows than one run will use, because the backoff below is applied
  // here rather than in SQL: the first few candidates may all be waiting out a
  // failure, and a run that stops at the first eight would never reach the ones
  // that are actually ready.
  const { data: candidates, error: findError } = await admin.rpc("acculynx_sync_candidates", {
    max_attempts: MAX_ATTEMPTS,
    lim: MAX_JOBS_PER_RUN * 6,
  });

  if (findError) {
    console.error("acculynx-retry-sync: could not list candidate jobs:", findError.message);
    return { error: findError.message };
  }

  const due = (candidates || []).filter((j) => nextAttemptDue(j, now)).slice(0, MAX_JOBS_PER_RUN);
  if (due.length === 0) {
    console.log("acculynx-retry-sync: nothing due.");
    return { attempted: 0, synced: 0, stillFailing: 0 };
  }

  // Resolve each company once. A company whose integration is off, or which has no
  // key, is skipped WITHOUT counting an attempt against its jobs — those jobs are
  // not failing, they are simply not ours to send.
  const companyIds = [...new Set(due.map((j) => j.company_id))];
  const { data: companies } = await admin
    .from("companies")
    .select("id, name, slug")
    .in("id", companyIds);

  const perCompany = new Map();
  for (const company of companies || []) {
    const resolved = await loadAccuLynxConfig(admin, company, { requireAutoSync: true });
    if (resolved.skip) {
      console.log(`acculynx-retry-sync: skipping ${company.slug} — ${resolved.skip}.`);
      continue;
    }
    perCompany.set(company.id, {
      ...resolved,
      ctx: await loadReportContext(admin, company.id),
      slug: company.slug,
    });
  }

  let attempted = 0;
  let synced = 0;
  const failures = [];

  for (const stale of due) {
    const tenant = perCompany.get(stale.company_id);
    if (!tenant) continue;

    // Re-read the row immediately before sending anything.
    //
    // The candidate list was taken at the top of the run and this loop then spends
    // real time on each job — AccuLynx round trips and a PDF render apiece. In that
    // window somebody may have pressed Close Job on this very row and filed the
    // report by hand. Acting on the stale snapshot would upload a SECOND copy of it
    // into the customer's Job Paperwork, and AccuLynx has no call to take one back.
    //
    // This does not make the race impossible — a browser mid-upload has not written
    // report_uploaded_at yet — but it closes the whole minutes-wide part of it for
    // the cost of one query, against a harm nobody can undo.
    const { data: job, error: rereadError } = await admin
      .from("jobs")
      .select("*")
      .eq("id", stale.id)
      .maybeSingle();

    if (rereadError || !job) {
      console.error(
        `acculynx-retry-sync: job ${stale.id} could not be re-read, skipped:`,
        rereadError?.message || "row is gone",
      );
      continue;
    }
    // Someone got there first. Not a failure, and not an attempt: nothing is owed.
    if (job.syncStatus === "synced") continue;

    attempted += 1;
    let result;
    try {
      result = await syncOneJob({
        apiKey: tenant.apiKey,
        config: tenant.config,
        job,
        ctx: tenant.ctx,
      });
    } catch (err) {
      // Never let one job take the run down: the remaining jobs still deserve their
      // attempt, and a job that throws still has to record that it was tried, or the
      // next run picks it up immediately and throws again.
      console.error(`acculynx-retry-sync: job ${job.id} threw:`, err.message);
      result = {
        fields: {
          syncStatus: "failed",
          syncNote: `Retry failed: ${err.message}`,
          sync_attempts: (Number(job.sync_attempts) || 0) + 1,
          sync_last_attempt_at: new Date().toISOString(),
        },
        ok: false,
        note: err.message,
      };
    }

    const { error: writeError } = await writeBack(admin, job.id, result.fields);
    if (writeError) {
      // The write is the only durable record that this happened. If it fails the
      // work was still done in AccuLynx, so log loudly — a silent miss here means
      // the next run tries to file the report a second time.
      console.error(
        `acculynx-retry-sync: job ${job.id} (PO ${job.po}) synced but the write-back failed:`,
        writeError.message,
      );
    }

    if (result.conflict && !writeError) {
      await flagConflict(admin, { job, tenant, ...result.conflict });
    }

    if (result.ok) synced += 1;
    else failures.push(`${job.po || job.id}: ${result.note}`);
  }

  console.log(
    `acculynx-retry-sync: attempted ${attempted}, synced ${synced}` +
      (failures.length ? `, still failing — ${failures.join(" | ")}` : ""),
  );
  return { attempted, synced, stillFailing: failures.length };
}

// AccuLynx already held this job's cost at another figure; the sync posted nothing.
async function flagConflict(admin, { job, tenant, posted, correct }) {
  const plan = planCorrectionNotice({
    job: { ...job, acculynx_posted_amount: posted },
    newAmount: correct,
  });
  if (plan.action !== "flag") return;
  const r = await flagOutOfDate(admin, {
    job,
    companyId: job.company_id,
    companyName: tenant.ctx.company?.name || "Steadwerk",
    ctx: tenant.ctx,
    posted: plan.posted,
    correct: plan.correct,
    byName: "Steadwerk's hourly AccuLynx sync",
  });
  if (!r.ok) console.error(`acculynx-retry-sync: could not flag job ${job.id}:`, r.error);
}

// ── The watch pass (supabase/69) ─────────────────────────────────────────────
//
// The trigger marks a job whose materials or PO changed after something reached
// AccuLynx, whoever changed it. This acts on those marks, so a correction is caught
// even when the browser never managed to report it.
const MAX_WATCH_PER_RUN = 20;

// One job whose materials changed: compare with AccuLynx, flag or clear.
export async function checkChangedJob(admin, { job, ctx, companyName }) {
  const before = job.acculynx_items_before;
  const after = job.items || job.materials || [];
  const beforeAmount = Array.isArray(before)
    ? buildCostPayload(
        { ...job, items: before, materials: before },
        ctx.users,
        ctx.inv,
        ctx.company,
      ).amount
    : null;
  const { amount } = buildCostPayload(job, ctx.users, ctx.inv, ctx.company);
  const plan = planCorrectionNotice({ job, newAmount: amount, beforeAmount });

  if (plan.action === "flag") {
    const r = await flagOutOfDate(admin, {
      job,
      companyId: job.company_id,
      companyName,
      ctx,
      posted: plan.posted,
      correct: plan.correct,
      changes: Array.isArray(before) ? materialCountChanges(before, after) : [],
      byName: "Steadwerk's hourly check",
    });
    // Leave the mark in place if the flag did not land, so the next run tries again.
    if (!r.ok) return { action: "error", error: r.error };
  } else if (plan.action === "clear") {
    const r = await clearOutOfDate(admin, { jobId: job.id, companyId: job.company_id });
    if (!r.ok) return { action: "error", error: r.error };
  }
  await clearCheckDue(admin, {
    jobId: job.id,
    companyId: job.company_id,
    seq: job.acculynx_check_seq,
  });
  return plan;
}

// The sync state a job is reset to when its PO moved to a different AccuLynx job:
// nothing of ours is on the new one yet, so the retry files it all again there.
export function poMovedResetFields(oldPo, newPo) {
  return {
    acculynx_po_moved_from: null,
    syncStatus: null,
    syncNote:
      `PO changed from ${oldPo} to ${newPo} after it was filed in AccuLynx. Sending it under ` +
      `${newPo}; remove the old filing from AccuLynx job ${oldPo}.`,
    report_uploaded_at: null,
    report_file_name: null,
    acculynx_posted_amount: null,
    acculynx_correct_amount: null,
    acculynx_out_of_date_at: null,
    acculynx_check_due: false,
    acculynx_items_before: null,
    sync_attempts: 0,
    sync_last_attempt_at: null,
  };
}

// One job whose PO changed after filing. Returns what was done.
export async function handlePoMove(admin, { job, apiKey, companyName }) {
  const oldPo = job.acculynx_po_moved_from;
  let oldRef;
  let newRef;
  try {
    [oldRef, newRef] = await Promise.all([
      resolveAccuLynxJobId(apiKey, { poNumber: oldPo }),
      resolveAccuLynxJobId(apiKey, { poNumber: job.po }),
    ]);
  } catch (err) {
    // AccuLynx unreachable: no evidence either way. Try again next hour.
    return { action: "retry", error: err.message };
  }

  if (oldRef.ok && newRef.ok && oldRef.acculynxJobId === newRef.acculynxJobId) {
    // A different spelling of the same AccuLynx job. Nothing moved.
    await admin
      .from("jobs")
      .update({ acculynx_po_moved_from: null })
      .eq("id", job.id)
      .eq("company_id", job.company_id);
    return { action: "same-job" };
  }

  // Reset first, guarded on the PO still being the one checked: someone may have
  // changed it again during this run, and the trigger has already re-marked it.
  const { data: reset, error } = await admin
    .from("jobs")
    .update(poMovedResetFields(oldPo, job.po || "(none)"))
    .eq("id", job.id)
    .eq("company_id", job.company_id)
    .eq("po", job.po)
    .select("id");
  if (error) return { action: "error", error: error.message };
  if (!reset?.length) return { action: "retry", error: "PO changed again during the check" };

  const mail = await mailPoMoved(admin, {
    job,
    companyId: job.company_id,
    companyName,
    oldPo,
    newPoFound: newRef.ok,
  });
  return { action: "moved", ...mail };
}

async function runWatch(admin) {
  const { data: rows, error } = await admin
    .from("jobs")
    .select("*")
    .or("acculynx_check_due.eq.true,acculynx_po_moved_from.not.is.null")
    .limit(MAX_WATCH_PER_RUN);
  if (error) {
    // Most likely supabase/69 has not been run. The retries are unaffected.
    console.log("acculynx-retry-sync: watch pass skipped:", error.message);
    return { checked: 0 };
  }

  const tenants = new Map();
  const tenantFor = async (companyId) => {
    if (tenants.has(companyId)) return tenants.get(companyId);
    const ctx = await loadReportContext(admin, companyId);
    const cfg = ctx.company ? await loadAccuLynxConfig(admin, ctx.company) : { skip: "no company" };
    const t = { ctx, cfg, companyName: ctx.company?.name || "Steadwerk" };
    tenants.set(companyId, t);
    return t;
  };

  let checked = 0;
  for (const job of rows || []) {
    try {
      const t = await tenantFor(job.company_id);
      if (job.acculynx_po_moved_from) {
        // Without the company's key there is no telling whether the PO now points
        // somewhere else, so wait rather than guess.
        if (t.cfg.skip) continue;
        const r = await handlePoMove(admin, {
          job,
          apiKey: t.cfg.apiKey,
          companyName: t.companyName,
        });
        checked += 1;
        console.log(`acculynx-retry-sync: PO change on job ${job.id}: ${r.action}`);
        // A moved job was reset and will be sent again in full, so its material
        // check no longer applies.
        if (r.action !== "same-job") continue;
      }
      if (job.acculynx_check_due) {
        const r = await checkChangedJob(admin, { job, ctx: t.ctx, companyName: t.companyName });
        checked += 1;
        console.log(`acculynx-retry-sync: material change on job ${job.id}: ${r.action}`);
      }
    } catch (err) {
      console.error(`acculynx-retry-sync: watch on job ${job.id} threw:`, err.message);
    }
  }
  return { checked };
}

const rawHandler = async () => {
  const admin = adminClient();
  const retries = await runRetries(admin, Date.now());
  const watch = await runWatch(admin);
  if (retries.error) {
    return { statusCode: 500, body: JSON.stringify({ error: retries.error, ...watch }) };
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, ...retries, ...watch }) };
};

export const handler = withSentry("acculynx-retry-sync", rawHandler);

// Netlify reads this to register the cron. Hourly, on the hour.
//
// Hourly rather than every few minutes because nothing here is urgent — the office
// closes jobs out in the days after they finish, not the minutes — and every run
// costs AccuLynx calls for each job it touches. It is also what makes the backoff
// above meaningful: a job that fails is not retried on the next run but the one
// after, or later.
export const config = {
  schedule: "0 * * * *",
};
