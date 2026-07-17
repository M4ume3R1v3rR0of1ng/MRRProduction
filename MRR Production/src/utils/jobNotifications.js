// src/utils/jobNotifications.js
//
// Automatic email to a job's ASSIGNED SUPERVISOR when the job moves through a status
// the company has opted into. Company config lives in settings(key='job_notifications')
// as { approved, active, completed, closed } booleans — off by default, so nothing goes
// out until an admin turns it on in Settings → Notifications.
//
// The pieces are split so the decision and the template are pure and unit-tested; the
// only impure part is the actual send, which is injectable.

import { sendEmail, escapeHtml } from "./email";

// The status a job just ENTERED → how it's described to the supervisor. Keys match the
// four transitions the enforcement trigger already gates (see supabase/12).
export const JOB_MOVE_EVENTS = {
  approved: {
    label: "Approved",
    verb: "has been approved and assigned to you",
    cta: "Log in to pull inventory for this job.",
  },
  active: {
    label: "Materials Pulled",
    verb: "has had its materials pulled and is now active",
    cta: "The crew is provisioned — work can begin.",
  },
  completed: {
    label: "Completed",
    verb: "has been marked completed",
    cta: "Any unused materials were returned to the warehouse.",
  },
  closed: {
    label: "Closed",
    verb: "has been closed and archived",
    cta: "No further changes are expected on this job.",
  },
};

// `approved` defaults ON because an approval/assignment email already fired
// unconditionally before this feature — gating it behind a default-off toggle would
// silently stop a notification people rely on. The three genuinely new moves default
// OFF: turning on new outbound email is a deliberate admin choice, not a surprise.
export const DEFAULT_JOB_NOTIFICATIONS = { approved: true, active: false, completed: false, closed: false };

// Pure: does this company want an email for this transition?
export function shouldNotifyJobMove(transition, prefs) {
  if (!JOB_MOVE_EVENTS[transition]) return false;
  return !!(prefs && prefs[transition] === true);
}

// Pure: the subject/html for a move. Job PO, name and address are user-entered free
// text rendered into HTML email — escape them, same rule as the PDF and the other
// sendEmail call sites.
export function buildJobMoveEmail(transition, job) {
  const ev = JOB_MOVE_EVENTS[transition];
  if (!ev) return null;
  const rawName = job?.title || job?.name || "Untitled job";
  const rawPo = job?.po || "—";
  const name = escapeHtml(rawName);
  const po = escapeHtml(rawPo);
  const addr = escapeHtml(job?.addr || job?.address || "");
  return {
    subject: `Job ${ev.label}: ${rawName} (PO ${rawPo})`,
    html:
      `<h2>Job ${ev.label}</h2>` +
      `<p>Your job <strong>${name}</strong> ${ev.verb}.</p>` +
      `<p><strong>PO:</strong> ${po}</p>` +
      (addr ? `<p><strong>Address:</strong> ${addr}</p>` : "") +
      `<p>${ev.cta}</p>`,
  };
}

// Resolve the assigned supervisor and email them, IF the company enabled this move.
// Returns a result rather than throwing — a status change must never fail because an
// email couldn't be sent. `send` is injectable so tests don't hit the network.
export async function notifyJobMove({ transition, job, users = [], prefs, send = sendEmail }) {
  if (!shouldNotifyJobMove(transition, prefs)) return { sent: false, reason: "disabled" };

  const supId = job?.assignedto || job?.assignedTo;
  const sup = users.find((u) => u && u.id === supId);
  if (!sup?.email) return { sent: false, reason: "no-supervisor-email" };

  const mail = buildJobMoveEmail(transition, job);
  if (!mail) return { sent: false, reason: "unknown-transition" };

  try {
    await send({ to: sup.email, subject: mail.subject, html: mail.html });
    return { sent: true, to: sup.email };
  } catch (err) {
    return { sent: false, reason: "send-failed", error: err?.message };
  }
}
