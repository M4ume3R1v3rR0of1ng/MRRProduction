// netlify/functions/_shared/acculynxCompany.js
//
// One company's AccuLynx settings and everything the report needs, as read by the
// SERVICE-ROLE client. Moved here from acculynx-retry-sync.js when
// acculynx-correction-notice.js became a second caller: the revised report it files
// must read exactly like the original, so both load their inputs the same way.
//
// Every query is filtered by company_id by hand. RLS does not apply to this client.

// The non-secret half lives in `settings` (every member can read it); the key itself
// is in company_secrets, which no browser role is granted. Returns { skip } when this
// company has nothing for us to do.
//
// `requireAutoSync` is the cron's rule: a company that switched Auto Sync off did so
// to stop unattended sends. The correction notice is a person's own action, so it
// only needs the integration enabled.
export async function loadAccuLynxConfig(admin, company, { requireAutoSync = false } = {}) {
  const [{ data: settingsRow }, { data: secrets }] = await Promise.all([
    admin
      .from("settings")
      .select("value")
      .eq("company_id", company.id)
      .eq("key", "acculynx_config")
      .maybeSingle(),
    admin.from("company_secrets").select("integrations").eq("company_id", company.id).maybeSingle(),
  ]);

  let config = {};
  if (settingsRow?.value) {
    try {
      config = JSON.parse(settingsRow.value);
    } catch {
      // A corrupt settings blob must not stop the other tenants' retries.
      return { skip: "settings row is not valid JSON" };
    }
  }

  if (!config.enabled) return { skip: "integration disabled" };
  if (requireAutoSync && !config.autoSync) return { skip: "auto sync off" };

  const apiKey =
    secrets?.integrations?.acculynxApiKey ||
    (company.slug === "maumee-river-roofing" ? process.env.ACCULYNX_API_KEY : null);
  if (!apiKey) return { skip: "no API key configured" };

  return { apiKey, config };
}

// Everything buildJobReportModel needs: the roster (for the supervisor's name),
// inventory (for the price of a line with no pull-time snapshot) and the company row
// (name, tax rate, logo). Same shape the browser assembles, so the report reads
// identically.
export async function loadReportContext(admin, companyId) {
  const [{ data: mems }, { data: inv }, { data: company }] = await Promise.all([
    admin.from("memberships").select("user_id, role, active").eq("company_id", companyId),
    admin.from("inventory").select("*").eq("company_id", companyId),
    admin.from("companies").select("id, name, slug, branding").eq("id", companyId).single(),
  ]);

  const memberIds = (mems || []).map((m) => m.user_id);
  const { data: profs } = memberIds.length
    ? await admin.from("profiles").select("*").in("id", memberIds)
    : { data: [] };
  const roleByUser = Object.fromEntries((mems || []).map((m) => [m.user_id, m]));

  return {
    users: (profs || []).map((p) => {
      const m = roleByUser[p.id];
      return m ? { ...p, role: m.role, active: m.active } : p;
    }),
    inv: inv || [],
    company: company || null,
  };
}
