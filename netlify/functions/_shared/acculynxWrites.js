// netlify/functions/_shared/acculynxWrites.js
//
// Every call this app makes INTO AccuLynx, in one place.
//
// WHY THIS FILE EXISTS
//
// There are two callers now: acculynx-sync.js, which is a person pressing a button,
// and acculynx-retry-sync.js, which is a cron finishing what no browser managed.
// They must file the same document into the same folder, post the same expense
// against the same account type, and — above all — apply the same de-duplication
// guards, or the retry becomes the double-billing it exists to prevent. Two copies
// of that arithmetic is exactly how a retry books a second expense.
//
// So the HTTP shell owns authentication, tenancy and status codes; this file owns
// AccuLynx. Each function returns { ok, status, ... } instead of throwing, because
// the status is part of the answer: 404 means "no such job, stop retrying" and 502
// means "try again later", and the cron branches on precisely that difference.
//
// The facts here were verified against the live v2 API on 2026-08-11 and again when
// the expense finally posted on 2026-10-23. Where a path or a field name looks
// wrong, it is not — the comment says what the obvious spelling does instead.

import { buildExpenseNotes } from "./expenseNotes.js";

const API = "https://api.acculynx.com/api/v2";

const authHeaders = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
});

// ── Document folders ─────────────────────────────────────────────────────────
// Folder ids are per-company, so the id for "Job Paperwork" differs per tenant and
// can only be discovered at runtime from their own AccuLynx account.
//
// Two things here are easy to get wrong and were: the path is NOT
// /company/documentfolders (that 404s), and the id field is `documentFolderId`, not
// `id` — reading `id` yields undefined for every folder, so the list comes back
// empty rather than erroring.
export async function listDocumentFolders(apiKey) {
  const res = await fetch(
    `${API}/company-settings/job-file-settings/document-folders?pageSize=100&recordStartIndex=0`,
    { headers: authHeaders(apiKey) },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AccuLynx folder list failed: HTTP ${res.status} ${txt}`);
  }
  const d = await res.json();
  const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : [];
  return raw
    .map((f) => ({ id: f.documentFolderId, name: f.name || "Unnamed folder" }))
    .filter((f) => f.id);
}

// ── Account types ────────────────────────────────────────────────────────────
// An Additional Job Expense is booked against an account type — the same
// "Commission / Labor / Materials / Other" list AccuLynx makes you pick from in the
// UI when you mark an expense paid. The API documents accountTypeId as optional,
// and it is, right up until `isPaid` is set: then AccuLynx has to resolve which
// account the money left, finds nothing, and answers 500 InternalServerError with a
// traceId and no explanation — which is the error the sync reported against real
// jobs for months.
//
// Ids are per-company like folder ids, so this resolves at runtime. Note the
// response is a BARE ARRAY, not the { items } envelope the rest of v2 uses.
export async function listAccountTypes(apiKey) {
  const res = await fetch(
    `${API}/company-settings/location-settings/account-types?pageSize=100&recordStartIndex=0`,
    { headers: authHeaders(apiKey) },
  );
  if (!res.ok) return [];
  const d = await res.json();
  const raw = Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : [];
  return raw
    .filter((a) => a.id && a.isActive !== false)
    .map((a) => ({ id: a.id, name: a.name || "Unnamed account" }));
}

// Full-text search. AccuLynx has no `search`/`jobNumber` filter on GET /jobs — real
// search is POST /jobs/search with { searchTerm } in the body.
export async function searchJobs(apiKey, searchTerm, pageSize = 25) {
  const res = await fetch(`${API}/jobs/search?pageSize=${pageSize}&recordStartIndex=0`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ searchTerm }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AccuLynx job search failed: HTTP ${res.status} ${txt}`);
  }
  const d = await res.json();
  // v2 has never settled on one envelope for this endpoint; read them all rather
  // than pick whichever one today's response happens to use.
  return d?.data || d?.items || d?.jobs || d?.results || (Array.isArray(d) ? d : []);
}

// ── Which AccuLynx job is this? ──────────────────────────────────────────────
//
// THE ONE RULE, and the reason it is a function rather than three copies of a
// `.find()`: a job linked through the Build Jobs wizard carries the AccuLynx id
// directly, and an unlinked one resolves by an EXACT jobNumber match against the
// PO. Exact, never the nearest hit — both of the writes below put money or a
// customer's paperwork onto whatever this returns, and the nearest hit belongs to
// somebody else.
//
// Returns { ok: true, acculynxJobId } or { ok: false, status, error, nearby }.
// `nearby` is what the search DID turn up, so whoever reads the failure can see
// that their PO is "22311-A" against AccuLynx's "22311" instead of guessing. That
// list is also what makes this usable as a pre-flight check from the app, before a
// crew finishes a job whose PO was never going to match.
export async function resolveAccuLynxJobId(apiKey, { acculynxJobId, poNumber } = {}) {
  if (acculynxJobId) return { ok: true, acculynxJobId, matchedBy: "id", nearby: [] };

  const po = poNumber && poNumber !== "NO_PO" ? String(poNumber).trim() : "";
  if (!po) {
    return {
      ok: false,
      status: 400,
      error: "This job has no PO number to match against AccuLynx.",
      nearby: [],
    };
  }

  const candidates = await searchJobs(apiKey, po);
  const hit = candidates.find((j) => String(j.jobNumber) === po);
  if (hit?.id) return { ok: true, acculynxJobId: hit.id, matchedBy: "jobNumber", nearby: [] };

  return {
    ok: false,
    status: 404,
    error:
      `No AccuLynx job has job number "${po}". Nothing was sent, because the closest ` +
      `match belongs to a different job.`,
    nearby: candidates
      .slice(0, 5)
      .map((j) => ({ jobNumber: j.jobNumber, name: j.jobName || "Untitled Job" })),
  };
}

