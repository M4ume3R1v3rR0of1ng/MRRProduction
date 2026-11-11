// netlify/functions/send-end-of-day-recap.js
//
// Every weekday at 5pm Eastern, A.N.V.I.L. writes each person one message about how their day
// went: what got done, what did not, and what is on for the next working day. The evening
// partner of send-daily-briefing.js, and it lands in the same place: the person's own A.N.V.I.L.
// conversation, as a proactive message, so the launcher's dot lights up until they open it.
//
// ⚠️ SILENCE IS A FEATURE. buildRecap returns null when there is nothing to report and NO ROW
//    is written. See anvilRecap.js.
//
// WHY TWO CRON TIMES. A cron is in UTC, and 5pm Eastern is 21:00 UTC in summer and 22:00 UTC in
// winter. This is scheduled at both, and the handler runs only when the Eastern hour is 17, so
// exactly one of the two firings does the work all year (see _shared/localTime.js).
//
// NOT SENT TWICE. If a run is repeated (a retry, a manual invoke), anyone who already has an
// evening recap from the last few hours is skipped, rather than relying on the schedule alone.
//
// Same shape as send-daily-briefing.js otherwise: a cron, so no access token or company to
// resolve; adminClient() bypasses RLS, which makes every .eq("company_id", ...) load-bearing.
//
// Env: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, both via adminClient. Sends no mail.

import { adminClient, USABLE_SUBSCRIPTION_STATES } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { loadCompanyRoster } from "./_shared/anvilPerms.js";
import { loadBriefingData } from "./_shared/anvilBriefing.js";
import { buildRecap } from "./_shared/anvilRecap.js";
import { localParts, nextWorkingDay } from "./_shared/localTime.js";

const RECAP_HOUR = 17;
const ALREADY_SENT_WINDOW_MS = 3 * 60 * 60 * 1000;

const rawHandler = async () => {
  const now = new Date();
  const local = localParts(now);

  if (local.hour !== RECAP_HOUR) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: "not 5pm Eastern", hour: local.hour }),
    };
  }
  if (local.weekday === 0 || local.weekday === 6) {
    return { statusCode: 200, body: JSON.stringify({ skipped: "weekend", day: local.day }) };
  }

  const today = local.day;
  const tomorrow = nextWorkingDay(today);
  const admin = adminClient();

  const { data: companies, error: companyError } = await admin
    .from("companies")
    .select("id, name, subscription_status");
  if (companyError) {
    console.error("send-end-of-day-recap: company lookup failed:", companyError.message);
    return { statusCode: 500, body: JSON.stringify({ error: companyError.message }) };
  }

  let sent = 0;
  let quiet = 0;
  const companiesProcessed = [];

  for (const company of companies || []) {
    if (!USABLE_SUBSCRIPTION_STATES.includes(company.subscription_status)) continue;

    const [data, { roster, error: rosterError }, { data: recent }] = await Promise.all([
      loadBriefingData(admin, company.id),
      loadCompanyRoster(admin, company.id),
      admin
        .from("chat_messages")
        .select("user_id")
        .eq("company_id", company.id)
        .eq("role", "assistant")
        .eq("proactive", true)
        .like("text", "Evening%")
        .gte("created_at", new Date(now.getTime() - ALREADY_SENT_WINDOW_MS).toISOString()),
    ]);
    if (data.error) {
      console.error(`send-end-of-day-recap: data load failed for ${company.name}:`, data.error);
      continue;
    }
    if (rosterError) {
      console.error(`send-end-of-day-recap: roster failed for ${company.name}:`, rosterError);
      continue;
    }
    const alreadyHave = new Set((recent || []).map((r) => String(r.user_id)));

    const rows = [];
    for (const member of roster) {
      if (alreadyHave.has(String(member.userId))) continue;
      const recap = buildRecap({ member, perms: member.perms, ...data, today, tomorrow });
      if (!recap) {
        quiet += 1;
        continue;
      }
      rows.push({
        company_id: company.id,
        user_id: member.userId,
        role: "assistant",
        text: recap.text,
        // Raised on its own, which is what lights the unread dot on the launcher.
        // origin_session_id stays null so no open tab mistakes it for its own echo
        // (see supabase/41's "WHY origin_session_id").
        proactive: true,
      });
    }

    if (rows.length === 0) {
      companiesProcessed.push({ company: company.name, sent: 0 });
      continue;
    }

    // One insert per company: either its recaps land or none do.
    const { error: insertError } = await admin.from("chat_messages").insert(rows);
    if (insertError) {
      console.error(
        `send-end-of-day-recap: insert failed for ${company.name}:`,
        insertError.message,
      );
      continue;
    }
    sent += rows.length;
    companiesProcessed.push({ company: company.name, sent: rows.length });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ day: today, sent, quiet, companies: companiesProcessed }),
  };
};

export const handler = withSentry("send-end-of-day-recap", rawHandler);

// 21:00 and 22:00 UTC, weekdays. One of them is 5pm Eastern in any season; the other returns
// early at the hour check above.
export const config = {
  schedule: "0 21,22 * * 1-5",
};
