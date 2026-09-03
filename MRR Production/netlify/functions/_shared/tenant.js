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
// @ts-check

import { createClient } from "@supabase/supabase-js";

/** @typedef {import("@supabase/supabase-js").SupabaseClient<any, any, any, any, any>} SupabaseClient */

/**
 * What resolveCaller hands back on success — everything downstream needs to know
 * who is asking and what company they're scoped to.
 * @typedef {Object} Caller
 * @property {string} userId
 * @property {string | undefined} email
 * @property {string} companyId
 * @property {string} companyName
 * @property {string} companySlug
 * @property {string | undefined} role - The membership role, or "admin" while visiting (see below). Undefined only if a non-admin somehow has no membership row, which resolveCaller otherwise refuses.
 * @property {boolean} isPlatformAdmin
 * @property {boolean} isVisiting - True when a platform admin is looking at a company they don't belong to.
 * @property {Record<string, unknown>} integrations - company_secrets.integrations. Never echo this to the browser.
 */

/**
 * @typedef {Object} CallerError
 * @property {number} status - HTTP status to return verbatim.
 * @property {string} message
 */

/**
 * @typedef {{ caller: Caller, error?: undefined } | { caller?: undefined, error: CallerError }} ResolveCallerResult
 */

// A company in one of these states may use the app. 'past_due' is deliberately
// included: Stripe retries a failed card for ~2 weeks, and locking a roofing crew
// out of their live job data the instant a card expires is the wrong call. They
// lose access when Stripe gives up and moves them to 'canceled'.
const USABLE_SUBSCRIPTION_STATES = ["trialing", "active", "past_due"];

// steadwerk.com first so it's also the fallback origin (ALLOWED_ORIGINS[0]) — it's the
// primary domain now. mrrproduction.netlify.app stays for the old URL and previews.
const ALLOWED_ORIGINS = [
  "https://steadwerk.com",
  "https://www.steadwerk.com",
  "https://mrrproduction.netlify.app",
  "http://localhost:5173",
  "http://localhost:8888",
  "http://localhost:3000",
  // The iOS app. Capacitor serves the bundled build from a custom scheme rather
  // than from https, so the browser sends this as the Origin on every call.
  // Without it appOrigin() falls through to steadwerk.com, the CORS header comes
  // back naming a different origin, and WKWebView blocks EVERY function response:
  // billing, email, user creation, AccuLynx, chat, weather. The app loads and
  // then nothing in it works, which reads like a broken backend rather than a
  // missing string. Set by "iosScheme": "capacitor" in capacitor.config.json;
  // changing that value means changing this one.
  "capacitor://localhost",
];

// The app origin a request may be answered on. Falls back to the primary domain
// for anything not on the allowlist.
//
// Use this for any URL that ends up in an email. The raw Origin header is
// attacker-controlled, so interpolating it straight into a sign-in or
// set-your-password link would let someone mint a credible phishing link that
// arrives from our own verified sending domain.
/**
 * @param {string | undefined} requestOrigin
 * @returns {string}
 */
export function appOrigin(requestOrigin) {
  return requestOrigin && /** @type {string[]} */ (ALLOWED_ORIGINS).includes(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0];
}

/**
 * @param {string | undefined} requestOrigin
 * @returns {Record<string, string>}
 */