// ── File the completion report as a job document ─────────────────────────────
//
// AccuLynx has no "create invoice" endpoint — invoices are read-only in v2. The
// closest thing to sending one back is attaching the report as a job document,
// which is what the office actually opens.
//
// NOT IDEMPOTENT, and there is no replace-document call: a second successful call
// puts a second copy of the same report in Job Paperwork. The caller is responsible
// for not asking twice — see jobs.report_uploaded_at, which is the written record
// of whether this already happened.
export async function uploadJobDocument(
  apiKey,
  {
    acculynxJobId,
    poNumber,
    documentFolderId = null,
    documentFolderName = "Job Paperwork",
    fileName,
    fileBase64,
    description,
  } = {},
) {
  const resolved = await resolveAccuLynxJobId(apiKey, { acculynxJobId, poNumber });
  if (!resolved.ok) return { ...resolved, error: `${resolved.error} The report was not filed.` };

  // The office files these in "Job Paperwork" by hand today, so that folder is the
  // default and needs no setup. An explicit id from Settings still wins, and the
  // name is matched case-insensitively because a tenant may have typed it as
  // "Job paperwork".
  let folderId = documentFolderId || null;
  if (!folderId) {
    const wanted = String(documentFolderName || "Job Paperwork")
      .trim()
      .toLowerCase();
    const folders = await listDocumentFolders(apiKey);
    folderId = folders.find((f) => String(f.name).trim().toLowerCase() === wanted)?.id || null;
    if (!folderId) {
      return {
        ok: false,
        status: 404,
        error:
          `No AccuLynx document folder named "${documentFolderName || "Job Paperwork"}". ` +
          `Pick one in Settings. Folders found: ${folders.map((f) => f.name).join(", ") || "none"}`,
      };
    }
  }

  if (!fileBase64) return { ok: false, status: 400, error: "Missing file payload" };

  const bytes = Buffer.from(fileBase64, "base64");
  // Netlify caps a function request body at 6MB and base64 inflates by ~33%. A
  // material report is tens of KB; anything near the cap is a bug upstream, and
  // failing here names the real problem instead of filing a truncated upload.
  if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) {
    return { ok: false, status: 400, error: "Report PDF is empty or too large to upload" };
  }

  // Node 18+ on Netlify has FormData/Blob natively, so the multipart body needs no
  // extra dependency. Do NOT set Content-Type by hand — fetch has to append its own
  // multipart boundary.
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), fileName || "JobReport.pdf");
  form.append("documentFolderId", folderId);
  if (description) form.append("description", String(description).slice(0, 500));

  const res = await fetch(`${API}/jobs/${resolved.acculynxJobId}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text();
    return {
      ok: false,
      status: 502,
      error: `AccuLynx document upload failed ${res.status}: ${txt}`,
    };
  }

  return {
    ok: true,
    status: 200,
    acculynxJobId: resolved.acculynxJobId,
    message: "Completion report uploaded to the AccuLynx job file.",
  };
}

// The reference stamped on our own expense line, and the key the duplicate check
// matches on. 50, not 255: AccuLynx caps refNumber at 50 and 400s the whole call
// past that. Both sides have to derive it the same way, or a replay fails to
// recognise its own earlier expense and books the cost twice.
export const expenseRefFor = (poNumber) =>
  poNumber && poNumber !== "NO_PO" ? String(poNumber).slice(0, 50) : null;

// ── Has this cost already been booked? ───────────────────────────────────────
//
// Creating an expense is not idempotent, and a caller cannot tell a lost reply from
// a failed write: a request that times out may well have posted. The obvious next
// move for whoever sees "Sync Failed" is to press Retry, and without this that books
// the material cost onto the job a second time. A cron makes that same mistake on a
// schedule, which is worse.
//
// Matching on amount AND our own PO reference, because a company legitimately has
// several expenses on one job (dumpster, labor) and only OUR line is the one being
// replayed.
//
// Returns the matching expense, or null. A FAILED check returns null and lets the
// post proceed: that is the old behaviour, and refusing to post because a read
// failed would strand the cost instead.
export async function findPriorExpense(apiKey, acculynxJobId, amount, expenseRef) {
  try {
    const res = await fetch(`${API}/jobs/${acculynxJobId}/payments`, {
      headers: authHeaders(apiKey),
    });
    if (!res.ok) return null;
    const existing = await res.json();

    // GET /payments answers three buckets, each wrapping its own list:
    //   { additionalExpenses: { payments: [...], total }, paidPayments: {...},
    //     receivedPayments: {...} }
    // — verified against the live API. This used to read `existing.items`, which is
    // never present, so the list was ALWAYS empty and the guard never once fired:
    // every retry of a timed-out sync booked the cost a second time. The endpoint
    // also takes no paging parameters, so they are gone.
    //
    // Only additionalExpenses is searched. Our line is an expense, and matching a
    // customer's received payment that happened to be the same amount would skip a
    // post that genuinely needed to happen.
    const prior = Array.isArray(existing?.additionalExpenses?.payments)
      ? existing.additionalExpenses.payments
      : [];
    return (
      prior.find(
        (p) =>
          Math.abs(Number(p.amount) - amount) < 0.005 &&
          (!expenseRef || String(p.refNumber || "") === expenseRef),
      ) || null
    );
  } catch {
    return null;
  }
}

// ── Post the material cost as an Additional Job Expense ──────────────────────
//
// AccuLynx has no /lineitems endpoint; material costs are recorded as an Additional
// Job Expense payment, and `notes` carries what fits of the breakdown. The cap is
// 250 characters — see _shared/expenseNotes.js.
export async function postJobExpense(
  apiKey,
  {
    acculynxJobId,
    poNumber,
    paymentDescription,
    totalMaterialCost,
    lineItems,
    paidTo,
    accountTypeName,
    paymentDate,
  } = {},
) {
  const amount = Math.round(Number(totalMaterialCost) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: true,
      status: 200,
      skipped: true,
      message: "No material cost to sync (net pulled quantity is zero).",
    };
  }

  const resolved = await resolveAccuLynxJobId(apiKey, { acculynxJobId, poNumber });
  if (!resolved.ok) return { ...resolved, error: `${resolved.error} No cost was posted.` };

  const jobId = resolved.acculynxJobId;
  const expenseRef = expenseRefFor(poNumber);

  const duplicate = await findPriorExpense(apiKey, jobId, amount, expenseRef);
  if (duplicate) {
    return {
      ok: true,
      status: 200,
      acculynxJobId: jobId,
      alreadyRecorded: true,
      // The matched line is echoed back because "already recorded" is AMBIGUOUS on a
      // multi-crew PO: it is either our own earlier post or a sibling job's identical
      // amount, and only the caller knows whether a sibling exists. See
      // src/features/jobs/poCollisions.js, which is what asks the question.
      matched: { amount: Number(duplicate.amount), refNumber: duplicate.refNumber || null },
      message:
        `This material cost is already on the AccuLynx job (${amount.toFixed(2)}). ` +
        `Nothing was posted a second time.`,
    };
  }

  const notes = buildExpenseNotes(paymentDescription, lineItems);

  // paymentDate is REQUIRED. Without it AccuLynx rejects the whole call with 400
  // "PaymentDate cannot be null or empty" — verified against the live API. Seconds
  // precision, which is the shape AccuLynx documents ("2020-06-22T00:00:00Z"); they
  // discard the time either way, so the milliseconds a JS ISO string carries buy
  // nothing and appear in none of their examples.
  const when = paymentDate || new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Booked under "Materials", because that is what this expense is. A tenant whose
  // chart of accounts names it differently can say so. With no match we post the
  // expense WITHOUT isPaid rather than risk the 500 described at listAccountTypes:
  // an expense on the job that someone ticks "paid" by hand is recoverable, and a
  // refused one leaves nothing behind at all.
  const wanted = String(accountTypeName || "Materials")
    .trim()
    .toLowerCase();
  const accountTypes = await listAccountTypes(apiKey);
  const accountTypeId =
    accountTypes.find((a) => String(a.name).trim().toLowerCase() === wanted)?.id || null;

  const res = await fetch(`${API}/jobs/${jobId}/payments/expense`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      to: paidTo || "MRR Warehouse",
      amount,
      notes,
      paymentDate: when,
      // These two travel together or not at all — see listAccountTypes.
      ...(accountTypeId ? { accountTypeId, isPaid: true } : {}),
      refNumber: expenseRef || undefined,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    // AccuLynx documents no 5xx here, and when it sends one the body is a traceId and
    // nothing actionable. Saying plainly that it is their end, and that the report PDF
    // is a separate write, saves reading that JSON as a bug in the app.
    const hint =
      res.status >= 500
        ? " This is an error inside AccuLynx, not a rejected payload. The completion " +
          "report is filed by a separate call and is unaffected."
        : "";
    return { ok: false, status: 502, error: `AccuLynx expense error ${res.status}: ${txt}${hint}` };
  }

  return {
    ok: true,
    status: 200,
    acculynxJobId: jobId,
    amount,
    message: "Material costs recorded in AccuLynx as an additional job expense.",
  };
}
