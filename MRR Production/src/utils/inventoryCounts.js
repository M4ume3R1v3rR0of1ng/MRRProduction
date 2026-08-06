// src/utils/inventoryCounts.js
//
// Monthly stock reconciliation: what the books SAY should be on the shelf versus
// what someone physically counted, and the gap between them.
//
// That gap is the whole point. Every other number in this app is derived from the
// books, so the books can never disagree with themselves — an item reads -1 and the
// system is perfectly consistent about it. Only a physical count introduces an
// outside fact, and only then can "we are losing about 3% of our ridge vent" be
// said at all.
//
// Everything here is pure. The batch list and the job list are the inputs; nothing
// is fetched, nothing is written. That keeps the arithmetic testable, which matters
// because these numbers accuse people of losing material.

import { formatDay, parseDay, tot, newestPrice, batchKind } from "./helpers";

// A period is a calendar month, "YYYY-MM".
//
// Derived through formatDay(parseDay(x)) rather than by slicing the raw string.
// Batch dates are already local calendar days, but job timestamps are UTC ISO
// strings — slicing those directly files a job completed at 8pm on Jan 31 (which
// is Feb 1 in UTC) into February, and month-boundary work is exactly when someone
// is watching these numbers.
export const periodOf = (d) => (d ? formatDay(parseDay(d)).slice(0, 7) : null);

export const currentPeriod = () => formatDay(new Date()).slice(0, 7);

// "2026-01" shifted by -1 gives "2025-12". Day 1 of the month keeps the arithmetic
// away from the 31st-of-February class of bug.
export const shiftPeriod = (period, months) => {
  const [y, m] = String(period).split("-").map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return formatDay(d).slice(0, 7);
};

export const periodLabel = (period) => {
  const [y, m] = String(period).split("-").map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

// The last N periods, newest first, ending at `endPeriod`.
export const recentPeriods = (endPeriod, n) =>
  Array.from({ length: n }, (_, i) => shiftPeriod(endPeriod, -i));

// ── When a job line moved ────────────────────────────────────────────────────
//
// Pulls and returns are two events on different days, and a job that pulls in
// January and closes in February straddles a period boundary. Dating both to the
// same timestamp would move a whole month's usage into the wrong month.
//
// `pulledAt` is stamped at pull time. Older rows predate it, so fall back through
// the job dates that do exist. The fallback is approximate by nature; it is still
// far better than dropping the line, which would silently understate usage.
export const pullDateOf = (job, line) =>
  line?.pulledAt || job?.pulledAt || job?.approved || job?.completed || job?.completedAt || job?.created || job?.createdAt || null;

export const returnDateOf = (job, line) =>
  job?.completed || job?.completedAt || pullDateOf(job, line);

// Net material that left the yard for jobs in this period, per inventory id.
// Returns are subtracted in the period they came BACK, not the period they went out.
export function usageByItem(jobs, period) {
  const out = new Map();
  const add = (iid, field, qty) => {
    if (!iid || !qty) return;
    const row = out.get(iid) || { pulled: 0, returned: 0 };
    row[field] += qty;
    out.set(iid, row);
  };

  for (const job of jobs || []) {
    if (!job) continue;
    // Drafts have not pulled anything. Everything else can have, including jobs
    // reopened after close.
    if (job.status === "draft") continue;
    for (const line of job.items || job.materials || []) {
      if (!line || !line.iid) continue;
      const pulled = parseFloat(line.pulled) || 0;
      const returned = parseFloat(line.returned) || 0;
      if (pulled && periodOf(pullDateOf(job, line)) === period) add(line.iid, "pulled", pulled);
      if (returned && periodOf(returnDateOf(job, line)) === period) add(line.iid, "returned", returned);
    }
  }
  return out;
}

// Receipts and upward corrections dated inside the period, per inventory id.
//
// Downward corrections leave NO row: Adjust Stock walks the existing batches down
// in place. So a write-off is invisible here by construction, and lands in the
// variance instead. That is the honest outcome — an unexplained write-off and an
// unexplained disappearance are the same event as far as the shelf is concerned.
export function movementByItem(item, period) {
  let received = 0;
  let adjusted = 0;
  let shortfall = 0;
  for (const b of item?.batches || []) {
    if (periodOf(b?.rcvd) !== period) continue;
    const qty = parseFloat(b?.qty) || 0;
    const kind = batchKind(b);
    if (kind === "receipt") received += qty;
    else if (kind === "adjustment") adjusted += qty;
    else if (kind === "shortfall") shortfall += Math.abs(qty);
  }
  return { received, adjusted, shortfall };
}

const round = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

// Build the count sheet for one period.
//
//   opening   last period's COUNTED number when there is one, because a count is a
//             fact and the book is only a claim. With no prior count, roll today's
//             book balance backwards through this period's movements.
//   expected  opening + received + adjusted - used
//   variance  counted - expected. Negative means material left without a record.
//
// `entries` is what people have typed so far, as { [iid]: { counted, at, by } }.
// Lines with nothing typed carry counted: null, which is NOT the same as zero —
// "nobody has counted this yet" must never render as "we have none".
export function buildCountLines(inv, jobs, period, { previousLines = [], entries = {} } = {}) {
  const usage = usageByItem(jobs, period);
  const prevCounted = new Map(
    (previousLines || [])
      .filter((l) => l && l.iid != null && l.counted != null)
      .map((l) => [l.iid, parseFloat(l.counted) || 0]),
  );

  return (inv || [])
    .filter(Boolean)
    .map((item) => {
      const { received, adjusted, shortfall } = movementByItem(item, period);
      const u = usage.get(item.id) || { pulled: 0, returned: 0 };
      const used = u.pulled - u.returned;
      const onHand = tot(item);

      const hasPrior = prevCounted.has(item.id);
      const opening = hasPrior
        ? prevCounted.get(item.id)
        : round(onHand - received - adjusted + used);

      const expected = round(opening + received + adjusted - used);

      const entry = entries?.[item.id];
      const counted =
        entry && entry.counted !== "" && entry.counted != null && !Number.isNaN(parseFloat(entry.counted))
          ? parseFloat(entry.counted)
          : null;

      return {
        iid: item.id,
        name: item.name,
        cat: item.cat || "",
        unit: item.unit || "",
        price: newestPrice(item),
        openingSource: hasPrior ? "counted" : "derived",
        opening,
        received: round(received),
        adjusted: round(adjusted),
        pulled: round(u.pulled),
        returned: round(u.returned),
        used: round(used),
        shortfall: round(shortfall),
        onHand: round(onHand),
        expected,
        counted,
        variance: counted == null ? null : round(counted - expected),
        countedAt: entry?.at || null,
        countedBy: entry?.by || null,
      };
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true }));
}

