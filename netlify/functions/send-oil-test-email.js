// netlify/functions/send-oil-test-email.js
//
// "Does the oil-change email actually reach me?" — answered on demand instead of
// waiting for a truck to come due and the 13:00 UTC cron to fire.
//
// WHAT IT DOES
//   1. Dry-runs the exact decision send-maintenance-push-notices makes for every
//      truck in the caller's company (decideNoticeAction — the same function, not
//      a copy), and records what the real job WOULD do and who it would mail.
//   2. Sends ONE email, to the caller only, containing a sample urgent notice and
//      that dry-run table.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   * Write anything. No oil_due_notices upsert, no chat_messages row, no request
//     expiry, no push. Running it cannot change what the real job does tomorrow.
//   * Email anyone but the caller. Drivers and other managers see nothing.
//
// Unlike the nightly job it SURFACES a missing RESEND_API_KEY or a Resend
// rejection as an error instead of logging and carrying on, because finding out
// exactly that is the point.
//
// Only people who hold fleet_edit (or a company admin) may call it — they are the
// people the real job emails, so a test of "what would reach me" is theirs to run.

import { Resend } from "resend";
import {
  adminClient,
  resolveCaller,
  corsHeaders,
  platformFromAddress,
} from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { checkRateLimit, rateLimitedResponse } from "./_shared/rateLimit.js";
import { loadFleetManagers, dropUser } from "./_shared/fleetRecipients.js";
import { oilStatus } from "./_shared/oilForecast.js";
import {
  decideNoticeAction,
  buildUrgentMessage,
  buildManagerMessage,
  vehicleLabel,
} from "./send-maintenance-push-notices.js";

const MAIL_FROM = platformFromAddress("alerts");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const WOULD_DO = {
  none: "nothing",
  clear_cycle: "clear stale cycle (nothing sent)",
  pause: "pause (nothing sent)",
  heads_up: "send 7-day heads-up",
  urgent: "send URGENT overdue escalation",
  stalled: "send manager-only 'stalled request' notice",
};

// Pure: why a truck that LOOKS overdue by mileage still produces no notice.
// Exported for the test. This is the gap a manager can't see from the app — the
// job projects a due date from the truck's own mileage log and goes silent when
// it can't.
export function silenceReason(vehicle, decision) {
  if (decision.action !== "none" || decision.projectedDueDate) return null;
  const status = oilStatus(vehicle);
  if (!status) return "no oil interval set";
  const log = Array.isArray(vehicle.mil) ? vehicle.mil : [];
  if (log.length < 2) {
    return status.state === "ok"
      ? "fewer than 2 mileage log entries, so no due date can be projected"
      : `${status.state} by mileage, but fewer than 2 mileage log entries, so no due date can be projected and the job stays silent`;
  }
  return status.state === "ok"
    ? "mileage log does not show the truck accruing miles, so no due date can be projected"
    : `${status.state} by mileage, but the mileage log does not show it accruing miles, so no due date can be projected and the job stays silent`;
}

