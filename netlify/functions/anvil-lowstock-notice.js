// netlify/functions/anvil-lowstock-notice.js
//
// The FREE low-stock email: every Monday, tell the people who manage stock which items are
// at or below their line. Nothing else. No proposals, no queue, no suggested quantity; that
// is Anvil Pro (anvil-reorder-scan.js), and a company that has Pro with auto-reorder on is
// skipped here because the Pro email already covers the same items.
//
// Silent when nothing is low, and weekly rather than daily because this has no memory of
// what it already said (see the note in _shared/reorder.js). That is also why it never
// writes anything: no table, no flags, nothing to clean up.
//
// WHO IS TOLD: active members whose effective permissions include inv_edit, the same right
// the Pro email uses. Like the other crons this runs as the service role, so every
// .eq("company_id", ...) below is load-bearing.
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.

import {
  adminClient,
  platformFromAddress,
  appOrigin,
  USABLE_SUBSCRIPTION_STATES,
} from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { loadCompanyRoster } from "./_shared/anvilPerms.js";
import { isEffectivePro } from "./_shared/anvilPro.js";
import {
  findLowStockItems,
  buildLowStockEmail,
  wantsFreeLowStockNotice,
} from "./_shared/reorder.js";

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

  const [{ data: companies, error: companyError }, { data: enabledRows }] = await Promise.all([
    admin
      .from("companies")
      .select("id, name, subscription_status, is_platform_company, anvil_pro, anvil_pro_comped"),
    admin.from("anvil_reorder_settings").select("company_id").eq("enabled", true),
  ]);
  if (companyError) {
    console.error("anvil-lowstock-notice: company lookup failed:", companyError.message);
    return { statusCode: 500, body: JSON.stringify({ error: companyError.message }) };
  }
  const reorderOn = new Set((enabledRows || []).map((r) => r.company_id));

  let emailed = 0;
  for (const company of companies || []) {
    const proReorderRuns = isEffectivePro(company) && reorderOn.has(company.id);
    if (!wantsFreeLowStockNotice(company, proReorderRuns, USABLE_SUBSCRIPTION_STATES)) continue;

    try {
      const { data: inventory, error: invError } = await admin
        .from("inventory")
        .select("id, name, unit, alrt, batches")
        .eq("company_id", company.id);
      if (invError) throw new Error(invError.message);

      const items = findLowStockItems(inventory || []);
      if (items.length === 0) continue;

      const { roster } = await loadCompanyRoster(admin, company.id);
      const recipients = [
        ...new Set(
          roster
            .filter((m) => m.perms.inv_edit && m.email)
            .map((m) => /** @type {string} */ (m.email).trim().toLowerCase()),
        ),
      ];
      if (recipients.length === 0) continue;

      const { subject, html } = buildLowStockEmail({
        companyName: company.name,
        items,
        appUrl: appOrigin(""),
      });
      await sendEmail({ companyName: company.name, to: recipients, subject, html });
      emailed += 1;
    } catch (err) {
      // One company's failure must not stop the rest of the run.
      console.error(`anvil-lowstock-notice: ${company.name} failed:`, err);
    }
  }

  console.log(`anvil-lowstock-notice: emailed ${emailed} companies`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, emailed }) };
};

export const handler = withSentry("anvil-lowstock-notice", rawHandler);

// Mondays 13:00 UTC, the same early-morning-in-the-Midwest slot as the Pro scan.
export const config = {
  schedule: "0 13 * * 1",
};
