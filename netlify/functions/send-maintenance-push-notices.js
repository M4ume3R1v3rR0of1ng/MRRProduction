// netlify/functions/send-maintenance-push-notices.js
//
// Nightly job: tell a driver 7 days before their truck's oil change is
// projected due (from the truck's own mileage log — see
// _shared/oilForecast.js), then escalate daily once it is due until the oil
// change is actually recorded.
//
// A FILED REQUEST PAUSES THE ESCALATION. IT DOES NOT END IT.
//
// Filing an oil-change maintenance request used to set resolved_at and silence
// the cycle for good, which treated a statement of intent as a completed
// service. The real world does not cooperate: drivers file late, managers
// forget to approve, shops reschedule, and the truck keeps moving the whole
// time. The ladder now is:
//
//   days 1-3 after filing   silent. Somebody is plausibly on it
//                           (REQUEST_GRACE_DAYS).
//   day 4 onward, daily     "stalled" — manager only. The driver did the one
//                           thing asked of them; the hold-up is not theirs.
//   day 14                  the request is auto-closed as `expired`
//                           (REQUEST_EXPIRY_DAYS, supabase/53), and from the
//                           next run the full driver+manager escalation
//                           resumes, because nothing is open on the truck.
//   any day                 a RECORDED oil change (vehicles.lomi moves) ends
//                           the cycle. That, and only that.
//
// TWO AUDIENCES, NOT ONE
//
// The driver gets both notices because they are the one standing next to the
// truck. The FLEET MANAGER gets both too — everyone holding `fleet_edit`, see
// _shared/fleetRecipients.js for why that permission and not a role name —
// because a driver alert that goes unread is a truck that quietly runs past
// its oil change, and the person answerable for that never hears about it.
// The urgent one is written as an escalation when it reaches them: by that
// day the projection has passed, nobody has filed a request, and the
// manager's copy says plainly how many days overdue it now is.
//
// This also fixes a silent gap: an UNASSIGNED truck used to be skipped
// outright (`if (!driverId) continue`), so a truck sitting between drivers
// accrued miles past its oil change and generated no notice of any kind. It
// is now processed on the manager channel alone — which is the right
// escalation anyway, since there is no driver to act on it.
//
// FOUR CHANNELS, ONE DECISION
//
// The escalation timing (decideNoticeAction below) doesn't know or care which
// channel actually reaches anyone — it just decides "heads-up" or "urgent"
// once per cycle/day. Four things happen off that one decision:
//   1. iOS push, via APNs (_shared/apns.js) — the intended long-term channel,
//      gated on apnsReady since the Apple key isn't in place yet.
//   2. An oil_due_notices row upsert with driver_id set — supabase/40 makes
//      that row readable (SELECT only) by the driver it names and puts the
//      table on the realtime publication, so useAppData.js's
//      "realtime-oil-due-notices" effect shows an immediate toast the moment
//      a row lands, same mechanism as the existing maintenance_requests toast.
//   3. An email via Resend, so someone who doesn't open the app that day
//      still hears about it. This is the channel the fleet manager is reached
//      on, and the only one of the four that needs no setup at all.
//   4. A chat_messages row (supabase/41) — the SAME text, but written into
//      the recipient's own conversation with the Steadwerk Assistant, so it's
//      not just a toast that vanishes: it's a real, persisted message the
//      assistant "said", there on next login same as any reply it ever gave.
//      ChatWidget picks this up live via its own realtime subscription.
// Only (1) needs Apple credentials that aren't in place yet — see the
// apnsReady check: a push attempt is skipped, not the whole run, when APNs
// isn't configured. (2), (3), and (4) work today regardless.
//
// ⚠️ (2) IS DRIVER-ONLY, AND THAT IS A SCHEMA LIMIT, NOT A CHOICE.
//    oil_due_notices carries exactly one driver_id and supabase/40's policy
//    reads `driver_id = auth.uid()`, so the in-app realtime toast can only
//    ever reach the one person the row names. Managers are covered by (3) and
//    (4) instead — the chat message persists, which is the part that matters.
//    Giving managers the toast too means another migration (a second policy
//    resolving fleet_edit inside RLS, or a notice-recipients table); worth
//    doing if the toast turns out to be the channel people actually read.
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
import { loadFleetManagers, dropUser } from "./_shared/fleetRecipients.js";

const MAIL_FROM = platformFromAddress("alerts");

