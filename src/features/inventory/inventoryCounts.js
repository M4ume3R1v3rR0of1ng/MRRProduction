// src/features/inventory/inventoryCounts.js
//
// Stock reconciliation: what the books SAY should be on the shelf versus what
// someone physically counted, and the gap between them. Monthly or weekly — see
// the cadence block below.
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

import { formatDay, parseDay, tot, newestPrice, batchKind } from "@/shared/utils/helpers";

// ─────────────────────────────────────────────────────────────────────────────
// CADENCE
//
// A period is either a calendar month, "2026-10", or an ISO week, "2026-W41".
// The STRING SHAPE IS the cadence — there is no separate column or flag saying
// which kind a row is, because two sources of truth for that would be one too
// many. cadenceOf() reads it back off any period string.
//
// ONE CADENCE AT A TIME, per company, stored in settings(key =
// 'inventory_count_cadence'). Weekly and monthly counts deliberately do NOT
// coexist as parallel chains: a week sits inside a month, so the same receipts
// and the same job usage would be reconciled twice, and "last period's counted
// number" — the one input the whole chain depends on — would have two answers.
// See the same warning in supabase/20_inventory_counts.sql.
//
// Switching cadence is safe and does not need a cutover: the chain looks
// backwards by DATE (see previousClosedCount), not by period name, so the first
// weekly count after a switch still opens from the last monthly count that
// closed before it.
// ─────────────────────────────────────────────────────────────────────────────

export const MONTHLY = "monthly";
export const WEEKLY = "weekly";
export const CADENCES = [MONTHLY, WEEKLY];

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WEEK_RE = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

// Which kind of period this string is, or null if it is neither. Anything
// reading a stored period goes through this rather than sniffing for a "W".
export const cadenceOf = (period) => {
  const p = String(period ?? "");
  if (MONTH_RE.test(p)) return MONTHLY;
  if (WEEK_RE.test(p)) return WEEKLY;
  return null;
};

const DAY_MS = 86400000;

// Monday-as-0 index. JS getDay() is Sunday-as-0, and every ISO week calculation
// below counts from Monday, so doing this conversion in one place is what keeps
// the off-by-one out of the rest of the file.
const mondayIndex = (date) => (date.getDay() + 6) % 7;

// The ISO year and week number a date falls in.
//
// ISO 8601 weeks run Monday to Sunday, and week 1 is the week containing the
// first Thursday of January. The consequence worth knowing: the ISO YEAR is not
// always the calendar year. 2026-12-31 is a Thursday, so it belongs to week 53
// of 2026; but 2027-01-01 (Friday) is in that SAME week, and is therefore
// "2026-W53", not "2027-W01". Deriving the year from getFullYear() instead of
// from the week's own Thursday is the classic way to file a day into a week that
// does not contain it.
export function isoWeekParts(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Step to the Thursday of this week; whichever year that Thursday is in is the
  // ISO year, by definition of week 1 above.
  d.setDate(d.getDate() - mondayIndex(d) + 3);
  const isoYear = d.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const week1Thursday = new Date(isoYear, 0, 4 - mondayIndex(jan4) + 3);
  const week = 1 + Math.round((d - week1Thursday) / (7 * DAY_MS));
  return { isoYear, week };
}

// The Monday that starts a given ISO week. The inverse of isoWeekParts.
export function isoWeekStart(isoYear, week) {
  const jan4 = new Date(isoYear, 0, 4);
  const week1Monday = new Date(isoYear, 0, 4 - mondayIndex(jan4));
  week1Monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  return week1Monday;
}

// A date to the period that contains it, at the cadence asked for.
//
// Derived through formatDay(parseDay(x)) rather than by slicing the raw string.
// Batch dates are already local calendar days, but job timestamps are UTC ISO
// strings — slicing those directly files a job completed at 8pm on Jan 31 (which
// is Feb 1 in UTC) into February, and period-boundary work is exactly when
// someone is watching these numbers.
export const periodOf = (d, cadence = MONTHLY) => {
  if (!d) return null;
  const day = parseDay(formatDay(parseDay(d)));
  if (cadence === WEEKLY) {
    const { isoYear, week } = isoWeekParts(day);
    return `${isoYear}-W${String(week).padStart(2, "0")}`;
  }
  return formatDay(day).slice(0, 7);
};

export const currentPeriod = (cadence = MONTHLY) => periodOf(new Date(), cadence);

// First and last calendar day of a period, as "YYYY-MM-DD".
//
// These are what make the rest of the file cadence-blind: every "is this date in
// this period" question becomes a string comparison against these two bounds,
// and ISO-format dates compare correctly as strings.
export const periodStart = (period) => {
  const kind = cadenceOf(period);
  if (kind === WEEKLY) {
    const [, y, w] = WEEK_RE.exec(String(period));
    return formatDay(isoWeekStart(Number(y), Number(w)));
  }
  if (kind === MONTHLY) {
    const [, y, m] = MONTH_RE.exec(String(period));
    return formatDay(new Date(Number(y), Number(m) - 1, 1));
  }
  return null;
};

export const periodEnd = (period) => {
  const kind = cadenceOf(period);
  if (kind === WEEKLY) {
    const [, y, w] = WEEK_RE.exec(String(period));
    const d = isoWeekStart(Number(y), Number(w));
    d.setDate(d.getDate() + 6); // Monday + 6 = Sunday
    return formatDay(d);
  }
  if (kind === MONTHLY) {
    const [, y, m] = MONTH_RE.exec(String(period));
    // Day 0 of the NEXT month is the last day of this one, which avoids having to
    // know which months have 31 days or whether February is leaping.
    return formatDay(new Date(Number(y), Number(m), 0));
  }
  return null;
};

