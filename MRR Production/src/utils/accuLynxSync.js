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

// Retries are for READS only. The default sync action creates an Additional Job
// Expense, which is not idempotent: if an attempt reaches AccuLynx and the reply is
// lost, retrying books the material cost onto the job a SECOND time. This helper
// used to retry everything, including that write, and it also retried a non-ok
// response with no delay at all — so one 502 from a request that had already
// created the expense became three expenses.
//
// Each attempt gets its own timeout rather than one shared deadline for the whole
// sequence. With a single AbortController the first abort poisons the signal, so
// every later attempt failed instantly and the "retry" was decorative.
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

export async function attemptAccuLynxSync(job, users, config, setJobs) {
  // `items` and `materials` are the same list under two names. The build wizard
  // writes `materials`; PullInventoryView writes both. Every other reader in the
  // app does `items || materials` — this one didn't, so a job that reached
  // completion without a pull having rewritten `items` synced a cost of $0 and
  // was silently skipped as "no material cost".
  const lines = Array.isArray(job?.items) ? job.items : (Array.isArray(job?.materials) ? job.materials : null);

  const totalCost = lines
    ? lines.reduce((s, i) => {
        const itemPrice = i.priceAtPull !== undefined ? i.priceAtPull : (i.cost || i.price || 0);
        return s + (Math.max(0, (i.pulled || 0) - (i.returned || 0))) * itemPrice;
      }, 0)
    : 0;
  
  const payload = {
    poNumber: job?.po || 'NO_PO',
    acculynxJobId: job?.acculynx_job_id || null, // Direct target when the job was linked via the wizard
    paymentDescription: `Material Cost — ${job?.name || job?.title || 'Job'}`, 
    totalMaterialCost: parseFloat(totalCost.toFixed(2)), 
    lineItems: lines
      ? lines
          .filter(i => (i.pulled || 0) - (i.returned || 0) > 0)
          .map(i => {
            const itemPrice = i.priceAtPull !== undefined ? i.priceAtPull : (i.cost || i.price || 0); 
            return {
              name: i.iname || i.name || 'Unknown Material', 
              category: i.icat || i.category || 'Materials', 
              unit: i.unit || 'units', 
              quantity: (i.pulled || 0) - (i.returned || 0), 
              unitPrice: itemPrice, 
              totalCost: parseFloat((((i.pulled || 0) - (i.returned || 0)) * itemPrice).toFixed(2)), 
            };
          })
      : [],
  };

  if (!config || !config.enabled || !config.proxyUrl) {
    const note = 'Configure AccuLynx in Settings to enable auto-sync.';
    if (typeof setJobs === 'function') {
      setJobs(p => p.map(j => j.id === job?.id ? {
        ...j,
        syncStatus: 'manual',
        syncNote: note,
        // Payload stays in memory only. It is recomputable from the job's items,
        // so persisting it would duplicate material lines somewhere they can drift.
        syncPayload: payload,
      } : j));
    }
    await persistSyncState(job?.id, { syncStatus: 'manual', syncNote: note });
    return;
  }

  try {
    const accessToken = await getAccessToken();
    // A null token can only produce a 401 "Not authenticated" from the proxy, which
    // reads like an AccuLynx problem and sends people to check their API key. Fail
    // here instead, naming the thing they can actually act on.
    if (!accessToken) throw new Error(SESSION_EXPIRED);
    // No retry: this call creates an expense. 30s because the request is a chain —
    // browser to the Netlify function, the function verifying the session against
    // Supabase, then AccuLynx. AccuLynx itself answers in about 300ms; the old 8s
    // budget was being eaten by the hops in front of it, most visibly by a cold
    // function on the first call after a deploy or a `netlify dev` start.
    const res = await fetchWithTimeout(config.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // ── 🟢 FIXED: The key is hidden inside the secure Authorization header ──
        'Authorization': `Bearer ${config.apiKey || ''}`
      },
      body: JSON.stringify({ ...payload, accessToken }), // 🟢 The JSON payload string is now completely clean of keys
    }, 30000);

    const responseData = await res.json().catch(() => ({}));

    if (res.ok) {
      const syncedAt = new Date().toISOString();
      const note = responseData.message || 'Cost data synchronized onto AccuLynx file record.';
      if (typeof setJobs === 'function') {
        setJobs(p => p.map(j => j.id === job.id ? {
          ...j,
          syncStatus: 'synced',
          syncedAt,
          syncNote: note,
          syncPayload: payload,
        } : j));
      }
      await persistSyncState(job.id, { syncStatus: 'synced', syncedAt, syncNote: note });
    } else {
      const upstreamError = responseData?.error || responseData?.message || `HTTP ${res.status}`;
      throw new Error(upstreamError);
    }
  } catch (err) {
    // A timeout means the outcome is UNKNOWN, not that nothing was written: the
    // expense may have been created with only the reply lost. Say so, because the
    // obvious next move is to hit Retry, and a blind retry on a create is how one
    // job ends up billed twice. The server now de-duplicates, but the person
    // reading this still deserves to know which kind of failure they are looking at.
    const errorMsg = err.name === 'AbortError'
      ? 'AccuLynx request timed out. The cost may or may not have posted — check the job in AccuLynx before retrying.'
      : err.message;
    if (typeof setJobs === 'function') {
      setJobs(p => p.map(j => j.id === job.id ? {
        ...j,
        syncStatus: 'failed',
        syncNote: errorMsg,
        syncPayload: payload,
      } : j));
    }
    await persistSyncState(job.id, { syncStatus: 'failed', syncNote: errorMsg });
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
// Renders the report to real PDF bytes and files it on the job. Kept separate from
// attemptAccuLynxSync so a failed upload can't lose the cost sync, or the reverse:
// they hit different AccuLynx endpoints and fail for different reasons.
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

    // Recorded so the app can answer "is this job's paperwork already in AccuLynx"
    // without uploading a second copy to find out.
    const uploadedAt = new Date().toISOString();
    await persistSyncState(job?.id, { report_uploaded_at: uploadedAt, report_file_name: filename });

    return { ok: true, message: data.message, filename, uploadedAt };
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