const DAY_MS = 86400000;
const HEADS_UP_WINDOW_DAYS = 7;

// How long an open oil-change request buys. Three days covers a driver getting
// to the shop, a manager approving the request, and the shop actually doing the
// work — and is short enough that a request nobody is working on stops passing
// for progress. Days 1-3 are silent; a request still open on day 4 stalls.
export const REQUEST_GRACE_DAYS = 3;

// When an open request stops counting as a request at all. At two weeks the
// thing is not pending, it is abandoned, and leaving it open means it keeps
// suppressing the DRIVER's half of the escalation for a truck that has been
// running past its interval for a fortnight. Auto-closing it as `expired`
// (supabase/53) hands the truck back to the normal overdue escalation and keeps
// the maintenance board free of tickets nobody will ever action.
export const REQUEST_EXPIRY_DAYS = 14;

// True when `isoTimestamp` falls on the same UTC calendar day as `todayStr`
// ("YYYY-MM-DD"). Used to cap each escalation at one send per day.
export function isSameUtcDay(isoTimestamp, todayStr) {
  if (!isoTimestamp) return false;
  return String(isoTimestamp).slice(0, 10) === todayStr;
}

// Whole calendar days from `fromDay` to `todayStr`, floored at 0. Both ends are
// parsed in one UTC frame (see oilForecast.parseDay), so this counts days and
// is not an hours-apart division a daylight saving change can tip onto the
// wrong side of a rounding boundary. `fromDay` may be a full timestamp — a
// request's `at` is a timestamptz — and only its calendar day is used: a
// request filed at 11pm is one day old the next morning, not 0.42.
export function wholeDaysSince(fromDay, todayStr) {
  const from = parseDay(fromDay);
  const today = parseDay(todayStr);
  if (!from || !today) return 0;
  return Math.max(0, Math.round((today - from) / DAY_MS));
}

