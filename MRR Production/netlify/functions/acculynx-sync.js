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
    if (body.action === "search") {
      const q = (body.query || "").trim();
      if (!q) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing search query" }) };
      }
      try {
        // Run a name search and, if query looks numeric, a parallel job-number search
        const nameUrl = `https://api.acculynx.com/api/v2/jobs?search=${encodeURIComponent(q)}&page=1&pageSize=10`;
        const requests = [
          fetch(nameUrl, { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }),
        ];
        const isNumeric = /^\d+$/.test(q);
        if (isNumeric) {
          const numUrl = `https://api.acculynx.com/api/v2/jobs?jobNumber=${encodeURIComponent(q)}&page=1&pageSize=10`;
          requests.push(fetch(numUrl, { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }));
        }
        const rawResponses = [];
        const responses = await Promise.all(requests);
        const dataArrays = await Promise.all(
          responses.map(async (r) => {
            if (!r.ok) return [];
            const d = await r.json();
            rawResponses.push({ keys: Object.keys(d || {}), status: r.status, sample: JSON.stringify(d).slice(0, 500) });
            console.log("AccuLynx raw response:", JSON.stringify(d));
            return d?.data || d?.items || d?.jobs || d?.results || (Array.isArray(d) ? d : []);
          })
        );
        // Merge and deduplicate by id
        const seen = new Set();
        const merged = dataArrays.flat().filter((j) => {
          if (!j?.id || seen.has(j.id)) return false;
          seen.add(j.id);
          return true;
        });
        const jobs = merged.map((j) => {
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
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, jobs: [], _debug: rawResponses }) };
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
          // Try jobNumber filter first (exact match), then fall back to text search
          const byNum = await fetch(
            `https://api.acculynx.com/api/v2/jobs?jobNumber=${encodeURIComponent(poNumber)}&page=1&pageSize=1`,
            { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
          );
          if (byNum.ok) {
            const numData = await byNum.json();
            rawJob = numData?.data?.[0] || numData?.items?.[0] || null;
          }
          if (!rawJob) {
            const bySearch = await fetch(
              `https://api.acculynx.com/api/v2/jobs?search=${encodeURIComponent(poNumber)}&page=1&pageSize=1`,
              { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
            );
            if (bySearch.ok) {
              const searchData = await bySearch.json();
              rawJob = searchData?.data?.[0] || searchData?.items?.[0] || null;
            }
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

    // ── FIX 1: Look up AccuLynx internal numeric Job ID via your specification query ──
    const searchRes = await fetch(
      `https://api.acculynx.com/api/v2/jobs?search=${encodeURIComponent(body.poNumber)}&page=1&pageSize=5`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`, 
          'Content-Type': 'application/json', 
        },
      }
    );

    if (!searchRes.ok) {
      const txt = await searchRes.text();
      throw new Error(`AccuLynx job lookup failed ${searchRes.status}: ${txt}`); 
    }

    const searchData = await searchRes.json(); 
    const acculynxJob = searchData?.data?.[0]; // Grab first array match

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