// Does `period` contain the day `d`? The cadence-general replacement for
// comparing periodOf(d) against a period string, which only worked while every
// period was the same kind.
export const periodContains = (period, d) => {
  if (!d) return false;
  const start = periodStart(period);
  const end = periodEnd(period);
  if (!start || !end) return false;
  const day = formatDay(parseDay(d));
  return day >= start && day <= end;
};

// Shift a period by n of its own units: months for a month, weeks for a week.
//
// "2026-01" shifted by -1 gives "2025-12"; "2026-W01" shifted by -1 gives
// "2025-W53". Both go via a real date rather than by decrementing the number in
// the string, which is what keeps week 1 and January from underflowing into a
// week 0 or a month 0 that do not exist.
export const shiftPeriod = (period, n) => {
  const kind = cadenceOf(period);
  if (kind === WEEKLY) {
    const d = parseDay(periodStart(period));
    d.setDate(d.getDate() + n * 7);
    return periodOf(d, WEEKLY);
  }
  if (kind === MONTHLY) {
    const [, y, m] = MONTH_RE.exec(String(period));
    // Day 1 keeps the arithmetic away from the 31st-of-February class of bug.
    return formatDay(new Date(Number(y), Number(m) - 1 + n, 1)).slice(0, 7);
  }
  return period;
};

export const periodLabel = (period) => {
  const kind = cadenceOf(period);
  if (kind === WEEKLY) {
    const [, , w] = WEEK_RE.exec(String(period));
    const start = parseDay(periodStart(period));
    const end = parseDay(periodEnd(period));
    const sameMonth = start.getMonth() === end.getMonth();
    const from = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const to = end.toLocaleDateString(
      "en-US",
      sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
    );
    return `Week ${Number(w)} · ${from}–${to}, ${end.getFullYear()}`;
  }
  if (kind === MONTHLY) {
    const [, y, m] = MONTH_RE.exec(String(period));
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }
  return period;
};

// The last N periods, newest first, ending at `endPeriod`. Stays at whatever
// cadence `endPeriod` is.
export const recentPeriods = (endPeriod, n) =>
  Array.from({ length: n }, (_, i) => shiftPeriod(endPeriod, -i));

// The count whose counted numbers open `period`.
//
// WHY THIS IS NOT shiftPeriod(period, -1)
//
// It used to be, as an exact string match on the immediately preceding period,
// and that had two failure modes which both ended the same way — silently
// re-deriving the opening balance from the book, discarding a physical count
// that exists:
//
//   1. A SKIPPED PERIOD. Nobody counted in September, so October looked for
//      "2026-09", found nothing, and ignored August's perfectly good count.
//   2. A CADENCE SWITCH. The first weekly count looks for last week, which never
//      existed because the company was counting monthly until yesterday.
//
// So: the most recent CLOSED count that ended before this period begins,
// whatever cadence it was taken at. Open counts are excluded because their
// `lines` are empty until close (see supabase/20) — only a frozen
// reconciliation carries counted numbers worth opening from.
export function previousClosedCount(counts, period) {
  const start = periodStart(period);
  if (!start) return null;
  let best = null;
  let bestEnd = null;
  for (const c of counts || []) {
    if (!c || c.status !== "closed") continue;
    const end = periodEnd(c.period);
    if (!end || end >= start) continue;
    if (bestEnd === null || end > bestEnd) {
      best = c;
      bestEnd = end;
    }
  }
  return best;
}

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
  line?.pulledAt ||
  job?.pulledAt ||
  job?.approved ||
  job?.completed ||
  job?.completedAt ||
  job?.created ||
  job?.createdAt ||
  null;

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
      if (pulled && periodContains(period, pullDateOf(job, line))) add(line.iid, "pulled", pulled);
      if (returned && periodContains(period, returnDateOf(job, line)))
        add(line.iid, "returned", returned);
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
    if (!periodContains(period, b?.rcvd)) continue;
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
        entry &&
        entry.counted !== "" &&
        entry.counted != null &&
        !Number.isNaN(parseFloat(entry.counted))
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
  const throughput = counted.reduce(
    (s, l) => s + Math.max(0, l.opening + l.received + l.adjusted),
    0,
  );
  const variance = counted.reduce((s, l) => s + (l.variance || 0), 0);
  const shrinkUnits = counted.reduce((s, l) => s + Math.min(0, l.variance || 0), 0);
  const value = counted.reduce((s, l) => s + (l.variance || 0) * (l.price || 0), 0);
  const shrinkValue = counted.reduce(
    (s, l) => s + Math.min(0, l.variance || 0) * (l.price || 0),
    0,
  );

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
      return (
        Math.abs(l.variance) >= minUnits && (Math.abs(l.variance) / base) * 100 >= tolerancePct
      );
    })
    .sort((a, b) => Math.abs(b.variance * (b.price || 1)) - Math.abs(a.variance * (a.price || 1)));
}

// Bleed across several closed periods for one item, oldest first — the trend that
// separates "someone miscounted once" from "this walks off every month".
export function bleedTrend(closedCounts, iid) {
  return (
    (closedCounts || [])
      .filter((c) => c && c.status === "closed")
      .map((c) => {
        const line = (c.lines || []).find((l) => l && l.iid === iid && l.counted != null);
        return line
          ? {
              period: c.period,
              variance: line.variance,
              value: round((line.variance || 0) * (line.price || 0)),
            }
          : null;
      })
      .filter(Boolean)
      // By START DATE, not by string. A company that switched cadence has both
      // shapes in its history, and "2026-W05" sorts after "2026-12" lexically —
      // which would draw the trend line in the wrong order across the switch.
      .sort((a, b) => String(periodStart(a.period)).localeCompare(String(periodStart(b.period))))
  );
}
