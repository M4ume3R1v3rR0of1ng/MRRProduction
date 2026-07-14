// netlify/functions/acculynx-sync.js

import { adminClient, resolveCaller } from "./_shared/tenant.js";

const ALLOWED_ORIGINS = [
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

    // AccuLynx has no /lineitems endpoint; material costs are recorded as an
    // Additional Job Expense payment. The per-item breakdown goes in `notes`.
    const itemLines = Array.isArray(body.lineItems)
      ? body.lineItems.map((li) =>
          `${li.name} — ${li.quantity} ${li.unit} @ $${Number(li.unitPrice || 0).toFixed(2)} = $${Number(li.totalCost || 0).toFixed(2)}`
        )
      : [];
    let notes = [body.paymentDescription, ...itemLines].filter(Boolean).join("\n");
    if (notes.length > 1900) notes = `${notes.slice(0, 1900)}…`;

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
          isPaid: true,
          refNumber: body.poNumber && body.poNumber !== "NO_PO" ? String(body.poNumber).slice(0, 255) : undefined,
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