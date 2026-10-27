// netlify/functions/_shared/userAdmin.js
//
// Who may manage users, and what a non-admin is allowed to do with that power.
//
// Until now every user-management path checked isCompanyAdmin(caller) — a literal
// `role === 'admin'` test. Meanwhile Settings offers a `users_manage` toggle per
// role, which opens the User Management screen in the browser (App.jsx gates the
// route on it) but was honoured by nothing on the server. So an admin could grant
// "Manage Users" to their managers, watch the screen appear, and every button on
// it would come back "Admin access required". The toggle was a label with no
// mechanism behind it.
//
// This module is the mechanism. A caller may manage users if they are a company
// admin, the platform owner, OR they hold users_manage — and in that last case
// they are a DELEGATE, who may do the day-to-day work without inheriting the
// things "admin" also means here (billing, API keys, the permission matrix
// itself, which all keep their own strict checks elsewhere).
//
// ── The delegate rules, and why each one exists ──
//
//   1. A delegate may not create anyone as admin, or promote anyone to admin.
//      Otherwise users_manage is a self-service route to full admin: add an
//      account as admin, sign in as it, done. This is the rule that keeps the
//      permission from being an escalation.
//
//   2. A delegate may not act on an account that IS an admin — no renaming,
//      no password reset, no removal, no demotion. Without this, a delegate
//      could reset an admin's password and take the account over, or demote
//      every admin and leave the company with none.
//
//   3. A delegate may not change their own role. Covered in part by rule 1, but
//      stated separately so the intent survives someone later relaxing rule 1
//      for some narrower case.
//
// Overrides (user_permission_overrides) are deliberately NOT delegated. Handing
// out individual permissions is how you'd grant settings_manage to a friendly
// account and get everything rule 1 denies; its RLS policy in
// supabase/02_tenancy_tables.sql stays admin-only, and the UI hides the button
// for delegates to match.
//
// The matching SQL lives in supabase/62_delegated_user_management.sql, which
// re-implements these same rules inside set_member_role(). Change one, change
// both — same standing warning as resolveCaller's mirror of active_company_id().
// @ts-check

import { isCompanyAdmin } from "./tenant.js";
import { getEffectivePerms } from "./anvilPerms.js";

/** @typedef {import("./tenant.js").Caller} Caller */
/** @typedef {import("@supabase/supabase-js").SupabaseClient<any, any, any, any, any>} SupabaseClient */

// The message every one of these paths returned before delegation existed. Kept
// verbatim for the genuinely-unauthorized case so nothing that matches on it
// (and no muscle memory) breaks.
export const ADMIN_REQUIRED = "Admin access required";

/**
 * May this caller manage users at all, and with how much authority?
 *
 * @param {SupabaseClient} admin
 * @param {Caller} caller
 * @returns {Promise<{ fullAdmin: boolean, error?: undefined } | { fullAdmin?: undefined, error: { status: number, message: string } }>}
 */
export async function resolveUserAdmin(admin, caller) {
  // A company admin or the platform owner. No delegate rules apply.
  if (isCompanyAdmin(caller)) return { fullAdmin: true };

  // A delegate: whatever the company's permission matrix says for their role,
  // plus their personal overrides. Same resolver the AI assistant and the daily
  // briefing already use, so there is one server-side answer to "what may this
  // person do", not three.
  const perms = await getEffectivePerms(admin, caller.userId, caller.companyId, caller.role);
  if (perms?.users_manage === true) return { fullAdmin: false };

  return { error: { status: 403, message: ADMIN_REQUIRED } };
}

/**
 * Rule 1: only a real admin may hand out admin.
 *
 * @param {string | undefined} role - The role being assigned.
 * @param {boolean} fullAdmin
 * @returns {string | null} An error message, or null if the assignment is allowed.
 */
export function roleAssignmentError(role, fullAdmin) {
  if (role === "admin" && !fullAdmin) {
    return "Only an admin can give someone admin access. Ask an admin to make this change.";
  }
  return null;
}

/**
 * Rules 2 and 3: a delegate may not act on an admin, nor on their own account.
 *
 * Reads the TARGET's membership role in the caller's company — not profiles.role,
 * which is deprecated and drifts. Callers that already verified the membership
 * exists can pass its role through as `knownRole` to skip the second lookup.
 *
 * @param {SupabaseClient} admin
 * @param {Caller} caller
 * @param {string} targetUserId
 * @param {boolean} fullAdmin
 * @param {{ knownRole?: string | null, allowSelf?: boolean }} [options]
 * @returns {Promise<string | null>} An error message, or null if the action is allowed.
 */
export async function targetGuardError(admin, caller, targetUserId, fullAdmin, options = {}) {
  if (fullAdmin) return null;

  const { knownRole, allowSelf = false } = options;

  if (!allowSelf && targetUserId === caller.userId) {
    return "You cannot change your own access. Ask an admin to make this change.";
  }

  let role = knownRole;
  if (role === undefined) {
    const { data: membership } = await admin
      .from("memberships")
      .select("role")
      .eq("user_id", targetUserId)
      .eq("company_id", caller.companyId)
      .maybeSingle();
    role = membership?.role ?? null;
  }

  if (role === "admin") {
    return "Only an admin can change another admin's account.";
  }

  return null;
}
