// netlify/functions/send-maintenance-push-notices.js
//
// Nightly job: tell a driver 7 days before their truck's oil change is
// projected due (from the truck's own mileage log — see
// _shared/oilForecast.js), then escalate to a daily URGENT notice starting
// the day it's due if nobody has filed a matching maintenance request.
//
// FOUR CHANNELS, ONE DECISION
//
// The escalation timing (decideNoticeAction below) doesn't know or care which
// channel actually reaches the driver — it just decides "heads-up" or
// "urgent" once per cycle/day. Four things happen off that one decision:
//   1. iOS push, via APNs (_shared/apns.js) — the intended long-term channel,
//      gated on apnsReady since the Apple key isn't in place yet.
//   2. An oil_due_notices row upsert with driver_id set — supabase/40 makes
//      that row readable (SELECT only) by the driver it names and puts the
//      table on the realtime publication, so useAppData.js's
//      "realtime-oil-due-notices" effect shows an immediate toast the moment
//      a row lands, same mechanism as the existing maintenance_requests toast.
//   3. An email via Resend, so a driver who doesn't open the app that day
//      still hears about it.
//   4. A chat_messages row (supabase/41) — the SAME text, but written into
//      the driver's own conversation with the Steadwerk Assistant, so it's
//      not just a toast that vanishes: it's a real, persisted message the
//      assistant "said", there on next login same as any reply it ever gave.
//      ChatWidget picks this up live via its own realtime subscription.
// Only (1) needs Apple credentials that aren't in place yet — see the
// apnsReady check: a push attempt is skipped, not the whole run, when APNs
// isn't configured. (2), (3), and (4) work today regardless.
//
// Same shape as daily-archive.js otherwise: the cron invokes this, not a
// person, so there is no access token or company to resolve — adminClient()
// bypasses RLS entirely, which makes every .eq("company_id", ...) below
// load-bearing, not decorative (see the warning at
// supabase/02_tenancy_tables.sql:405).
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both via adminClient),
// RESEND_API_KEY (email — already required elsewhere, e.g. send-alert.js),
// plus APNS_KEY / APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID (see
// _shared/apns.js) and optionally APNS_PRODUCTION for push once that's ready.

import { Resend } from "resend";
import { adminClient, platformFromAddress } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { parseDay, projectedOilDueDate } from "./_shared/oilForecast.js";
import { sendPush, isDeadTokenResponse } from "./_shared/apns.js";

const MAIL_FROM = platformFromAddress("alerts");

const DAY_MS = 86400000;
const HEADS_UP_WINDOW_DAYS = 7;

// True when `isoTimestamp` falls on the same UTC calendar day as `todayStr`
// ("YYYY-MM-DD"). Used to cap the urgent escalation at one send per day.
export function isSameUtcDay(isoTimestamp, todayStr) {
  if (!isoTimestamp) return false;
  return String(isoTimestamp).slice(0, 10) === todayStr;
}

// The pure decision for one vehicle on one day — no I/O, so this is what the
// unit tests exercise directly. `existingNotice` is the current
// oil_due_notices row for this vehicle (or null); `hasResolvingRequest` is
// whether a pending/scheduled Oil Change request already covers the CURRENT
// cycle (the caller is responsible for that "current cycle" filtering, since
// it needs the maintenance_requests table).
//
// Returns { action, projectedDueDate }, action one of:
//   "none"        - nothing to do today
//   "clear_cycle" - the stored cycle is stale (oil was actually changed, or
//                   this vehicle no longer projects a due date at all) and
//                   the tracking row should be deleted
//   "resolve"     - a qualifying request showed up; mark the row resolved,
//                   no push
//   "heads_up"    - send the 7-day heads-up, upsert the tracking row
//   "urgent"      - send today's urgent escalation, upsert the tracking row
export function decideNoticeAction({ vehicle, todayStr, existingNotice, hasResolvingRequest }) {
  const cycleLomi = Number(vehicle.lomi) || 0;
  // A stored cycle whose baseline lomi no longer matches the vehicle's current
  // lomi means the oil was actually changed since that cycle opened — it's
  // over, regardless of what the rest of this function would otherwise do.
  const staleCycle = !!existingNotice && Number(existingNotice.cycle_lomi) !== cycleLomi;
  const notice = staleCycle ? null : existingNotice;

  const projectedDueDate = projectedOilDueDate(vehicle, { today: parseDay(todayStr) });

  if (!projectedDueDate) {
    return { action: staleCycle ? "clear_cycle" : "none", projectedDueDate: null };
  }

  const daysOut = Math.round((parseDay(projectedDueDate) - parseDay(todayStr)) / DAY_MS);

  // Due date reached or passed.
  if (daysOut <= 0) {
    if (hasResolvingRequest) {
      if (notice && !notice.resolved_at) return { action: "resolve", projectedDueDate };
      return { action: staleCycle ? "clear_cycle" : "none", projectedDueDate };
    }
    if (notice?.resolved_at) return { action: "none", projectedDueDate }; // already resolved this cycle
    if (isSameUtcDay(notice?.urgent_last_sent_at, todayStr)) {
      return { action: "none", projectedDueDate };
    }
    return { action: "urgent", projectedDueDate };
  }

  // Within the heads-up window and not sent yet for this cycle. <= rather than
  // === so a job that missed a day (deploy hiccup, cold start failure) still
  // catches it on the next run instead of jumping straight to "urgent" with no
  // warning at all — the heads_up_sent_at guard still caps it at one send.
  if (daysOut <= HEADS_UP_WINDOW_DAYS && !notice?.heads_up_sent_at) {
    return { action: "heads_up", projectedDueDate };
  }

  return { action: staleCycle ? "clear_cycle" : "none", projectedDueDate };
}

