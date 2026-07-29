// src/utils/schedule.js
//
// Bucketing for the schedule surfaces: the week-ahead card on the dashboard and
// the full month view behind it. Pure — no React, no data access — so both can
// share one definition of "what is happening on this day" and cannot drift.
//
// Why this exists at all: jobs, trailers and maintenance each already have their
// own month grid (CrewCalendar, TrailerCalendar, MaintenanceCalendar), each in a
// different view, and none of them can see the other two. Everything here is
// about putting all three on the same day.
import { parseDay, formatDay, todayLocal } from "./helpers";

// Consecutive day keys starting at `from`.
//
// Stepped through local Dates rather than by adding 86400000 to a timestamp: a
// DST boundary makes a day 23 or 25 hours long, and arithmetic on milliseconds
// duplicates or skips one when the clock changes.
export const dayKeys = (from = todayLocal(), count = 7) => {
  const start = parseDay(from);
  return Array.from({ length: count }, (_, i) =>
    formatDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)),
  );
};

// Jobs store `scheduledDate` (a bare day); maintenance stores `scheduled_date`
// and some rows carry a full timestamp. Normalise both to a day key.
export const dayKeyOf = (value) => (value ? String(value).split("T")[0] : null);

export const isFinishedJob = (j) => j.status === "completed" || j.status === "closed";

// The calendar grid for a month: whole weeks, Sunday-first, so the month always
// starts on the right weekday and the grid is a clean 7 x n.
//
// `month` is 0-indexed, matching Date.getMonth().
export const monthGrid = (year, month) => {
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  const last = new Date(year, month + 1, 0);
  // Days from the grid start through the end of the week containing the last day.
  const span = last.getDate() + first.getDay() + (6 - new Date(year, month, last.getDate()).getDay());
  return dayKeys(formatDay(gridStart), span);
};

// Everything happening on each day in `keys`.
//
// A job appears on its scheduled day. A job with no schedule is not guessed at
// and simply does not appear — inferring one from createdAt would invent history.
// Maintenance appears only once it has a date, since a pending request has no day
// to sit on.
//
// `includeFinished` is the difference between the two surfaces: the dashboard
// card looks forward and hides completed work, the month view looks backward and
// must show it, because seeing past jobs is the whole point of opening it.
export const buildSchedule = ({
  jobs = [],
  reqs = [],
  jobTrailers = [],
  vehs = [],
  users = [],
  from,
  days = 7,
  keys: providedKeys,
  includeFinished = false,
} = {}) => {
  const keys = providedKeys || dayKeys(from, days);
  const window = new Set(keys);
  const buckets = new Map(keys.map((k) => [k, { key: k, jobs: [], maint: [], trailerIds: new Set() }]));

  for (const j of jobs) {
    if (!includeFinished && isFinishedJob(j)) continue;
    const key = dayKeyOf(j.scheduledDate);
    if (!key || !window.has(key)) continue;
    const bucket = buckets.get(key);
    const trailerIds = jobTrailers.filter((jt) => jt.job_id === j.id).map((jt) => jt.trailer_id);
    trailerIds.forEach((id) => bucket.trailerIds.add(id));
    bucket.jobs.push({
      id: j.id,
      title: j.title || j.name || j.po || "Untitled job",
      po: j.po || null,
      status: j.status,
      finished: isFinishedJob(j),
      supervisor: users.find((u) => u.id === (j.assignedto || j.assignedTo))?.name || null,
      trailers: trailerIds.map((id) => vehs.find((v) => v.id === id)?.name).filter(Boolean),
    });
  }

  for (const r of reqs) {
    if (!includeFinished && r.status === "completed") continue;
    const key = dayKeyOf(r.scheduled_date);
    if (!key || !window.has(key)) continue;
    buckets.get(key).maint.push({
      id: r.id,
      vehicle: vehs.find((v) => String(v.id) === String(r.vehicle_id))?.name || r.vname || "Vehicle",
      vehicleId: r.vehicle_id,
      issue: r.type || r.issue || "Service",
      urgency: r.urgency,
      finished: r.status === "completed",
    });
  }

  return keys.map((k) => {
    const b = buckets.get(k);
    // A truck cannot be out on a job and in the shop the same day. This is the
    // collision no single existing calendar can see, since trailers live in Fleet
    // and shop time lives in Maintenance. Finished work is excluded: a conflict
    // that already resolved itself is not worth warning about.
    const booked = new Set(b.trailerIds);
    const conflicts = b.maint
      .filter((m) => !m.finished && booked.has(m.vehicleId))
      .map((m) => m.vehicle);
    return { ...b, trailerCount: b.trailerIds.size, conflicts };
  });
};

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
