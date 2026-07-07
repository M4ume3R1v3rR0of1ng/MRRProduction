// netlify/functions/acculynx-import.js
// Pulls jobs + customer details from AccuLynx and upserts them into Supabase.
// Env vars required (already set for your other functions):
//   ACCULYNX_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Plus a new one to protect this endpoint (anyone with the URL can trigger a full pull otherwise):
//   ACCULYNX_IMPORT_SECRET
// Call it with either header `x-import-secret: <value>` or query param `?secret=<value>`.
// Defaults to pulling only "completed" milestone jobs. Pass ?milestones=all to pull every
// stage, or ?milestones=<stage> for a specific one (lead, prospect, approved, completed,
// invoiced, closed, cancelled, dead). Paginate with ?page=<recordStartIndex>.

const { createClient } = require('@supabase/supabase-js');

const ACCULYNX_BASE = 'https://api.acculynx.com/api/v2';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function acculynxFetch(path) {
  const res = await fetch(`${ACCULYNX_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.ACCULYNX_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AccuLynx ${res.status} on ${path}: ${body}`);
  }
  return res.json();
}

// Fetch a page of jobs. AccuLynx v2 uses pageSize / recordStartIndex paging
// (NOT pageStartIndex — that param doesn't exist and was silently ignored,
// which meant every "page" re-fetched the same first pageSize jobs).
// `milestones` filters by job stage (lead, prospect, approved, completed,
// invoiced, closed, cancelled, dead) — matches the milestone filter on the
// AccuLynx Jobs dashboard (e.g. currentMilestoneList:Completed).
async function fetchJobsPage(pageStartIndex = 0, pageSize = 25, milestones = "") {
  const milestoneParam = milestones ? `&milestones=${encodeURIComponent(milestones)}` : "";
  return acculynxFetch(`/jobs?pageSize=${pageSize}&recordStartIndex=${pageStartIndex}${milestoneParam}`);
}

// Full details for one job (includes milestone/status, addresses, contact refs)
async function fetchJobDetails(jobId) {
  return acculynxFetch(`/jobs/${jobId}`);
}

// Customer/contact record tied to the job
async function fetchContact(contactId) {
  return acculynxFetch(`/contacts/${contactId}`);
}

// Map AccuLynx job + contact into your Supabase jobs table shape.
// NOTE: verify exact field names against a real response from your account —
// log one response and adjust. These names follow the v2 docs conventions.
function mapToSupabaseRow(job, contact) {
  const primaryEmail = contact?.emailAddresses?.[0]?.emailAddress ?? null;
  const primaryPhone = contact?.phoneNumbers?.[0]?.phoneNumber ?? null;
  const addr = job?.jobSiteAddress ?? {};

  return {
    acculynx_job_id: job.id,
    job_number: job.jobNumber ?? null,
    job_name: job.jobName ?? null,
    acculynx_status: job.milestone?.name ?? job.status ?? null,
    customer_name: contact
      ? [contact.firstName, contact.lastName].filter(Boolean).join(' ')
      : null,
    customer_email: primaryEmail,
    customer_phone: primaryPhone,
    address_street: addr.streetAddress ?? null,
    address_city: addr.city ?? null,
    address_state: addr.state ?? null,
    address_zip: addr.zipCode ?? null,
    last_synced_at: new Date().toISOString(),
  };
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};

    // ── Shared-secret guard: without this, anyone with the URL could trigger a full AccuLynx pull ──
    const providedSecret =
      event.headers?.['x-import-secret'] ||
      event.headers?.['X-Import-Secret'] ||
      params.secret ||
      null;

    if (!process.env.ACCULYNX_IMPORT_SECRET || providedSecret !== process.env.ACCULYNX_IMPORT_SECRET) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const pageStartIndex = parseInt(params.page || '0', 10);
    const pageSize = 25;
    // Defaults to "completed" — pass ?milestones=all (or any other stage) to override.
    const milestones = params.milestones === 'all' ? '' : (params.milestones || 'completed');

    // 1. Get a page of jobs
    const jobsPage = await fetchJobsPage(pageStartIndex, pageSize, milestones);
    const jobs = jobsPage.items ?? jobsPage ?? [];

    const rows = [];
    for (const summary of jobs) {
      // 2. Pull full job details
      const job = await fetchJobDetails(summary.id);

      // 3. Pull the customer contact if the job references one
      let contact = null;
      const contactId =
        job.contactId ?? job.primaryContact?.id ?? job.contact?.id ?? null;
      if (contactId) {
        try {
          contact = await fetchContact(contactId);
        } catch (err) {
          console.warn(`Contact fetch failed for job ${job.id}:`, err.message);
        }
      }

      rows.push(mapToSupabaseRow(job, contact));

      // Be polite to the API — small delay between jobs
      await new Promise((r) => setTimeout(r, 200));
    }

    // 4. Upsert into Supabase keyed on the AccuLynx job id
    if (rows.length > 0) {
      const { error } = await supabase
        .from('jobs')
        .upsert(rows, { onConflict: 'acculynx_job_id' });
      if (error) throw error;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        imported: rows.length,
        nextPage: jobs.length === pageSize ? pageStartIndex + pageSize : null,
      }),
    };
  } catch (err) {
    console.error('AccuLynx import failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
