// netlify/functions/daily-archive.js
//
// Nightly maintenance: sweep audit_logs rows older than 30 days.
//
// This is the one function in this directory with NO caller to resolve. The cron
// invokes it, not a person, so there is no access token, no company, and nothing
// for resolveCaller() to check — which is exactly why archive_old_audit_logs() is
// company-agnostic and sweeps every tenant in one pass. It still uses the shared
// adminClient() so the service-role credentials are built in one place rather
// than assembled from process.env here.
//
// ⚠️ The RPC DELETES. There is no archive table behind it; rows older than 30 days
// are gone permanently. See supabase/03_functions.sql for what that costs you.
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both via adminClient).

import { adminClient } from "./_shared/tenant.js";

export const handler = async () => {
  const admin = adminClient();

  // Returns the number of rows it deleted. Worth logging: a count that suddenly
  // jumps, or sits at 0 for weeks, is the first sign the audit trail stopped
  // being written at all.
  const { data: deleted, error } = await admin.rpc("archive_old_audit_logs");

  if (error) {
    console.error("daily-archive: archive_old_audit_logs failed:", error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  console.log(`daily-archive: removed ${deleted ?? 0} audit log rows older than 30 days.`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, deleted: deleted ?? 0 }) };
};

// Netlify reads this to register the cron. Nightly at midnight UTC.
export const config = {
  schedule: "0 0 * * *",
};
