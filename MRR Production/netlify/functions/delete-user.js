// netlify/functions/delete-user.js
// Admin-only: permanently removes a user's profile, permission overrides, and
// their underlying Supabase Auth account — replaces the old deactivate-only flow.

const { createClient } = require("@supabase/supabase-js");

const ALLOWED_ORIGINS = [
  "https://mrrproduction.netlify.app",
  "http://localhost:5173",
  "http://localhost:8888",
  "http://localhost:3000",
];

function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

exports.handler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(requestOrigin);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { accessToken, targetUserId } = body;
  if (!accessToken) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Not authenticated" }) };
  }
  if (!targetUserId) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing targetUserId" }) };
  }

  const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Not authenticated" }) };
    }

    // Matches the DB-level RLS convention already in place: admin-only.
    const { data: callerProfile } = await admin.from("profiles").select("role, active").eq("id", authData.user.id).single();
    if (!callerProfile || callerProfile.active === false || callerProfile.role !== "admin") {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: "Admin access required" }) };
    }

    if (targetUserId === authData.user.id) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "You cannot remove your own account." }) };
    }

    // Clean up dependent rows first (regardless of the profiles_id_fkey's ON DELETE
    // behavior, this ordering always works), then remove the underlying auth account.
    await admin.from("user_permission_overrides").delete().eq("user_id", targetUserId);
    await admin.from("profiles").delete().eq("id", targetUserId);

    const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
    if (deleteError) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: deleteError.message }) };
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
