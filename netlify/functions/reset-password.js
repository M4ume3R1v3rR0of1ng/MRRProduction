// netlify/functions/reset-password.js
// Sets a new password for a user in the CALLER'S company. Requires admin, or the
// users_manage permission — see _shared/userAdmin.js for the delegate rules.
//
// This one needs more care than it looks like it does.
//
// A password is not company-scoped — it unlocks the whole account. So if a user
// belongs to two companies, letting an admin at company A set their password hands
// company A a working login for company B. That is account takeover, dressed up as
// a helpdesk feature.
//
// Rule: an admin may only reset the password of someone whose ONLY membership is
// this company. Anyone else gets the self-serve reset-by-email flow, which proves
// possession of the mailbox instead of trusting an admin.

import { adminClient, resolveCaller, corsHeaders } from "./_shared/tenant.js";
import { resolveUserAdmin, targetGuardError } from "./_shared/userAdmin.js";
import { validatePassword } from "./_shared/password.js";
import { withSentry } from "./_shared/sentry.js";
import { checkRateLimit, rateLimitedResponse } from "./_shared/rateLimit.js";

const rawHandler = async (event) => {
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

  const { accessToken, targetUserId, password } = body;
  if (!targetUserId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing targetUserId" }) };
  }
  const passwordProblem = validatePassword(password);
  if (passwordProblem) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: passwordProblem }) };
  }

  const admin = adminClient();

  const { caller, error: callerError } = await resolveCaller(admin, accessToken);
  if (callerError) {
    return {
      statusCode: callerError.status,
      headers,
      body: JSON.stringify({ error: callerError.message }),
    };
  }
  const { fullAdmin, error: authzError } = await resolveUserAdmin(admin, caller);
  if (authzError) {
    return {
      statusCode: authzError.status,
      headers,
      body: JSON.stringify({ error: authzError.message }),
    };
  }

  // Defense in depth, not the primary control: this action already requires a
  // verified admin session and the takeover guard below. The cap exists for the
  // case that guard doesn't cover — a compromised admin session scripting mass
  // password resets across the company's own users.
  const rl = checkRateLimit(`reset-password:${caller.userId}`, { max: 10, windowMs: 60 * 1000 });
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds, headers);

  try {
    const { data: memberships } = await admin
      .from("memberships")
      .select("company_id, role")
      .eq("user_id", targetUserId);

    const companies = memberships || [];

    const here = companies.find((m) => m.company_id === caller.companyId);
    if (!here) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "That user is not a member of your company." }),
      };
    }

    // Rule 2, and the sharpest case for it: a password unlocks the whole account.
    // A delegate who could reset an admin's password would simply sign in as that
    // admin, which hands them everything the delegate rules withhold.
    const guardError = await targetGuardError(admin, caller, targetUserId, fullAdmin, {
      knownRole: here.role ?? null,
    });
    if (guardError) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: guardError }) };
    }

    // The takeover guard described above. A platform admin (you) is exempt — you
    // already hold the service-role key, so this would be theatre.
    if (companies.length > 1 && !caller.isPlatformAdmin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error:
            "This user also works for another company on the platform, so their password " +
            "cannot be set from here. Ask them to use the 'forgot password' link instead.",
        }),
      };
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, {
      password,
    });
    if (updateError) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: updateError.message }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

export const handler = withSentry("reset-password", rawHandler);
