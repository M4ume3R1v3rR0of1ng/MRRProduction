// netlify/functions/create-user.js
// Admin-only: creates a real Supabase Auth user (with the password the admin
// set, no invite email) so the database's auth.users -> profiles trigger fires
// with a real, FK-valid id. UserManagementView.jsx previously inserted a
// fabricated crypto.randomUUID() straight into `profiles`, which can never
// satisfy profiles_id_fkey.

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

  const { accessToken, name, email, role, password } = body;
  if (!accessToken) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Not authenticated" }) };
  }
  if (!name || !email || !role) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing name, email, or role" }) };
  }
  if (!password || password.length < 8) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Password must be at least 8 characters" }) };
  }
  // Never trust an arbitrary role string, even from an admin — pin it to the known set.
  const VALID_ROLES = ["admin", "warehouse", "coordinator", "manager", "field", "employee", "bookkeeper"];
  if (!VALID_ROLES.includes(role)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid role" }) };
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

    // Creating the auth user fires the handle_new_user trigger, which inserts the
    // profile row with a safe DEFAULT role (it deliberately ignores metadata role so
    // untrusted self-signups can't pick their own). email_confirm: true — the admin is
    // vouching for this account, so it's usable immediately with the password just set.
    const { data: createData, error: createError } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: name.trim() },
    });

    if (createError) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: createError.message }) };
    }

    // Apply the admin-chosen role explicitly with the service-role client (bypasses RLS).
    // The trigger only sets a default; without this step every admin-created user would
    // keep that default regardless of the role the admin selected.
    const { error: roleError } = await admin
      .from("profiles")
      .update({ role })
      .eq("id", createData.user.id);
    if (roleError) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: `User created but role assignment failed: ${roleError.message}` }) };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, id: createData.user.id }),
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
