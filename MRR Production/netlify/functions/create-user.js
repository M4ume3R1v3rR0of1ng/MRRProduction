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

import { Resend } from "resend";
import { adminClient, resolveCaller, isCompanyAdmin, corsHeaders, appOrigin, platformFromAddress } from "./_shared/tenant.js";
import { validatePassword } from "./_shared/password.js";

const VALID_ROLES = ["admin", "warehouse", "coordinator", "manager", "field", "employee", "bookkeeper"];

const MAIL_FROM = platformFromAddress("notifications");

// Company and person names land inside an HTML email. They're admin-supplied free
// text, so escape them rather than trusting whatever was typed into Settings.
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Tell a newly added user they have access.
//
// Two different emails, because the two paths are genuinely different:
//
//   New account      -> a set-your-own-password link, so the admin never has to
//                       read a temporary password down the phone. Generated with
//                       Supabase's recovery link, the same mechanism as the
//                       "Forgot password?" flow, so it lands on ResetPasswordScreen.
//
//   Existing account -> NO password link. They already have a password, and
//                       minting a recovery link for an existing user at the request
//                       of a DIFFERENT company's admin is the account-takeover hole
//                       this file's header warns about. They just get told they now
//                       have access, and sign in the way they already do.
//
// Never throws. A failed invite must not fail user creation: the account and the
// membership are already committed, and the person genuinely does have access. The
// caller reports the failure so the admin knows to reach out directly.
async function sendInviteEmail({ admin, targetEmail, name, isNewAccount, companyName, origin }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { invited: false, inviteError: "Email is not configured (RESEND_API_KEY is unset)." };

  try {
    let actionLink = null;
    if (isNewAccount) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: targetEmail,
        options: { redirectTo: origin },
      });
      if (error) return { invited: false, inviteError: error.message };
      actionLink = data?.properties?.action_link || null;
    }

    const company = esc(companyName);
    const greeting = name ? `Hi ${esc(name.split(" ")[0])},` : "Hi,";

    const html = isNewAccount
      ? `<h2>You've been added to ${company}</h2>
         <p>${greeting}</p>
         <p>An account has been created for you on the ${company} portal. Set your password to get started.</p>
         <p style="margin:24px 0">
           <a href="${actionLink}" style="background:#1f2937;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Set your password</a>
         </p>
         <p style="color:#6b7280;font-size:13px">This link expires in 24 hours. If it does, use "Forgot password?" on the sign-in page to get a new one.</p>`
      : `<h2>You now have access to ${company}</h2>
         <p>${greeting}</p>
         <p>Your existing account has been given access to the ${company} portal. Sign in with the password you already use, then pick ${company} from the company switcher.</p>
         <p style="margin:24px 0">
           <a href="${origin}" style="background:#1f2937;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Go to the portal</a>
         </p>`;

    const resend = new Resend(apiKey);
    const { error: sendError } = await resend.emails.send({
      from: `${companyName} <${MAIL_FROM}>`,
      to: targetEmail,
      subject: isNewAccount ? `Your ${companyName} account is ready` : `You've been added to ${companyName}`,
      html,
    });
    if (sendError) return { invited: false, inviteError: sendError.message };

    return { invited: true, inviteError: null };
  } catch (err) {
    return { invited: false, inviteError: err.message };
  }
}

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

  // sendInvite defaults to true: the old behaviour (create silently, admin relays the
  // password by hand) is the thing being fixed, so it has to be opted OUT of, not in.
  const { accessToken, name, email, role, password, sendInvite = true } = body;
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
      const passwordProblem = validatePassword(password);
      if (passwordProblem) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: passwordProblem }) };
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

    // Invite last, and never fatal. Everything above is committed by this point, so a
    // mail failure is reported alongside ok:true rather than masking a successful add.
    let invited = false;
    let inviteError = null;
    if (sendInvite) {
      ({ invited, inviteError } = await sendInviteEmail({
        admin,
        targetEmail,
        name: name.trim(),
        isNewAccount: !existing,
        companyName: caller.companyName,
        origin: appOrigin(event.headers?.origin || event.headers?.Origin || ""),
      }));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, id: userId, addedExisting: Boolean(existing), invited, inviteError }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
