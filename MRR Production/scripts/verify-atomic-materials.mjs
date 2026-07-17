// scripts/verify-atomic-materials.mjs
//
// Proves commit_job_materials() (supabase/14) is genuinely all-or-nothing.
//
// The bug it exists to prevent: pulling used to write the job first and each inventory
// item after, as separate statements. A failure partway left the job marked `active`
// with only some stock deducted — and unrecoverable, because the Pull button only
// renders on `approved` jobs. The ledger and the job costing silently disagreed from
// then on. Atomicity is a claim about transaction semantics, and claims about money
// deserve evidence, so this forces a mid-loop failure and checks that EVERY earlier
// write in the same call was undone.
//
// Also pins the security property that makes the function safe: it is SECURITY INVOKER,
// so RLS and the enforce_job_perms trigger still apply. As DEFINER it would run as the
// owner and wave every permission check through — silently.
//
// Run:
//   SUPABASE_SERVICE_ROLE_KEY=$(npx netlify-cli env:get SUPABASE_SERVICE_ROLE_KEY) \
//     node scripts/verify-atomic-materials.mjs
//
// Exit 0 = the transaction holds.

import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const URL = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").match(/eyJ[A-Za-z0-9._-]+/)?.[0];
if (!URL || !ANON || !SERVICE) { console.error("Missing Supabase env"); process.exit(2); }
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const SLUG = "zz-atomic-test";
let coId = null;
const users = {};
let passed = 0;
const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`  ✅ ${n}`); }
  else { failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); }
};

const PERMS = {
  coordinator: { jobs_pull: true, jobs_complete: true, jobs_close: false, jobs_build: true, jobs_approve: true },
  bookkeeper: { jobs_pull: false, jobs_complete: false, jobs_close: true },
};

// Every negative test here asserts "the call failed and nothing was written". A MISSING
// function satisfies that trivially — so without this guard the whole suite passes
// vacuously against a database where 14 was never applied. That is not hypothetical:
// it is exactly what happened on the first run. A rejection only counts if the function
// was there to do the rejecting.
const MISSING_FN = (e) =>
  !!e && (e.code === "PGRST202" || /Could not find the function/i.test(e.message || ""));
const rejected = (e) => !!e && !MISSING_FN(e);

const BATCHES = [
  { id: "b1", rcvd: "2026-07-01", qty: 10, price: 10, rem: 10, by: "system" },
  { id: "b2", rcvd: "2026-07-10", qty: 10, price: 15, rem: 10, by: "system" },
];
// What doFifo returns for a 15-unit pull: the $10 batch emptied, 5 left of the $15.
const PULLED = [
  { id: "b1", rcvd: "2026-07-01", qty: 10, price: 10, rem: 0, by: "system" },
  { id: "b2", rcvd: "2026-07-10", qty: 10, price: 15, rem: 5, by: "system" },
];

