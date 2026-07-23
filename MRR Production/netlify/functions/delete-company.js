// netlify/functions/delete-company.js
//
// Platform-owner-only: PERMANENTLY deletes a company and everything attached to it.
// This is the hard-delete the owner console offers next to Suspend/Reactivate. It is
// deliberately irreversible, so it is fenced on every side:
//
//   • Caller must be a platform admin (resolveCaller → isPlatformAdmin).
//   • The company must already be 'suspended' — a two-step gesture so a live, paying
//     company can never be nuked in one accidental click. The UI only shows Delete on
//     suspended rows; this re-checks it server-side.
//   • The typed company name must match exactly (confirmName), echoing the UI's
//     type-to-confirm box so an autoclick can't go through.
//   • You cannot delete the company you are currently signed into.
//
// ORDER MATTERS. company_secrets holds the ONLY pointer to the Stripe subscription, and
// most tables cascade-delete off companies — so anything that needs those rows (Stripe
// cancel, member list, storage paths) has to happen BEFORE the company row is deleted.
//
// What cascades vs. what we clean up by hand:
//   • ON DELETE CASCADE (removed automatically by the final delete): every tenant table
//     — jobs, inventory, vehicles, memberships, settings, audit_logs, company_secrets…
//     (supabase/01,02,04).
//   • NOT cascading — handled here first:
//       - profiles.active_company_id has no delete rule (supabase/01_tenancy_core.sql),
//         so a profile still pointing at this company would block the delete with an FK
//         violation. We null those pointers first (the service-role client is exempt
//         from the guard_profiles_privileged trigger, which only fences authenticated/
//         anon — see supabase/04_security_fixes.sql).
//       - Stripe subscription/customer live at Stripe, not in our DB.
//       - Storage objects live in the buckets, keyed by <company_id>/ path.
//       - Orphaned logins: a member left with NO other membership gets their account
//         deleted, mirroring delete-user.js. A member who still works elsewhere keeps
//         their login untouched.
//
// Best-effort external cleanup (Stripe, storage, orphan accounts) never blocks the core
// delete: failures there are collected into `warnings` and returned, because a company
// the owner asked to delete must actually get deleted.

import Stripe from "stripe";
import { adminClient, resolveCaller, corsHeaders } from "./_shared/tenant.js";

// The five tenant-scoped buckets. Uploads write to <company_id>/<file> (supabase/05).
const BUCKETS = [
  "vehicle-photos",
  "inventory-photos",
  "job-attachments",
  "vehicle-attachments",
  "inventory-attachments",
];

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

  const { accessToken, companyId, confirmName } = body;
  if (!companyId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing companyId" }) };
  }

  const admin = adminClient();

  // ── 1. Auth: platform owner only ──────────────────────────────────────────
  const { caller, error: callerError } = await resolveCaller(admin, accessToken);
  if (callerError) {
    return { statusCode: callerError.status, headers, body: JSON.stringify({ error: callerError.message }) };
  }
  if (!caller.isPlatformAdmin) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Platform admin access required" }) };
  }

  // ── 2. Load the target + enforce the guardrails ───────────────────────────
  const { data: company, error: coErr } = await admin
    .from("companies")
    .select("id, name, subscription_status")
    .eq("id", companyId)
    .single();
  if (coErr || !company) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "No such company" }) };
  }

  if (company.id === caller.companyId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "You can't delete the company you're signed into." }) };
  }
  if (company.subscription_status !== "suspended") {
    return { statusCode: 409, headers, body: JSON.stringify({ error: "Suspend the company first, then delete it." }) };
  }
  if ((confirmName || "").trim() !== company.name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "The typed name doesn't match the company name." }) };
  }

  const warnings = [];

  try {
    // Snapshot the members BEFORE the delete cascades their membership rows away —
    // we need this list afterward to spot logins that are now orphaned.
    const { data: members } = await admin
      .from("memberships")
      .select("user_id")
      .eq("company_id", companyId);
    const memberIds = [...new Set((members || []).map((m) => m.user_id))];

    // ── 3. Cancel Stripe (best-effort). Must precede the delete: company_secrets,
    //       which holds these ids, cascades away with the company. ──────────────
    const { data: secrets } = await admin
      .from("company_secrets")
      .select("stripe_subscription_id, stripe_customer_id")
      .eq("company_id", companyId)
      .maybeSingle();

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (secretKey && (secrets?.stripe_subscription_id || secrets?.stripe_customer_id)) {
      const stripe = new Stripe(secretKey);
      if (secrets.stripe_subscription_id) {
        try {
          await stripe.subscriptions.cancel(secrets.stripe_subscription_id);
        } catch (e) {
          // Already canceled/expired subs throw resource_missing — that's the desired
          // end state, so only surface anything else.
          if (e?.code !== "resource_missing") warnings.push(`Stripe subscription not cancelled: ${e.message}`);
        }
      }
      if (secrets.stripe_customer_id) {
        try {
          await stripe.customers.del(secrets.stripe_customer_id);
        } catch (e) {
          if (e?.code !== "resource_missing") warnings.push(`Stripe customer not removed: ${e.message}`);
        }
      }
    }

    // ── 4. Purge storage (best-effort). Files are flat at <company_id>/<file>. ──
    for (const bucket of BUCKETS) {
      try {
        const { data: files, error: listErr } = await admin.storage.from(bucket).list(companyId, { limit: 1000 });
        if (listErr) throw listErr;
        if (files && files.length) {
          await admin.storage.from(bucket).remove(files.map((f) => `${companyId}/${f.name}`));
        }
      } catch (e) {
        warnings.push(`Storage '${bucket}' not fully purged: ${e.message}`);
      }
    }

    // ── 5. Clear the one FK that does NOT cascade, or the delete below fails. ───
    // Anyone still pointed here is nulled; they re-resolve a company from their
    // memberships on next login (LoginScreen). The service-role client is exempt
    // from the active_company_id guard trigger.
    const { error: repointErr } = await admin
      .from("profiles")
      .update({ active_company_id: null })
      .eq("active_company_id", companyId);
    if (repointErr) throw new Error(`Could not release active-company pointers: ${repointErr.message}`);

    // ── 6. The delete. One statement removes the company and cascades every
    //       tenant row (memberships, jobs, inventory, secrets, audit_logs, …). ──
    const { error: delErr } = await admin.from("companies").delete().eq("id", companyId);
    if (delErr) throw new Error(`Delete failed: ${delErr.message}`);

    // ── 7. Reap now-orphaned accounts (mirrors delete-user.js). A member who still
    //       has a membership somewhere keeps their login; a member with none left
    //       had this company as their only tie, so the account itself goes. ──────
    let accountsDeleted = 0;
    for (const uid of memberIds) {
      try {
        const { data: still } = await admin
          .from("memberships")
          .select("company_id")
          .eq("user_id", uid)
          .limit(1);
        if (still && still.length > 0) continue; // employed elsewhere — leave them be

        await admin.from("profiles").delete().eq("id", uid);
        const { error: authErr } = await admin.auth.admin.deleteUser(uid);
        if (authErr) warnings.push(`Login for a former member not removed: ${authErr.message}`);
        else accountsDeleted += 1;
      } catch (e) {
        warnings.push(`Orphan-account cleanup skipped a user: ${e.message}`);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, deleted: company.name, accountsDeleted, warnings }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message, warnings }) };
  }
};
