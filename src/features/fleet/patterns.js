// src/features/fleet/patterns.js
// Pure, in-memory pattern analysis over already-loaded fleet/maintenance data —
// same style as oilSt/detSt/predDays in helpers.js. No backend, no training.
import { parseDay, formatDay } from "@/shared/utils/helpers";

const DAY_MS = 86400000;

// A calendar day ("YYYY-MM-DD") as a UTC instant, or NaN if it isn't one.
//
// WHY A SECOND PARSE AND NOT parseDay
//
// These two numbers get SUBTRACTED, and that only works in a frame where every
// day is exactly 86,400,000ms long. parseDay deliberately returns LOCAL
// midnight, which is the right thing for display and for the projection below,
// but a local span that crosses a daylight-saving change is 23 or 25 hours —
// so an interval measured that way comes out at 364.96 days instead of 365, and
// the published "every ~292d" average drifts a little further with every
// transition the log happens to span. Measuring in UTC, where there are no
// transitions, keeps a gap a whole number of days. Same reasoning as
// netlify/functions/_shared/oilForecast.js's parseDay, which does this for the
// mileage-based forecast.
//
// Returning NaN rather than throwing also gives the caller a cheap way to drop
// a service record whose `dt` is not a date at all — see the filter below.
function utcDay(value) {
  const [y, m, d] = String(value ?? "")
    .split("T")[0]
    .split("-")
    .map(Number);
  return y && m && d ? Date.UTC(y, m - 1, d) : NaN;
}

// Learns each vehicle's real-world interval (days + miles) per service type
// from its own service log (vehicle.sl) and projects the next due date/mileage.
export function learnServiceIntervals(vehicle) {
  if (!vehicle?.sl || vehicle.sl.length < 2) return [];

  const byType = {};
  for (const s of vehicle.sl) {
    // An unparseable `dt` is dropped rather than carried: it would make every
    // gap it touches NaN, and the average with it, which surfaces as a
    // confident "Invalid Date" on the vehicle card.
    if (!s.type || !s.dt || Number.isNaN(utcDay(s.dt))) continue;
    (byType[s.type] ||= []).push(s);
  }

  const results = [];
  for (const [type, entries] of Object.entries(byType)) {
    if (entries.length < 2) continue;
    const sorted = [...entries].sort((a, b) => utcDay(a.dt) - utcDay(b.dt));

    const dayGaps = [];
    const mileGaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const days = (utcDay(sorted[i].dt) - utcDay(sorted[i - 1].dt)) / DAY_MS;
      if (days > 0) dayGaps.push(days);
      if (
        typeof sorted[i].mi === "number" &&
        typeof sorted[i - 1].mi === "number" &&
        sorted[i].mi > sorted[i - 1].mi
      ) {
        mileGaps.push(sorted[i].mi - sorted[i - 1].mi);
      }
    }
    if (dayGaps.length === 0) continue;

    const avgDays = dayGaps.reduce((a, b) => a + b, 0) / dayGaps.length;
    const avgMiles = mileGaps.length ? mileGaps.reduce((a, b) => a + b, 0) / mileGaps.length : null;
    const avgIntervalDays = Math.round(avgDays);
    const last = sorted[sorted.length - 1];

    // THE PROJECTION IS CALENDAR ADDITION, NOT MILLISECOND ADDITION.
    //
    // Both ends stay in local calendar space: parsing with new Date() and
    // formatting with toISOString() would shift the projection across a day
    // boundary twice over, in opposite directions.
    //
    // But local midnight + N * 86,400,000ms is NOT N days later either. Over a
    // span that falls back an hour it lands at 23:00 on the day BEFORE the one
    // intended, and formatDay then reads local components and names that
    // earlier day — a silent one-day-early projection for any interval long
    // enough to cross November, which at a ~292d oil-change cadence is most of
    // them. setDate() moves whole calendar days and is indifferent to what the
    // clocks did in between (it also rolls months and years over on its own).
    //
    // Adding the ROUNDED average, not the raw one, is what makes
    // `lastServiceDate + avgIntervalDays` land exactly on predictedNextDate.
    // The two were previously computed from different numbers and could name
    // dates a day apart, which is impossible to defend to someone reading the
    // card.
    const predicted = parseDay(last.dt);
    predicted.setDate(predicted.getDate() + avgIntervalDays);

    results.push({
      type,
      // Services logged, not gaps between them. The card says "Based on N past
      // services", and three oil changes are three services with two intervals
      // between them — reporting the gap count there undercounted the history
      // by one and called a two-service history "1 past service".
      serviceCount: sorted.length,
      sampleSize: dayGaps.length,
      lastServiceDate: last.dt,
      lastServiceMileage: typeof last.mi === "number" ? last.mi : null,
      avgIntervalDays,
      avgIntervalMiles: avgMiles !== null ? Math.round(avgMiles) : null,
      predictedNextDate: formatDay(predicted),
      predictedNextMileage:
        avgMiles !== null && typeof last.mi === "number" ? Math.round(last.mi + avgMiles) : null,
    });
  }

  return results.sort((a, b) => utcDay(a.predictedNextDate) - utcDay(b.predictedNextDate));
}