// Also what gets written to oil_due_notices.vehicle_name (see supabase/40) —
// one fallback chain, not one per call site.
export function vehicleLabel(vehicle) {
  return vehicle.name || vehicle.plate || vehicle.id;
}

export function buildHeadsUpMessage(vehicle, dueDate) {
  const name = vehicleLabel(vehicle);
  return {
    title: "Oil change coming up",
    body: `${name}'s oil change is projected due around ${dueDate}. Request maintenance when you get a chance.`,
    data: { type: "oil_due", vehicleId: vehicle.id },
  };
}

export function buildUrgentMessage(vehicle, dueDate) {
  const name = vehicleLabel(vehicle);
  return {
    title: "URGENT: oil change overdue",
    body: `${name}'s oil change was due ${dueDate} and no maintenance request has been filed yet.`,
    data: { type: "oil_due_urgent", vehicleId: vehicle.id },
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Pushes to every device registered for `driverId`, pruning tokens APNs
// reports as dead along the way. Returns true if at least one push actually
// went out (a driver with zero registered devices, or every send failing,
// still updates the tracking row — this is at-least-once notification intent
// against a device, not a delivery guarantee). A no-op, not an error, when
// APNs isn't configured yet — the in-app/email channels below still fire.
async function pushToDriver(admin, driverId, message, vehicleLabel, apnsReady) {
  if (!apnsReady) return false;

  const { data: tokens, error } = await admin
    .from("device_push_tokens")
    .select("token")
    .eq("user_id", driverId);
  if (error) {
    console.error(
      `send-maintenance-push-notices: token lookup failed for ${vehicleLabel}:`,
      error.message,
    );
    return false;
  }
  if (!tokens || tokens.length === 0) return false;

  let anySent = false;
  const deadTokens = [];
  for (const { token } of tokens) {
    try {
      const result = await sendPush(token, message);
      if (result.ok) {
        anySent = true;
      } else if (isDeadTokenResponse(result)) {
        deadTokens.push(token);
      } else {
        console.error(
          `send-maintenance-push-notices: APNs rejected a token for ${vehicleLabel}: ${result.statusCode} ${result.reason || ""}`,
        );
      }
    } catch (err) {
      console.error(
        `send-maintenance-push-notices: APNs send failed for ${vehicleLabel}:`,
        err.message,
      );
    }
  }
  if (deadTokens.length) {
    await admin.from("device_push_tokens").delete().in("token", deadTokens);
  }
  return anySent;
}

// Best-effort email to the driver — a missing RESEND_API_KEY or a Resend
// failure logs and returns rather than throwing, so it never takes the push
// attempt or the DB upsert (which is what drives the in-app banner) down
// with it.
async function emailDriver(driver, companyName, message, vehicleLabel) {
  if (!driver?.email) return;
  if (!process.env.RESEND_API_KEY) {
    console.warn("send-maintenance-push-notices: RESEND_API_KEY not set — skipping driver email.");
    return;
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: `${companyName} Alerts <${MAIL_FROM}>`,
      to: driver.email,
      subject: `${message.title} — Steadwerk`,
      html: `<p>${escapeHtml(message.body)}</p><p>Open the app to file the maintenance request.</p>`,
    });
  } catch (err) {
    console.error(`send-maintenance-push-notices: email failed for ${vehicleLabel}:`, err.message);
  }
}

