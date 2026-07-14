// scripts/verify-tenant-isolation.mjs
//
// Proves — with a real second company and a real logged-in user — that tenant
// isolation actually holds. Everything in supabase/01-03 is carefully reasoned, but
// reasoning is not evidence, and the failure mode here is SILENT: a missing RLS
// policy doesn't throw, it just quietly hands Company A's data to Company B. You
// would find out from a customer, not from a stack trace.
//
// It creates a throwaway company + user, signs in as them for real (anon key, same
// path the browser takes), and asserts they can see NOTHING of Maumee River's. Then
// it flips the kill switch and asserts the portal goes dark. Then it cleans up.
//
// Run:
//   SUPABASE_SERVICE_ROLE_KEY=$(npx netlify-cli env:get SUPABASE_SERVICE_ROLE_KEY) \
//     node scripts/verify-tenant-isolation.mjs
//
// Exit code 0 = isolation holds. Non-zero = DO NOT SELL THIS TO ANYONE.

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

// Tables that hold tenant data and must never cross a company boundary.
const TENANT_TABLES = [
  "jobs", "inventory", "vehicles", "maintenance_requests", "job_trailers",
  "warehouses", "settings", "role_permissions", "user_permission_overrides",
  "team_chat_messages", "team_chat_reads", "audit_logs", "vehicle_inspections",
];

const TEST_SLUG = "zz-isolation-test";
const TEST_EMAIL = `isolation-test-${Date.now()}@example.invalid`;
const TEST_PASSWORD = `Test-${Math.random().toString(36).slice(2)}-9xQ!`;

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function cleanup(companyId, userId) {
  // The Supabase query builder is a thenable, not a full Promise — no .catch(). Wrap.
  try { if (userId) await admin.auth.admin.deleteUser(userId); } catch {}
  try { if (companyId) await admin.from("companies").delete().eq("id", companyId); } catch {}
  // profiles/memberships/company_secrets cascade from auth.users + companies.
}

// ── main ─────────────────────────────────────────────────────────────────────
let testCompanyId = null;
let testUserId = null;