export function corsHeaders(requestOrigin) {
  const origin = appOrigin(requestOrigin);
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

// All platform email goes out from one Resend-verified domain, with the company name
// as the display name, until per-company domain verification exists. Each sender keeps
// its own local part (notifications@, alerts@) but shares the domain, so there's a
// single place to point at the verified domain.
//
//   PLATFORM_MAIL_DOMAIN — the bare domain, e.g. "steadwerk.com" (preferred).
//   PLATFORM_MAIL_FROM   — legacy full address; if set, only its domain is used, so an
//                          existing "notifications@steadwerk.com" still resolves right.
//
// Defaults to steadwerk.com, NOT the old maumeeriverroofing.com — a missing env var
// must not silently send every tenant's mail as Maumee River.
/**
 * @param {string} localPart
 * @returns {string}
 */
export function platformFromAddress(localPart) {
  const legacy = process.env.PLATFORM_MAIL_FROM;
  const domain =
    (legacy && legacy.includes("@") ? legacy.split("@")[1].trim() : null) ||
    process.env.PLATFORM_MAIL_DOMAIN ||
    "steadwerk.com";
  return `${localPart}@${domain}`;
}

/** @returns {SupabaseClient} */
export function adminClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Was previously handed straight to createClient(url, key) even when undefined —
  // supabase-js does not validate its arguments, so a misconfigured deploy built a
  // client that would fail confusingly on its first query instead of failing here,
  // loudly, with the actual missing variable named. strictNullChecks is what
  // surfaced this: createClient's parameters are typed as `string`, not
  // `string | undefined`.
  if (!url || !key) {
    throw new Error(
      "adminClient: missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variable(s).",
    );
  }
  return createClient(url, key);
}

// Verify the caller and work out which company they are acting in.
//
// Returns { caller } on success, or { error: { status, message } } to return verbatim.
//
// This re-implements in JS the same check active_company_id() makes in SQL. It has
// to: the service-role key means the database will not make it for us. If you
// change the rules in one place, change them in the other.
/**
 * @param {SupabaseClient} admin
 * @param {string | undefined} accessToken
 * @returns {Promise<ResolveCallerResult>}
 */
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

  // The platform owner may be VISITING a tenant they hold no membership in — see
  // supabase/31. active_company_id() resolves for them in SQL, so this mirror has
  // to resolve too, or every function in this directory 403s the moment the owner
  // steps into a customer's portal to fix something.
  const isPlatformAdmin = profile.is_platform_admin === true;
  const isVisiting = (!membership || membership.active === false) && isPlatformAdmin;

  if ((!membership || membership.active === false) && !isPlatformAdmin) {
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
  //
  // A visiting platform admin is exempt, matching the SQL: a lapsed or suspended
  // tenant is exactly when you need to get in and look, and the owner must not be
  // locked out of their own product by a customer's billing state. A normal member
  // of that same company still gets the 402.
  if (!isVisiting && !USABLE_SUBSCRIPTION_STATES.includes(company.subscription_status)) {
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
      // No membership row to read a role from while visiting; the owner acts as
      // admin there, same as active_role() returns in SQL.
      role: membership?.role || (isVisiting ? "admin" : undefined),
      isPlatformAdmin,
      isVisiting,
      integrations: secrets?.integrations || {},
    },
  };
}

// Company admin, or you. Use for anything that manages users or settings.
/**
 * @param {Caller} caller
 * @returns {boolean}
 */
export function isCompanyAdmin(caller) {
  return caller.role === "admin" || caller.isPlatformAdmin;
}

// The lowercased email addresses of a company's ACTIVE members. Used to fence the
// email relays (send-email / send-alert): an authenticated user may only send to
// people in their own company, never to arbitrary external addresses — otherwise the
// relay is a phishing/spam machine sending from our verified domain.
/**
 * @param {SupabaseClient} admin
 * @param {string} companyId
 * @returns {Promise<Set<string>>}
 */
export async function companyMemberEmails(admin, companyId) {
  const { data: mems } = await admin
    .from("memberships")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("active", true);
  const ids = (mems || []).map((m) => m.user_id);
  if (ids.length === 0) return new Set();
  const { data: profs } = await admin.from("profiles").select("email").in("id", ids);
  return new Set((profs || []).map((p) => (p.email || "").trim().toLowerCase()).filter(Boolean));
}

// Every handler in this directory ends its try/catch with
// `body: JSON.stringify({ error: err.message })`. That assumes the thrown value is
// an Error, which is usually true (Stripe and supabase-js both throw real Errors)
// but not guaranteed — `throw "some string"` or a rejected non-Error value would
// previously have produced `error: undefined` in the response and told the caller
// nothing. Centralized so every catch block gets the safe version for free.
/**
 * @param {unknown} err
 * @returns {string}
 */
export function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

export { USABLE_SUBSCRIPTION_STATES };
