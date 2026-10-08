// src/core/rolePreview.js
//
// "View as" — render the whole app as another role without signing in as
// somebody else.
//
// ── WHY ──
//
// The training clips have to show each role the app it actually gets: a site
// supervisor's sidebar, an employee's dashboard, a bookkeeper's narrow slice of
// Jobs. Recorded from the owner's own account every clip shows the admin app
// instead, which teaches the wrong screen to everyone who watches it.
//
// The alternative was a real account per role, signed in and out of between
// takes. That leaves seven half-set-up people in the tenant, a different name on
// every ticket the recording files, and a re-record whenever one of those
// passwords goes stale.
//
// ── THIS IS A PREVIEW, NOT A DEMOTION ──
//
// Only the CLIENT's idea of the viewer's role changes. The session, the JWT and
// therefore active_role() are untouched, so has_perm() (supabase/13) still
// answers for the REAL role and the database still permits exactly what it
// permitted before. Previewing 'employee' takes the Pull Inventory row out of
// the nav; it does not make Postgres refuse a pull.
//
// The reverse also holds, and is the sharper edge: preview a role you do not
// hold and you get that role's buttons on screen while RLS keeps answering for
// yours. For the platform owner, whose real role is 'admin' in every tenant they
// can reach, that direction is always a narrowing — which is why the control is
// offered to platform admins and nobody else (see canPreviewRoles below). It is
// a recording tool, not an access-control feature, and must never be read as one.
//
// ── IDENTITY IS NEVER PREVIEWED ──
//
// `role` and `isPlatformAdmin` are the only two fields replaced. id, email,
// name, companyId and isVisiting carry straight through, because every write in
// the app stamps rows with them: a maintenance ticket filed mid-preview is still
// filed by you, under your name, in the company you are really in — and the
// visiting banner still tells you whose live data that is.
import { ROLES, getEffectivePerms } from "@/shared/database/permissions";

/** Every role that can be previewed, in the order the picker offers them. */
export const PREVIEW_ROLES = Object.keys(ROLES);

/**
 * Who gets the picker at all. The platform operator only: see the header on why
 * this is a recording tool rather than an access-control feature. Checked here
 * rather than only where the control is drawn, so hiding the control and
 * refusing the preview are the same rule.
 */
export const canPreviewRoles = (user) => user?.isPlatformAdmin === true;

/**
 * The user and permissions the app should RENDER from, given who is signed in
 * and which role they have asked to preview.
 *
 * Returns `previewing: null` whenever the answer is "just show them their own
 * app" — not entitled, nothing selected, or an unknown role. One shape either
 * way, so no caller has to branch.
 */
export function resolveRolePreview({ user, previewRole, rolePerms, userOverrides = {} }) {
  if (!user) return { viewUser: null, perms: {}, previewing: null };

  const asked = canPreviewRoles(user) && PREVIEW_ROLES.includes(previewRole) ? previewRole : null;

  // Deliberately NOT short-circuited when `asked` matches the role you already
  // hold. That read as "nothing to preview", and it made selecting Admin do
  // visibly nothing for the one person who can use this picker: the platform
  // owner's membership role IS 'admin' in every tenant they can reach.
  //
  // But a platform owner's app is not a company admin's app — the difference is
  // exactly the isPlatformAdmin branch stripped below. Admin has to stay a real
  // preview, or there is no way to record the screen a customer's own admin gets.
  if (!asked) {
    return {
      viewUser: user,
      perms: getEffectivePerms(user, rolePerms, userOverrides),
      previewing: null,
    };
  }

  // isPlatformAdmin goes too. Left on, the Owner Console row stays in the
  // sidebar, the Billing route stays reachable and the past-due banner keeps
  // showing — none of which a crew member has ever seen, so a clip recorded with
  // them still on is a clip of a screen that does not exist. The real flag is
  // untouched on the real user, which is what the picker itself reads, so
  // switching it off here cannot strand anyone outside the console.
  const viewUser = { ...user, role: asked, isPlatformAdmin: false, previewRole: asked };

  return {
    viewUser,
    // Overrides are deliberately dropped. They are per-PERSON exceptions keyed
    // by user id, so carrying them over blends YOUR individual grants into the
    // role being previewed and renders a screen nobody in that role has. The
    // clip should show the role's preset — what a new hire gets on day one.
    perms: getEffectivePerms(viewUser, rolePerms, {}),
    previewing: asked,
  };
}

// ── Where the choice is remembered ──
//
// sessionStorage, not localStorage, and not the `storage` helper that wraps
// Capacitor Preferences. A preview has to survive the page reloads a recording
// session is full of, and must NOT survive the tab: coming back tomorrow to an
// app that is quietly pretending you are an employee is the one failure mode
// worth engineering against. Signing out clears it too (see useAppData).
const STORE_KEY = "steadwerk-role-preview";

/** The remembered preview role, or null. Validated, so a stale key can't widen anything. */
export function readPreviewRole() {
  try {
    const stored = sessionStorage.getItem(STORE_KEY);
    return PREVIEW_ROLES.includes(stored) ? stored : null;
  } catch {
    // Private windows and webviews with site data blocked throw on access. A
    // preview that cannot be remembered is a preview that resets on reload,
    // which is a worse recording session and not a broken app.
    return null;
  }
}

export function storePreviewRole(role) {
  try {
    if (role) sessionStorage.setItem(STORE_KEY, role);
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* see readPreviewRole */
  }
}
