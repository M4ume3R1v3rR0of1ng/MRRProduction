// netlify/functions/acculynx-sync.js
//
// The browser's door into AccuLynx: authenticate the caller, find THEIR company's
// API key, and hand the work to _shared/acculynxWrites.js.
//
// Everything that actually talks to AccuLynx moved into that module when
// acculynx-retry-sync.js (the cron) became a second caller. This file is now only
// the HTTP shell: CORS, a verified session, the per-company key, and mapping a
// result's `status` onto the response. Keep it that way — a write added here rather
// than there is a write the cron will not perform, and the cron is the half that
// runs when nobody has a browser open.

import { adminClient, resolveCaller, corsHeaders as buildCorsHeaders } from "./_shared/tenant.js";
import {
  listDocumentFolders,
  postJobExpense,
  resolveAccuLynxJobId,
  searchJobs,
  uploadJobDocument,
} from "./_shared/acculynxWrites.js";
import { withSentry } from "./_shared/sentry.js";

// CORS used to be a second, hand-copied ALLOWED_ORIGINS list here, which had
// drifted from _shared/tenant.js's copy and was missing "capacitor://localhost" —
// the iOS app's origin under WKWebView. That silently CORS-blocked AccuLynx sync
// for every iOS user. Importing the one shared list means it can't drift again.
// X-Content-Type-Options is added on top since the shared helper doesn't set it.
function getCorsHeaders(requestOrigin) {
  return { ...buildCorsHeaders(requestOrigin), "X-Content-Type-Options": "nosniff" };
}

