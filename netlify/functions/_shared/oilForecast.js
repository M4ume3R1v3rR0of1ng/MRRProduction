// netlify/functions/_shared/oilForecast.js
//
// Oil-change status and due-date projection for a truck, from its OWN mileage
// history — not a fleet-wide guess. Extracted out of chat.js (where it powers
// get_fleet_status / recommend_maintenance) so the new daily
// send-maintenance-push-notices job can compute the exact same numbers
// without a second, drifting copy. Both files run in the same Netlify
// functions ESM bundle, so a real shared import is safe here — unlike
// src/shared/utils/helpers.js's oilSt/predDays/detSt, which is a genuinely
// separate copy for the browser bundle and stays that way.
//
// The scoring/arithmetic lives here in JS, not SQL and not the LLM — see the
// comment this was lifted from in chat.js for why: asking a model to do
// mileage math across a fleet is exactly the kind of task it gets quietly
// wrong.

const DAY_MS = 86400000;

// Stored dates are plain calendar days ("YYYY-MM-DD"). Parse and format both
// ends in one frame (UTC) so a projection never drifts across a day boundary.
export function parseDay(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("T")[0].split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export function oilStatus(v) {
  if (v.type !== "truck") return null;
  const interval = Number(v.oii);
  if (!interval || interval <= 0) return null;
  const milesSince = (Number(v.mi) || 0) - (Number(v.lomi) || 0);
  const pct = milesSince / interval;
  return {
    milesSince: Math.round(milesSince),
    interval,
    milesRemaining: Math.round(interval - milesSince),
    state: pct >= 1 ? "overdue" : pct >= 0.8 ? "soon" : "ok",
  };
}

// Days until the oil change comes due, projected from how fast this truck
// actually accrues miles rather than a fleet-wide guess.
export function daysUntilOilDue(v) {
  if (v.type !== "truck" || !Array.isArray(v.mil) || v.mil.length < 2) return null;
  // Every current caller only reaches this after oilStatus() already filtered
  // out a missing/zero interval, so this guard was previously unreachable —
  // but projectedOilDueDate() below calls this directly, and Number(v.oii)
  // being NaN would otherwise silently propagate into an Invalid Date.
  const interval = Number(v.oii);
  if (!interval || interval <= 0) return null;
  const log = v.mil
    .filter((e) => e?.dt && typeof e.mi === "number" && parseDay(e.dt))
    .sort((a, b) => parseDay(a.dt) - parseDay(b.dt));
  if (log.length < 2) return null;
  const spanDays = (parseDay(log[log.length - 1].dt) - parseDay(log[0].dt)) / DAY_MS;
  if (spanDays < 1) return null;
  const milesPerDay = (log[log.length - 1].mi - log[0].mi) / spanDays;
  if (milesPerDay <= 0) return null;
  const remaining = interval - ((Number(v.mi) || 0) - (Number(v.lomi) || 0));
  return remaining <= 0 ? 0 : Math.round(remaining / milesPerDay);
}

// The calendar date daysUntilOilDue projects, as a "YYYY-MM-DD" string, or
// null on the same conditions daysUntilOilDue returns null for. Convenience
// for callers (send-maintenance-push-notices) that need to compare against a
// stored date rather than a day count that shifts by one every day the job runs.
export function projectedOilDueDate(v, { today = new Date() } = {}) {
  const days = daysUntilOilDue(v);
  if (days === null) return null;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return new Date(start + days * DAY_MS).toISOString().split("T")[0];
}
