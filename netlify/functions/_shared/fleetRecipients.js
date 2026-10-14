// netlify/functions/_shared/fleetRecipients.js
//
// Who, besides the driver, hears about a truck's maintenance from a scheduled
// job. Extracted so send-maintenance-push-notices.js (and anything else that
// later needs to escalate past one driver) resolves the same set of people the
// same way.
//
// WHY A PERMISSION AND NOT A ROLE NAMED "FLEET MANAGER"
//
// There is no such role. src/shared/database/permissions.js ships six
// (warehouse, coordinator, manager, employee, field, bookkeeper) and a company
// is free to re-cut what each one can do. The person this job needs is whoever
// is actually responsible for the trucks, and the app already names that
// capability exactly: `fleet_edit`, labelled "Manage Fleet — Add & edit
// vehicles, assign drivers". Whoever can put a truck in a driver's name is
// whoever should hear that the truck is overdue. Resolving on the permission
// rather than a role string also means a shop that renames or re-cuts its roles
// keeps getting the mail without anyone editing this file.
//
// Note the default matrix puts `fleet_edit` on warehouse and coordinator but
// NOT on the role literally called "manager" — which is exactly why guessing
// from role names would have mailed the wrong people.
//
// ⚠️ THE ROLE THAT COUNTS IS memberships.role, NOT profiles.role.
//    profiles.role is deprecated and, for someone who works at two companies,
//    holds whichever role was written last (supabase/02_tenancy_tables.sql:199
//    says so in the column comment, and useAppData.js overlays the membership
//    role for the same reason). A job that read profiles.role would hand one
//    company's trucks to another company's permission set.

// Mirrors DEFAULT_ROLE_PERMS[role].fleet_edit in
// src/shared/database/permissions.js — keep in sync. This is the baseline a
// company gets before an admin saves anything, and role_permissions rows are
// layered OVER it, not substituted for it: a row saved before a permission key
// existed simply has no opinion about that key, and the client does the same
// layering (see useAppData.js's "Layer stored perms over defaults" comment).
// Without the layer, a shop that saved its permissions once would resolve
// fleet_edit to undefined and this job would email nobody.
const FLEET_EDIT_DEFAULTS = {
  warehouse: true,
  coordinator: true,
  manager: false,
  employee: false,
  field: false,
  bookkeeper: false,
};

export const FLEET_MANAGE_PERM = "fleet_edit";

// Pure: does this member hold `perm` in this company?
//
// Mirrors getEffectivePerms() in src/shared/database/permissions.js — admin
// short-circuits to every permission, otherwise it is role defaults, then the
// company's saved role row, then that one person's overrides, last write wins.
export function memberHoldsPerm(
  member,
  { rolePermissions = {}, overrides = {}, roleDefaults = FLEET_EDIT_DEFAULTS, perm } = {},
) {
  if (!member) return false;
  if (member.role === "admin") return true;

  const resolved = {
    ...{ [perm]: roleDefaults[member.role] === true },
    ...(rolePermissions[member.role] || {}),
    ...(overrides[member.user_id ?? member.id] || {}),
  };
  return resolved[perm] === true;
}

// Pure: the people to mail, given rows already read from the database.
//
// Dropped, each deliberately:
//   inactive members  — an account that has been switched off should not keep
//                       receiving the fleet's mail.
//   no email on file  — nothing to send to; the caller logs the count so a
//                       fleet with no reachable manager is visible in the job
//                       output rather than silently unescalated.
//
// The assigned DRIVER is not excluded here, because this resolves once per
// company while the driver differs per truck. The caller drops them per
// vehicle — see dropUser below.
export function resolveFleetManagers({
  members = [],
  profilesById = new Map(),
  rolePermissions = {},
  overrides = {},
  perm = FLEET_MANAGE_PERM,
} = {}) {
  const out = [];
  for (const member of members) {
    if (!member?.user_id) continue;
    if (member.active === false) continue;
    if (!memberHoldsPerm(member, { rolePermissions, overrides, perm })) continue;

    const profile = profilesById.get(member.user_id);
    if (!profile?.email) continue;
    out.push({ id: member.user_id, email: profile.email, name: profile.full_name || "" });
  }
  return out;
}

// A truck's assigned driver is mailed separately, in the driver's own wording.
// Without this a driver who also manages the fleet gets the same truck twice,
// in two different voices, and reasonably concludes the alerts are noise.
export function dropUser(people = [], userId) {
  if (!userId) return people;
  return people.filter((p) => String(p.id) !== String(userId));
}

// The I/O half: four reads, scoped to one company.
//
// `admin` is the SERVICE-ROLE client, so RLS does not apply to any of these —
// every .eq("company_id", companyId) below is the only thing keeping one
// company's managers out of another's alerts. Same warning as every other
// service-role call site in this directory.
//
// Returns [] on a read failure rather than throwing: a nightly job that cannot
// resolve managers should still get the driver notices out.
export async function loadFleetManagers(admin, companyId, { perm = FLEET_MANAGE_PERM } = {}) {
  const [{ data: members, error: memberError }, { data: roleRows }, { data: overrideRows }] =
    await Promise.all([
      admin.from("memberships").select("user_id, role, active").eq("company_id", companyId),
      admin.from("role_permissions").select("role, permissions").eq("company_id", companyId),
      admin
        .from("user_permission_overrides")
        .select("user_id, overrides")
        .eq("company_id", companyId),
    ]);

  if (memberError) {
    console.error(
      `loadFleetManagers: membership lookup failed for company ${companyId}:`,
      memberError.message,
    );
    return [];
  }
  if (!members?.length) return [];

  const rolePermissions = Object.fromEntries(
    (roleRows || []).map((r) => [r.role, r.permissions || {}]),
  );
  const overrides = Object.fromEntries(
    (overrideRows || []).map((r) => [r.user_id, r.overrides || {}]),
  );

  // Candidates first, profiles second — a fleet of 60 employees with three
  // fleet managers should fetch three profiles, not sixty.
  const candidateIds = (members || [])
    .filter((m) => m?.user_id && m.active !== false)
    .filter((m) => memberHoldsPerm(m, { rolePermissions, overrides, perm }))
    .map((m) => m.user_id);
  if (!candidateIds.length) return [];

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("id", candidateIds);
  if (profileError) {
    console.error(
      `loadFleetManagers: profile lookup failed for company ${companyId}:`,
      profileError.message,
    );
    return [];
  }

  return resolveFleetManagers({
    members,
    profilesById: new Map((profiles || []).map((p) => [p.id, p])),
    rolePermissions,
    overrides,
    perm,
  });
}
