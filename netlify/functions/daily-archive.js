// netlify/functions/daily-archive.js
//
// Nightly maintenance: sweep audit_logs rows older than 30 days, and
// chat_messages rows older than CHAT_RETENTION_DAYS.
//
// This is the one function in this directory with NO caller to resolve. The cron
// invokes it, not a person, so there is no access token, no company, and nothing
// for resolveCaller() to check — which is exactly why archive_old_audit_logs() is
// company-agnostic and sweeps every tenant in one pass. It still uses the shared
// adminClient() so the service-role credentials are built in one place rather
// than assembled from process.env here.
//
// Both sweeps DELETE. There is no archive table behind either; rows past
// their window are gone permanently. See supabase/03_functions.sql for what
// that costs on the audit side; chat_messages (supabase/41) has no such
// history requirement, so a plain client-side delete is enough — unlike audit
// logs, it doesn't need a SQL function to count rows atomically.
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both via adminClient).

import { adminClient } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";

// Generous relative to audit_logs' 30 days — a driver's conversation with the
// assistant has ongoing value ("what did it say about that truck last month")
// that an audit trail correction doesn't, so this trades some storage for a
// longer memory rather than matching the shorter window.
const CHAT_RETENTION_DAYS = 90;

const rawHandler = async () => {
  const admin = adminClient();

  // Returns the number of rows it deleted. Worth logging: a count that suddenly
  // jumps, or sits at 0 for weeks, is the first sign the audit trail stopped
  // being written at all.
  const { data: deletedLogs, error: logsError } = await admin.rpc("archive_old_audit_logs");

  if (logsError) {
    console.error("daily-archive: archive_old_audit_logs failed:", logsError.message);
    return { statusCode: 500, body: JSON.stringify({ error: logsError.message }) };
  }

  const chatCutoff = new Date(Date.now() - CHAT_RETENTION_DAYS * 86400000).toISOString();
  const { error: chatError, count: deletedChatCount } = await admin
    .from("chat_messages")
    .delete({ count: "exact" })
    .lt("created_at", chatCutoff);

  if (chatError) {
    // Not fatal to the run — the audit sweep above already succeeded, and a
    // failed chat sweep just means retrying tomorrow, not data at risk.
    console.error("daily-archive: chat_messages sweep failed:", chatError.message);
  }

  console.log(
    `daily-archive: removed ${deletedLogs ?? 0} audit log rows older than 30 days, ` +
      `${deletedChatCount ?? 0} chat messages older than ${CHAT_RETENTION_DAYS} days.`,
  );
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      deletedAuditLogs: deletedLogs ?? 0,
      deletedChatMessages: deletedChatCount ?? 0,
    }),
  };
};

export const handler = withSentry("daily-archive", rawHandler);

// Netlify reads this to register the cron. Nightly at midnight UTC.
export const config = {
  schedule: "0 0 * * *",
};
