// netlify/functions/_shared/anvilBriefing.js
//
// What A.N.V.I.L. has to say to one person first thing in the morning.
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE BRIEFING PER PERSON, NOT ONE PER COMPANY
// ─────────────────────────────────────────────────────────────────────────────
// A briefing that lists what a warehouse manager needs is the wrong briefing
// for a site supervisor, and worse than useless for a driver — it tells them
// about margin on jobs they cannot open. Every section below is gated on the
// SAME permission that gates its page in the app (see anvilPerms.js), so a
// person's briefing contains exactly the things they could have gone and
// looked at themselves.
//
// WHY THIS IS A PURE FUNCTION OVER ALREADY-FETCHED ROWS
//
// send-daily-briefing.js reads each company's tables ONCE and then calls this
// per member. A version that queried per person would issue the same handful
// of selects dozens of times a morning for a company of thirty. It also means
// the whole thing is testable without a database, which is the only practical
// way to pin "a driver never sees contract values".
//
// WHY AN EMPTY BRIEFING IS A FIRST-CLASS RESULT
//
// Nothing erodes a proactive channel faster than a daily message that says
// everything is fine. buildBriefing returns null when it has found nothing
// worth waking someone for, and the caller writes no row at all. A quiet
// morning should be silent.

import { oilStatus, daysUntilOilDue } from "./oilForecast.js";

const DAY_MS = 86400000;

// How far ahead "coming up" reaches. Two days, because this runs every
// morning: anything further out will be mentioned again tomorrow, and a
// briefing that lists next week's work buries today's.
const LOOKAHEAD_DAYS = 2;

// A job that has been finished but never closed out is normal for a few days —
// somebody is waiting on the customer to pay. Past this it is a loose end.
const STALE_COMPLETED_DAYS = 14;

const dayKey = (value) => (value ? String(value).split("T")[0] : null);

