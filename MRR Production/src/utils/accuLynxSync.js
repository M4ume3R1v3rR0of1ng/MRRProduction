// src/utils/accuLynxSync.js
import { getAccessToken, updateRowStrict } from './supabase';
import { buildJobReportModel } from './pdfGenerator';

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
// Two writes to two different AccuLynx endpoints:
//   1. the completion report PDF, filed as a document on the job
//   2. the material cost, posted as an Additional Job Expense (TAX INCLUDED)
//
// They do not gate each other. Different endpoints, different failure modes, and
// either can land without the other — so a refused expense must never cost you the
// paperwork, and a refused upload must never hide a posted cost.
//
// Separately, the 📄 PDF button does NOT sync. Generating a report to read and
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

  const report = await uploadJobReportToAccuLynx({ job, users, activeLogo, inv, company, config });
  const cost = await postJobCostToAccuLynx({ job, users, inv, company, config });

  // Report the halves separately. Collapsing them into one "failed" hides which of
  // the two actually landed, and the whole point of recording this is to answer
  // that without opening AccuLynx.
  const parts = [
    report.ok ? 'Report filed.' : report.skipped ? null : `Report failed: ${report.error}`,
    cost.ok ? cost.message : cost.skipped ? null : `Cost failed: ${cost.error}`,
  ].filter(Boolean);
  const note = parts.join(' ') || 'Nothing to send.';

  const anyFailed = (!report.ok && !report.skipped) || (!cost.ok && !cost.skipped);
  const at = report.uploadedAt || new Date().toISOString();

  const fields = anyFailed
    ? { syncStatus: 'failed', syncNote: note }
    : { syncStatus: 'synced', syncedAt: at, syncNote: note };

  // Only claim the report is filed when it genuinely is — this column is what stops
  // a later sync from uploading a second copy.
  if (report.ok) {
    fields.report_uploaded_at = report.uploadedAt;
    fields.report_file_name = report.filename;
  }

  applyJobState(setJobs, job?.id, fields);
  await persistSyncState(job?.id, fields);

  return { ok: !anyFailed, report, cost, error: anyFailed ? note : undefined, message: note };
}

function applyJobState(setJobs, jobId, fields) {
  if (typeof setJobs !== 'function' || !jobId) return;
  setJobs((p) => p.map((j) => (j.id === jobId ? { ...j, ...fields } : j)));
}

const money = (n) => '$' + Number(n).toFixed(2);

// ── Post the material cost as an Additional Job Expense ──────────────────────
//
// The amount is m.totalWithTax — the TAX-INCLUSIVE figure, and the exact number
// printed as "TOTAL MATERIAL COST" on the PDF. This used to post the pre-tax
// subtotal, so the expense in AccuLynx and the report attached to the same job
// disagreed by the tax on every job.
//
// Both numbers now come from one call to buildJobReportModel, which is also what
// the PDF renders from. They cannot drift, because there is only one calculation.
async function postJobCostToAccuLynx({ job, users, inv, company, config }) {
  const m = buildJobReportModel(job, users, inv, company);
  const amount = parseFloat(m.totalWithTax.toFixed(2));

  if (!(amount > 0)) {
    return { ok: false, skipped: true, error: 'No material cost to post.' };
  }

  const lineItems = m.categories
    .flatMap((c) => c.items)
    .filter((i) => i.used > 0)
    .map((i) => ({
      name: i.iname || 'Unknown Material',
      category: i.icat || 'Materials',
      unit: i.unit || 'units',
      quantity: i.used,
      unitPrice: i.unitPrice,
      totalCost: parseFloat(i.total.toFixed(2)),
    }));

  // Second line spells out the tax so the number is auditable from AccuLynx alone,
  // without opening the PDF to find out why the expense is not the sum of the items.
  const paymentDescription =
    `Material Cost - ${job?.name || job?.title || 'Job'}\n` +
    `${money(m.grandTotal)} + ${m.taxLabel} ${m.taxPct}% ${money(m.salesTax)} = ${money(amount)}`;

  try {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error(SESSION_EXPIRED);

    // One attempt only: creating an expense is not idempotent. The server also
    // de-duplicates on amount + PO before posting, which is what makes a retry
    // after an ambiguous timeout safe.
    const res = await fetchWithTimeout(config.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey || ''}`,
      },
      body: JSON.stringify({
        poNumber: job?.po || 'NO_PO',
        acculynxJobId: job?.acculynx_job_id || null,
        paymentDescription,
        totalMaterialCost: amount,
        lineItems,
        accessToken,
      }),
    }, 30000);

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);

    return {
      ok: true,
      amount,
      alreadyRecorded: !!data.alreadyRecorded,
      message: data.message || `Cost ${money(amount)} posted to AccuLynx.`,
    };
  } catch (err) {
    // A timeout means the outcome is UNKNOWN, not that nothing was written.
    return {
      ok: false,
      error: err.name === 'AbortError'
        ? `Cost post timed out. ${money(amount)} may or may not have posted — check the job in AccuLynx before retrying.`
        : err.message,
    };
  }
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
