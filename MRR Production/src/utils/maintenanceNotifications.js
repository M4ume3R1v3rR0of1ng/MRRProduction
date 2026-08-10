// src/utils/maintenanceNotifications.js
//
// Automatic email for the maintenance queue. Two directions:
//   - a new request goes OUT to everyone who can act on it (the Manage Requests
//     permission holders), because until now filing a request only produced a popup
//     that the shop saw whenever it next happened to log in;
//   - a status change goes BACK to whoever filed it.
//
// Company config lives in settings(key='maintenance_notifications') and is described by
// the shared registry in ./automations. Everything defaults off, so nothing sends until
// an admin turns it on in Settings → Automations.
//
// Same split as jobNotifications: the decision, the recipient resolution and the
// template are pure and unit-tested, and the only impure part is the send, which is
// injectable.

import { sendEmail, escapeHtml } from "./email";
import { getEffectivePerms, DEFAULT_ROLE_PERMS } from "../database/permissions";

// send-email.js caps one request at 10 recipients to keep the relay from being used as
// a fan-out. Larger shops just get more than one call.
const MAX_RECIPIENTS_PER_SEND = 10;

// Urgency strings the two create modals can produce. FleetManagementView offers
// normal/soon/urgent and MaintenanceRequestsView offers standard/priority/urgent, and
// the sort in that view also ranks "high", so accept the whole family rather than
// matching one literal.
const URGENT_VALUES = new Set(["urgent", "high", "critical", "emergency"]);

export function isUrgent(req) {
  return URGENT_VALUES.has(String(req?.urgency || "").trim().toLowerCase());
}

export const MAINT_EVENTS = {
  filed: {
    label: "New Maintenance Request",
    audience: "managers",
    heading: "New maintenance request",
    lead: "has been reported and is waiting to be scheduled.",
    cta: "Log in to the Maintenance queue to schedule or close it.",
  },
  urgent: {
    label: "URGENT Maintenance Request",
    audience: "managers",
    heading: "Urgent maintenance request",
    lead: "has been reported as urgent. It may be a safety concern or a vehicle that is down.",
    cta: "Log in to the Maintenance queue and triage this one first.",
  },
  scheduled: {
    label: "Maintenance Scheduled",
    audience: "requester",
    heading: "Your request is scheduled",
    lead: "has been approved and booked in by the shop.",
    cta: "No action needed. The shop will update the ticket when the work is done.",
  },
  completed: {
    label: "Maintenance Completed",
    audience: "requester",
    heading: "Your request is complete",
    lead: "has been serviced and the ticket is closed.",
    cta: "If the problem is still there, file a new request so it gets tracked.",
  },
};

// Ticket status a request just ENTERED → the automation key that covers it. A status
// with no entry here (pending, cancelled) never emails.
const STATUS_EVENTS = { scheduled: "scheduled", completed: "completed" };

export function eventForStatus(status) {
  return STATUS_EVENTS[String(status || "").trim().toLowerCase()] || null;
}

// Which automation covers a newly filed request. An urgent ticket prefers the `urgent`
// rule; if that one is off it still falls back to `filed`, so turning urgent off can
// never make an urgent request quieter than a routine one.
export function eventForNewRequest(req, prefs) {
  if (isUrgent(req) && prefs?.urgent === true) return "urgent";
  if (prefs?.filed === true) return "filed";
  return null;
}

// Pure: does this company want an email for this event?
export function shouldNotifyMaint(event, prefs) {
  if (!MAINT_EVENTS[event]) return false;
  return !!(prefs && prefs[event] === true);
}

// Everyone who can act on a maintenance request: the same `maint_manage` predicate the
// dashboard popup already uses, so the email and the popup can never disagree about who
// is in control. Inactive accounts and accounts with no email are dropped — the relay
// rejects any recipient who is not an active company member anyway.
export function resolveMaintManagers(users = [], rolePerms = {}, userOverrides = {}, { excludeUserId } = {}) {
  // An empty rolePerms means the permission tables have not hydrated yet, not that
  // nobody has the permission. Resolving against {} would quietly return zero
  // recipients and drop the email, so fall back to the baseline matrix instead.
  const perms = rolePerms && Object.keys(rolePerms).length > 0 ? rolePerms : DEFAULT_ROLE_PERMS;

  return users.filter((u) => {
    if (!u || !u.email) return false;
    if (u.active === false) return false;
    if (excludeUserId && String(u.id) === String(excludeUserId)) return false;
    return getEffectivePerms(u, perms, userOverrides).maint_manage === true;
  });
}

