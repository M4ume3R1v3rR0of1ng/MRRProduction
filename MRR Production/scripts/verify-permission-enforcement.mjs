// scripts/verify-permission-enforcement.mjs
//
// Proves that job permissions are enforced by the DATABASE, not just hidden in the UI.
//
// The bug this exists to prevent: before supabase/12, `jobs_close: false` only hid a
// button. Any company member could still close a job with a direct API call — or with
// a stale browser session that still believed it had the permission. The rule looked
// enforced and wasn't, and the failure was invisible: no error, just the wrong person
// closing jobs.
//
// This creates a throwaway company whose role_permissions MIRROR production (coordinator
// pull/complete yes, close NO; bookkeeper close only), signs in as each role for real
// through the anon key — the same path the browser takes — and asserts every gated
// transition allows or denies correctly.
//
// It deliberately covers the two fallback paths that quietly grant permission by
// accident: a role row missing the key entirely (field/warehouse have no jobs_close),
// and a role with no stored perms at all (employee) — both must land on DENY.
//
// Run:
//   SUPABASE_SERVICE_ROLE_KEY=$(npx netlify-cli env:get SUPABASE_SERVICE_ROLE_KEY) \
//     node scripts/verify-permission-enforcement.mjs
//
// Exit 0 = permissions are real. Non-zero = the toggles are decorative.

import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// ── config ───────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").match(/eyJ[A-Za-z0-9._-]+/)?.[0];

