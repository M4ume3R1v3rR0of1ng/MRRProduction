// netlify/functions/_shared/localTime.js
//
// "What time is it for the people reading this?", for the two crons that write A.N.V.I.L.'s
// daily messages (send-daily-briefing.js at 7am, send-end-of-day-recap.js at 5pm).
//
// WHY THIS EXISTS. A Netlify cron is written in UTC, and America/New_York is UTC-5 in winter
// and UTC-4 in summer. A single fixed UTC time is therefore 7am for half the year and 8am for
// the other half. The fix is to schedule the cron at BOTH candidate UTC hours and let the
// handler run only when the local hour is the one wanted (isLocalHour): exactly one of the two
// firings passes, in either season.
//
// There is no per-company time zone column yet, so everything uses one platform zone. A tenant
// outside Eastern time gets Eastern times. That is a known limit, not an oversight; a
// companies.timezone column would let this take a company's own zone without changing callers.

export const PLATFORM_TZ = "America/New_York";

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The calendar day, hour (0-23) and weekday (0 = Sunday) in `tz` at the instant `date`.
 * @param {Date} [date]
 * @param {string} [tz]
 * @returns {{ day: string, hour: number, weekday: number }}
 */
export function localParts(date = new Date(), tz = PLATFORM_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  /** @param {string} type */
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    weekday: WEEKDAY[/** @type {keyof typeof WEEKDAY} */ (get("weekday"))] ?? 0,
  };
}

/**
 * @param {Date} date
 * @param {number} hour - the local hour wanted, 0-23
 * @param {string} [tz]
 */
export function isLocalHour(date, hour, tz = PLATFORM_TZ) {
  return localParts(date, tz).hour === hour;
}

/**
 * The local calendar day a stored value falls on. A date-only value ("2026-11-11") already IS a
 * calendar day and is returned as it is. A full timestamp is converted, so something finished at
 * 8:30pm Eastern lands on that evening's date and not on the next day in UTC.
 * @param {unknown} value
 * @param {string} [tz]
 * @returns {string | null}
 */
export function localDayOf(value, tz = PLATFORM_TZ) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.split("T")[0] || null;
  return localParts(d, tz).day;
}

/**
 * The next weekday after a calendar day: tomorrow, except Friday and Saturday roll to Monday.
 * @param {string} day - YYYY-MM-DD
 */
export function nextWorkingDay(day) {
  const base = new Date(`${day}T12:00:00Z`);
  const weekday = base.getUTCDay();
  const step = weekday === 5 ? 3 : weekday === 6 ? 2 : 1;
  return new Date(base.getTime() + step * 86400000).toISOString().slice(0, 10);
}