async function makeUser(role) {
  const email = `atomic-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const password = `Test-${Math.random().toString(36).slice(2)}-9xQ!`;
  const { data: au, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  await admin.from("memberships").insert({ user_id: au.user.id, company_id: coId, role, active: true });
  await admin.from("profiles").update({ active_company_id: coId, active: true }).eq("id", au.user.id);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;
  return { uid: au.user.id, client };
}

const resetFixture = async () => {
  await admin.from("jobs").update({ status: "approved" }).eq("company_id", coId).eq("id", "atomic_job");
  await admin.from("inventory").update({ batches: BATCHES }).eq("company_id", coId).eq("id", "atomic_a");
  await admin.from("inventory").update({ batches: BATCHES }).eq("company_id", coId).eq("id", "atomic_b");
};
const statusOf = async () => (await admin.from("jobs").select("status").eq("company_id", coId).eq("id", "atomic_job").single()).data?.status;
const remOf = async (id) => {
  const { data } = await admin.from("inventory").select("batches").eq("company_id", coId).eq("id", id).single();
  return (data?.batches || []).reduce((s, b) => s + (parseFloat(b.rem) || 0), 0);
};

try {
  console.log("\n── Setup ──────────────────────────────────────────────────────");
  const { data: stale } = await admin.from("companies").select("id").eq("slug", SLUG).maybeSingle();
  if (stale) {
    await admin.from("jobs").delete().eq("company_id", stale.id);
    await admin.from("inventory").delete().eq("company_id", stale.id);
    await admin.from("companies").delete().eq("id", stale.id);
  }
  const { data: co, error: coErr } = await admin.from("companies")
    .insert({ name: "ZZ Atomic Test", slug: SLUG, subscription_status: "active" }).select("id").single();
  if (coErr) throw coErr;
  coId = co.id;
  for (const [role, permissions] of Object.entries(PERMS)) {
    await admin.from("role_permissions").upsert({ company_id: coId, role, permissions }, { onConflict: "company_id,role" });
  }
  users.coordinator = await makeUser("coordinator");
  users.bookkeeper = await makeUser("bookkeeper");

  await admin.from("inventory").insert([
    { id: "atomic_a", company_id: coId, name: "Item A", unit: "each", alrt: 1, batches: BATCHES },
    { id: "atomic_b", company_id: coId, name: "Item B", unit: "each", alrt: 1, batches: BATCHES },
  ]);
  const items = [{ iid: "atomic_a", iname: "Item A", planned: 15, pulled: 0, priceAtPull: 0, pullCost: 0 }];
  await admin.from("jobs").insert({ id: "atomic_job", company_id: coId, status: "approved", title: "Atomic Test", items, materials: items });
  console.log(`  Test tenant + coordinator/bookkeeper ready.`);

  const pulledItems = [{ iid: "atomic_a", iname: "Item A", planned: 15, pulled: 15, priceAtPull: 175 / 15, pullCost: 175 }];
  const jerry = users.coordinator.client;

  // Preflight: prove the function EXISTS before trusting any rejection below.
  const { error: preErr } = await jerry.rpc("commit_job_materials", {
    p_job_id: "atomic_job", p_status: "approved", p_items: items, p_batches: {},
  });
  if (MISSING_FN(preErr)) {
    throw new Error(
      "commit_job_materials() is not exposed. Run supabase/14_atomic_material_moves.sql, " +
      "then reload PostgREST's schema cache (Supabase → API → Reload, or NOTIFY pgrst, 'reload schema'). " +
      "Aborting rather than reporting green: every rejection check below would pass for the wrong reason.",
    );
  }

  console.log("\n── 1. Happy path: job + stock move together ───────────────────");
  await resetFixture();
  const { error: okErr } = await jerry.rpc("commit_job_materials", {
    p_job_id: "atomic_job", p_status: "active", p_items: pulledItems,
    p_batches: { atomic_a: PULLED },
  });
  check("pull succeeds for a coordinator with jobs_pull", !okErr, okErr?.message);
  check("job moved to 'active'", (await statusOf()) === "active");
  check("stock deducted (20 → 5)", (await remOf("atomic_a")) === 5);

  console.log("\n── 2. THE BUG: a failure mid-way must undo EVERYTHING ─────────");
  await resetFixture();
  // atomic_a is real and would succeed; ghost_item does not exist and raises P0002
  // partway through the loop — exactly the shape of the old partial write.
  const { error: rbErr } = await jerry.rpc("commit_job_materials", {
    p_job_id: "atomic_job", p_status: "active", p_items: pulledItems,
    p_batches: { atomic_a: PULLED, ghost_item: PULLED },
  });
  check("a bad item raises instead of silently skipping", rejected(rbErr), rbErr ? "" : "NO ERROR RAISED");
  check("job status ROLLED BACK to 'approved'", (await statusOf()) === "approved",
        `status is '${await statusOf()}' — job would be STRANDED`);
  check("the good item's stock ROLLED BACK to 20", (await remOf("atomic_a")) === 20,
        `rem is ${await remOf("atomic_a")} — stock deducted for a failed pull`);

  console.log("\n── 3. Permissions still enforced through the RPC ──────────────");
  await resetFixture();
  // The bookkeeper has jobs_pull: false. If the function were SECURITY DEFINER, the
  // trigger would see the owner rather than 'authenticated' and let this through.
  const { error: permErr } = await users.bookkeeper.client.rpc("commit_job_materials", {
    p_job_id: "atomic_job", p_status: "active", p_items: pulledItems,
    p_batches: { atomic_a: PULLED },
  });
  check("bookkeeper (no jobs_pull) is REJECTED by the trigger", rejected(permErr), permErr ? "" : "PULL ALLOWED — DEFINER LEAK");
  check("nothing was written on the rejected pull", (await statusOf()) === "approved" && (await remOf("atomic_a")) === 20);

  console.log("\n── 4. Tenant boundary holds inside the function ───────────────");
  const { data: mrr } = await admin.from("companies").select("id").eq("slug", "maumee-river-roofing").single();
  const { data: victim } = await admin.from("jobs").select("id,status").eq("company_id", mrr.id).limit(1).single();
  const { error: xErr } = await jerry.rpc("commit_job_materials", {
    p_job_id: victim.id, p_status: "closed", p_items: [], p_batches: {},
  });
  check("cannot touch another company's job", rejected(xErr), xErr ? "" : "CROSS-TENANT WRITE SUCCEEDED");
  const { data: after } = await admin.from("jobs").select("status").eq("company_id", mrr.id).eq("id", victim.id).single();
  check("the other company's job is untouched", after.status === victim.status,
        `status changed ${victim.status} → ${after.status}`);

  console.log("\n── 5. Return path (status + completed timestamp) ──────────────");
  await resetFixture();
  await admin.from("jobs").update({ status: "active" }).eq("company_id", coId).eq("id", "atomic_job");
  const stamp = new Date().toISOString();
  const { error: retErr } = await jerry.rpc("commit_job_materials", {
    p_job_id: "atomic_job", p_status: "completed", p_items: pulledItems,
    p_batches: { atomic_a: PULLED }, p_completed: stamp,
  });
  check("return/complete succeeds", !retErr, retErr?.message);
  const { data: done } = await admin.from("jobs").select("status,completed,completedAt").eq("company_id", coId).eq("id", "atomic_job").single();
  check("job completed and timestamped", done?.status === "completed" && !!done?.completedAt,
        `status=${done?.status} completedAt=${done?.completedAt}`);
} catch (err) {
  console.error(`\n💥 Harness error: ${err.message}`);
  failures.push(`harness: ${err.message}`);
} finally {
  console.log("\n── Cleanup ────────────────────────────────────────────────────");
  try {
    if (coId) {
      await admin.from("jobs").delete().eq("company_id", coId);
      await admin.from("inventory").delete().eq("company_id", coId);
    }
    for (const u of Object.values(users)) { try { await admin.auth.admin.deleteUser(u.uid); } catch {} }
    if (coId) await admin.from("companies").delete().eq("id", coId);
    console.log("  Removed.");
  } catch (e) { console.log(`  ⚠️ ${e.message}`); }
}

console.log("\n═══════════════════════════════════════════════════════════════");
if (failures.length === 0) {
  console.log(`✅ MATERIAL MOVES ARE ATOMIC — ${passed} checks passed.`);
  process.exit(0);
}
console.log(`❌ ${failures.length} FAILURE(S) — ${passed} passed.\n`);
failures.forEach((f) => console.log(`   • ${f}`));
process.exit(1);
