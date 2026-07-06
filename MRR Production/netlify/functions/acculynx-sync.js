// netlify/functions/acculynx-sync.js

const ALLOWED_ORIGINS = [
  "https://mrrproduction.netlify.app",
  "http://localhost:5173",
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

exports.handler = async (event) => {
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

    // ── 🟢 FIXED: Extract Key from Server-side Environment, fallback to header extraction ──
    let apiKey = process.env.ACCULYNX_API_KEY;

    if (!apiKey && event.headers?.authorization) {
      const parts = event.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        apiKey = parts[1];
      }
    }

    if (!apiKey) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Missing AccuLynx API key configuration" }) };
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

    // ── Look up AccuLynx internal numeric Job ID via the real search endpoint ──
    const searchRes = await fetch(
      `https://api.acculynx.com/api/v2/jobs/search?pageSize=5&recordStartIndex=0`,
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
    const acculynxJob = searchCandidates.find((j) => String(j.jobNumber) === String(body.poNumber)) || searchCandidates[0];

    if (!acculynxJob?.id) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ 
          ok: false, 
          error: `No AccuLynx job found matching PO: ${body.poNumber}` 
        }),
      };
    }

    const acculynxJobId = acculynxJob.id; 

    // ── FIX 2: Send clean, precisely schema-matched body down to official endpoint ──
    const lineItemRes = await fetch(
      `https://api.acculynx.com/api/v2/jobs/${acculynxJobId}/lineitems`, 
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`, 
          'Content-Type': 'application/json', 
        },
        body: JSON.stringify({
          description: body.paymentDescription,
          amount: body.totalMaterialCost, 
          lineItems: body.lineItems, 
        }),
      }
    );

    if (!lineItemRes.ok) {
      const txt = await lineItemRes.text(); 
      throw new Error(`AccuLynx line item error ${lineItemRes.status}: ${txt}`); 
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, acculynxJobId }), 
    };

  } catch (globalError) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: globalError.message }),
    };
  }
};