// Pure: the subject/html for an event. Vehicle name, issue type and the free-text notes
// are all user-entered and rendered into HTML email, so they get escaped — same rule as
// the PDF and every other sendEmail call site.
export function buildMaintEmail(event, req) {
  const ev = MAINT_EVENTS[event];
  if (!ev) return null;

  const rawVehicle = req?.vname || "Unknown vehicle";
  const vehicle = escapeHtml(rawVehicle);
  const type = escapeHtml(req?.type || "General");
  const notes = escapeHtml(req?.notes || "No description provided");
  const filedBy = escapeHtml(req?.uname || "Unknown");
  const mileage = req?.mileage == null || req.mileage === "" ? "" : escapeHtml(req.mileage);
  // The DB columns are snake_case but the in-memory ticket shape has carried camelCase
  // in places since before these rows were persisted; read both.
  const shopNotes = escapeHtml(req?.wh_notes ?? req?.whNotes ?? "");
  const scheduledDate = req?.scheduled_date ?? req?.scheduledDate ?? "";
  const completedAt = req?.completed_at ?? req?.completedAt ?? "";

  const row = (label, value) => (value ? `<p><strong>${label}:</strong> ${value}</p>` : "");

  return {
    subject: `${ev.label}: ${rawVehicle}`,
    html:
      `<h2>${escapeHtml(ev.heading)}</h2>` +
      `<p><strong>${vehicle}</strong> ${escapeHtml(ev.lead)}</p>` +
      row("Issue", type) +
      row("Reported by", filedBy) +
      row("Mileage", mileage) +
      row("Scheduled for", scheduledDate ? escapeHtml(formatDate(scheduledDate)) : "") +
      row("Completed", completedAt ? escapeHtml(formatDate(completedAt)) : "") +
      `<p><strong>Reported issue:</strong> ${notes}</p>` +
      row("Shop notes", shopNotes) +
      `<p>${escapeHtml(ev.cta)}</p>`,
  };
}

// Dates arrive as ISO strings or as plain yyyy-mm-dd. Keep the raw value if it is
// neither, rather than rendering "Invalid Date" into an email.
function formatDate(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString();
}

// A new request has landed: tell the people who can schedule it. Returns a result rather
// than throwing, because filing a request must never fail on account of an email.
export async function notifyMaintFiled({ req, recipients = [], prefs, excludeUserId, send = sendEmail }) {
  const event = eventForNewRequest(req, prefs);
  if (!event) return { sent: false, reason: "disabled" };

  // A warehouse manager who files their own request shouldn't be emailed about it,
  // matching the popup rule that nobody gets alerted to their own action.
  const to = [
    ...new Set(
      recipients
        .filter((u) => !(excludeUserId && String(u?.id) === String(excludeUserId)))
        .map((u) => String(u?.email || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (to.length === 0) return { sent: false, reason: "no-recipients" };

  const mail = buildMaintEmail(event, req);
  if (!mail) return { sent: false, reason: "unknown-event" };

  const batches = [];
  for (let i = 0; i < to.length; i += MAX_RECIPIENTS_PER_SEND) {
    batches.push(to.slice(i, i + MAX_RECIPIENTS_PER_SEND));
  }

  try {
    await Promise.all(batches.map((batch) => send({ to: batch, subject: mail.subject, html: mail.html })));
    return { sent: true, event, to };
  } catch (err) {
    return { sent: false, reason: "send-failed", error: err?.message };
  }
}

// A ticket moved: tell whoever filed it. `actorId` suppresses the email when the shop
// user updating the ticket is the same person who reported it, matching the existing
// `newforrequester` rule that stops the dashboard popup alerting someone to their own
// action.
export async function notifyMaintStatus({ status, req, users = [], prefs, actorId, send = sendEmail }) {
  const event = eventForStatus(status);
  if (!event) return { sent: false, reason: "no-event-for-status" };
  if (!shouldNotifyMaint(event, prefs)) return { sent: false, reason: "disabled" };

  const requesterId = req?.uid ?? req?.userId;
  if (actorId && String(requesterId) === String(actorId)) return { sent: false, reason: "self-update" };

  const requester = users.find((u) => u && String(u.id) === String(requesterId));
  if (!requester?.email || requester.active === false) return { sent: false, reason: "no-requester-email" };

  const mail = buildMaintEmail(event, { ...req, status });
  if (!mail) return { sent: false, reason: "unknown-event" };

  try {
    await send({ to: requester.email, subject: mail.subject, html: mail.html });
    return { sent: true, event, to: requester.email };
  } catch (err) {
    return { sent: false, reason: "send-failed", error: err?.message };
  }
}
