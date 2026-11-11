// netlify/functions/_shared/anvilRecap.js
//
// What A.N.V.I.L. has to say to one person at the end of the working day: what got done, what
// did not, and what is on for the next working day.
//
// The mirror image of anvilBriefing.js, and it follows the same rules:
//
//   ONE PER PERSON, BUILT FROM THEIR OWN PERMISSIONS. Every section is gated on the permission
//   that gates its page in the app, and a crew member's jobs are narrowed to the ones assigned
//   to them. A recap contains only what the person could have looked up themselves.
//
//   PURE OVER ALREADY-FETCHED ROWS. send-end-of-day-recap.js reads the company's tables once
//   (loadBriefingData) and calls this per member, so it is testable without a database.
//
//   SILENCE IS A FEATURE. Nothing done, nothing slipped and nothing coming means null, and no
//   row is written. A recap that says "all quiet" every evening is one people learn to skip.
//
//   WEEKDAYS ONLY, which the caller enforces.
//
// DATES. Two kinds, handled differently on purpose. Calendar-day fields (a job's scheduledDate,
// a request's scheduled_date, a training due_on) are the day somebody typed, so they are compared
// as written. Timestamps (completedAt, completed_at) are instants, so they are converted to the
// local day first: a job finished at 8:30pm Eastern belongs to that evening, not to the next
// day in UTC.

import { localDayOf } from "./localTime.js";

const DAY_MS = 86400000;

const dayKey = (value) => (value ? String(value).split("T")[0] : null);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const jobTitle = (j) => j.title || j.name || j.po || "Untitled job";

const noon = (day) => new Date(`${day}T12:00:00Z`);

const weekdayName = (day) =>
  noon(day).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

const FINISHED = new Set(["completed", "closed"]);

/**
 * @typedef {Object} RecapInput
 * @property {Object} member      { userId, name }
 * @property {Object} [perms]     Their effective permissions (anvilPerms.js).
 * @property {Object[]} [requests]
 * @property {Object[]} [jobs]
 * @property {Object[]} [assignments]
 * @property {Object[]} [media]
 * @property {string} today       The local calendar day being wrapped up, YYYY-MM-DD.
 * @property {string} tomorrow    The next working day, YYYY-MM-DD.
 */

/**
 * @param {RecapInput} input
 * @returns {{ text: string, sections: Array<{ key: string, lines: string[] }> } | null}
 */
export function buildRecap({
  member,
  perms = {},
  requests = [],
  jobs = [],
  assignments = [],
  media = [],
  today,
  tomorrow,
}) {
  const next = tomorrow || today;
  // "Tomorrow" when it is, otherwise the weekday name, so a Friday recap does not call
  // Monday's work "tomorrow".
  const isNextDay = noon(next).getTime() - noon(today).getTime() === DAY_MS;
  const nextHeading = isNextDay ? "Tomorrow" : weekdayName(next);

  /** @type {{ key: string, heading: string, lines: string[] }[]} */
  const groups = [
    { key: "done", heading: "Done today", lines: [] },
    { key: "slipped", heading: "Didn't get done", lines: [] },
    { key: "next", heading: nextHeading, lines: [] },
  ];
  const [done, slipped, upcoming] = groups;

  const titleOf = (mediaId) => media.find((m) => m.id === mediaId)?.title || "a training item";

  // ── Jobs ─────────────────────────────────────────────────────────────────
  if (perms.jobs_view) {
    const mine = (j) =>
      perms.jobs_approve || perms.jobs_build
        ? true
        : String(j.assignedto || j.assignedTo || "") === String(member.userId);
    const scoped = jobs.filter(mine);

    const finishedToday = scoped.filter(
      (j) => FINISHED.has(j.status) && localDayOf(j.completedAt || j.completed) === today,
    );
    if (finishedToday.length) {
      done.lines.push(
        `${plural(finishedToday.length, "job", "jobs")} finished: ${finishedToday.map(jobTitle).join(", ")}.`,
      );
    }

    const slippedJobs = scoped.filter(
      (j) => dayKey(j.scheduledDate) === today && !FINISHED.has(j.status),
    );
    if (slippedJobs.length) {
      slipped.lines.push(
        `${plural(slippedJobs.length, "job", "jobs")} scheduled for today and not finished: ${slippedJobs.map(jobTitle).join(", ")}.`,
      );
    }

    const comingJobs = scoped.filter(
      (j) => dayKey(j.scheduledDate) === next && !FINISHED.has(j.status),
    );
    if (comingJobs.length) {
      upcoming.lines.push(
        `${plural(comingJobs.length, "job", "jobs")} scheduled: ${comingJobs.map(jobTitle).join(", ")}.`,
      );
      // An approved job nobody has pulled for is the commonest reason a crew reaches a site
      // without its materials, and the evening before is when that can still be fixed.
      const unpulled = comingJobs.filter((j) => j.status === "approved");
      if (perms.jobs_pull && unpulled.length) {
        upcoming.lines.push(
          `${unpulled.length} of them still ${unpulled.length === 1 ? "needs" : "need"} a material pull.`,
        );
      }
    }
  }

  // ── Shop ─────────────────────────────────────────────────────────────────
  if (perms.maint_manage) {
    const vehicle = (r) => r.vname || "a vehicle";

    const finished = requests.filter(
      (r) => r.status === "completed" && localDayOf(r.completed_at) === today,
    );
    if (finished.length) {
      done.lines.push(`Maintenance completed: ${finished.map(vehicle).join(", ")}.`);
    }

    const missed = requests.filter(
      (r) => r.status === "scheduled" && r.scheduled_date && dayKey(r.scheduled_date) <= today,
    );
    if (missed.length) {
      slipped.lines.push(
        `Scheduled for the shop and not completed: ${missed.map(vehicle).join(", ")}.`,
      );
    }

    const coming = requests.filter(
      (r) => r.status === "scheduled" && dayKey(r.scheduled_date) === next,
    );
    if (coming.length) {
      upcoming.lines.push(`In the shop: ${coming.map(vehicle).join(", ")}.`);
    }
  }

  // ── Their own training ───────────────────────────────────────────────────
  const mineTraining = assignments.filter((a) => String(a.user_id) === String(member.userId));

  const finishedTraining = mineTraining.filter((a) => localDayOf(a.completed_at) === today);
  if (finishedTraining.length) {
    done.lines.push(
      `You finished training: ${finishedTraining.map((a) => titleOf(a.media_id)).join(", ")}.`,
    );
  }

  const openTraining = mineTraining.filter((a) => !a.completed_at);
  const overdue = openTraining.filter((a) => a.due_on && dayKey(a.due_on) < today);
  if (overdue.length) {
    slipped.lines.push(`Training overdue: ${overdue.map((a) => titleOf(a.media_id)).join(", ")}.`);
  }
  const dueNext = openTraining.filter((a) => dayKey(a.due_on) === next);
  if (dueNext.length) {
    upcoming.lines.push(`Training due: ${dueNext.map((a) => titleOf(a.media_id)).join(", ")}.`);
  }

  const kept = groups.filter((g) => g.lines.length > 0);
  if (kept.length === 0) return null;

  const firstName = String(member.name || "")
    .trim()
    .split(/\s+/)[0];
  const greeting = firstName ? `Evening, ${firstName}.` : "Evening.";
  const body = kept
    .map((g) => `${g.heading}:\n${g.lines.map((l) => `• ${l}`).join("\n")}`)
    .join("\n\n");

  return {
    text: `${greeting} Here is how today went:\n\n${body}\n\nAsk me about any of it.`,
    sections: kept.map((g) => ({ key: g.key, lines: g.lines })),
  };
}
