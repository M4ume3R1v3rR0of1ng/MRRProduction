// netlify/functions/anvil-reorder-scan.js
//
// Every weekday morning: for each company that has Anvil Pro AND has switched
// auto-reorder on, find the items at or below their low-stock line, draft a reorder
// proposal for each, and email the people who approve orders.
//
// ⚠️ THIS NEVER ORDERS ANYTHING. It writes proposals to a queue and sends one email. A
// proposal becomes 'approved' only when a person presses Approve (anvil-reorder.js), and
// even then no purchase order leaves the building yet — how an approved reorder reaches a
// supplier is an open decision. The whole feature is deliberately two steps short of
// spending money.
//
// WHY EMAIL IS DRIVEN BY `notified_at IS NULL` AND NOT BY "WAS CREATED THIS RUN"
//
// A proposal that is already pending is skipped by the scan (one per item, enforced by a
// unique index — see supabase/65), so a run that created it but failed to send the email
// would never mention it again. Selecting on notified_at means a failed send is retried by
// tomorrow's run, and a successful one is never repeated. Silence is the default: an
// item that stays low for a week produces one email, not five.
//
// WHO IS TOLD
//
// Active members whose effective permissions include inv_edit (the same right that adds
// an item or edits its threshold) plus any addresses in the company's notify_emails that
// still belong to an active member. An address that is not a member is dropped, for the
// same reason send-email.js fences its recipients: this runs from our verified domain.
//
// Like send-daily-briefing.js the caller is a cron, not a person, so adminClient()
// bypasses RLS and every .eq("company_id", ...) below is load-bearing.
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.

import { adminClient, platformFromAddress, appOrigin } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { loadCompanyRoster } from "./_shared/anvilPerms.js";
import { isEffectivePro } from "./_shared/anvilPro.js";
import { findReorderCandidates, buildReorderEmail } from "./_shared/reorder.js";

const MAIL_FROM = platformFromAddress("alerts");

async function sendEmail({ companyName, to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: `${companyName} <${MAIL_FROM}>`, to, subject, html }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || `Resend HTTP ${res.status}`);
  }
}

const rawHandler = async () => {
  const admin = adminClient();

  const { data: settingsRows, error: settingsError } = await admin
    .from("anvil_reorder_settings")
    .select("company_id, notify_emails")
    .eq("enabled", true);
  if (settingsError) {
    console.error("anvil-reorder-scan: settings lookup failed:", settingsError.message);
    return { statusCode: 500, body: JSON.stringify({ error: settingsError.message }) };
  }

  let created = 0;
  let emailed = 0;
  const skipped = [];

  for (const settings of settingsRows || []) {
    const companyId = settings.company_id;

    const { data: company } = await admin
      .from("companies")
      .select("id, name, anvil_pro, anvil_pro_comped, subscription_status")
      .eq("id", companyId)
      .maybeSingle();
    // Not Pro (or lapsed): the setting stays on file so re-subscribing resumes it, but
    // nothing runs. Checked here and not trusted from the settings row.
    if (!company || !isEffectivePro(company)) {
      skipped.push(companyId);
      continue;
    }

    try {
      const [{ data: inventory, error: invError }, { data: pending }] = await Promise.all([
        admin
          .from("inventory")
          .select("id, name, unit, alrt, batches, reorder_qty, supplier_name, supplier_email")
          .eq("company_id", companyId),
        admin
          .from("anvil_reorder_proposals")
          .select("inventory_id")
          .eq("company_id", companyId)
          .eq("status", "pending"),
      ]);
      if (invError) throw new Error(invError.message);

      const candidates = findReorderCandidates(inventory || [], pending || []);
      if (candidates.length > 0) {
        const { error: insertError } = await admin
          .from("anvil_reorder_proposals")
          .insert(candidates.map((c) => ({ ...c, company_id: companyId })));
        // 23505 = the unique index caught an overlapping run. Not a failure.
        if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
        else if (!insertError) created += candidates.length;
      }

      const { data: unsent } = await admin
        .from("anvil_reorder_proposals")
        .select("id, inventory_id, item_name, unit, on_hand, alert_level, suggested_qty")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .is("notified_at", null);
      if (!unsent || unsent.length === 0) continue;

      const { roster } = await loadCompanyRoster(admin, companyId);
      const memberEmails = new Set(
        roster.map((m) => (m.email || "").trim().toLowerCase()).filter(Boolean),
      );
      const recipients = new Set(
        roster
          .filter((m) => m.perms.inv_edit && m.email)
          .map((m) => /** @type {string} */ (m.email).trim().toLowerCase()),
      );
      for (const extra of settings.notify_emails || []) {
        const e = String(extra || "")
          .trim()
          .toLowerCase();
        if (memberEmails.has(e)) recipients.add(e);
      }
      if (recipients.size === 0) {
        console.warn(`anvil-reorder-scan: ${company.name} has proposals but nobody to tell.`);
        continue;
      }

      const { subject, html } = buildReorderEmail({
        companyName: company.name,
        proposals: unsent.map((p) => ({
          ...p,
          on_hand: Number(p.on_hand),
          alert_level: Number(p.alert_level),
          suggested_qty: p.suggested_qty === null ? null : Number(p.suggested_qty),
          supplier_name: null,
          supplier_email: null,
        })),
        appUrl: appOrigin(""),
      });
      await sendEmail({ companyName: company.name, to: [...recipients], subject, html });
      emailed += 1;

      // Only after the send succeeded, so a failure leaves them unnotified for tomorrow.
      await admin
        .from("anvil_reorder_proposals")
        .update({ notified_at: new Date().toISOString() })
        .in(
          "id",
          unsent.map((p) => p.id),
        )
        .eq("company_id", companyId);
    } catch (err) {
      // One company's failure must not stop the rest of the run.
      console.error(`anvil-reorder-scan: ${company.name} failed:`, err);
    }
  }

  console.log(
    `anvil-reorder-scan: created ${created}, emailed ${emailed} companies, skipped ${skipped.length} not-Pro`,
  );
  return { statusCode: 200, body: JSON.stringify({ ok: true, created, emailed }) };
};

export const handler = withSentry("anvil-reorder-scan", rawHandler);

// 13:00 UTC on weekdays: early morning in the Midwest, before crews load trucks, and the
// same weekday-only reasoning as the daily briefing — an email about Monday's stock on a
// Saturday reaches nobody who can act on it.
export const config = {
  schedule: "0 13 * * 1-5",
};
