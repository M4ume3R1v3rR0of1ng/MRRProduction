// src/utils/patterns.js
// Pure, in-memory pattern analysis over already-loaded fleet/maintenance data —
// same style as oilSt/detSt/predDays in helpers.js. No backend, no training.

// Learns each vehicle's real-world interval (days + miles) per service type
// from its own service log (vehicle.sl) and projects the next due date/mileage.
export function learnServiceIntervals(vehicle) {
  if (!vehicle?.sl || vehicle.sl.length < 2) return [];

  const byType = {};
  for (const s of vehicle.sl) {
    if (!s.type || !s.dt) continue;
    (byType[s.type] ||= []).push(s);
  }

  const results = [];
  for (const [type, entries] of Object.entries(byType)) {
    if (entries.length < 2) continue;
    const sorted = [...entries].sort((a, b) => new Date(a.dt) - new Date(b.dt));

    const dayGaps = [];
    const mileGaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const days = (new Date(sorted[i].dt) - new Date(sorted[i - 1].dt)) / 86400000;
      if (days > 0) dayGaps.push(days);
      if (typeof sorted[i].mi === "number" && typeof sorted[i - 1].mi === "number" && sorted[i].mi > sorted[i - 1].mi) {
        mileGaps.push(sorted[i].mi - sorted[i - 1].mi);
      }
    }
    if (dayGaps.length === 0) continue;

    const avgDays = dayGaps.reduce((a, b) => a + b, 0) / dayGaps.length;
    const avgMiles = mileGaps.length ? mileGaps.reduce((a, b) => a + b, 0) / mileGaps.length : null;
    const last = sorted[sorted.length - 1];
    const predictedNextDate = new Date(new Date(last.dt).getTime() + avgDays * 86400000)
      .toISOString()
      .split("T")[0];

    results.push({
      type,
      sampleSize: dayGaps.length,
      lastServiceDate: last.dt,
      lastServiceMileage: typeof last.mi === "number" ? last.mi : null,
      avgIntervalDays: Math.round(avgDays),
      avgIntervalMiles: avgMiles !== null ? Math.round(avgMiles) : null,
      predictedNextDate,
      predictedNextMileage:
        avgMiles !== null && typeof last.mi === "number" ? Math.round(last.mi + avgMiles) : null,
    });
  }

  return results.sort((a, b) => new Date(a.predictedNextDate) - new Date(b.predictedNextDate));
}

// Flags vehicle+issue-type combos that recur often within a trailing window —
// a "chronic" problem worth deeper inspection rather than another quick fix.
export function detectChronicIssues(reqs, { windowDays = 60, minCount = 3 } = {}) {
  const cutoff = Date.now() - windowDays * 86400000;
  const groups = {};

  for (const r of reqs || []) {
    if (!r.at || new Date(r.at).getTime() < cutoff) continue;
    const types = (r.type || "").split(",").map((t) => t.trim()).filter(Boolean);
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
    const types = (r.type || "").split(",").map((x) => x.trim()).filter(Boolean);
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