const rawHandler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin || "");

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    const { accessToken } = JSON.parse(event.body || "{}");

    const admin = adminClient();
    const { caller, error: callerError } = await resolveCaller(admin, accessToken);
    if (callerError) {
      return {
        statusCode: callerError.status,
        headers,
        body: JSON.stringify({ error: callerError.message }),
      };
    }

    const rl = checkRateLimit(`send-oil-test-email:${caller.userId}`, {
      max: 3,
      windowMs: 60 * 1000,
    });
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds, headers);

    // Same people the real job emails — see fleetRecipients.js.
    const fleetManagers = await loadFleetManagers(admin, caller.companyId);
    const isManager = fleetManagers.some((m) => String(m.id) === String(caller.userId));
    if (caller.role !== "admin" && !isManager) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: "Fleet management permission required." }),
      };
    }
    if (!caller.email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Your account has no email address on file." }),
      };
    }
    if (!process.env.RESEND_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "RESEND_API_KEY is not set on this site, so no oil-change email can be sent.",
        }),
      };
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const [{ data: vehicles }, { data: notices }, { data: openReqs }] = await Promise.all([
      admin
        .from("vehicles")
        .select("*")
        .eq("company_id", caller.companyId)
        .eq("type", "truck"),
      admin.from("oil_due_notices").select("*").eq("company_id", caller.companyId),
      admin
        .from("maintenance_requests")
        .select("id, vid, type, at")
        .eq("company_id", caller.companyId)
        .in("status", ["pending", "scheduled"]),
    ]);

    const driverIds = [...new Set((vehicles || []).map((v) => v.assignedTo).filter(Boolean))];
    const driverById = new Map();
    if (driverIds.length) {
      const { data: drivers } = await admin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", driverIds);
      for (const d of drivers || []) driverById.set(d.id, d);
    }
    const noticeByVehicle = new Map((notices || []).map((n) => [n.vehicle_id, n]));

    const rows = [];
    let sampleVehicle = null;
    let sampleDecision = null;
    for (const vehicle of vehicles || []) {
      const existingNotice = noticeByVehicle.get(vehicle.id) || null;
      const cycleRequests = (openReqs || [])
        .filter(
          (r) =>
            r.vid === vehicle.id &&
            /oil change/i.test(r.type || "") &&
            (!existingNotice || String(r.at) >= String(existingNotice.cycle_started_at)),
        )
        .sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const decision = decideNoticeAction({
        vehicle,
        todayStr,
        existingNotice,
        resolvingRequestAt: cycleRequests[0]?.at || null,
      });
      const status = oilStatus(vehicle);
      const driver = vehicle.assignedTo ? driverById.get(vehicle.assignedTo) : null;
      const managers = dropUser(fleetManagers, vehicle.assignedTo);
      const recipients = [
        ...(driver?.email && ["heads_up", "urgent"].includes(decision.action)
          ? [driver.email]
          : []),
        ...(["heads_up", "urgent", "stalled"].includes(decision.action)
          ? managers.map((m) => m.email)
          : []),
      ];
      rows.push({
        name: vehicleLabel(vehicle),
        milesSince: status?.milesSince ?? null,
        state: status?.state ?? "n/a",
        projectedDueDate: decision.projectedDueDate || null,
        action: decision.action,
        wouldDo: WOULD_DO[decision.action] || decision.action,
        recipients,
        silence: silenceReason(vehicle, decision),
      });
      if (!sampleVehicle && decision.action === "urgent") {
        sampleVehicle = vehicle;
        sampleDecision = decision;
      }
    }

    // A real sample if some truck is genuinely urgent today; otherwise a clearly
    // labelled made-up one, so the email always proves delivery.
    const sampleTruck = sampleVehicle || { id: "sample", name: "Truck 000" };
    const sampleDate = sampleDecision?.projectedDueDate || todayStr;
    const sample = buildUrgentMessage(sampleTruck, sampleDate);
    const managerSample = buildManagerMessage(sampleTruck, sampleDate, {
      event: "urgent",
      driverName: "a driver",
      daysOverdue: sampleDecision?.daysOverdue || 0,
    });

    const tableRows = rows
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.milesSince ?? "—")}</td>` +
          `<td>${escapeHtml(r.state)}</td><td>${escapeHtml(r.projectedDueDate || "—")}</td>` +
          `<td>${escapeHtml(r.wouldDo)}</td><td>${escapeHtml(r.recipients.length || "0")}</td>` +
          `<td>${escapeHtml(r.silence || "")}</td></tr>`,
      )
      .join("");

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: `${caller.companyName} Alerts <${MAIL_FROM}>`,
      to: [caller.email],
      subject: `TEST — oil change email check — Steadwerk`,
      html:
        `<p><strong>This is a test.</strong> Only you received it; nothing was changed and no one else was notified.</p>` +
        `<h3>What a driver would receive${sampleVehicle ? "" : " (sample truck)"}</h3>` +
        `<p><strong>${escapeHtml(sample.title)}</strong><br>${escapeHtml(sample.body)}</p>` +
        `<h3>What a fleet manager would receive</h3>` +
        `<p><strong>${escapeHtml(managerSample.title)}</strong><br>${escapeHtml(managerSample.body)}</p>` +
        `<h3>What tomorrow's real run would do today</h3>` +
        `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:13px">` +
        `<tr><th>Truck</th><th>Miles since oil</th><th>State</th><th>Projected due</th><th>Action</th><th>People emailed</th><th>Note</th></tr>` +
        `${tableRows}</table>` +
        `<p>Fleet managers who would be emailed: ${fleetManagers.length ? escapeHtml(fleetManagers.map((m) => m.email).join(", ")) : "<strong>none — nobody holds fleet_edit with an email on file</strong>"}.</p>`,
    });
    if (error) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Resend rejected the email: ${error.message}` }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        sentTo: caller.email,
        emailId: data?.id || null,
        fleetManagerCount: fleetManagers.length,
        trucks: rows,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

export const handler = withSentry("send-oil-test-email", rawHandler);