const addDays = (isoDay, n) =>
  new Date(new Date(`${isoDay}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

const daysBetween = (fromDay, toDay) =>
  Math.round(
    (new Date(`${toDay}T00:00:00Z`).getTime() - new Date(`${fromDay}T00:00:00Z`).getTime()) /
      DAY_MS,
  );

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// On-hand total across an item's batches — same sum as src helpers' tot().
const onHand = (item) => (item?.batches || []).reduce((s, b) => s + (parseFloat(b.rem) || 0), 0);

const jobTitle = (j) => j.title || j.name || j.po || "Untitled job";

/**
 * @typedef {Object} BriefingInput
 * @property {Object} member          The person this briefing is for: { userId, name }.
 * @property {Object} perms           Their effective permissions (anvilPerms.js).
 * @property {Object[]} vehicles
 * @property {Object[]} requests
 * @property {Object[]} inventory
 * @property {Object[]} jobs
 * @property {Object[]} assignments   training_assignments rows.
 * @property {Object[]} media         training_media rows, for assignment titles.
 * @property {string} [today]         Calendar day to brief for, YYYY-MM-DD.
 */

/**
 * Assembles one person's briefing.
 *
 * Returns null when there is nothing to say, or
 * { text, sections: [{ key, lines }] } — `text` being the message written into
 * their conversation, `sections` kept alongside it so the caller can log what
 * it actually sent without re-parsing prose.
 */
export function buildBriefing({
  member,
  perms = {},
  vehicles = [],
  requests = [],
  inventory = [],
  jobs = [],
  assignments = [],
  media = [],
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const horizon = addDays(today, LOOKAHEAD_DAYS);
  const sections = [];
  const add = (key, lines) => {
    const kept = lines.filter(Boolean);
    if (kept.length) sections.push({ key, lines: kept });
  };

  // ── Today's work ─────────────────────────────────────────────────────────
  // Everyone with jobs_view gets this; a site supervisor's copy is narrowed to
  // the jobs assigned to them, since the whole company's schedule is noise to
  // someone who is driving to one address.
  if (perms.jobs_view) {
    const mine = (j) =>
      perms.jobs_approve || perms.jobs_build
        ? true
        : String(j.assignedto || j.assignedTo || "") === String(member.userId);

    const live = jobs.filter((j) => j.status !== "closed" && mine(j));
    const todays = live.filter((j) => dayKey(j.scheduledDate) === today);
    const soon = live.filter((j) => {
      const key = dayKey(j.scheduledDate);
      return key && key > today && key <= horizon;
    });

    add("jobs_today", [
      todays.length
        ? `${plural(todays.length, "job", "jobs")} scheduled today: ${todays.map(jobTitle).join(", ")}.`
        : null,
      soon.length ? `${plural(soon.length, "job", "jobs")} in the next two days.` : null,
      // An approved job nobody has pulled for is the single most common reason
      // a crew arrives at a site without its materials.
      perms.jobs_pull && live.filter((j) => j.status === "approved").length
        ? `${plural(live.filter((j) => j.status === "approved").length, "approved job", "approved jobs")} still waiting on a material pull.`
        : null,
    ]);
  }

  // ── Fleet and maintenance ────────────────────────────────────────────────
  if (perms.fleet_view || perms.maint_manage) {
    const trucks = vehicles.filter((v) => v.type === "truck");
    const overdue = trucks.filter((v) => oilStatus(v)?.state === "overdue");
    const soon = trucks.filter((v) => {
      const status = oilStatus(v);
      if (status?.state !== "soon") return false;
      const days = daysUntilOilDue(v);
      return days === null || days <= 7;
    });

    add("fleet", [
      overdue.length ? `Oil change overdue on ${overdue.map((v) => v.name).join(", ")}.` : null,
      soon.length ? `Oil due within the week on ${soon.map((v) => v.name).join(", ")}.` : null,
      vehicles.filter((v) => v.status && v.status !== "active").length
        ? `${plural(vehicles.filter((v) => v.status && v.status !== "active").length, "vehicle", "vehicles")} not in active service.`
        : null,
    ]);
  }

  if (perms.maint_manage) {
    const pending = requests.filter((r) => r.status === "pending");
    // A ticket that has sat pending for a week is not waiting on the shop, it
    // is waiting on the person reading this.
    const stale = pending.filter((r) => r.at && daysBetween(dayKey(r.at), today) >= 7);
    const dueToday = requests.filter(
      (r) => r.status === "scheduled" && dayKey(r.scheduled_date) === today,
    );

    add("maintenance", [
      pending.length
        ? `${plural(pending.length, "maintenance request", "maintenance requests")} pending your scheduling${stale.length ? ` — ${stale.length} of them over a week old` : ""}.`
        : null,
      dueToday.length
        ? `In the shop today: ${dueToday.map((r) => r.vname || "a vehicle").join(", ")}.`
        : null,
      requests.filter((r) => r.urgency === "critical" && r.status !== "completed").length
        ? `${plural(requests.filter((r) => r.urgency === "critical" && r.status !== "completed").length, "critical ticket", "critical tickets")} still open.`
        : null,
    ]);
  }

  // ── Inventory ────────────────────────────────────────────────────────────
  if (perms.inv_view) {
    const low = inventory.filter((i) => {
      const threshold = Number(i.alrt);
      if (!Number.isFinite(threshold) || threshold <= 0) return false;
      return onHand(i) <= threshold;
    });
    const out = low.filter((i) => onHand(i) <= 0);

    add("inventory", [
      out.length ? `Out of stock: ${out.map((i) => i.name).join(", ")}.` : null,
      low.length - out.length > 0
        ? `${plural(low.length - out.length, "item", "items")} at or below the low-stock line${
            low.length - out.length <= 4
              ? `: ${low
                  .filter((i) => onHand(i) > 0)
                  .map((i) => i.name)
                  .join(", ")}`
              : ""
          }.`
        : null,
    ]);
  }

  // ── Training ─────────────────────────────────────────────────────────────
  // Their own first, because that is the one they can act on this morning.
  const titleOf = (mediaId) => media.find((m) => m.id === mediaId)?.title || "a training item";
  const open = assignments.filter((a) => !a.completed_at);
  const mineOpen = open.filter((a) => String(a.user_id) === String(member.userId));
  const mineOverdue = mineOpen.filter((a) => a.due_on && dayKey(a.due_on) < today);
  const mineDueSoon = mineOpen.filter((a) => {
    const due = dayKey(a.due_on);
    return due && due >= today && due <= horizon;
  });

  add("training_mine", [
    mineOverdue.length
      ? `Training overdue: ${mineOverdue.map((a) => titleOf(a.media_id)).join(", ")}.`
      : null,
    mineDueSoon.length
      ? `Training due in the next two days: ${mineDueSoon.map((a) => titleOf(a.media_id)).join(", ")}.`
      : null,
  ]);

  if (perms.users_manage) {
    const teamOverdue = open.filter(
      (a) => String(a.user_id) !== String(member.userId) && a.due_on && dayKey(a.due_on) < today,
    );
    add("training_team", [
      teamOverdue.length
        ? `${plural(teamOverdue.length, "training assignment", "training assignments")} overdue across the team.`
        : null,
    ]);
  }

  // ── Loose ends ───────────────────────────────────────────────────────────
  if (perms.jobs_close) {
    // Both columns exist and the app reads them with this same fallback (see
    // BuildJobsView's detail rows) — older rows carry `completed`, newer ones
    // carry both.
    const finishedOn = (j) => dayKey(j.completed || j.completedAt);
    const stale = jobs.filter(
      (j) =>
        j.status === "completed" &&
        finishedOn(j) &&
        daysBetween(finishedOn(j), today) >= STALE_COMPLETED_DAYS,
    );
    add("close_out", [
      stale.length
        ? `${plural(stale.length, "completed job", "completed jobs")} finished over two weeks ago and not yet closed out.`
        : null,
    ]);
  }

  if (sections.length === 0) return null;

  const firstName = String(member.name || "")
    .trim()
    .split(/\s+/)[0];
  const greeting = firstName ? `Morning, ${firstName}.` : "Morning.";
  const body = sections.flatMap((s) => s.lines.map((line) => `• ${line}`)).join("\n");

  return {
    text: `${greeting} Here is your day:\n\n${body}\n\nAsk me about any of it.`,
    sections,
  };
}

/**
 * Everything buildBriefing needs for one company, in one pass.
 *
 * Lives here rather than in chat.js so send-daily-briefing.js can have it
 * without importing that module — which would pull the whole Anthropic SDK
 * into a cron bundle that never talks to a model.
 *
 * ⚠️ Every select is scoped by company_id. This runs on a service-role client
 *    where RLS does not apply, so those filters are the only tenant isolation
 *    there is (see supabase/02_tenancy_tables.sql:405). training_media is the
 *    one exception and is deliberate: platform-authored training is shared
 *    across tenants by design (supabase/42), and this only ever reads titles
 *    for assignment rows that were already company-scoped above.
 */
export async function loadBriefingData(admin, companyId) {
  const [vehicles, requests, inventory, jobs, assignments, media] = await Promise.all([
    admin.from("vehicles").select("*").eq("company_id", companyId).limit(200),
    admin.from("maintenance_requests").select("*").eq("company_id", companyId).limit(500),
    admin
      .from("inventory")
      .select("id, name, unit, alrt, batches")
      .eq("company_id", companyId)
      .limit(500),
    admin
      .from("jobs")
      .select('id, po, title, name, status, "scheduledDate", assignedto, completed, "completedAt"')
      .eq("company_id", companyId)
      .limit(500),
    admin
      .from("training_assignments")
      .select("media_id, user_id, due_on, completed_at")
      .eq("company_id", companyId)
      .limit(1000),
    admin.from("training_media").select("id, title").limit(500),
  ]);

  const failed = [vehicles, requests, inventory, jobs, assignments, media].find((r) => r.error);
  if (failed) return { error: failed.error.message };

  return {
    vehicles: vehicles.data || [],
    requests: requests.data || [],
    inventory: inventory.data || [],
    jobs: jobs.data || [],
    assignments: assignments.data || [],
    media: media.data || [],
  };
}