if (!URL || !ANON) { console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env"); process.exit(2); }
if (!SERVICE)      { console.error("Missing SUPABASE_SERVICE_ROLE_KEY in the environment"); process.exit(2); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const TEST_SLUG = "zz-perm-enforcement-test";

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Mirrors production's role_permissions exactly, including the MISSING keys — those
// are the interesting ones. `field`/`warehouse` have no jobs_close stored, so the
// answer comes from default_job_perms(); if that default were wrong they'd silently
// gain the ability to close jobs.
const ROLE_PERMS = {
  coordinator: { jobs_build: true,  jobs_approve: true,  jobs_pull: true,  jobs_complete: true,  jobs_close: false },
  bookkeeper:  { jobs_build: false, jobs_approve: false, jobs_pull: false, jobs_complete: false, jobs_close: true  },
  field:       { jobs_build: false, jobs_approve: false, jobs_pull: true,  jobs_complete: true /* jobs_close absent */ },
  employee:    { fleet_view: true,  maint_submit: true /* every job key absent */ },
};

let testCompanyId = null;
const users = {};   // role -> { uid, email, client }
let jobSeq = 0;

async function makeUser(role) {
  const email = `perm-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const password = `Test-${Math.random().toString(36).slice(2)}-9xQ!`;
  const { data: au, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: `Perm ${role}` },
  });
  if (error) throw error;
  const uid = au.user.id;
  await admin.from("memberships").insert({ user_id: uid, company_id: testCompanyId, role, active: true });
  await admin.from("profiles").update({ active_company_id: testCompanyId, active: true }).eq("id", uid);

  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`sign-in failed for ${role}: ${sErr.message}`);
  return { uid, email, client };
}

// Seeded as service_role, which bypasses the trigger — so setup can't be blocked by
// the very rules under test.
async function seedJob(status) {
  const id = `permtest_${Date.now()}_${jobSeq++}`;
  const { error } = await admin.from("jobs").insert({
    id, company_id: testCompanyId, status, title: `Perm Test (${status})`,
  });
  if (error) throw error;
  return id;
}

async function statusOf(id) {
  const { data } = await admin.from("jobs").select("status").eq("id", id).eq("company_id", testCompanyId).maybeSingle();
  return data?.status;
}

async function tryTransition(client, jobId, newStatus) {
  const { data, error } = await client.from("jobs").update({ status: newStatus }).eq("id", jobId).select("id,status");
  return { ok: !error && (data || []).length === 1, error };
}

// ALLOW must actually persist — an RLS denial returns [] with no error, which would
// otherwise read as a pass.
async function expectAllow(label, client, from, to) {
  const id = await seedJob(from);
  const { ok, error } = await tryTransition(client, id, to);
  const landed = await statusOf(id);
  check(`${label}  (${from} → ${to})`, ok && landed === to,
        error ? `BLOCKED: ${error.code} ${error.message}` : (landed !== to ? `status stayed '${landed}'` : ""));
}

async function expectDeny(label, client, from, to) {
  const id = await seedJob(from);
  const { ok, error } = await tryTransition(client, id, to);
  const landed = await statusOf(id);
  const denied = !ok && landed === from;
  check(`${label}  (${from} → ${to} BLOCKED)`, denied,
        ok ? "TRANSITION SUCCEEDED — NOT ENFORCED" : (landed !== from ? `status changed to '${landed}' anyway` : ""));
}

async function expectInsert(label, client, shouldAllow) {
  const id = `permtest_ins_${Date.now()}_${jobSeq++}`;
  const { data, error } = await client.from("jobs")
    .insert({ id, company_id: testCompanyId, status: "draft", title: "Perm Test Insert" }).select("id");
  const ok = !error && (data || []).length === 1;
  if (shouldAllow) check(`${label}  (INSERT allowed)`, ok, error ? `BLOCKED: ${error.code} ${error.message}` : "affected 0 rows");
  else check(`${label}  (INSERT blocked)`, !ok, ok ? "INSERT SUCCEEDED — NOT ENFORCED" : "");
}

// ── main ─────────────────────────────────────────────────────────────────────
try {
  console.log("\n── Setup ──────────────────────────────────────────────────────");

  const { data: stale } = await admin.from("companies").select("id").eq("slug", TEST_SLUG).maybeSingle();
  if (stale) {
    await admin.from("jobs").delete().eq("company_id", stale.id);
    await admin.from("companies").delete().eq("id", stale.id);
  }

  const { data: co, error: coErr } = await admin.from("companies")
    .insert({ name: "ZZ Permission Test Co", slug: TEST_SLUG, subscription_status: "active" })
    .select("id").single();
  if (coErr) throw coErr;
  testCompanyId = co.id;
  console.log(`  Test tenant: ZZ Permission Test Co (${testCompanyId})`);

  for (const [role, permissions] of Object.entries(ROLE_PERMS)) {
    const { error } = await admin.from("role_permissions")
      .upsert({ company_id: testCompanyId, role, permissions }, { onConflict: "company_id,role" });
    if (error) throw error;
  }
  console.log(`  Seeded role_permissions mirroring production for: ${Object.keys(ROLE_PERMS).join(", ")}`);

  for (const role of ["coordinator", "bookkeeper", "field", "employee", "admin"]) {
    users[role] = await makeUser(role);
    console.log(`  User: ${role.padEnd(12)} ${users[role].email}`);
  }

  // ── The reported bug ───────────────────────────────────────────────────────
  console.log("\n── 1. Coordinator (Jerry's exact config: pull ✓ complete ✓ close ✗) ──");
  const coord = users.coordinator.client;
  await expectAllow("coordinator CAN pull inventory", coord, "approved", "active");
  await expectAllow("coordinator CAN complete", coord, "active", "completed");
  await expectDeny ("coordinator CANNOT close", coord, "completed", "closed");
  await expectDeny ("coordinator CANNOT reopen a closed job", coord, "closed", "completed");
  await expectAllow("coordinator CAN approve", coord, "draft", "approved");
  await expectInsert("coordinator CAN build", coord, true);

  console.log("\n── 2. Bookkeeper (Sabrina: close ONLY) ────────────────────────");
  const book = users.bookkeeper.client;
  await expectAllow("bookkeeper CAN close", book, "completed", "closed");
  await expectAllow("bookkeeper CAN reopen a closed job", book, "closed", "completed");
  await expectDeny ("bookkeeper CANNOT pull", book, "approved", "active");
  await expectDeny ("bookkeeper CANNOT complete", book, "active", "completed");
  await expectInsert("bookkeeper CANNOT build", book, false);

  console.log("\n── 3. Fallback: role row MISSING jobs_close (field) ───────────");
  // field's stored perms have no jobs_close key at all — the answer must come from
  // default_job_perms('field') = false. A wrong default here silently grants close.
  const field = users.field.client;
  await expectDeny ("field CANNOT close (key absent → default false)", field, "completed", "closed");
  await expectAllow("field CAN pull", field, "approved", "active");
  await expectInsert("field CANNOT build", field, false);

  console.log("\n── 4. Fallback: NO job perms stored at all (employee) ─────────");
  const emp = users.employee.client;
  await expectDeny ("employee CANNOT close", emp, "completed", "closed");
  await expectDeny ("employee CANNOT pull", emp, "approved", "active");
  await expectDeny ("employee CANNOT complete", emp, "active", "completed");
  await expectInsert("employee CANNOT build", emp, false);

  console.log("\n── 5. Per-user override beats the role ────────────────────────");
  // This is the "Jerry specifically" lever. user_id is TEXT here, not uuid — the cast
  // that migration 13 fixed. If it regresses, has_perm throws 42883 and EVERY check
  // below fails, including the allows.
  await admin.from("user_permission_overrides").upsert({
    company_id: testCompanyId, user_id: users.employee.uid, overrides: { jobs_close: true },
  }, { onConflict: "company_id,user_id" });
  await expectAllow("override GRANTS close to an employee", emp, "completed", "closed");

  await admin.from("user_permission_overrides").upsert({
    company_id: testCompanyId, user_id: users.coordinator.uid, overrides: { jobs_pull: false },
  }, { onConflict: "company_id,user_id" });
  await expectDeny("override REVOKES pull from the coordinator", coord, "approved", "active");
  await admin.from("user_permission_overrides").delete().eq("company_id", testCompanyId).eq("user_id", users.coordinator.uid);

  console.log("\n── 6. Admin bypass + trusted backend ──────────────────────────");
  await expectAllow("company admin CAN close", users.admin.client, "completed", "closed");

  // service_role must pass straight through — the Netlify functions depend on it.
  const svcJob = await seedJob("completed");
  const { error: svcErr } = await admin.from("jobs").update({ status: "closed" }).eq("id", svcJob);
  check("service_role bypasses enforcement", !svcErr && (await statusOf(svcJob)) === "closed",
        svcErr ? `BLOCKED: ${svcErr.message}` : "");

  console.log("\n── 7. Non-status edits stay ungated ───────────────────────────");
  // Only status transitions are gated; a coordinator renaming a job must still work.
  const editJob = await seedJob("active");
  const { error: edErr } = await coord.from("jobs").update({ title: "Renamed by coordinator" }).eq("id", editJob).select("id");
  check("coordinator CAN edit a job's title (no status change)", !edErr, edErr ? `BLOCKED: ${edErr.message}` : "");
} catch (err) {
  console.error(`\n💥 Test harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  console.log("\n── Cleanup ────────────────────────────────────────────────────");
  try {
    if (testCompanyId) await admin.from("jobs").delete().eq("company_id", testCompanyId);
    for (const u of Object.values(users)) { try { await admin.auth.admin.deleteUser(u.uid); } catch {} }
    if (testCompanyId) await admin.from("companies").delete().eq("id", testCompanyId);
    console.log("  Test company, users and jobs removed.");
  } catch (e) { console.log(`  ⚠️  cleanup issue: ${e.message}`); }
}

console.log("\n═══════════════════════════════════════════════════════════════");
if (failures.length === 0) {
  console.log(`✅ PERMISSIONS ARE ENFORCED — ${passed} checks passed.`);
  process.exit(0);
} else {
  console.log(`❌ ${failures.length} FAILURE(S) — ${passed} passed.\n`);
  failures.forEach((f) => console.log(`   • ${f}`));
  process.exit(1);
}