// Bleed rate: the share of everything that passed through the yard this period
// which cannot be accounted for.
//
// The denominator is throughput (opening + received + adjusted), not the closing
// balance. Measured against the closing balance, an item that turns over completely
// each month produces a meaningless percentage — and those fast movers are exactly
// where material goes missing.
//
// Only counted lines participate. An uncounted item contributes nothing to either
// side, so a half-finished sheet reports the bleed of the half that was counted
// rather than pretending the rest balanced.
export function summarizeCount(lines) {
  const counted = (lines || []).filter((l) => l && l.counted != null);
  const throughput = counted.reduce((s, l) => s + Math.max(0, l.opening + l.received + l.adjusted), 0);
  const variance = counted.reduce((s, l) => s + (l.variance || 0), 0);
  const shrinkUnits = counted.reduce((s, l) => s + Math.min(0, l.variance || 0), 0);
  const value = counted.reduce((s, l) => s + (l.variance || 0) * (l.price || 0), 0);
  const shrinkValue = counted.reduce((s, l) => s + Math.min(0, l.variance || 0) * (l.price || 0), 0);

  return {
    total: (lines || []).length,
    countedCount: counted.length,
    // Signed. Negative is material lost, positive is material found.
    varianceUnits: round(variance),
    varianceValue: round(value),
    shrinkUnits: round(shrinkUnits),
    shrinkValue: round(shrinkValue),
    throughput: round(throughput),
    // Percent of throughput unaccounted for. Negative = bleeding.
    bleedPct: throughput > 0 ? round((variance / throughput) * 100) : 0,
    // How far off the books were in EITHER direction. A yard that is 5 over on one
    // item and 5 under on another nets to zero, which reads as perfect control and
    // is not. This is the number that says how well the counts are being kept.
    absVarianceUnits: round(counted.reduce((s, l) => s + Math.abs(l.variance || 0), 0)),
  };
}

// Items whose variance is worth chasing, worst first. A tolerance keeps rounding
// on bulk goods (nails by the pound) out of a list meant to be acted on.
export function flaggedLines(lines, { tolerancePct = 2, minUnits = 1 } = {}) {
  return (lines || [])
    .filter((l) => {
      if (!l || l.variance == null || l.variance === 0) return false;
      const base = Math.max(1, l.opening + l.received + l.adjusted);
      return Math.abs(l.variance) >= minUnits && (Math.abs(l.variance) / base) * 100 >= tolerancePct;
    })
    .sort((a, b) => Math.abs(b.variance * (b.price || 1)) - Math.abs(a.variance * (a.price || 1)));
}

// Bleed across several closed periods for one item, oldest first — the trend that
// separates "someone miscounted once" from "this walks off every month".
export function bleedTrend(closedCounts, iid) {
  return (closedCounts || [])
    .filter((c) => c && c.status === "closed")
    .map((c) => {
      const line = (c.lines || []).find((l) => l && l.iid === iid && l.counted != null);
      return line
        ? { period: c.period, variance: line.variance, value: round((line.variance || 0) * (line.price || 0)) }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.period.localeCompare(b.period));
}