const rawHandler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(requestOrigin);

  // One shape for every reply, so readProxyJson on the client never has to guess.
  const reply = (statusCode, payload) => ({
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(payload),
  });

  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders, body: "" };
    }

    if (event.httpMethod !== "POST") {
      return reply(405, { error: "Method not allowed" });
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return reply(400, { error: "Invalid JSON body" });
    }

    // ── Require a verified, active Supabase session for every action ──
    // Previously this only checked that the *server* had an AccuLynx key configured,
    // meaning any unauthenticated request could search AccuLynx job/customer data
    // or (via the default action) post fabricated line items into real jobs.
    const admin = adminClient();
    const { caller, error: callerError } = await resolveCaller(admin, body.accessToken);
    if (callerError) {
      return reply(callerError.status, { error: callerError.message });
    }

    // ── The caller's OWN company's AccuLynx key ──
    // Each company has its own AccuLynx account. The shared ACCULYNX_API_KEY env var
    // remains only as a fallback so Maumee River keeps working until its key is moved
    // into companies.integrations; any other company must have its own key set, or it
    // gets nothing. Falling back to the env key for everyone would have let his
    // brother's company query Maumee River's AccuLynx data.
    const apiKey =
      caller.integrations?.acculynxApiKey ||
      (caller.companySlug === "maumee-river-roofing" ? process.env.ACCULYNX_API_KEY : null);

    if (!apiKey) {
      return reply(400, { error: "No AccuLynx API key is configured for your company." });
    }

    // Connection validation handling
    if (body.action === "validate") {
      try {
        const res = await fetch("https://api.acculynx.com/api/v2/jobs?page=1&pageSize=1", {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error(`AccuLynx connection rejected: HTTP ${res.status}`);
        return reply(200, { ok: true, message: "Connection validated" });
      } catch (err) {
        return reply(502, { ok: false, error: err.message });
      }
    }

    // ── Search action: used by the Build Jobs "Find Job" wizard step ──
    if (body.action === "search") {
      const q = (body.query || "").trim();
      if (!q) return reply(400, { ok: false, error: "Missing search query" });
      try {
        const rawJobs = await searchJobs(apiKey, q, 10);
        const jobs = rawJobs.map((j) => {
          const loc = j.locationAddress || {};
          const addrParts = [loc.street1, loc.city].filter(Boolean);
          return {
            acculynxJobId: j.id,
            po: j.jobNumber || j.id,
            name: j.jobName || "Untitled Job",
            addr: addrParts.join(", "),
          };
        });
        return reply(200, { ok: true, jobs });
      } catch (err) {
        return reply(502, { ok: false, error: err.message });
      }
    }

    // ── Will this job's PO actually resolve? ─────────────────────────────
    //
    // A read-only pre-flight, so the app can stop a crew BEFORE they finish a job
    // whose PO was never going to match anything in AccuLynx. It deliberately runs
    // the identical rule the two writes run — same function, not a second copy of
    // the `.find()` — because a check that is merely similar to the real one is
    // worse than no check: it blesses a PO the sync then refuses.
    //
    // `nearby` carries what the search did turn up, which is what turns "sync
    // failed" into "AccuLynx has 22311, you typed 22311-A".
    if (body.action === "resolveJobRef") {
      try {
        const resolved = await resolveAccuLynxJobId(apiKey, {
          acculynxJobId: body.acculynxJobId || null,
          poNumber: body.poNumber || null,
        });
        // 200 either way: "this PO does not resolve" is a successful answer to the
        // question asked, and the caller branches on `matched`. Returning 404 here
        // would make an expected answer look like a broken request.
        return reply(200, {
          ok: true,
          matched: resolved.ok,
          acculynxJobId: resolved.ok ? resolved.acculynxJobId : null,
          matchedBy: resolved.matchedBy || null,
          reason: resolved.ok ? null : resolved.error,
          nearby: resolved.nearby || [],
        });
      } catch (err) {
        // The lookup itself failed (AccuLynx down, network). That is NOT "the PO is
        // wrong", and must not be reported as such — the caller treats `ok: false`
        // as "unknown" and lets the job proceed.
        return reply(502, { ok: false, error: err.message });
      }
    }

    // ── Document folders: populates the Settings dropdown ────────────────
    if (body.action === "documentFolders") {
      try {
        return reply(200, { ok: true, folders: await listDocumentFolders(apiKey) });
      } catch (err) {
        return reply(502, { ok: false, error: err.message });
      }
    }

    // ── Upload the completion report PDF onto the AccuLynx job ───────────
    if (body.action === "uploadDocument") {
      try {
        const r = await uploadJobDocument(apiKey, {
          acculynxJobId: body.acculynxJobId || null,
          poNumber: body.poNumber || null,
          documentFolderId: body.documentFolderId || null,
          documentFolderName: body.documentFolderName || "Job Paperwork",
          fileName: body.fileName,
          fileBase64: body.fileBase64,
          description: body.description,
        });
        return reply(
          r.status,
          r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error },
        );
      } catch (err) {
        return reply(502, { ok: false, error: err.message });
      }
    }

    // ── ACTION: GET JOB PULL DETAILS (WITH DEFENSIVE NORMALIZATION) ──────
    if (body.action === "getJob") {
      try {
        const { poNumber, acculynxJobId } = body;
        let rawJob = null;

        if (acculynxJobId) {
          const jobRes = await fetch(`https://api.acculynx.com/api/v2/jobs/${acculynxJobId}`, {
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          });
          if (!jobRes.ok) throw new Error(`AccuLynx job fetch failed: HTTP ${jobRes.status}`);
          const jobData = await jobRes.json();
          rawJob = jobData?.data ? jobData.data : jobData;
        } else if (poNumber) {
          // Prefer an exact jobNumber match among results, fall back to the top hit.
          // This one is a READ shown to a human who then picks, so the soft fallback
          // is safe here in a way it is not for the writes — see resolveJobRef above
          // for the strict rule the writes use.
          const candidates = await searchJobs(apiKey, poNumber, 10);
          rawJob =
            candidates.find((j) => String(j.jobNumber) === String(poNumber)) ||
            candidates[0] ||
            null;
        } else {
          return reply(400, { ok: false, error: "Provide acculynxJobId or poNumber" });
        }

        if (!rawJob) return reply(404, { ok: false, error: "Job not found" });

        const loc = rawJob.locationAddress || {};
        const addrParts = [loc.street1, loc.city, loc.state?.abbreviation].filter(Boolean);
        const normalizedJob = {
          id: rawJob.id,
          jobNumber: rawJob.jobNumber || `PO-${rawJob.id}`,
          name: rawJob.jobName || "Untitled Job",
          addr: addrParts.length ? addrParts.join(", ") : "No address provided",
          milestone: rawJob.currentMilestone || null,
          _raw: rawJob,
        };
        return reply(200, { ok: true, job: normalizedJob });
      } catch (err) {
        return reply(502, { ok: false, error: err.message });
      }
    }

    // ── Default action: record material costs on the AccuLynx job ──
    const expense = await postJobExpense(apiKey, {
      acculynxJobId: body.acculynxJobId || null,
      poNumber: body.poNumber || null,
      paymentDescription: body.paymentDescription,
      totalMaterialCost: body.totalMaterialCost,
      lineItems: body.lineItems,
      paidTo: body.paidTo,
      accountTypeName: body.accountTypeName,
      paymentDate: body.paymentDate,
    });

    if (!expense.ok) {
      return reply(expense.status, { ok: false, error: expense.error });
    }
    return reply(200, {
      ok: true,
      skipped: expense.skipped || undefined,
      acculynxJobId: expense.acculynxJobId,
      alreadyRecorded: expense.alreadyRecorded || undefined,
      matched: expense.matched || undefined,
      message: expense.message,
    });
  } catch (globalError) {
    return reply(502, { ok: false, error: globalError.message });
  }
};

export const handler = withSentry("acculynx-sync", rawHandler);
