// netlify/functions/send-daily-briefing.js
//
// Every weekday morning, A.N.V.I.L. writes each person one message about their own
// day: today's jobs, overdue oil changes, tickets waiting on them, low stock,
// outstanding training, and loose ends — each section gated on the permission
// that gates its page in the app.
//
// WHY A BRIEFING AND NOT MORE ALERTS
//
// send-maintenance-push-notices.js already exists and is the right shape for
// what it does: one urgent thing, escalating daily, on four channels. That
// shape does not generalize. Doing the same for low stock, unpulled jobs and
// lapsed training would mean four more escalation ladders and a person
// receiving six emails before breakfast, which is how people learn to ignore
// all of them.
//
// A briefing inverts it. One message, once, in the one place A.N.V.I.L. already
// talks to them — their own conversation (supabase/41), where it persists and
// is still there after lunch. Nothing escalates, nothing nags, and the things
// in it are things they could have gone and looked at themselves.
//
// ⚠️ SILENCE IS A FEATURE. buildBriefing returns null when it found nothing
//    worth saying and NO ROW IS WRITTEN. A channel that produces a daily
//    "all clear" is a channel people filter, and then the morning that
//    actually matters is filtered too.
//
// WEEKDAYS ONLY. A Saturday briefing about Monday's unpulled jobs reaches
// somebody who is not at work and is stale by the time they are.
//
// Same shape as daily-archive.js and send-maintenance-push-notices.js
// otherwise: the cron invokes this, not a person, so there is no access token
// or company to resolve — adminClient() bypasses RLS entirely, which makes
// every .eq("company_id", ...) below load-bearing, not decorative (see the
// warning at supabase/02_tenancy_tables.sql:405).
//
// Env: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, both via adminClient.
// Nothing else — this writes to the database and sends no mail, which is the
// other reason it is cheap enough to run for every company every morning.

import { adminClient, USABLE_SUBSCRIPTION_STATES } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { loadCompanyRoster } from "./_shared/anvilPerms.js";
import { buildBriefing, loadBriefingData } from "./_shared/anvilBriefing.js";

const rawHandler = async () => {
  const admin = adminClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: "weekend", day: today }),
    };
  }

  // Lapsed tenants are skipped for the same reason resolveCaller 402s them:
  // the product is off, and briefing somebody about an account they cannot
  // open is worse than saying nothing.
  const { data: companies, error: companyError } = await admin
    .from("companies")
    .select("id, name, subscription_status");
  if (companyError) {
    console.error("send-daily-briefing: company lookup failed:", companyError.message);
    return { statusCode: 500, body: JSON.stringify({ error: companyError.message }) };
  }

  let briefed = 0;
  let quiet = 0;
  const companiesProcessed = [];

  for (const company of companies || []) {
    if (!USABLE_SUBSCRIPTION_STATES.includes(company.subscription_status)) continue;

    // Company data ONCE, then a briefing per member off the same rows — see
    // anvilBriefing.js's header. A per-person fetch would issue these selects
    // thirty times for a company of thirty.
    const [data, { roster, error: rosterError }] = await Promise.all([
      loadBriefingData(admin, company.id),
      loadCompanyRoster(admin, company.id),
    ]);
    if (data.error) {
      console.error(`send-daily-briefing: data load failed for ${company.name}:`, data.error);
      continue;
    }
    if (rosterError) {
      console.error(`send-daily-briefing: roster failed for ${company.name}:`, rosterError);
      continue;
    }

    const rows = [];
    for (const member of roster) {
      const briefing = buildBriefing({ member, perms: member.perms, ...data, today });
      if (!briefing) {
        quiet += 1;
        continue;
      }
      rows.push({
        company_id: company.id,
        user_id: member.userId,
        role: "assistant",
        text: briefing.text,
        // Marks it as something A.N.V.I.L. raised on its own, which is what drives
        // the unread badge on the launcher. origin_session_id stays null, so
        // ChatWidget's realtime subscription never mistakes it for its own
        // echo (see supabase/41's "WHY origin_session_id").
        proactive: true,
      });
    }

    if (rows.length === 0) {
      companiesProcessed.push({ company: company.name, briefed: 0 });
      continue;
    }

    // One insert per company rather than per person: thirty round trips a
    // morning per tenant adds up, and a partial failure is no worse here —
    // either the company's briefings land or none of them do, and nobody is
    // left half-informed about their own day.
    const { error: insertError } = await admin.from("chat_messages").insert(rows);
    if (insertError) {
      console.error(`send-daily-briefing: insert failed for ${company.name}:`, insertError.message);
      continue;
    }
    briefed += rows.length;
    companiesProcessed.push({ company: company.name, briefed: rows.length });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      day: today,
      briefed,
      // People who had a genuinely quiet morning. Reported so a run that
      // briefs nobody can be told apart from a run that found nothing.
      quiet,
      companies: companiesProcessed,
    }),
  };
};

export const handler = withSentry("send-daily-briefing", rawHandler);

// 12:00 UTC ≈ 7am Central / 8am Eastern — an hour before the oil escalation
// job (13:00), so the briefing is what somebody reads first and the urgent
// notice lands on top of it rather than underneath. One fixed run for every
// company regardless of their local timezone, the same limitation
// daily-archive.js and send-maintenance-push-notices.js already accept.
export const config = {
  schedule: "0 12 * * *",
};
