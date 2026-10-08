// src/shared/utils/chatNotifications.js
//
// Automatic email for team chat. One event: somebody @mentioned you, and you may not be
// looking at the dashboard.
//
// Mentions already worked in the UI — autocomplete and a blue highlight — but a mention
// reached you only if you happened to have the Dashboard open. There is an unread badge
// (team_chat_reads), and that is still the right thing for "there are new messages";
// this is for the narrower case of being named directly.
//
// Company config lives in settings(key='chat_notifications') and is described by the
// shared registry in ./automations. Defaults off, so nothing sends until an admin turns
// it on in Settings → Automations.
//
// Same split as the job, maintenance and fleet helpers: the decision and the template are
// pure and unit-tested, and the only impure part is the send, which is injectable. Who
// counts as mentioned is NOT decided here — that is ./mentions, shared with the renderer.

import { sendEmail, escapeHtml } from "./email";
import { knownNamesFrom, newMentionedNames, resolveMentionedUsers } from "./mentions";

// send-email.js caps one request at 10 recipients to keep the relay from being used as a
// fan-out. A message that names more than ten people just takes more than one call.
const MAX_RECIPIENTS_PER_SEND = 10;

// How much of the message to quote. Chat messages are usually a line or two; a pasted
// wall of text should not become a wall of email.
const EXCERPT_LIMIT = 400;

export function excerpt(text, limit = EXCERPT_LIMIT) {
  const clean = String(text ?? "").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit).trimEnd()}…`;
}

// Pure: the subject/html for a mention. The message body and both names are user-entered
// and land in HTML email, so they are escaped — same rule as every other sendEmail call
// site. Newlines become <br> AFTER escaping, so the break tags are the only markup that
// survives from the message.
export function buildMentionEmail({ senderName, message, hasPhoto } = {}) {
  const from = escapeHtml(String(senderName || "A teammate").trim() || "A teammate");
  const body = escapeHtml(excerpt(message)).replace(/\r?\n/g, "<br>");

  return {
    subject: `${String(senderName || "A teammate").trim() || "A teammate"} mentioned you in Team Chat`,
    html:
      `<h2>You were mentioned in Team Chat</h2>` +
      `<p><strong>${from}</strong> mentioned you:</p>` +
      (body
        ? `<blockquote style="margin:0 0 1em;padding:0 0 0 12px;border-left:3px solid #ccc;">${body}</blockquote>`
        : "") +
      (hasPhoto ? `<p><em>A photo was attached.</em></p>` : "") +
      `<p>Open the Dashboard to reply.</p>`,
  };
}

// Somebody posted or edited a message: email anyone newly named in it.
//
// `previousMessage` is what makes an edit safe — only mentions that were not already in
// that text are notified, so fixing a typo re-emails nobody. Omit it for a new message
// and every mention counts as new.
//
// Returns a result rather than throwing, because posting a chat message must never fail
// on account of an email.
export async function notifyChatMention({
  message,
  previousMessage,
  users = [],
  prefs,
  actorId,
  senderName,
  hasPhoto = false,
  send = sendEmail,
}) {
  if (!prefs || prefs.mentioned !== true) return { sent: false, reason: "disabled" };

  // Built from the whole roster, deactivated staff included, so this matches exactly what
  // the bubble highlights. They are dropped at recipient resolution instead — see the
  // note on resolveMentionedUsers.
  const names = knownNamesFrom(users);
  const fresh = newMentionedNames(message, previousMessage, names);
  if (fresh.length === 0) return { sent: false, reason: "no-new-mentions" };

  // Nobody is emailed about their own action. The autocomplete already hides the author
  // from its list, but a name can be typed by hand or survive a copy-paste.
  const recipients = resolveMentionedUsers(fresh, users, { excludeUserId: actorId });
  if (recipients.length === 0) return { sent: false, reason: "no-recipients" };

  const to = recipients.map((u) => String(u.email).trim().toLowerCase());
  const mail = buildMentionEmail({ senderName, message, hasPhoto });

  const batches = [];
  for (let i = 0; i < to.length; i += MAX_RECIPIENTS_PER_SEND) {
    batches.push(to.slice(i, i + MAX_RECIPIENTS_PER_SEND));
  }

  try {
    await Promise.all(
      batches.map((batch) => send({ to: batch, subject: mail.subject, html: mail.html })),
    );
    return { sent: true, event: "mentioned", to, names: fresh };
  } catch (err) {
    return { sent: false, reason: "send-failed", error: err?.message };
  }
}
