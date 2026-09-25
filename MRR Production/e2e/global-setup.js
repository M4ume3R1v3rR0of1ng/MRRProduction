// e2e/global-setup.js
//
// Seeds one disposable company + two users + one stocked inventory item, using
// the service-role key exactly like scripts/verify-tenant-isolation.mjs does —
// a real company/user/session, not a mock. Runs once before the whole
// Playwright run; global-teardown.js removes everything it creates.
//
// State is handed to the spec file through a JSON file rather than an
// exported value, because Playwright's globalSetup and the test files run in
// separate processes with no shared memory.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSupabaseEnv } from "./env.js";

const STATE_FILE = path.join(fileURLToPath(new URL(".", import.meta.url)), ".e2e-state.json");
const TEST_SLUG = "zz-e2e-test";

export default async function globalSetup() {
  const { url, serviceKey } = loadSupabaseEnv();
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Leftovers from a previous run that crashed before teardown ran.
  const { data: stale } = await admin
    .from("companies")
    .select("id")
    .eq("slug", TEST_SLUG)
    .maybeSingle();
  if (stale) await admin.from("companies").delete().eq("id", stale.id);

  const { data: company, error: companyErr } = await admin
    .from("companies")
    .insert({ name: "ZZ E2E Test Co", slug: TEST_SLUG, subscription_status: "active" })
    .select("id")
    .single();
  if (companyErr) throw companyErr;

  const runId = Date.now();
  const adminEmail = `e2e-admin-${runId}@example.invalid`;
  const adminPassword = `Test-${Math.random().toString(36).slice(2)}-9xQ!`;

  const { data: adminAuth, error: adminAuthErr } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: "ZZ E2E Admin" },
  });
  if (adminAuthErr) throw adminAuthErr;
  const adminUserId = adminAuth.user.id;

  await admin
    .from("memberships")
    .insert({ user_id: adminUserId, company_id: company.id, role: "admin", active: true });
  await admin
    .from("profiles")
    .update({ full_name: "ZZ E2E Admin", active_company_id: company.id, active: true })
    .eq("id", adminUserId);

  // A second member with a role BuildJobsView's approve modal will actually
  // offer as an assignee (fieldUsers = role "field" or "Site Supervisor").
  // Never signed in — just needs to exist so the "Assign to Site Supervisor"
  // dropdown has something to select.
  const supervisorName = "ZZ E2E Supervisor";
  const { data: supAuth, error: supAuthErr } = await admin.auth.admin.createUser({
    email: `e2e-supervisor-${runId}@example.invalid`,
    password: `Test-${Math.random().toString(36).slice(2)}-9xQ!`,
    email_confirm: true,
    user_metadata: { full_name: supervisorName },
  });
  if (supAuthErr) throw supAuthErr;
  const supervisorUserId = supAuth.user.id;

  await admin
    .from("memberships")
    .insert({ user_id: supervisorUserId, company_id: company.id, role: "field", active: true });
  await admin
    .from("profiles")
    .update({ full_name: supervisorName, active: true })
    .eq("id", supervisorUserId);

  // One catalog item with enough stock that a 1-unit pull never trips the
  // shortfall dialog. Shape mirrors the real insert in
  // src/features/inventory/ItemFormModal.jsx — company_id is set explicitly
  // here because that field is normally filled by a DB trigger keyed off the
  // caller's session, which the service-role key has none of.
  const itemName = "ZZ E2E Test Shingle";
  const { error: itemErr } = await admin.from("inventory").insert({
    id: `i_e2e_${runId}`,
    company_id: company.id,
    name: itemName,
    cat: "Roofing Materials",
    unit: "bundle",
    alrt: 5,
    batches: [
      {
        id: `b_e2e_${runId}`,
        rcvd: new Date().toISOString().slice(0, 10),
        qty: 100,
        rem: 100,
        price: 25,
        by: adminUserId,
      },
    ],
  });
  if (itemErr) throw itemErr;

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        companyId: company.id,
        adminUserId,
        supervisorUserId,
        adminEmail,
        adminPassword,
        supervisorName,
        itemName,
      },
      null,
      2,
    ),
  );
}

export { STATE_FILE };
