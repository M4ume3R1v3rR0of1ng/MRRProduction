// netlify/functions/_shared/tenant.js
//
// Every function in this directory talks to Supabase with the SERVICE-ROLE key,
// which BYPASSES ROW LEVEL SECURITY ENTIRELY. The tenant isolation in
// supabase/02_tenancy_tables.sql does not protect a single line of code in here.
//
// That makes this file the whole ballgame. If a function queries a tenant table
// without .eq("company_id", caller.companyId), it will happily return another
// company's data — and nothing in the database will stop it.
//
// So: resolve the caller ONCE, get their company, and scope every query by it.

import { createClient } from "@supabase/supabase-js";

// A company in one of these states may use the app. 'past_due' is deliberately
// included: Stripe retries a failed card for ~2 weeks, and locking a roofing crew
// out of their live job data the instant a card expires is the wrong call. They
// lose access when Stripe gives up and moves them to 'canceled'.
const USABLE_SUBSCRIPTION_STATES = ["trialing", "active", "past_due"];

const ALLOWED_ORIGINS = [
  "https://mrrproduction.netlify.app",
  "http://localhost:5173",
  "http://localhost:8888",
  "http://localhost:3000",
];

export function corsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function adminClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Verify the caller and work out which company they are acting in.
//
// Returns { caller } on success, or { error: { status, message } } to return verbatim.
//
// This re-implements in JS the same check active_company_id() makes in SQL. It has
// to: the service-role key means the database will not make it for us. If you
// change the rules in one place, change them in the other.
export async function resolveCaller(admin, accessToken) {
  if (!accessToken) {
    return { error: { status: 401, message: "Not authenticated" } };
  }

  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !authData?.user) {
    return { error: { status: 401, message: "Not authenticated" } };
  }
  const userId = authData.user.id;

  const { data: profile } = await admin
    .from("profiles")
    .select("active, active_company_id, is_platform_admin")
    .eq("id", userId)
    .single();

  if (!profile || profile.active === false) {
    return { error: { status: 403, message: "Account inactive" } };
  }

  const companyId = profile.active_company_id;
  if (!companyId) {
    // A user with no company — a fresh signup nobody has invited yet. Fail closed.
    return { error: { status: 403, message: "Your account is not attached to a company yet." } };
  }

  // The membership, not profiles.role, is the source of truth for what this person
  // may do — because role is now per-company.
  const { data: membership } = await admin
    .from("memberships")
    .select("role, active")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .single();

  if (!membership || membership.active === false) {
    return { error: { status: 403, message: "You are not an active member of this company." } };
  }

  const { data: company } = await admin
    .from("companies")
    .select("id, name, slug, subscription_status")
    .eq("id", companyId)
    .single();

  if (!company) {
    return { error: { status: 403, message: "Company not found" } };
  }

  // The kill switch, enforced server-side. 402 Payment Required is the honest code.
  if (!USABLE_SUBSCRIPTION_STATES.includes(company.subscription_status)) {
    return {
      error: {
        status: 402,
        message: "This company's subscription is not active. Contact your administrator.",
      },
    };
  }

  // Secrets (AccuLynx key, Stripe ids) live in company_secrets, a table with no grant
  // to any browser role — see supabase/04_security_fixes.sql. Only this service-role
  // client can read it. It must NEVER be echoed back to the browser.
  const { data: secrets } = await admin
    .from("company_secrets")
    .select("integrations")
    .eq("company_id", companyId)
    .maybeSingle();

  return {
    caller: {
      userId,
      email: authData.user.email,
      companyId,
      companyName: company.name,
      companySlug: company.slug,
      role: membership.role,
      isPlatformAdmin: profile.is_platform_admin === true,
      integrations: secrets?.integrations || {},
    },
  };
}

// Company admin, or you. Use for anything that manages users or settings.
export function isCompanyAdmin(caller) {
  return caller.role === "admin" || caller.isPlatformAdmin;
}

export { USABLE_SUBSCRIPTION_STATES };