// The pure decision for one vehicle on one day — no I/O, so this is what the
// unit tests exercise directly. `existingNotice` is the current
// oil_due_notices row for this vehicle (or null); `resolvingRequestAt` is the
// filing timestamp of the OLDEST open (pending/scheduled) oil-change request
// covering the current cycle, or null if there is none — the caller does that
// filtering, since it needs the maintenance_requests table.
//
// Oldest rather than newest on purpose: the grace window is measured from when
// somebody first raised this, so filing a second request for the same truck
// cannot buy another three days of silence.
//
// Returns { action, projectedDueDate, daysOverdue, daysRequestOpen }, action
// one of:
//   "none"        - nothing to do today
//   "clear_cycle" - the stored cycle is stale (oil was actually changed, or
//                   this vehicle no longer projects a due date at all) and
//                   the tracking row should be deleted
//   "pause"       - a qualifying request showed up; stamp the row as paused,
//                   notify nobody
//   "heads_up"    - send the 7-day heads-up, upsert the tracking row
//   "urgent"      - send today's overdue escalation to driver AND manager
//   "stalled"     - an open request has outlived the grace window: today's
//                   manager-only escalation. The caller also expires the
//                   request once daysRequestOpen reaches REQUEST_EXPIRY_DAYS.
//
// WHAT A PAUSE IS NOT
//
// `paused_at` being set does NOT suppress "urgent". That was the bug (see
// supabase/53): a request filed and then closed, cancelled, or auto-expired
// without the oil ever being changed left the truck permanently silent. The
// only thing that ends a cycle is a recorded oil change, which arrives here as
// staleCycle below.
export function decideNoticeAction({ vehicle, todayStr, existingNotice, resolvingRequestAt }) {
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
    const daysOverdue = -daysOut;

    if (resolvingRequestAt) {
      const daysRequestOpen = wholeDaysSince(resolvingRequestAt, todayStr);

      // Inside the grace window: somebody is plausibly on it. Stamp the pause
      // the first time so the row records WHY this cycle went quiet, then say
      // nothing for the rest of the window.
      if (daysRequestOpen < REQUEST_GRACE_DAYS) {
        if (notice && !notice.paused_at) {
          return { action: "pause", projectedDueDate, daysOverdue, daysRequestOpen };
        }
        return {
          action: staleCycle ? "clear_cycle" : "none",
          projectedDueDate,
          daysOverdue,
          daysRequestOpen,
        };
      }

      // The window has lapsed and the request is still open. The driver already
      // did what was asked of them, so this goes to the manager alone — capped
      // at one a day by its own timestamp, which is deliberately not the one
      // that caps "urgent".
      if (isSameUtcDay(notice?.stall_last_sent_at, todayStr)) {
        return { action: "none", projectedDueDate, daysOverdue, daysRequestOpen };
      }
      return { action: "stalled", projectedDueDate, daysOverdue, daysRequestOpen };
    }

    // No open request — including the case where one was just expired, or was
    // closed by hand without the oil being changed. Full escalation, both
    // audiences. Note paused_at is NOT consulted: see "WHAT A PAUSE IS NOT".
    if (isSameUtcDay(notice?.urgent_last_sent_at, todayStr)) {
      return { action: "none", projectedDueDate, daysOverdue };
    }
    return { action: "urgent", projectedDueDate, daysOverdue };
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

// The manager's wording, for both events.
//
// WHY NOT JUST FORWARD THE DRIVER'S COPY
//
// It is addressed to the wrong person and asks for the wrong thing. "Request
// maintenance when you get a chance" is advice to the driver; the manager needs
// to know WHICH truck, WHOSE it is, and — once it is overdue — how long it has
// been and that nobody has filed anything. A forwarded driver notice reads like
// a cc and gets filtered like one.
//
// `event` is "heads_up", "urgent" or "stalled" — the same three the decision
// produces. `daysOverdue` is derived from the projected date rather than
// counted from the first notice, so it stays right even if the job missed days.
export function buildManagerMessage(
  vehicle,
  dueDate,
  { event = "heads_up", driverName, daysOverdue = 0, daysRequestOpen = 0, expired = false } = {},
) {
  const name = vehicleLabel(vehicle);
  const whose = driverName ? `assigned to ${driverName}` : "with no driver assigned";
  // Day 0 is the due date itself, so "0 days overdue" would be wrong on the
  // first escalation — the truck is due TODAY and unactioned, which is already
  // the thing worth saying.
  const pastDue =
    daysOverdue > 0 ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} past due` : "due today";

  if (event === "heads_up") {
    return {
      title: `Oil change due soon: ${name}`,
      body: `${name} (${whose}) is projected due for an oil change around ${dueDate}. The driver has been notified.`,
      data: { type: "oil_due_manager", vehicleId: vehicle.id },
    };
  }

  if (event === "stalled") {
    // A request exists, so this is not "nobody knows" — it is "somebody raised
    // it and it has not moved". Saying which of the two it is, in the subject,
    // is the difference between a manager chasing the driver and a manager
    // chasing the shop.
    const openFor = `open ${daysRequestOpen} day${daysRequestOpen === 1 ? "" : "s"}`;
    return {
      title: `ACTION NEEDED: oil change request stalled — ${name} (${pastDue}, request filed but no oil change recorded)`,
      body:
        `${name} (${whose}) was projected due for an oil change on ${dueDate} — ${pastDue}. ` +
        `A maintenance request has been ${openFor} and no oil change has been recorded against the ` +
        `vehicle, so it is still running on the old interval.` +
        (expired
          ? ` That request has now been open ${daysRequestOpen} days and has been auto-closed as expired; ` +
            `from tomorrow this truck goes back to the full overdue escalation, driver included.`
          : ""),
      data: { type: "oil_due_manager_stalled", vehicleId: vehicle.id },
    };
  }

  return {
    title: `ACTION NEEDED: oil change ${pastDue} — ${name}`,
    body:
      `${name} (${whose}) was projected due for an oil change on ${dueDate} — ${pastDue} — ` +
      `and no maintenance request has been filed. No oil change has been recorded against it either, ` +
      `so the truck is still running on the old interval.`,
    data: { type: "oil_due_manager_urgent", vehicleId: vehicle.id },
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

// Pushes to every device registered for `userId`, pruning tokens APNs
// reports as dead along the way. Returns true if at least one push actually
// went out (someone with zero registered devices, or every send failing,
// still updates the tracking row — this is at-least-once notification intent
// against a device, not a delivery guarantee). A no-op, not an error, when
// APNs isn't configured yet — the in-app/email channels below still fire.
//
// Takes a userId rather than a driverId: nothing about a push is specific to
// being the assigned driver, and the fleet manager who installed the app
// should get it on their phone on the same terms.
async function pushToUser(admin, userId, message, vehicleLabel, apnsReady) {
  if (!apnsReady || !userId) return false;

  const { data: tokens, error } = await admin
    .from("device_push_tokens")
    .select("token")
    .eq("user_id", userId);
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

// Best-effort email — a missing RESEND_API_KEY or a Resend failure logs and
// returns rather than throwing, so it never takes the push attempt or the DB
// upsert (which is what drives the in-app banner) down with it.
//
// `people` is a list so the fleet managers go out in ONE Resend call rather
// than one per manager: three managers times forty trucks on a bad week is a
// lot of API calls to make serially inside a 10-second function. They are
// genuine `to:` recipients, not bcc — these are colleagues working the same
// problem and seeing who else was told is useful, not a leak.
//
// `urgent` only changes the footer. Resend has no "high importance" flag worth
// relying on, and clients largely ignore X-Priority anyway, so the escalation
// is carried by the subject line (buildManagerMessage writes "ACTION NEEDED")
// where it is actually visible in a list of unread mail.
async function emailPeople(people, companyName, message, vehicleLabel, { urgent = false } = {}) {
  const to = [...new Set((people || []).map((p) => p?.email).filter(Boolean))];
  if (!to.length) return;
  if (!process.env.RESEND_API_KEY) {
    console.warn("send-maintenance-push-notices: RESEND_API_KEY not set — skipping email.");
    return;
  }
  const footer = urgent
    ? "<p>Open the app to file the maintenance request, or log the oil change if it has already been done and was never recorded.</p>"
    : "<p>Open the app to file the maintenance request.</p>";
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: `${companyName} Alerts <${MAIL_FROM}>`,
      to,
      subject: `${message.title} — Steadwerk`,
      html: `<p>${escapeHtml(message.body)}</p>${footer}`,
    });
  } catch (err) {
    console.error(`send-maintenance-push-notices: email failed for ${vehicleLabel}:`, err.message);
  }
}

// Writes the reminder into one person's own conversation with the Steadwerk
// Assistant (supabase/41) — origin_session_id is left null on purpose, which
// is what tells ChatWidget's realtime subscription this row did NOT come from
// a tab it needs to skip as its own echo (see that migration's "WHY
// origin_session_id"). Best-effort like the other two channels: a failure
// here still leaves the push/email/oil_due_notices row intact.
//
// One row per recipient, because each person's assistant conversation is their
// own — this is the channel that gives a manager something still there on
// Monday, since the realtime toast cannot reach them (see the schema note in
// the header).
async function writeAssistantChatMessage(admin, companyId, userId, text, vehicleLabel) {
  if (!userId) return;
  const { error } = await admin.from("chat_messages").insert({
    company_id: companyId,
    user_id: userId,
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

// Auto-closes the oil-change requests that have outlived REQUEST_EXPIRY_DAYS,
// as `expired` (supabase/53 documents the status). Returns how many closed.
//
// NOT `completed`: nothing was completed. Writing completed would put a service
// that never happened into the vehicle's maintenance history, its reports, and
// the "past services" the fleet card learns its intervals from — poisoning the
// very projection this job runs on.
//
// Scoped three ways, because a service-role client has no RLS to fall back on:
// by company, by the exact request ids this cycle is tracking, and by the
// statuses that are still open. The status filter also makes it safe against a
// race — if somebody approved or completed the request in the seconds since
// this run read it, the update matches nothing rather than reopening a decision
// a person already made.
//
// The reason is APPENDED to wh_notes, never written over it. That field holds
// whatever the scheduler or the shop wrote — "waiting on a filter", "booked for
// Tuesday" — which is the most useful thing on the ticket for working out why
// it stalled. Replacing it would destroy the evidence at the exact moment
// somebody needs it. One update per request rather than one bulk update is the
// price of that, and there is normally one request per truck.
//
// Best-effort like every other write here: a failure is logged and the stall
// notice still goes out.
async function expireStaleRequests(admin, requests, companyId, vehicleLabel) {
  const note =
    `Auto-closed after ${REQUEST_EXPIRY_DAYS} days: still open, and no oil change was ` +
    `recorded against this vehicle. Overdue escalation resumes.`;

  let closed = 0;
  for (const request of requests || []) {
    if (!request?.id) continue;
    const existing = String(request.wh_notes || "").trim();

    const { data, error } = await admin
      .from("maintenance_requests")
      .update({ status: "expired", wh_notes: existing ? `${existing}\n\n${note}` : note })
      .eq("company_id", companyId)
      .eq("id", request.id)
      .in("status", ["pending", "scheduled"])
      .select("id");

    if (error) {
      console.error(
        `send-maintenance-push-notices: expiring request ${request.id} failed for ${vehicleLabel}:`,
        error.message,
      );
      continue;
    }
    closed += data?.length || 0;
  }
  return closed;
}

// Every manager channel for one event, in parallel. Returns the count mailed so
// the job's log line says whether the escalation actually reached anybody.
async function notifyManagers(
  admin,
  { companyId, companyName, managers, message, vehicleLabel, apnsReady, urgent },
) {
  if (!managers.length) return 0;
  await Promise.all([
    emailPeople(managers, companyName, message, vehicleLabel, { urgent }),
    ...managers.map((m) => pushToUser(admin, m.id, message, vehicleLabel, apnsReady)),
    ...managers.map((m) =>
      writeAssistantChatMessage(admin, companyId, m.id, message.body, vehicleLabel),
    ),
  ]);
  return managers.length;
}

const rawHandler = async () => {
  // Gates the APNs push ATTEMPT only (pushToUser no-ops without this) — not
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
  let stalledSent = 0;
  let paused = 0;
  let requestsExpired = 0;
  let managerNotices = 0;
  let unassignedEscalated = 0;

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
        .select("id, vid, type, at, wh_notes")
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

    // Also once per company, for the same reason. A fleet with no reachable
    // manager is logged rather than passed over in silence — "nobody holds
    // fleet_edit" and "everybody who does has no email on file" both look
    // identical from the outside, and both mean the escalation this job exists
    // for is going nowhere.
    const fleetManagers = await loadFleetManagers(admin, company.id);
    if (!fleetManagers.length) {
      console.warn(
        `send-maintenance-push-notices: company ${company.id} has no fleet manager with an ` +
          "email on file (nobody holding fleet_edit) — oil-due escalations will reach drivers only.",
      );
    }

    for (const vehicle of vehicles || []) {
      // An unassigned truck is NOT skipped any more: it still accrues miles and
      // still comes due, and having no driver is precisely the case where the
      // manager is the only person who can act. The driver-facing channels
      // below no-op on a null driverId.
      const driverId = vehicle.assignedTo || null;
      const driver = driverId ? driverById.get(driverId) : null;
      const managers = dropUser(fleetManagers, driverId);

      const existingNotice = noticeByVehicle.get(vehicle.id) || null;
      // A request "resolves" this cycle if it's an open Oil Change request
      // filed since the cycle started — filing checkboxes read "Routine Oil
      // Change, ..." (comma-joined), not the bare "Oil Change" the completion
      // dropdown uses, hence the substring match rather than an exact one.
      // See MaintenanceRequestsView.jsx vs CompleteServiceModal.jsx.
      //
      // Sorted and kept, not reduced to a boolean: the grace window is measured
      // from the OLDEST of them (so a second request for the same truck cannot
      // buy another three days of quiet), and the ids are what gets expired at
      // the two-week mark.
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
      const nowIso = new Date().toISOString();
      // NOT named vehicleLabel — that name is the exported fallback-chain
      // function below (vehicle.name || vehicle.plate || vehicle.id), used a
      // few lines down for vehicle_name. This is only ever a log/error string.
      const vehicleLogLabel = `vehicle ${vehicle.id} (company ${company.id})`;

      if (decision.action === "clear_cycle") {
        staleVehicleIds.push(vehicle.id);
        continue;
      }
      if (decision.action === "pause") {
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
          stall_last_sent_at: existingNotice.stall_last_sent_at,
          paused_at: nowIso,
          updated_at: nowIso,
        });
        paused++;
        continue;
      }
      if (decision.action === "heads_up") {
        const message = buildHeadsUpMessage(vehicle, decision.projectedDueDate);
        const managerMessage = buildManagerMessage(vehicle, decision.projectedDueDate, {
          event: "heads_up",
          driverName: driver?.full_name,
        });
        await Promise.all([
          pushToUser(admin, driverId, message, vehicleLogLabel, apnsReady),
          emailPeople(driver ? [driver] : [], company.name, message, vehicleLogLabel),
          writeAssistantChatMessage(admin, company.id, driverId, message.body, vehicleLogLabel),
          notifyManagers(admin, {
            companyId: company.id,
            companyName: company.name,
            managers,
            message: managerMessage,
            vehicleLabel: vehicleLogLabel,
            apnsReady,
            urgent: false,
          }).then((n) => {
            managerNotices += n;
          }),
        ]);
        headsUpSent++;
        if (!driverId) unassignedEscalated++;
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
          stall_last_sent_at: existingNotice?.stall_last_sent_at || null,
          paused_at: null,
          updated_at: nowIso,
        });
        continue;
      }
      if (decision.action === "stalled") {
        // Two weeks open is not pending, it is abandoned. Expiring it here —
        // before the notice is composed — is what makes the `expired` wording
        // below true, and from tomorrow the truck falls back into the normal
        // driver+manager escalation because nothing is open on it any more.
        const expiring = decision.daysRequestOpen >= REQUEST_EXPIRY_DAYS;
        if (expiring) {
          requestsExpired += await expireStaleRequests(
            admin,
            cycleRequests,
            company.id,
            vehicleLogLabel,
          );
        }

        const managerMessage = buildManagerMessage(vehicle, decision.projectedDueDate, {
          event: "stalled",
          driverName: driver?.full_name,
          daysOverdue: decision.daysOverdue,
          daysRequestOpen: decision.daysRequestOpen,
          expired: expiring,
        });
        // Manager-only, deliberately. The driver filed the request; whatever is
        // holding it up is not theirs to answer for, and a daily nag about a
        // ticket they cannot approve or schedule is how people learn to ignore
        // this channel.
        managerNotices += await notifyManagers(admin, {
          companyId: company.id,
          companyName: company.name,
          managers,
          message: managerMessage,
          vehicleLabel: vehicleLogLabel,
          apnsReady,
          urgent: true,
        });
        stalledSent++;
        upserts.push({
          company_id: company.id,
          vehicle_id: vehicle.id,
          driver_id: driverId,
          vehicle_name: vehicleLabel(vehicle),
          cycle_lomi: Number(vehicle.lomi) || 0,
          cycle_started_at: existingNotice?.cycle_started_at || nowIso,
          projected_due_date: decision.projectedDueDate,
          heads_up_sent_at: existingNotice?.heads_up_sent_at || null,
          urgent_last_sent_at: existingNotice?.urgent_last_sent_at || null,
          stall_last_sent_at: nowIso,
          // The pause stamp stays. It is the record of when a request bought
          // this cycle its three days, and clearing it would lose that.
          paused_at: existingNotice?.paused_at || null,
          updated_at: nowIso,
        });
        continue;
      }
      if (decision.action === "urgent") {
        const message = buildUrgentMessage(vehicle, decision.projectedDueDate);
        const managerMessage = buildManagerMessage(vehicle, decision.projectedDueDate, {
          event: "urgent",
          driverName: driver?.full_name,
          daysOverdue: decision.daysOverdue,
        });
        await Promise.all([
          pushToUser(admin, driverId, message, vehicleLogLabel, apnsReady),
          emailPeople(driver ? [driver] : [], company.name, message, vehicleLogLabel, {
            urgent: true,
          }),
          writeAssistantChatMessage(admin, company.id, driverId, message.body, vehicleLogLabel),
          notifyManagers(admin, {
            companyId: company.id,
            companyName: company.name,
            managers,
            message: managerMessage,
            vehicleLabel: vehicleLogLabel,
            apnsReady,
            urgent: true,
          }).then((n) => {
            managerNotices += n;
          }),
        ]);
        urgentSent++;
        if (!driverId) unassignedEscalated++;
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
          stall_last_sent_at: existingNotice?.stall_last_sent_at || null,
          paused_at: existingNotice?.paused_at || null,
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
    `send-maintenance-push-notices: heads-up ${headsUpSent}, urgent ${urgentSent}, ` +
      `stalled ${stalledSent}, paused ${paused}, requests expired ${requestsExpired}, ` +
      `manager notices ${managerNotices}, unassigned trucks escalated ${unassignedEscalated}.`,
  );
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      headsUpSent,
      urgentSent,
      stalledSent,
      paused,
      requestsExpired,
      managerNotices,
      unassignedEscalated,
    }),
  };
};

export const handler = withSentry("send-maintenance-push-notices", rawHandler);

// 13:00 UTC ≈ 8am Central / 9am Eastern — one fixed run for every company
// regardless of their local timezone, same limitation daily-archive.js
// already accepts. Adjust here if the fleet's timezone calls for a different
// hour.
export const config = {
  schedule: "0 13 * * *",
};