try {
  console.log("\n── Setup ──────────────────────────────────────────────────────");

  // Leftovers from a previous aborted run.
  const { data: stale } = await admin.from("companies").select("id").eq("slug", TEST_SLUG).maybeSingle();
  if (stale) await admin.from("companies").delete().eq("id", stale.id);

  const { data: mrr } = await admin.from("companies").select("id, name").eq("slug", "maumee-river-roofing").single();
  if (!mrr) throw new Error("maumee-river-roofing company row not found — did 02 run?");
  console.log(`  Real tenant:  ${mrr.name} (${mrr.id})`);

  // How much real data is there to leak? If these are all zero the test proves nothing.
  const realCounts = {};
  for (const t of TENANT_TABLES) {
    const { count } = await admin.from(t).select("*", { count: "exact", head: true }).eq("company_id", mrr.id);
    realCounts[t] = count ?? 0;
  }
  const totalReal = Object.values(realCounts).reduce((a, b) => a + b, 0);
  console.log(`  Rows belonging to ${mrr.name}: ${totalReal} across ${TENANT_TABLES.length} tables`);
  if (totalReal === 0) {
    console.error("\n  ⚠️  There is no real data to leak — this test would pass vacuously. Aborting.");
    process.exit(2);
  }

  const { data: co, error: coErr } = await admin
    .from("companies")
    .insert({ name: "ZZ Isolation Test Co", slug: TEST_SLUG, subscription_status: "active" })
    .select("id").single();
  if (coErr) throw coErr;
  testCompanyId = co.id;
  console.log(`  Test tenant:  ZZ Isolation Test Co (${testCompanyId})`);

  const { data: authUser, error: uErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true,
    user_metadata: { full_name: "Isolation Test" },
  });
  if (uErr) throw uErr;
  testUserId = authUser.user.id;

  // Make them an ADMIN of the test company — deliberately the most privileged role
  // available to a tenant. If even a company admin can't reach across, nobody can.
  await admin.from("memberships").insert({
    user_id: testUserId, company_id: testCompanyId, role: "admin", active: true,
  });
  await admin.from("profiles").update({ active_company_id: testCompanyId, active: true }).eq("id", testUserId);
  console.log(`  Test user:    ${TEST_EMAIL} (role: admin of the test company)`);

  // ── Sign in for real, exactly as the browser would ──────────────────────────
  const user = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: session, error: sErr } = await user.auth.signInWithPassword({
    email: TEST_EMAIL, password: TEST_PASSWORD,
  });
  if (sErr) throw sErr;
  if (!session?.user) throw new Error("sign-in returned no user");

  console.log("\n── 1. Can the other company read Maumee River's data? ─────────");
  for (const t of TENANT_TABLES) {
    const { data, error } = await user.from(t).select("*").eq("company_id", mrr.id);
    const leaked = (data || []).length;
    // An RLS denial usually returns [] rather than an error; either is a pass.
    check(`${t} — sees 0 of ${mrr.name}'s ${realCounts[t]} rows`, leaked === 0,
          leaked > 0 ? `LEAKED ${leaked} ROWS` : (error ? `(blocked: ${error.code})` : ""));
  }

  console.log("\n── 2. Unfiltered SELECT (the query a careless dev writes) ──────");
  for (const t of TENANT_TABLES) {
    const { data } = await user.from(t).select("company_id");
    const foreign = (data || []).filter((r) => r.company_id !== testCompanyId).length;
    check(`${t} — no foreign rows in a bare select *`, foreign === 0,
          foreign > 0 ? `LEAKED ${foreign} ROWS` : "");
  }

  console.log("\n── 3. Can they WRITE into Maumee River's tenant? ───────────────");
  const { error: wErr } = await user.from("jobs").insert({
    id: `evil_${Date.now()}`, company_id: mrr.id, name: "cross-tenant write", status: "pending",
  });
  check("jobs — cross-tenant INSERT is rejected", !!wErr, wErr ? `(blocked: ${wErr.code})` : "WRITE SUCCEEDED");

  const { data: upd } = await user.from("jobs").update({ name: "hijacked" }).eq("company_id", mrr.id).select("id");
  check("jobs — cross-tenant UPDATE affects 0 rows", (upd || []).length === 0,
        (upd || []).length > 0 ? `MODIFIED ${upd.length} ROWS` : "");

  const { data: del } = await user.from("jobs").delete().eq("company_id", mrr.id).select("id");
  check("jobs — cross-tenant DELETE affects 0 rows", (del || []).length === 0,
        (del || []).length > 0 ? `DELETED ${del.length} ROWS` : "");

  console.log("\n── 4. Privilege escalation ────────────────────────────────────");
  await user.from("profiles").update({ is_platform_admin: true }).eq("id", testUserId);
  const { data: esc } = await admin.from("profiles").select("is_platform_admin").eq("id", testUserId).single();
  check("cannot make self platform_admin", esc?.is_platform_admin !== true,
        esc?.is_platform_admin === true ? "ESCALATED TO PLATFORM ADMIN" : "");

  await user.from("profiles").update({ active_company_id: mrr.id }).eq("id", testUserId);
  const { data: hop } = await admin.from("profiles").select("active_company_id").eq("id", testUserId).single();
  check("cannot point self at another company", hop?.active_company_id !== mrr.id,
        hop?.active_company_id === mrr.id ? "HOPPED TENANTS" : "");

  const { error: swErr } = await user.rpc("set_active_company", { target: mrr.id });
  check("set_active_company() rejects a company they're not in", !!swErr,
        swErr ? "" : "SWITCH SUCCEEDED");

  const { data: coRead } = await user.from("companies").select("id, name").eq("id", mrr.id);
  check("cannot read the other company's row", (coRead || []).length === 0,
        (coRead || []).length > 0 ? "READ FOREIGN COMPANY" : "");

  console.log("\n── 5. Secrets: is the AccuLynx key readable by a tenant admin? ──");
  // Secrets live in company_secrets now (no grant to any browser role). Reading it as
  // an authenticated user must fail outright — for their OWN company and any other.
  const { data: ownSec, error: ownErr } = await user.from("company_secrets").select("integrations").eq("company_id", testCompanyId);
  check("company_secrets not readable for own company", !!ownErr || (ownSec || []).length === 0,
        (ownSec || []).length > 0 ? "OWN SECRETS READABLE" : (ownErr ? `(blocked: ${ownErr.code})` : ""));
  const { data: mrrSec, error: mrrErr } = await user.from("company_secrets").select("integrations").eq("company_id", mrr.id);
  check("company_secrets not readable for another company", !!mrrErr || (mrrSec || []).length === 0,
        (mrrSec || []).length > 0 ? "FOREIGN SECRETS READABLE" : (mrrErr ? `(blocked: ${mrrErr.code})` : ""));

  console.log("\n── 6. Storage: cross-tenant file access ───────────────────────");
  const BUCKET = "vehicle-photos";
  const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // minimal JPEG marker bytes
  const ownPath = `${testCompanyId}/verify_${Date.now()}.jpg`;
  const evilPath = `${mrr.id}/verify_${Date.now()}.jpg`;

  const { error: upOwn } = await user.storage.from(BUCKET).upload(ownPath, tinyJpeg, { contentType: "image/jpeg", upsert: true });
  check("can upload into OWN company folder", !upOwn, upOwn?.message || "");

  const { error: upEvil } = await user.storage.from(BUCKET).upload(evilPath, tinyJpeg, { contentType: "image/jpeg", upsert: true });
  check("cannot upload into another company's folder", !!upEvil, upEvil ? "" : "WROTE INTO FOREIGN FOLDER");

  const { data: listEvil } = await user.storage.from(BUCKET).list(mrr.id);
  check("cannot enumerate another company's files", !listEvil || listEvil.length === 0,
        (listEvil || []).length > 0 ? `LISTED ${listEvil.length} FOREIGN FILES` : "");

  // Clean up whatever landed. If the evil write somehow succeeded, admin removes it too.
  try { await admin.storage.from(BUCKET).remove([ownPath]); } catch {}
  if (!upEvil) { try { await admin.storage.from(BUCKET).remove([evilPath]); } catch {} }

  console.log("\n── 7. THE KILL SWITCH ─────────────────────────────────────────");
  // Seed one row FIRST, while still active, so "sees nothing after cancel" is a real
  // before/after and not trivially empty.
  try { await admin.from("warehouses").insert({ id: "wtest", name: "Test WH", company_id: testCompanyId }); } catch {}
  await admin.from("companies").update({ subscription_status: "canceled" }).eq("id", testCompanyId);

  const { data: afterKill } = await user.from("warehouses").select("*");
  check("canceled company sees an EMPTY portal", (afterKill || []).length === 0,
        (afterKill || []).length > 0 ? `STILL SEES ${afterKill.length} ROWS AFTER CANCELLATION` : "");

  await admin.from("companies").update({ subscription_status: "active" }).eq("id", testCompanyId);
  const { data: afterRestore } = await user.from("warehouses").select("*");
  check("reactivating restores access", (afterRestore || []).length > 0,
        (afterRestore || []).length === 0 ? "STILL LOCKED OUT AFTER REACTIVATION" : "");

  await user.auth.signOut();
} catch (err) {
  console.error(`\n💥 Test harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  console.log("\n── Cleanup ────────────────────────────────────────────────────");
  await cleanup(testCompanyId, testUserId);
  console.log("  Test company and user removed.");
}

console.log("\n═══════════════════════════════════════════════════════════════");
if (failures.length === 0) {
  console.log(`✅ ISOLATION HOLDS — ${passed} checks passed.`);
  process.exit(0);
} else {
  console.log(`❌ ${failures.length} FAILURE(S) — ${passed} passed.\n`);
  failures.forEach((f) => console.log(`   • ${f}`));
  console.log("\n   DO NOT PUT A SECOND COMPANY ON THIS.");
  process.exit(1);
}
