// src/features/training/trainingAssignments.js
//
// The logic half of training assignments (supabase/48). Kept pure and separate
// from TrainingView for the same reason the money and permission helpers are:
// "is this overdue", "who still owes me this clip" and "what rows do I insert
// for 14 people" are all decisions worth testing without mounting a video
// player.
//
// Vocabulary, matching the table:
//   outstanding  completed_at is null
//   watched      completed_at is set
//   due_on       optional calendar day. Null is the common case, and means "no
//                deadline" rather than "due immediately" — see the migration.

import { parseDay, todayLocal } from "@/shared/utils/helpers";

// How many days before a deadline the UI starts leaning on it. Three days is
// enough for someone who only opens the app on working days to see it at least
// once before it bites.
export const DUE_SOON_DAYS = 3;

// Whole days from today to `dueOn`, negative once it is in the past. Null for a
// row with no deadline, so callers can tell "no deadline" from "due today"
// rather than both arriving as 0.
export function daysUntilDue(dueOn, today = todayLocal()) {
  if (!dueOn) return null;
  const then = parseDay(dueOn);
  const now = parseDay(today);
  if (isNaN(then) || isNaN(now)) return null;
  // Both are local midnights (parseDay's whole purpose), so this subtraction is
  // a whole number of days and needs no rounding against DST.
  return Math.round((then - now) / 86400000);
}

// One of: "watched" | "overdue" | "due-soon" | "open".
//
// Deliberately ordered so watched wins over overdue: someone who finished a clip
// late has finished it, and showing them a red "overdue" badge afterwards is a
// reprimand the app has no business delivering.
export function assignmentStatus(assignment, today = todayLocal()) {
  if (!assignment) return "open";
  if (assignment.completed_at) return "watched";
  const days = daysUntilDue(assignment.due_on, today);
  if (days === null) return "open";
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due-soon";
  return "open";
}

// Short human label for a deadline: "Overdue by 2 days", "Due today", "Due in
// 3 days". Returns null when there is nothing to say, so the caller renders
// nothing rather than an empty chip.
//
// Returns a DESCRIPTOR, not a string: { key, n }. The app ships English and
// Spanish, so the words have to come out of translations.js at the call site —
// building "Overdue by 2 days" here would hard-code one language into logic
// that is otherwise about dates. `n` is always a positive count, since the
// direction is already carried by the key.
export function dueDescriptor(assignment, today = todayLocal()) {
  if (!assignment || assignment.completed_at) return null;
  const days = daysUntilDue(assignment.due_on, today);
  if (days === null) return null;
  if (days < 0) return { key: "overdue", n: Math.abs(days) };
  if (days === 0) return { key: "today", n: 0 };
  if (days === 1) return { key: "tomorrow", n: 1 };
  return { key: "days", n: days };
}

// The descriptor above, in the viewer's language. Kept here beside the classifier
// rather than inline in the view so the key-to-string mapping is covered by the
// same tests — a missing translation key renders "undefined" in a badge, which
// is the sort of thing nobody notices in the language they don't read.
export function formatDue(descriptor, t = {}) {
  if (!descriptor) return null;
  const { key, n } = descriptor;
  if (key === "today") return t.trDueToday;
  if (key === "tomorrow") return t.trDueTomorrow;
  if (key === "days") return String(t.trDueInDays || "").replace("{n}", String(n));
  // Singular gets its own key: Spanish needs "hace 1 día" against "hace 2 días",
  // and an English "Overdue by 1 days" is the usual giveaway that it was faked
  // with a trailing s.
  return n === 1 ? t.trOverdueByDay : String(t.trOverdueByDays || "").replace("{n}", String(n));
}

