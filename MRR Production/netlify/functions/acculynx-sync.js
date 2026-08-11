// netlify/functions/acculynx-sync.js

import { adminClient, resolveCaller } from "./_shared/tenant.js";
import { buildExpenseNotes } from "./_shared/expenseNotes.js";

const ALLOWED_ORIGINS = [
  "https://steadwerk.com",
  "https://www.steadwerk.com",
  "https://mrrproduction.netlify.app",
  "http://localhost:5173",
  "http://localhost:8888",
  "http://localhost:3000",
];

function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization", // 🟢 CORS allows Authorization headers
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
  };
}

export const handler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(requestOrigin);

  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders, body: "" };
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON body" }) };
    }

    // ── Require a verified, active Supabase session for every action ──
    // Previously this only checked that the *server* had an AccuLynx key configured,
    // meaning any unauthenticated request could search AccuLynx job/customer data
    // or (via the default action) post fabricated line items into real jobs.
    const admin = adminClient();
    const { caller, error: callerError } = await resolveCaller(admin, body.accessToken);
    if (callerError) {
      return { statusCode: callerError.status, headers: corsHeaders, body: JSON.stringify({ error: callerError.message }) };
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
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "No AccuLynx API key is configured for your company." }),
      };
    }

    // Connection validation handling
    if (body.action === "validate") {
      try {
        const res = await fetch("https://api.acculynx.com/api/v2/jobs?page=1&pageSize=1", {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error(`AccuLynx connection rejected: HTTP ${res.status}`);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, message: "Connection validated" }) };
      } catch (err) {
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ ok: false, error: err.message }) };
      }
    }

    // ── Search action: used by the Build Jobs "Find Job" wizard step ──
    // AccuLynx has no `search`/`jobNumber` filter on GET /jobs — real full-text search
    // is a separate endpoint: POST /jobs/search with { searchTerm } in the body.
    if (body.action === "search") {
      const q = (body.query || "").trim();
      if (!q) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing search query" }) };
      }
      try {
        const res = await fetch(
          `https://api.acculynx.com/api/v2/jobs/search?pageSize=10&recordStartIndex=0`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ searchTerm: q }),
          }
        );
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`AccuLynx job search failed: HTTP ${res.status} ${txt}`);
        }
        const d = await res.json();
        console.log("AccuLynx raw response:", JSON.stringify(d));
        const rawJobs = d?.data || d?.items || d?.jobs || d?.results || (Array.isArray(d) ? d : []);
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
        if (jobs.length === 0) {
          const debugInfo = [{ keys: Object.keys(d || {}), status: res.status, sample: JSON.stringify(d).slice(0, 500) }];
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, jobs: [], _debug: debugInfo }) };
        }
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, jobs }) };
      } catch (err) {
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ ok: false, error: err.message }) };
      }
    }

    // Folder ids are per-company, so the id for "Job Paperwork" differs per tenant
    // and can only be discovered at runtime from their own AccuLynx account.
    //
    // Two things here are easy to get wrong and were, verified against the live API
    // on 2026-08-11: the path is NOT /company/documentfolders (that 404s), and the
    // id field is `documentFolderId`, not `id` — reading `id` yields undefined for
    // every folder, so the list comes back empty rather than erroring.
    const listDocumentFolders = async () => {
      const res = await fetch(
        "https://api.acculynx.com/api/v2/company-settings/job-file-settings/document-folders?pageSize=100&recordStartIndex=0",
        { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`AccuLynx folder list failed: HTTP ${res.status} ${txt}`);
      }
      const d = await res.json();
      const raw = Array.isArray(d?.items) ? d.items : (Array.isArray(d) ? d : []);
      return raw
        .map((f) => ({ id: f.documentFolderId, name: f.name || "Unnamed folder" }))
        .filter((f) => f.id);
    };

    // ── Document folders: populates the Settings dropdown ────────────────
    if (body.action === "documentFolders") {
      try {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, folders: await listDocumentFolders() }) };
      } catch (err) {
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ ok: false, error: err.message }) };
      }
    }

    // ── Upload the completion report PDF onto the AccuLynx job ───────────
    // AccuLynx has no "create invoice" endpoint — invoices are read-only in v2.
    // The closest thing to sending one back is attaching the report as a job
    // document, which is what the office actually opens.
    if (body.action === "uploadDocument") {
      try {
        const { documentFolderId, fileName, fileBase64, description } = body;
        // Wizard-linked jobs carry the id; unlinked ones resolve by PO, and as with
        // expenses the match must be an exact jobNumber — a best guess would file a
        // customer's cost report onto somebody else's job.
        let acculynxJobId = body.acculynxJobId || null;
        if (!acculynxJobId && body.poNumber && body.poNumber !== "NO_PO") {
          const lookup = await fetch(
            `https://api.acculynx.com/api/v2/jobs/search?pageSize=25&recordStartIndex=0`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ searchTerm: body.poNumber }),
            }
          );
          if (lookup.ok) {
            const d = await lookup.json();
            const candidates = d?.data || d?.items || d?.jobs || d?.results || (Array.isArray(d) ? d : []);
            acculynxJobId = candidates.find((j) => String(j.jobNumber) === String(body.poNumber))?.id || null;
          }
        }
        if (!acculynxJobId) {
          return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({ ok: false, error: `No AccuLynx job matches "${body.poNumber || "(no PO)"}" — upload skipped to avoid filing the report on the wrong job` }),
          };
        }
        // The office files these in "Job Paperwork" by hand today, so that folder is
        // the default and needs no setup. An explicit id from Settings still wins,
        // and the name is matched case-insensitively because a tenant may have typed
        // it as "Job paperwork".
        let folderId = documentFolderId || null;
        if (!folderId) {
          const wanted = String(body.documentFolderName || "Job Paperwork").trim().toLowerCase();
          const folders = await listDocumentFolders();
          folderId = folders.find((f) => String(f.name).trim().toLowerCase() === wanted)?.id || null;
          if (!folderId) {
            return {
              statusCode: 404,
              headers: corsHeaders,
              body: JSON.stringify({
                ok: false,
                error: `No AccuLynx document folder named "${body.documentFolderName || "Job Paperwork"}". Pick one in Settings. Folders found: ${folders.map((f) => f.name).join(", ") || "none"}`,
              }),
            };
          }
        }
        if (!fileBase64) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing file payload" }) };
        }

        const bytes = Buffer.from(fileBase64, "base64");
        // Netlify caps a function request body at 6MB and base64 inflates by ~33%.
        // A material report is tens of KB; anything near the cap is a bug upstream,
        // and failing here names the real problem instead of a truncated upload.
        if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Report PDF is empty or too large to upload" }) };
        }

        // Node 18+ on Netlify has FormData/Blob natively, so the multipart body
        // needs no extra dependency. Do NOT set Content-Type by hand — fetch has
        // to append its own multipart boundary.
        const form = new FormData();
        form.append("file", new Blob([bytes], { type: "application/pdf" }), fileName || "JobReport.pdf");
        form.append("documentFolderId", folderId);
        if (description) form.append("description", String(description).slice(0, 500));

        const upRes = await fetch(`https://api.acculynx.com/api/v2/jobs/${acculynxJobId}/documents`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });

        if (!upRes.ok) {
          const txt = await upRes.text();
          throw new Error(`AccuLynx document upload failed ${upRes.status}: ${txt}`);
        }

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: true, message: "Completion report uploaded to the AccuLynx job file." }),
        };
      } catch (err) {
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ ok: false, error: err.message }) };
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
          // Real full-text search lives on POST /jobs/search with { searchTerm } — prefer an
          // exact jobNumber match among results, fall back to the top hit.
          const searchRes = await fetch(
            `https://api.acculynx.com/api/v2/jobs/search?pageSize=10&recordStartIndex=0`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ searchTerm: poNumber }),
            }
          );
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            const candidates = searchData?.data || searchData?.items || searchData?.jobs || searchData?.results || (Array.isArray(searchData) ? searchData : []);
            rawJob = candidates.find((j) => String(j.jobNumber) === String(poNumber)) || candidates[0] || null;
          }
        } else {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Provide acculynxJobId or poNumber" }) };
        }

        if (!rawJob) {
          return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Job not found" }) };
        }

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
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, job: normalizedJob }) };
      } catch (err) {
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ ok: false, error: err.message }) };
      }
    }

    // ── Default action: record material costs on the AccuLynx job ──
    if (!body.acculynxJobId && (!body.poNumber || body.poNumber === "NO_PO")) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Job has no PO number to match against AccuLynx" }) };
    }

    const amount = Math.round(Number(body.totalMaterialCost) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, skipped: true, message: "No material cost to sync (net pulled quantity is zero)." }),
      };
    }

    // Jobs linked through the Build Jobs wizard carry the AccuLynx job id
    // directly; only fall back to a PO-number lookup for unlinked jobs.
    let acculynxJob = body.acculynxJobId ? { id: body.acculynxJobId } : null;

    if (!acculynxJob) {
      const searchRes = await fetch(
        `https://api.acculynx.com/api/v2/jobs/search?pageSize=25&recordStartIndex=0`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ searchTerm: body.poNumber }),
        }
      );

      if (!searchRes.ok) {
        const txt = await searchRes.text();
        throw new Error(`AccuLynx job lookup failed ${searchRes.status}: ${txt}`);
      }

      const searchData = await searchRes.json();
      const searchCandidates = searchData?.data || searchData?.items || searchData?.jobs || searchData?.results || (Array.isArray(searchData) ? searchData : []);
      // Exact jobNumber match only — costs are written to the job, so a
      // best-guess fallback would silently post expenses onto the wrong file.
      acculynxJob = searchCandidates.find((j) => String(j.jobNumber) === String(body.poNumber));
    }

    if (!acculynxJob?.id) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: false,
          error: `No AccuLynx job with job number "${body.poNumber}" — sync skipped to avoid posting costs to the wrong job`
        }),
      };
    }

    const acculynxJobId = acculynxJob.id;

    // ── Do not bill the same job twice ───────────────────────────────────
    // Creating an expense is not idempotent, and the client cannot tell a lost
    // reply from a failed write: a request that times out may well have posted.
    // The obvious next move for whoever sees "Sync Failed" is to press Retry,
    // and without this that books the material cost onto the job a second time.
    //
    // Matching on amount AND our PO reference, because a company legitimately
    // has several expenses on one job (dumpster, labor) and only OUR line is the
    // one being replayed.
    const expenseRef = body.poNumber && body.poNumber !== "NO_PO" ? String(body.poNumber).slice(0, 50) : null;
    try {
      const existingRes = await fetch(
        `https://api.acculynx.com/api/v2/jobs/${acculynxJobId}/payments?pageSize=100&recordStartIndex=0`,
        { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
      );
      if (existingRes.ok) {
        const existing = await existingRes.json();
        const priorPayments = Array.isArray(existing?.items) ? existing.items : [];
        const duplicate = priorPayments.find(
          (p) => Math.abs(Number(p.amount) - amount) < 0.005 &&
                 (!expenseRef || String(p.refNumber || "") === expenseRef)
        );
        if (duplicate) {
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              ok: true,
              acculynxJobId,
              alreadyRecorded: true,
              message: `This material cost is already on the AccuLynx job (${amount.toFixed(2)}). Nothing was posted a second time.`,
            }),
          };
        }
      }
      // A failed duplicate check is not a reason to abandon the sync. It only
      // means we post without the guard, which is the old behaviour.
    } catch {
      // fall through and post
    }

    // AccuLynx has no /lineitems endpoint; material costs are recorded as an
    // Additional Job Expense payment, and `notes` carries what fits of the
    // breakdown. The cap is 250 characters — see _shared/expenseNotes.js.
    const notes = buildExpenseNotes(body.paymentDescription, body.lineItems);

    // paymentDate is REQUIRED. Without it AccuLynx rejects the whole call with
    // 400 "PaymentDate cannot be null or empty" — verified against the live API,
    // and the reason no expense this integration ever sent has landed. The sync
    // fires when the job is marked complete, so "now" is the honest date; callers
    // may override it if they ever need to backdate.
    const paymentDate = body.paymentDate || new Date().toISOString();

    const expenseRes = await fetch(
      `https://api.acculynx.com/api/v2/jobs/${acculynxJobId}/payments/expense`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: body.paidTo || "MRR Warehouse",
          amount,
          notes,
          paymentDate,
          isPaid: true,
          // 50, not 255: AccuLynx caps refNumber at 50 and 400s the whole call
          // past that. It also has to match the slice the duplicate check above
          // uses, or a replay would fail to recognise its own earlier expense.
          refNumber: expenseRef || undefined,
        }),
      }
    );

    if (!expenseRes.ok) {
      const txt = await expenseRes.text();
      throw new Error(`AccuLynx expense error ${expenseRes.status}: ${txt}`);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, acculynxJobId, message: "Material costs recorded in AccuLynx as an additional job expense." }),
    };

  } catch (globalError) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: globalError.message }),
    };
  }
};