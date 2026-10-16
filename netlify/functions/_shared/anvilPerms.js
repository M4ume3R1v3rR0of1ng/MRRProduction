// netlify/functions/_shared/anvilPerms.js
//
// The one server-side copy of "what is this user actually allowed to do".
//
// Mirrors src/shared/database/permissions.js getEffectivePerms() — keep in sync.
// Permission config is per-company: two companies can define 'manager' quite
// differently, so both lookups are scoped by companyId.
//
// This used to live inline in chat.js. It moved here the moment a second
// caller needed it (send-daily-briefing.js, which has to decide per recipient
// what belongs in their briefing), because two hand-copied permission
// resolvers is exactly how one of them ends up granting something the other
// denies.

// Admin bypasses the matrix entirely, same as the frontend. Listed explicitly
// rather than returning a Proxy that says yes to everything: a typo'd
// permission id in a tool guard should fail closed, not silently pass for
// admins and fail for everyone else.
const ADMIN_PERMS = {
  inv_view: true,
  inv_edit: true,
  inv_receive: true,
  inv_bulk_receive: true,
  inv_pricing_view: true,
  inv_pricing_edit: true,
  inv_adjust: true,
  inv_count: true,
  fleet_view: true,
  fleet_edit: true,
  fleet_log_service: true,
  fleet_log_inspection: true,
  fleet_photo_delete: true,
  fleet_log_mi: true,
  maint_submit: true,
  maint_manage: true,
  jobs_view: true,
  jobs_build: true,
  jobs_approve: true,
  jobs_pull: true,
  jobs_edit_pull: true,
  jobs_complete: true,
  jobs_close: true,
  jobs_revenue: true,
  reports_view: true,
  users_manage: true,
  settings_manage: true,
};

export function adminPerms() {
  return { ...ADMIN_PERMS };
}

export async function getEffectivePerms(admin, userId, companyId, role) {
  if (role === "admin") return adminPerms();

  const [{ data: roleRow }, { data: overrideRow }] = await Promise.all([
    admin
      .from("role_permissions")
      .select("permissions")
      .eq("company_id", companyId)
      .eq("role", role)
      .maybeSingle(),
    admin
      .from("user_permission_overrides")
      .select("overrides")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  return { ...(roleRow?.permissions || {}), ...(overrideRow?.overrides || {}) };
}

/**
 * Everyone active in one company, with the permissions each of them actually
 * holds — resolved in ONE pass rather than one query per person.
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN A PLAIN profiles SELECT
 *
 * `profiles` is NOT company-scoped: it has one row per auth user across the
 * whole platform, and this runs on a service-role client where RLS does not
 * apply. A bare `admin.from("profiles").select("id, full_name")` therefore
 * returns every user of every tenant — so any tool that resolves an id to a
 * name has to come through here, where `memberships` decides the id list
 * first and profiles is only ever read with `.in("id", memberIds)`.
 *
 * Same candidates-first shape as _shared/fleetRecipients.js's
 * loadFleetManagers, for the same reason: a 60-person company should fetch 60
 * profiles, not the platform's.
 *
 * Returns [{ userId, name, email, role, perms }].
 */
export async function loadCompanyRoster(admin, companyId) {
  const [{ data: members, error: memberError }, { data: roleRows }, { data: overrideRows }] =
    await Promise.all([
      admin.from("memberships").select("user_id, role, active").eq("company_id", companyId),
      admin.from("role_permissions").select("role, permissions").eq("company_id", companyId),
      admin
        .from("user_permission_overrides")
        .select("user_id, overrides")
        .eq("company_id", companyId),
    ]);
  if (memberError) return { error: memberError.message, roster: [] };

  const active = (members || []).filter((m) => m?.user_id && m.active !== false);
  if (active.length === 0) return { roster: [] };

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, full_name, name, email")
    .in(
      "id",
      active.map((m) => m.user_id),
    );
  if (profileError) return { error: profileError.message, roster: [] };

  const rolePerms = Object.fromEntries((roleRows || []).map((r) => [r.role, r.permissions || {}]));
  const overrides = Object.fromEntries(
    (overrideRows || []).map((r) => [r.user_id, r.overrides || {}]),
  );
  const profileById = new Map((profiles || []).map((p) => [p.id, p]));

  return {
    roster: active.map((m) => {
      const p = profileById.get(m.user_id) || {};
      return {
        userId: m.user_id,
        name: p.full_name || p.name || p.email || "Unknown",
        email: p.email || null,
        role: m.role,
        perms:
          m.role === "admin"
            ? adminPerms()
            : { ...(rolePerms[m.role] || {}), ...(overrides[m.user_id] || {}) },
      };
    }),
  };
}
