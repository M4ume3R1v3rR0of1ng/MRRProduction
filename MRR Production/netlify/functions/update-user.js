// netlify/functions/update-user.js
// Admin-only: update a member's shared profile fields (name, email) within the
// CALLER'S company.
//
// Why this can't be a plain client-side profiles update:
//
// The email a person signs in with lives in auth.users.email — that's the login
// identity, and it's what the app shows on the Personal Profile (curUser.email,
// read from the session at login). profiles.email is only a mirror. User Management
// used to write profiles.email alone, so the auth email (and therefore the profile
// page and the actual login) never changed — the edit looked saved but did nothing
// real. A browser cannot change another user's auth email, so it has to happen here
// with the service-role Admin API.
//
// Scope: a company admin may only edit a member of THEIR OWN company. The service
// role bypasses RLS, so that membership check is the whole guard.

import { adminClient, resolveCaller, isCompanyAdmin, corsHeaders } from "./_shared/tenant.js";

export const handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin || "");

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { accessToken, targetUserId, name, email } = body;
  if (!targetUserId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing targetUserId" }) };
  }

  const admin = adminClient();

  const { caller, error: callerError } = await resolveCaller(admin, accessToken);
  if (callerError) {
    return { statusCode: callerError.status, headers, body: JSON.stringify({ error: callerError.message }) };
  }
  if (!isCompanyAdmin(caller)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Admin access required" }) };
  }

  // The target must be a member of the caller's company — otherwise an admin could
  // pass any uuid and edit a user in a company they've never heard of.
  const { data: membership } = await admin
    .from("memberships")
    .select("user_id")
    .eq("user_id", targetUserId)
    .eq("company_id", caller.companyId)
    .maybeSingle();
  if (!membership) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "That user is not a member of your company." }) };
  }

  const cleanName = (name || "").trim();
  const cleanEmail = (email || "").trim().toLowerCase();

  try {
    // One auth update carrying the email (the login identity) and the display name
    // in user_metadata. Nothing reads user_metadata.full_name back for display, but
    // signup sets it, so we keep it in step with profiles rather than letting the
    // auth record drift. Auto-confirm the email: this is an admin-initiated change,
    // so the user signs in with the new address immediately instead of clicking a
    // confirmation link. Only touch the email when it actually changes.
    const authPatch = {};
    if (cleanEmail) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Enter a valid email address." }) };
      }
      const { data: authData } = await admin.auth.admin.getUserById(targetUserId);
      const currentEmail = authData?.user?.email?.toLowerCase();
      if (cleanEmail !== currentEmail) {
        authPatch.email = cleanEmail;
        authPatch.email_confirm = true;
      }
    }
    if (cleanName) {
      authPatch.user_metadata = { full_name: cleanName };
    }
    if (Object.keys(authPatch).length > 0) {
      const { error: authErr } = await admin.auth.admin.updateUserById(targetUserId, authPatch);
      // Most common failure: the address already belongs to another account.
      if (authErr) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: authErr.message }) };
      }
    }

    // Mirror to profiles so the app's displayed name/email match the auth identity.
    const patch = {};
    if (cleanName) { patch.name = cleanName; patch.full_name = cleanName; }
    if (cleanEmail) patch.email = cleanEmail;
    if (Object.keys(patch).length > 0) {
      const { error: profErr } = await admin.from("profiles").update(patch).eq("id", targetUserId);
      if (profErr) throw profErr;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
