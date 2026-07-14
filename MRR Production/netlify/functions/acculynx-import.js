// netlify/functions/acculynx-import.js
// Pulls jobs + customer details from AccuLynx and upserts them into Supabase.
//
// MULTI-TENANT: every company has its own AccuLynx account, so the API key is read
// from companies.integrations.acculynxApiKey — NOT from a single shared env var.
// The company to import into is named explicitly:
//     ?company=<slug>          e.g. ?company=maumee-river-roofing
//
// Auth: header `x-import-secret: <ACCULYNX_IMPORT_SECRET>`. There is no user session
// here (it's a machine-to-machine pull), so the target company cannot be inferred —
// it must be passed, and the rows must be stamped with it. Without company_id the
// insert now fails outright: company_id is NOT NULL and its DEFAULT active_company_id()
// evaluates to NULL under the service-role key. That is a deliberate tripwire.
//
// Defaults to pulling only "completed" milestone jobs. Pass ?milestones=all to pull every
// stage, or ?milestones=<stage> for a specific one (lead, prospect, approved, completed,
// invoiced, closed, cancelled, dead). Paginate with ?page=<recordStartIndex>.

import { adminClient } from "./_shared/tenant.js";

const ACCULYNX_BASE = 'https://api.acculynx.com/api/v2';

const supabase = adminClient();

async function acculynxFetch(path, apiKey) {
  const res = await fetch(`${ACCULYNX_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
async function fetchJobsPage(apiKey, pageStartIndex = 0, pageSize = 25, milestones = "") {
  const milestoneParam = milestones ? `&milestones=${encodeURIComponent(milestones)}` : "";
  return acculynxFetch(`/jobs?pageSize=${pageSize}&recordStartIndex=${pageStartIndex}${milestoneParam}`, apiKey);
}

// Full details for one job (includes milestone/status, addresses, contact refs)
async function fetchJobDetails(apiKey, jobId) {
  return acculynxFetch(`/jobs/${jobId}`, apiKey);
}

// Customer/contact record tied to the job
async function fetchContact(apiKey, contactId) {
  return acculynxFetch(`/contacts/${contactId}`, apiKey);
}

// Map AccuLynx job + contact into your Supabase jobs table shape.
//
// FIXED: this previously wrote `job_number` and `job_name`, neither of which is a
// column on `jobs` — Postgres rejects an insert naming an unknown column, so this
// import has never actually landed a row. The real columns are `po` and `name`.
//
// NOTE: verify the AccuLynx-side field names against a real response from your
// account — log one and adjust. These follow the v2 docs conventions.
function mapToSupabaseRow(job, contact, companyId) {
  const primaryEmail = contact?.emailAddresses?.[0]?.emailAddress ?? null;
  const primaryPhone = contact?.phoneNumbers?.[0]?.phoneNumber ?? null;
  const addr = job?.jobSiteAddress ?? {};

  return {
    // `id` is the table's other PK column and is app-generated text elsewhere, so
    // key imported jobs off the AccuLynx id to keep them stable across re-imports.
    id: `acx_${job.id}`,
    company_id: companyId,
    acculynx_job_id: job.id,
    po: job.jobNumber ?? null,
    name: job.jobName ?? null,
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

export const handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};

    // ── Shared-secret guard: without this, anyone with the URL could trigger a full AccuLynx pull ──
    // Header only — never accept the secret via query string, which leaks into
    // access logs, proxies, and browser history.
    const providedSecret =
      event.headers?.['x-import-secret'] ||
      event.headers?.['X-Import-Secret'] ||
      null;

    if (!process.env.ACCULYNX_IMPORT_SECRET || providedSecret !== process.env.ACCULYNX_IMPORT_SECRET) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // ── Which company are we importing into? ──
    // There is no user session on this endpoint, so it cannot be inferred. Naming it
    // explicitly is also what stops a caller who has the import secret from dumping
    // one company's AccuLynx jobs into another company's portal.
    const slug = params.company;
    if (!slug) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing ?company=<slug> — the import target must be named explicitly.' }),
      };
    }

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id, name, subscription_status')
      .eq('slug', slug)
      .maybeSingle();

    if (companyError || !company) {
      return { statusCode: 404, body: JSON.stringify({ error: `No company with slug "${slug}".` }) };
    }
    if (!['trialing', 'active', 'past_due'].includes(company.subscription_status)) {
      return {
        statusCode: 402,
        body: JSON.stringify({ error: `Company "${slug}" does not have an active subscription.` }),
      };
    }

    // The AccuLynx key lives in company_secrets now (no browser role can read it).
    // This service-role client can. ACCULYNX_API_KEY stays as a fallback only so
    // Maumee River keeps working before its key is saved into the DB.
    const { data: secrets } = await supabase
      .from('company_secrets')
      .select('integrations')
      .eq('company_id', company.id)
      .maybeSingle();
    const apiKey = secrets?.integrations?.acculynxApiKey || process.env.ACCULYNX_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `No AccuLynx API key configured for "${slug}".` }),
      };
    }

    const pageStartIndex = parseInt(params.page || '0', 10);
    const pageSize = 25;
    // Defaults to "completed" — pass ?milestones=all (or any other stage) to override.
    const milestones = params.milestones === 'all' ? '' : (params.milestones || 'completed');

    // 1. Get a page of jobs
    const jobsPage = await fetchJobsPage(apiKey, pageStartIndex, pageSize, milestones);
    const jobs = jobsPage.items ?? jobsPage ?? [];

    const rows = [];
    for (const summary of jobs) {
      // 2. Pull full job details
      const job = await fetchJobDetails(apiKey, summary.id);

      // 3. Pull the customer contact if the job references one
      let contact = null;
      const contactId =
        job.contactId ?? job.primaryContact?.id ?? job.contact?.id ?? null;
      if (contactId) {
        try {
          contact = await fetchContact(apiKey, contactId);
        } catch (err) {
          console.warn(`Contact fetch failed for job ${job.id}:`, err.message);
        }
      }

      rows.push(mapToSupabaseRow(job, contact, company.id));

      // Be polite to the API — small delay between jobs
      await new Promise((r) => setTimeout(r, 200));
    }

    // 4. Upsert, keyed on (company_id, acculynx_job_id).
    //
    // The old onConflict: 'acculynx_job_id' could never work — no unique constraint
    // on that column existed, and Postgres rejects an ON CONFLICT that doesn't match
    // one. supabase/02_tenancy_tables.sql adds the composite constraint this needs.
    // Composite is also the correct key: two companies each have their own AccuLynx
    // account, and their job-id spaces are allowed to overlap.
    if (rows.length > 0) {
      const { error } = await supabase
        .from('jobs')
        .upsert(rows, { onConflict: 'company_id,acculynx_job_id' });
      if (error) throw error;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        company: company.name,
        imported: rows.length,
        nextPage: jobs.length === pageSize ? pageStartIndex + pageSize : null,
      }),
    };
  } catch (err) {
    console.error('AccuLynx import failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