// Flags vehicle+issue-type combos that recur often within a trailing window —
// a "chronic" problem worth deeper inspection rather than another quick fix.
export function detectChronicIssues(reqs, { windowDays = 60, minCount = 3 } = {}) {
  const cutoff = Date.now() - windowDays * 86400000;
  const groups = {};

  for (const r of reqs || []) {
    if (!r.at || new Date(r.at).getTime() < cutoff) continue;
    const types = (r.type || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    for (const t of types) {
      const key = `${r.vid}::${t}`;
      (groups[key] ||= { vid: r.vid, vname: r.vname, issueType: t, dates: [] }).dates.push(r.at);
    }
  }

  return Object.values(groups)
    .filter((g) => g.dates.length >= minCount)
    .map((g) => ({ ...g, count: g.dates.length, dates: g.dates.sort() }))
    .sort((a, b) => b.count - a.count);
}

// Flags issue types whose recent daily rate has spiked versus their prior
// baseline rate (or that are entirely new) — catches systemic problems like a
// bad parts batch or a model-wide issue, not just one vehicle's history.
export function detectFleetTrends(
  reqs,
  { recentDays = 30, baselineDays = 90, minRecentCount = 3, spikeRatio = 1.5 } = {},
) {
  const now = Date.now();
  const recentCutoff = now - recentDays * 86400000;
  const baselineCutoff = recentCutoff - baselineDays * 86400000;

  const recentCounts = {};
  const baselineCounts = {};
  for (const r of reqs || []) {
    if (!r.at) continue;
    const t = new Date(r.at).getTime();
    const types = (r.type || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (t >= recentCutoff) {
      for (const type of types) recentCounts[type] = (recentCounts[type] || 0) + 1;
    } else if (t >= baselineCutoff) {
      for (const type of types) baselineCounts[type] = (baselineCounts[type] || 0) + 1;
    }
  }

  const allTypes = new Set([...Object.keys(recentCounts), ...Object.keys(baselineCounts)]);
  const results = [];
  for (const type of allTypes) {
    const recentCount = recentCounts[type] || 0;
    if (recentCount < minRecentCount) continue;

    const recentRate = recentCount / recentDays;
    const baselineCount = baselineCounts[type] || 0;
    const baselineRate = baselineCount / baselineDays;
    const isNew = baselineCount === 0;
    const ratio = isNew ? null : recentRate / baselineRate;

    if (isNew || ratio >= spikeRatio) {
      results.push({
        issueType: type,
        recentCount,
        baselineCount,
        ratio: ratio !== null ? Math.round(ratio * 10) / 10 : null,
        isNew,
      });
    }
  }

  return results.sort((a, b) => b.recentCount - a.recentCount);
}
