// netlify/functions/create-user.js
// Admin-only: adds a user to the CALLER'S company.
//
// Two paths, because a person can now belong to more than one company:
//   - Email is new to the platform  -> create the auth account, then add a membership.
//   - Email already has an account  -> just add a membership to this company.
//     (Sam works for Maumee River and his brother's company; one login, two portals.)
//     No password is set in this case — they already have one, and letting an admin
//     at company B set the password of an existing company A user would be an
//     account-takeover hole.

import { adminClient, resolveCaller, isCompanyAdmin, corsHeaders } from "./_shared/tenant.js";

const VALID_ROLES = ["admin", "warehouse", "coordinator", "manager", "field", "employee", "bookkeeper"];

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

  const { accessToken, name, email, role, password } = body;
  if (!name || !email || !role) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing name, email, or role" }) };
  }
  // Never trust an arbitrary role string, even from an admin — pin it to the known set.
  if (!VALID_ROLES.includes(role)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid role" }) };
  }

  const admin = adminClient();

  const { caller, error: callerError } = await resolveCaller(admin, accessToken);
  if (callerError) {
    return { statusCode: callerError.status, headers, body: JSON.stringify({ error: callerError.message }) };
  }
  if (!isCompanyAdmin(caller)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Admin access required" }) };
  }

  const targetEmail = email.trim().toLowerCase();

  try {
    // Does this email already have an account anywhere on the platform?
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", targetEmail)
      .maybeSingle();

    let userId = existing?.id || null;

    // ── Seat cap ──
    // Adding someone consumes a seat UNLESS they're already a member of this company
    // (re-invite just changes their role). Checked BEFORE we create any auth account,
    // so a full company never leaves an orphaned login behind. The platform owner
    // bypasses the cap; a comped company (seat_capacity NULL) has no cap.
    let alreadyMember = false;
    if (userId) {
      const { data: mem } = await admin
        .from("memberships").select("user_id")
        .eq("user_id", userId).eq("company_id", caller.companyId).maybeSingle();
      alreadyMember = !!mem;
    }
    if (!alreadyMember && !caller.isPlatformAdmin) {
      const { data: co } = await admin.from("companies").select("seat_capacity").eq("id", caller.companyId).single();
      if (co?.seat_capacity != null) {
        const { count } = await admin
          .from("memberships").select("*", { count: "exact", head: true })
          .eq("company_id", caller.companyId).eq("active", true);
        if ((count ?? 0) >= co.seat_capacity) {
          return {
            statusCode: 402,
            headers,
            body: JSON.stringify({ error: "Your company is at its seat limit. Add a 5-seat pack in Billing to invite more users." }),
          };
        }
      }
    }

    if (!userId) {
      if (!password || password.length < 8) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Password must be at least 8 characters" }) };
      }

      // Creating the auth user fires handle_new_user(), which inserts the profile row.
      const { data: createData, error: createError } = await admin.auth.admin.createUser({
        email: targetEmail,
        password,
        email_confirm: true, // the admin is vouching for them; usable immediately
        user_metadata: { full_name: name.trim() },
      });
      if (createError) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: createError.message }) };
      }
      userId = createData.user.id;
    }

    // The membership IS the grant of access. Without this row, active_company_id()
    // returns NULL for them and every RLS policy denies — they'd log in to an empty
    // portal. Upsert so re-inviting someone just updates their role.
    const { error: memberError } = await admin
      .from("memberships")
      .upsert(
        { user_id: userId, company_id: caller.companyId, role, active: true },
        { onConflict: "user_id,company_id" },
      );
    if (memberError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `User created but company access failed: ${memberError.message}` }),
      };
    }

    // Point them at this company if they aren't looking at one yet. Never move a
    // user who is already active somewhere else — that would yank an existing
    // employee out of their current portal mid-session.
    await admin
      .from("profiles")
      .update({ active_company_id: caller.companyId })
      .eq("id", userId)
      .is("active_company_id", null);

    // profiles.role is DEPRECATED (memberships.role is authoritative) but the React
    // app still reads it at sign-in. Keep it in sync until the frontend moves over,
    // then delete this write and the column together.
    await admin.from("profiles").update({ role }).eq("id", userId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, id: userId, addedExisting: Boolean(existing) }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
