// netlify/functions/delete-user.js
// Admin-only: removes a user from the CALLER'S company.
//
// ⚠️ The semantics changed with multi-tenancy, and the old behaviour is now a bug.
//
// Before, this deleted the auth account outright. With memberships, a person can
// work for two companies — so an admin at Maumee River pressing "remove" would have
// destroyed that user's login at his brother's company too. An admin must never be
// able to reach outside their own tenant.
//
// So: revoke the membership. Only if that was their LAST membership anywhere is the
// underlying account actually deleted, because at that point nothing else refers to it.

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

  const { accessToken, targetUserId } = body;
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
  if (targetUserId === caller.userId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "You cannot remove your own account." }) };
  }

  try {
    // The target must be a member of the caller's company. Without this check an
    // admin could pass any uuid and evict a user from a company they've never
    // heard of — the service-role key would let them.
    const { data: targetMembership } = await admin
      .from("memberships")
      .select("user_id")
      .eq("user_id", targetUserId)
      .eq("company_id", caller.companyId)
      .maybeSingle();

    if (!targetMembership) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "That user is not a member of your company." }) };
    }

    // Company-scoped cleanup only. Their overrides at another company are none of
    // this company's business.
    await admin
      .from("user_permission_overrides")
      .delete()
      .eq("user_id", targetUserId)
      .eq("company_id", caller.companyId);

    await admin
      .from("memberships")
      .delete()
      .eq("user_id", targetUserId)
      .eq("company_id", caller.companyId);

    // Were they only ever with us?
    const { data: remaining } = await admin
      .from("memberships")
      .select("company_id")
      .eq("user_id", targetUserId);

    if (remaining && remaining.length > 0) {
      // Still employed elsewhere. Leave the account alone, but make sure they are
      // not left pointing at the company that just removed them — active_company_id()
      // would return NULL and they'd get a confusing empty portal instead of their
      // other employer's.
      await admin
        .from("profiles")
        .update({ active_company_id: remaining[0].company_id })
        .eq("id", targetUserId)
        .eq("active_company_id", caller.companyId);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, accountDeleted: false, stillMemberOf: remaining.length }),
      };
    }

    // Last membership gone — now the account itself can go.
    await admin.from("profiles").delete().eq("id", targetUserId);

    const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
    if (deleteError) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: deleteError.message }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, accountDeleted: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
