// e2e/global-teardown.js
//
// Mirrors the cleanup() half of scripts/verify-tenant-isolation.mjs: delete
// the two auth users, then the company (memberships, profile rows, and the
// inventory row all cascade from either the user or the company per
// supabase/02_tenancy_tables.sql). Runs even if the test itself failed, so a
// broken run doesn't leave a permanent "ZZ E2E Test Co" tenant behind.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { loadSupabaseEnv } from "./env.js";
import { STATE_FILE } from "./global-setup.js";

export default async function globalTeardown() {
  if (!fs.existsSync(STATE_FILE)) return; // global-setup never got far enough to write it

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const { url, serviceKey } = loadSupabaseEnv();
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  for (const userId of [state.adminUserId, state.supervisorUserId]) {
    try {
      if (userId) await admin.auth.admin.deleteUser(userId);
    } catch {}
  }
  try {
    if (state.companyId) await admin.from("companies").delete().eq("id", state.companyId);
  } catch {}

  fs.rmSync(STATE_FILE, { force: true });
}
