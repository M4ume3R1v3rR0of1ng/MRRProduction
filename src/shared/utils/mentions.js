// src/shared/utils/mentions.js
//
// ONE matcher for @mentions in team chat, used by both the thing that highlights them
// and the thing that emails about them.
//
// WHY THIS IS SHARED AND NOT TWO COPIES
//
// Mentions are stored as plain text: team_chat_messages.message holds the literal
// "@Jason Smith can you check this", with no user id and no structured record. Both the
// blue highlight in the bubble and the notification have to re-derive "who was mentioned"
// by matching staff names against that text. If those two derivations disagree by so
// much as a hyphen, you get a mention that is visibly highlighted and emails nobody —
// which is indistinguishable, to the person who typed it, from the feature being broken.
// So there is one function, and both callers use it.

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Longest first, so "@Jason Smith" wins over "@Jason" when both are on the crew.
// A regex alternation matches left to right and takes the FIRST branch that fits, so
// without this sort "Jason" would match and leave " Smith" as plain text.
export function knownNamesFrom(users = []) {
  return [
    ...new Set(
      users
        .map((u) => u?.full_name || u?.name)
        .filter(Boolean)
        .map((n) => String(n).trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);
}

// The capturing pattern, for String.split() in the renderer and matchAll() here.
//
// Deliberately case-SENSITIVE, matching what the chat has always highlighted. The
// autocomplete inserts the name verbatim, so a real mention always matches exactly;
// loosening it would make the email fire on text the bubble leaves unhighlighted, which
// is the drift this module exists to prevent.
//
// The (?![\w'-]) tail stops "@Jo" matching inside "@Joanne" — without it, mentioning
// Joanne would also notify Jo.
export function mentionPattern(names = []) {
  if (!names.length) return null;
  return new RegExp(`(@(?:${names.map(escapeRegex).join("|")}))(?![\\w'-])`, "g");
}

// Every known name actually mentioned in `text`, de-duplicated, in no guaranteed order.
// Mentioning the same person twice in one message is one mention.
export function mentionedNames(text, names = []) {
  const pattern = mentionPattern(names);
  if (!pattern || !text) return [];
  const found = new Set();
  for (const match of String(text).matchAll(pattern)) {
    found.add(match[1].slice(1)); // drop the leading "@"
  }
  return [...found];
}

// Names mentioned in `text` that were NOT already mentioned in `previousText`.
//
// This is what makes editing safe. An edit re-runs the notification, and without this a
// corrected typo would re-email everyone the message ever mentioned. Only genuinely new
// mentions are returned, so adding "@Dana" to an existing message tells Dana and nobody
// else. Passing no previousText (a brand-new message) returns every mention, since all
// of them are new.
export function newMentionedNames(text, previousText, names = []) {
  const before = new Set(mentionedNames(previousText, names));
  return mentionedNames(text, names).filter((n) => !before.has(n));
}

// Matched names → the user records they belong to, ready to be emailed.
//
// DEACTIVATED STAFF ARE DROPPED HERE, and that is load-bearing rather than tidy:
// send-email.js fences recipients to active company members and returns 403 for the
// WHOLE request if any one address fails the check, so a single mention of someone who
// has since left would silently kill the email to everyone else in that message. The
// highlight keeps showing their name on old messages on purpose (supabase/21 keeps
// deactivated profiles readable so history still reads correctly) — they just cannot be
// written to.
//
// Name collisions resolve to every match: two people genuinely called "Jason Smith"
// both get the email, because the stored text carries no id that could tell them apart.
export function resolveMentionedUsers(names = [], users = [], { excludeUserId } = {}) {
  const wanted = new Set(names);
  if (wanted.size === 0) return [];
  const byEmail = new Map();
  for (const u of users) {
    if (!u) continue;
    if (!wanted.has(u.full_name || u.name)) continue;
    if (u.active === false) continue;
    if (!u.email) continue;
    if (excludeUserId && String(u.id) === String(excludeUserId)) continue;
    const email = String(u.email).trim().toLowerCase();
    if (email) byEmail.set(email, u);
  }
  return [...byEmail.values()];
}
