// scripts/magic-link.mjs
//
// Mints a one-time sign-in link for an existing user, for support and debugging.
// Prints it to your terminal. It does NOT email anyone.
//
// Run:
//   SUPABASE_SERVICE_ROLE_KEY=$(npx netlify-cli env:get SUPABASE_SERVICE_ROLE_KEY) \
//     node scripts/magic-link.mjs sam@maumeeriverroofing.com
//
//   ...optionally with a redirect target (defaults to production):
//     node scripts/magic-link.mjs sam@maumeeriverroofing.com http://localhost:8888
//
// ── WHAT THIS DOES TO THE TARGET ACCOUNT ─────────────────────────────────────
//
// Nothing. That is the reason to prefer it over the alternatives:
//
//   • No email is sent. generateLink RETURNS the link rather than delivering it,
//     which is why it exists (Supabase's own flow for custom mail providers).
//     create-user.js uses the same call and hands the link to Resend itself.
//   • Their password is unchanged. The reset-password path would change it and
//     lock the person out mid-shift, turning a support question into an outage.
//   • Their existing sessions stay valid. They are not signed out.
//
// ── WHAT IT DOES TO YOU ──────────────────────────────────────────────────────
//
// It signs you in AS them. Two consequences worth holding onto:
//
//   1. OPEN IT IN A PRIVATE WINDOW. Supabase auth persists to localStorage per
//      origin, so clicking this in your normal browser replaces your own session
//      with theirs. A private window keeps the two apart and lets you close the
//      impersonated one cleanly.
//
//   2. EVERY ACTION IS ATTRIBUTED TO THEM. logAction() in src/utils/logger.js
//      stamps audit_logs with the acting user's id and email, and it cannot tell
//      the difference. Anything you click lands in the record under their name,
//      including in the audit trail you would later rely on to reconstruct what
//      actually happened. Prefer to look, not touch.
//
// If you only need to SEE a tenant's data rather than be a specific person,
// there is a cleaner route that involves no impersonation at all: give your own
// account a membership in that company and use CompanySwitcher. is_platform_admin
// is ORed into every RLS policy, but active_company_id() joins through
// memberships, so the membership row is what actually lets you switch in.
//
// Links are single-use and expire (1 hour by default, per your Supabase auth
// settings). Generate a fresh one rather than saving this anywhere.

import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// Same .env parsing as the verify-* scripts: the URL and anon key are public and
// live in the file, while the service-role key is passed in the environment so it
// never lands on disk.
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const URL = env.VITE_SUPABASE_URL;
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").match(/eyJ[A-Za-z0-9._-]+/)?.[0];

const email = (process.argv[2] || "").trim().toLowerCase();
// Must be an origin the app is actually served from, or the link lands nowhere
// useful. Mirrors ALLOWED_ORIGINS in netlify/functions/_shared/tenant.js.
const redirectTo = (process.argv[3] || "https://steadwerk.com").trim();

if (!URL)     { console.error("Missing VITE_SUPABASE_URL in .env"); process.exit(2); }
if (!SERVICE) { console.error("Missing SUPABASE_SERVICE_ROLE_KEY in the environment"); process.exit(2); }
if (!email)   { console.error("Usage: node scripts/magic-link.mjs <email> [redirectTo]"); process.exit(2); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

// Confirm the account exists and show whose session you are about to assume.
// generateLink for a non-existent address fails in a way that reads like a
// config problem, and it is worth seeing the name before you click anything.
const { data: profile } = await admin
  .from("profiles")
  .select("id, email, full_name, name, active, active_company_id, is_platform_admin")
  .eq("email", email)
  .maybeSingle();

if (!profile) {
  console.error(`No profile with email "${email}". Check the address.`);
  process.exit(1);
}

let companyName = "(none)";
if (profile.active_company_id) {
  const { data: co } = await admin
    .from("companies")
    .select("name")
    .eq("id", profile.active_company_id)
    .maybeSingle();
  companyName = co?.name || "(unknown)";
}

const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo },
});

if (error) {
  console.error(`Could not generate a link: ${error.message}`);
  process.exit(1);
}

const link = data?.properties?.action_link;
if (!link) {
  console.error("Supabase returned no action_link. Check that magic links are enabled in Auth settings.");
  process.exit(1);
}

console.log(`
You are about to sign in as:

  ${profile.full_name || profile.name || "(no name)"}  <${profile.email}>
  company         ${companyName}
  active          ${profile.active}
  platform admin  ${profile.is_platform_admin}

Open this in a PRIVATE window. Single use, and it expires.

${link}

Their password is unchanged, no email was sent, and their own session is still
valid. Anything you do from here is recorded in audit_logs as them.
`);
