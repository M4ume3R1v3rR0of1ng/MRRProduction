// src/utils/accuLynxSync.js
import { getAccessToken, updateRowStrict } from './supabase';

// ── Reading sync state off a job ─────────────────────────────────────────────
// "syncStatus"/"syncedAt"/"syncNote" are real columns on public.jobs and always
// were — nothing had ever written to them (see supabase/28). They are the storage,
// so there is exactly one shape to read and these accessors exist to keep the
// empty-string-vs-null handling in one place rather than at every call site.
export const syncStatusOf = (job) => job?.syncStatus || null;
export const syncNoteOf = (job) => job?.syncNote || '';
export const syncedAtOf = (job) => job?.syncedAt || '';
export const reportUploadedAtOf = (job) => job?.report_uploaded_at || null;

// Sync state is a record of what happened, not part of the job's own edit flow.
// It must never turn a completed job into a failed save, so a write that doesn't
// land is logged and swallowed: the in-memory state is already correct, and the
// worst case is the badge resetting on the next reload — which is exactly the
// behaviour this whole migration replaced, not a regression.
async function persistSyncState(jobId, fields) {
  if (!jobId) return;
  const { error } = await updateRowStrict('jobs', jobId, fields);
  if (error) console.warn('Could not persist AccuLynx sync state:', error.message);
}

// Shown instead of the proxy's bare "Not authenticated", which points at the wrong
// thing entirely: nothing is wrong with AccuLynx or the API key.
const SESSION_EXPIRED = 'Your sign-in session expired. Reload the page and sign in again, then retry.';

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Retries are for READS only. Uploading a document is a create: if an attempt
// reaches AccuLynx and the reply is lost, retrying files a SECOND copy of the same
// report onto the job. So the upload gets exactly one attempt, and only lookups
// come through here.
//
// Each attempt gets its own timeout rather than one shared deadline for the whole
// sequence. With a single AbortController the first abort poisons the signal, so
// every later attempt fails instantly and the "retry" is decorative.
async function fetchRead(url, options, { retries = 2, timeoutMs = 15000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      if (res.ok || i === retries) return res;
    } catch (err) {
      lastErr = err;
      if (i === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw lastErr || new Error('Request failed');
}

// The one thing this app sends to AccuLynx: the completion report PDF, filed as a
// document on the job. Named "Sync Upload" in the UI.
//
// It used to also post the material cost as an Additional Job Expense. That is
// gone. The PDF already carries the full itemised breakdown, categories, tax and
// total, so the expense was a second, lossier copy of the same numbers that had to
// survive a 250-character notes field and a non-idempotent create.
//
// Separately, the 📄 PDF button does NOT upload. Generating a report to read and
// filing it in the CRM are different intentions, and merging them meant every
// reprint of a finished job dropped another copy into Job Paperwork.
export async function syncJobReportToAccuLynx({
  job, users = [], config, setJobs,
  activeLogo = null, inv = [], company = null,
}) {
  if (!config?.enabled || !config?.proxyUrl) {
    const note = 'Configure AccuLynx in Settings to enable upload.';
    applyJobState(setJobs, job?.id, { syncStatus: 'manual', syncNote: note });
    await persistSyncState(job?.id, { syncStatus: 'manual', syncNote: note });
    return { ok: false, skipped: true, error: note };
  }

  const result = await uploadJobReportToAccuLynx({ job, users, activeLogo, inv, company, config });

  if (result.ok) {
    const fields = {
      syncStatus: 'synced',
      syncedAt: result.uploadedAt,
      syncNote: result.message || 'Report filed on the AccuLynx job.',
      report_uploaded_at: result.uploadedAt,
      report_file_name: result.filename,
    };
    applyJobState(setJobs, job?.id, fields);
    await persistSyncState(job?.id, fields);
  } else if (!result.skipped) {
    const fields = { syncStatus: 'failed', syncNote: result.error };
    applyJobState(setJobs, job?.id, fields);
    await persistSyncState(job?.id, fields);
  }

  return result;
}

function applyJobState(setJobs, jobId, fields) {
  if (typeof setJobs !== 'function' || !jobId) return;
  setJobs((p) => p.map((j) => (j.id === jobId ? { ...j, ...fields } : j)));
}

// ── Document folders (Settings dropdown) ─────────────────────────────────────
export async function fetchAccuLynxDocumentFolders(config) {
  if (!config?.proxyUrl) throw new Error("AccuLynx integration is not configured.");

  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error(SESSION_EXPIRED);
  const res = await fetch(config.proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey || ''}` },
    body: JSON.stringify({ action: "documentFolders", accessToken }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data.folders || [];
}

// ── Upload the completion report PDF onto the AccuLynx job ───────────────────
// The transport half: render the report to real PDF bytes and post them. Kept
// separate from syncJobReportToAccuLynx, which owns recording the outcome on the
// job, so the upload itself stays callable without touching any state.
export async function uploadJobReportToAccuLynx({ job, users, activeLogo, inv, company, config }) {
  if (!config?.enabled || !config?.proxyUrl) {
    return { ok: false, skipped: true, error: "AccuLynx integration is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    // Imported lazily: this pulls in jsPDF, and a company with uploads off should
    // never pay for the download.
    const { buildJobReportPdf } = await import("./jobReportPdf");
    const { base64, filename } = await buildJobReportPdf(job, users, activeLogo, inv, company);

    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error(SESSION_EXPIRED);

    const res = await fetch(config.proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey || ''}` },
      body: JSON.stringify({
        action: "uploadDocument",
        acculynxJobId: job?.acculynx_job_id || null,
        poNumber: job?.po || null,
        // Neither is required: with both empty the server files into "Job Paperwork",
        // which is where the office puts these by hand today.
        documentFolderId: config.documentFolderId || null,
        documentFolderName: config.documentFolderName || null,
        fileName: filename,
        fileBase64: base64,
        description: `Material cost report - ${job?.name || job?.title || "Job"}`,
        accessToken,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data?.error || `HTTP ${res.status}`);

    // Transport only: the caller records this on the job. Persisting here as well
    // meant two database writes per upload, and left this function unusable by
    // anything that does not want a write as a side effect.
    return { ok: true, message: data.message, filename, uploadedAt: new Date().toISOString() };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, error: err.name === "AbortError" ? "AccuLynx upload timed out" : err.message };
  }
}

// ── 🆕 ADDED: Fetch Job Data Helper ──────────────────────────────────────────
export async function fetchAccuLynxJob({ poNumber, acculynxJobId }, config) {
  if (!config?.enabled || !config?.proxyUrl) {
    throw new Error("AccuLynx integration is not configured.");
  }

  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error(SESSION_EXPIRED);

  // A lookup is a read, so retrying it is free of consequences.
  const res = await fetchRead(config.proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Maintained Authorization header parity for flexible/hybrid token architecture
      "Authorization": `Bearer ${config.apiKey || ''}`
    },
    body: JSON.stringify({ action: "getJob", poNumber, acculynxJobId, accessToken }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data.job;
}