// The rows to insert for a bulk assign. company_id comes from the column default
// (active_company_id()), never from the client — same as mediaRow in
// trainingMedia.js.
//
// userIds is de-duplicated because the role shortcuts in the picker overlap: an
// admin who taps "all Field crew" and then also ticks one of those people by
// hand should get one row, not a unique-constraint violation.
export function assignmentRows({ mediaId, userIds = [], dueOn = null, user }) {
  if (!mediaId) throw new Error("assignmentRows: mediaId is required.");
  const unique = [...new Set(userIds.filter(Boolean))];
  return unique.map((userId) => ({
    media_id: mediaId,
    user_id: userId,
    // "" from an untouched date input must land as null, not as an invalid date.
    due_on: dueOn ? dueOn : null,
    assigned_by: user?.id || null,
    // Denormalised, see the migration: an id alone cannot survive the assigner
    // leaving the company.
    assigned_by_name: user?.full_name || user?.name || user?.email || null,
  }));
}

// Everything directed at one person, newest-pressure-first: overdue, then
// due-soon, then undated, and within each by deadline. Watched rows drop out
// entirely — this feeds the "Assigned to you" list, which is a to-do list.
const STATUS_RANK = { overdue: 0, "due-soon": 1, open: 2, watched: 3 };

export function outstandingFor(userId, assignments = [], today = todayLocal()) {
  return assignments
    .filter((a) => a.user_id === userId && !a.completed_at)
    .sort((a, b) => {
      const rank =
        STATUS_RANK[assignmentStatus(a, today)] - STATUS_RANK[assignmentStatus(b, today)];
      if (rank !== 0) return rank;
      // Undated rows sort after dated ones inside the same bucket.
      if (!a.due_on && !b.due_on)
        return String(a.assigned_at || "").localeCompare(String(b.assigned_at || ""));
      if (!a.due_on) return 1;
      if (!b.due_on) return -1;
      return String(a.due_on).localeCompare(String(b.due_on));
    });
}

// The admin roster for one clip: who has watched it and who has not, with the
// person's own record attached so the caller does not have to re-join.
//
// `users` is the company's member list. An assignment whose person is no longer
// in that list (deactivated since) still counts — dropping them would quietly
// change "8 of 12" to "8 of 11" and hide that someone left mid-assignment.
export function rosterFor(mediaId, assignments = [], users = []) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const mine = assignments.filter((a) => a.media_id === mediaId);
  const decorate = (a) => ({ ...a, person: byId.get(a.user_id) || null });
  const watched = mine.filter((a) => a.completed_at).map(decorate);
  const outstanding = mine.filter((a) => !a.completed_at).map(decorate);
  return {
    watched,
    outstanding,
    total: mine.length,
    // Pre-computed because every call site wants it and "8 of 12" read off two
    // array lengths is easy to get backwards.
    watchedCount: watched.length,
    overdueCount: outstanding.filter((a) => assignmentStatus(a) === "overdue").length,
  };
}

// Members an admin can assign to: active only, and never a platform admin
// visiting from outside the company, who has no business in a crew roster.
// Sorted by display name so the picker is scannable.
export function assignableUsers(users = []) {
  return users
    .filter((u) => u && u.active !== false && !u.isPlatformAdmin)
    .sort((a, b) =>
      String(a.name || a.full_name || a.email || "").localeCompare(
        String(b.name || b.full_name || b.email || ""),
      ),
    );
}

// Role shortcuts for the picker: every role actually present among the
// assignable members, with its people. Roles nobody holds are left out rather
// than rendered as a shortcut that selects nothing.
export function roleShortcuts(users = []) {
  const groups = new Map();
  for (const u of assignableUsers(users)) {
    const role = u.role || "employee";
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(u.id);
  }
  return [...groups.entries()].map(([role, userIds]) => ({ role, userIds }));
}

// Who is already assigned this clip, so the picker can show them as ticked and
// disabled rather than letting an admin create a duplicate the unique
// constraint will reject.
export function alreadyAssigned(mediaId, assignments = []) {
  return new Set(assignments.filter((a) => a.media_id === mediaId).map((a) => a.user_id));
}
