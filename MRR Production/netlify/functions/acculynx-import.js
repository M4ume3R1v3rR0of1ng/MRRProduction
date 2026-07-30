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

// Customer/contact record tied to the job. Returns firstName/lastName, but its
// emailAddresses and phoneNumbers are REFERENCE STUBS — `{ id, _link }` with no
// value on them. The actual address and number live on the sub-collections below.
async function fetchContact(apiKey, contactId) {
  return acculynxFetch(`/contacts/${contactId}`, apiKey);
}

// The contact's real email / phone. Verified against the live API:
//   /contacts/{id}/email-addresses -> { items: [{ id, address, primary, type }] }
//   /contacts/{id}/phone-numbers   -> { items: [{ id, number, ext, type, primary }] }
// Prefer the one flagged primary, else take the first.
function pickPrimary(items) {
  const list = Array.isArray(items) ? items : [];
  return list.find((x) => x?.primary) || list[0] || null;
}

async function fetchContactEmail(apiKey, contactId) {
  const d = await acculynxFetch(`/contacts/${contactId}/email-addresses`, apiKey);
  return pickPrimary(d?.items)?.address ?? null;
}

async function fetchContactPhone(apiKey, contactId) {
  const d = await acculynxFetch(`/contacts/${contactId}/phone-numbers`, apiKey);
  return pickPrimary(d?.items)?.number ?? null;
}

// Which contact is the customer. A job carries `contacts: [{ id, contact: { id },
// isPrimary }]` — the id we want is the NESTED contact.id, not the join row's id.
// The old code looked for job.contactId / job.primaryContact.id / job.contact.id,
// none of which exist on the v2 job resource, so no contact was ever fetched and
// every customer column imported as null.
function primaryContactId(job) {
  const list = Array.isArray(job?.contacts) ? job.contacts : [];
  const chosen = list.find((c) => c?.isPrimary) || list[0] || null;
  return chosen?.contact?.id ?? null;
}

// Map AccuLynx job + contact into your Supabase jobs table shape.
//
// The job title column is `title`, NOT `name`. This wrote `name` until now, which
// broke the import a second time: supabase/15_jobs_schema_debt.sql dropped
// jobs.name (it was dead — 0 of 21 rows populated, because the build wizard has
// always written `title`), and Postgres rejects an insert naming a column that
// doesn't exist. Readers already prefer title: `j.title || j.name` throughout.
//
// Field names below are no longer guesses — they were checked against a live
// response from the Maumee River account (job 22311). The previous mapping used
// three fields that do not exist on the v2 job resource:
//
//   job.milestone.name / job.status  ->  actually `currentMilestone`, a plain string
//   job.jobSiteAddress               ->  actually `locationAddress`
//   job.contactId                    ->  actually contacts[].contact.id
//
// Postgres accepts those as nulls rather than erroring, so the import looked like
// it worked while writing a row with nothing in it but the id, PO and title.
function mapToSupabaseRow(job, customer, companyId) {
  // locationAddress: { street1, city, state: { abbreviation }, zipCode, country }.
  // `state` is a nested object, not a string — writing it straight into a text
  // column would have stored "[object Object]".
  const addr = job?.locationAddress ?? {};

  return {
    // `id` is the table's other PK column and is app-generated text elsewhere, so
    // key imported jobs off the AccuLynx id to keep them stable across re-imports.
    id: `acx_${job.id}`,
    company_id: companyId,
    acculynx_job_id: job.id,
    po: job.jobNumber ?? null,
    title: job.jobName ?? null,
    acculynx_status: job.currentMilestone ?? null,
    customer_name: customer?.name ?? null,
    customer_email: customer?.email ?? null,
    customer_phone: customer?.phone ?? null,
    address_street: addr.street1 ?? null,
    address_city: addr.city ?? null,
    address_state: addr.state?.abbreviation ?? null,
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
    for (const job of jobs) {
      // 2. No per-job GET /jobs/{id} here. Checked against the live API: the list
      //    response returns the identical key set to the detail response, so that
      //    was one wasted request per job. Dropping it pays for the contact
      //    sub-resource calls added below, keeping the request count flat — which
      //    matters because this runs inside a Netlify function's time limit.

      // 3. Customer details. Three calls, because the contact record carries the
      //    name but only reference stubs for email and phone. Email and phone are
      //    fetched together since neither depends on the other.
      let customer = null;
      const contactId = primaryContactId(job);
      if (contactId) {
        try {
          const [contact, email, phone] = await Promise.all([
            fetchContact(apiKey, contactId),
            fetchContactEmail(apiKey, contactId).catch(() => null),
            fetchContactPhone(apiKey, contactId).catch(() => null),
          ]);
          const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ');
          customer = { name: name || null, email, phone };
        } catch (err) {
          // A missing contact must not lose the job — import it without them.
          console.warn(`Contact fetch failed for job ${job.id}:`, err.message);
        }
      }

      rows.push(mapToSupabaseRow(job, customer, company.id));

      // Be polite to the API — small delay between jobs
      await new Promise((r) => setTimeout(r, 200));
    }

    // 4. Upsert, keyed on the primary key (company_id, id).
    //
    // NOT on (company_id, acculynx_job_id): that constraint is gone as of
    // supabase/17_multi_crew_jobs.sql, because one AccuLynx job can have several
    // inventory jobs on our side (roofing crew and siding crew each pull their
    // own materials). See that migration for the full reasoning.
    //
    // This is just as idempotent — `id` is derived from the AccuLynx job id in
    // mapToSupabaseRow, so a re-import of job X targets the same row every time.
    // It is also safer: keyed this way the import can only ever update rows the
    // import created, never a job a crew built by hand against the same AccuLynx job.
    if (rows.length > 0) {
      const { error } = await supabase
        .from('jobs')
        .upsert(rows, { onConflict: 'company_id,id' });
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