// Writes the reminder into the driver's own conversation with the Steadwerk
// Assistant (supabase/41) — origin_session_id is left null on purpose, which
// is what tells ChatWidget's realtime subscription this row did NOT come from
// a tab it needs to skip as its own echo (see that migration's "WHY
// origin_session_id"). Best-effort like the other two channels: a failure
// here still leaves the push/email/oil_due_notices row intact.
async function writeAssistantChatMessage(admin, companyId, driverId, text, vehicleLabel) {
  const { error } = await admin.from("chat_messages").insert({
    company_id: companyId,
    user_id: driverId,
    role: "assistant",
    text,
    proactive: true,
  });
  if (error) {
    console.error(
      `send-maintenance-push-notices: chat message failed for ${vehicleLabel}:`,
      error.message,
    );
  }
}

const rawHandler = async () => {
  // Gates the APNs push ATTEMPT only (pushToDriver no-ops without this) — not
  // the whole run. The in-app banner (oil_due_notices + realtime, see
  // supabase/40) and the email below need no Apple credentials at all.
  const apnsReady = ["APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID"].every(
    (k) => !!process.env[k],
  );
  if (!apnsReady) {
    console.warn(
      "send-maintenance-push-notices: APNs env vars are not fully set — skipping the push " +
        "attempt this run (in-app banner and email still go out normally).",
    );
  }

  const admin = adminClient();
  const todayStr = new Date().toISOString().split("T")[0];

  const { data: companies, error: companiesError } = await admin
    .from("companies")
    .select("id, name");
  if (companiesError) {
    console.error(
      "send-maintenance-push-notices: failed to load companies:",
      companiesError.message,
    );
    return { statusCode: 500, body: JSON.stringify({ error: companiesError.message }) };
  }

  let headsUpSent = 0;
  let urgentSent = 0;
  let resolved = 0;

  for (const company of companies || []) {
    const [
      { data: vehicles, error: vehError },
      { data: notices, error: noticeError },
      { data: openReqs, error: reqError },
    ] = await Promise.all([
      admin.from("vehicles").select("*").eq("company_id", company.id).eq("type", "truck"),
      admin.from("oil_due_notices").select("*").eq("company_id", company.id),
      admin
        .from("maintenance_requests")
        .select("vid, type, at")
        .eq("company_id", company.id)
        .in("status", ["pending", "scheduled"]),
    ]);

    if (vehError || noticeError || reqError) {
      console.error(
        `send-maintenance-push-notices: company ${company.id} read failed:`,
        (vehError || noticeError || reqError).message,
      );
      continue;
    }

    const noticeByVehicle = new Map((notices || []).map((n) => [n.vehicle_id, n]));
    const upserts = [];
    const staleVehicleIds = [];

    // One profiles lookup per company rather than per vehicle — email needs
    // the driver's address, and it's cheap to fetch every assigned driver up
    // front even for vehicles that turn out to need no action today.
    const driverIds = [...new Set((vehicles || []).map((v) => v.assignedTo).filter(Boolean))];
    const driverById = new Map();
    if (driverIds.length) {
      const { data: drivers, error: driversError } = await admin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", driverIds);
      if (driversError) {
        console.error(
          `send-maintenance-push-notices: driver lookup failed for company ${company.id}:`,
          driversError.message,
        );
      } else {
        for (const d of drivers || []) driverById.set(d.id, d);
      }
    }

    for (const vehicle of vehicles || []) {
      const driverId = vehicle.assignedTo;
      if (!driverId) continue;

      const existingNotice = noticeByVehicle.get(vehicle.id) || null;
      // A request "resolves" this cycle if it's an open Oil Change request
      // filed since the cycle started — filing checkboxes read "Routine Oil
      // Change, ..." (comma-joined), not the bare "Oil Change" the completion
      // dropdown uses, hence the substring match rather than an exact one.
      // See MaintenanceRequestsView.jsx vs CompleteServiceModal.jsx.
      const hasResolvingRequest = (openReqs || []).some(
        (r) =>
          r.vid === vehicle.id &&
          /oil change/i.test(r.type || "") &&
          (!existingNotice || String(r.at) >= String(existingNotice.cycle_started_at)),
      );

      const decision = decideNoticeAction({
        vehicle,
        todayStr,
        existingNotice,
        hasResolvingRequest,
      });
      const nowIso = new Date().toISOString();
      // NOT named vehicleLabel — that name is the exported fallback-chain
      // function below (vehicle.name || vehicle.plate || vehicle.id), used a
      // few lines down for vehicle_name. This is only ever a log/error string.
      const vehicleLogLabel = `vehicle ${vehicle.id} (company ${company.id})`;

      if (decision.action === "clear_cycle") {
        staleVehicleIds.push(vehicle.id);
        continue;
      }
      if (decision.action === "resolve") {
        upserts.push({
          company_id: company.id,
          vehicle_id: vehicle.id,
          driver_id: driverId,
          vehicle_name: vehicleLabel(vehicle),
          cycle_lomi: Number(vehicle.lomi) || 0,
          cycle_started_at: existingNotice.cycle_started_at,
          projected_due_date: decision.projectedDueDate,
          heads_up_sent_at: existingNotice.heads_up_sent_at,
          urgent_last_sent_at: existingNotice.urgent_last_sent_at,
          resolved_at: nowIso,
          updated_at: nowIso,
        });
        resolved++;
        continue;
      }
      if (decision.action === "heads_up") {
        const message = buildHeadsUpMessage(vehicle, decision.projectedDueDate);
        await Promise.all([
          pushToDriver(admin, driverId, message, vehicleLogLabel, apnsReady),
          emailDriver(driverById.get(driverId), company.name, message, vehicleLogLabel),
          writeAssistantChatMessage(admin, company.id, driverId, message.body, vehicleLogLabel),
        ]);
        headsUpSent++;
        upserts.push({
          company_id: company.id,
          vehicle_id: vehicle.id,
          driver_id: driverId,
          vehicle_name: vehicleLabel(vehicle),
          cycle_lomi: Number(vehicle.lomi) || 0,
          cycle_started_at: existingNotice?.cycle_started_at || nowIso,
          projected_due_date: decision.projectedDueDate,
          heads_up_sent_at: nowIso,
          urgent_last_sent_at: existingNotice?.urgent_last_sent_at || null,
          resolved_at: null,
          updated_at: nowIso,
        });
        continue;
      }
      if (decision.action === "urgent") {
        const message = buildUrgentMessage(vehicle, decision.projectedDueDate);
        await Promise.all([
          pushToDriver(admin, driverId, message, vehicleLogLabel, apnsReady),
          emailDriver(driverById.get(driverId), company.name, message, vehicleLogLabel),
          writeAssistantChatMessage(admin, company.id, driverId, message.body, vehicleLogLabel),
        ]);
        urgentSent++;
        upserts.push({
          company_id: company.id,
          vehicle_id: vehicle.id,
          driver_id: driverId,
          vehicle_name: vehicleLabel(vehicle),
          cycle_lomi: Number(vehicle.lomi) || 0,
          cycle_started_at: existingNotice?.cycle_started_at || nowIso,
          projected_due_date: decision.projectedDueDate,
          heads_up_sent_at: existingNotice?.heads_up_sent_at || null,
          urgent_last_sent_at: nowIso,
          resolved_at: null,
          updated_at: nowIso,
        });
      }
      // "none" — nothing to write.
    }

    if (upserts.length) {
      const { error: upsertError } = await admin
        .from("oil_due_notices")
        .upsert(upserts, { onConflict: "company_id,vehicle_id" });
      if (upsertError) {
        console.error(
          `send-maintenance-push-notices: upsert failed for company ${company.id}:`,
          upsertError.message,
        );
      }
    }
    if (staleVehicleIds.length) {
      const { error: deleteError } = await admin
        .from("oil_due_notices")
        .delete()
        .eq("company_id", company.id)
        .in("vehicle_id", staleVehicleIds);
      if (deleteError) {
        console.error(
          `send-maintenance-push-notices: cleanup failed for company ${company.id}:`,
          deleteError.message,
        );
      }
    }
  }

  console.log(
    `send-maintenance-push-notices: heads-up ${headsUpSent}, urgent ${urgentSent}, resolved ${resolved}.`,
  );
  return { statusCode: 200, body: JSON.stringify({ ok: true, headsUpSent, urgentSent, resolved }) };
};

export const handler = withSentry("send-maintenance-push-notices", rawHandler);

// 13:00 UTC ≈ 8am Central / 9am Eastern — one fixed run for every company
// regardless of their local timezone, same limitation daily-archive.js
// already accepts. Adjust here if the fleet's timezone calls for a different
// hour.
export const config = {
  schedule: "0 13 * * *",
};
