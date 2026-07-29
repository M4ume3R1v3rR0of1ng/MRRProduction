// src/utils/dates.test.js
//
// Calendar days vs instants.
//
// The bug these pin: `new Date("2026-05-01")` is UTC midnight per ECMA-262,
// which is the previous day everywhere west of Greenwich. Every date-only field
// in the app — batch received, job scheduled, truck detailed — rendered a day
// early for US users. Its mirror, `new Date().toISOString().split("T")[0]`,
// took the UTC date, so evening entries were stored as tomorrow.
//
// These assertions are written against LOCAL date components rather than
// formatted strings, so they hold in every timezone. The suite is also run under
// TZ=Pacific/Midway (UTC-11) and TZ=Pacific/Kiritimati (UTC+14) to prove that.
import { describe, it, expect } from "vitest";
import { parseDay, formatDay, todayLocal, fd, ft, detSt } from "./helpers";

describe("parseDay", () => {
  it("reads a date-only string as LOCAL midnight", () => {
    const d = parseDay("2026-05-01");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
  });

  it("differs from the built-in parse, which is the whole point", () => {
    // The native parse puts this at UTC midnight. Asserting on getUTCDate keeps
    // this check itself timezone-independent.
    expect(new Date("2026-05-01").getUTCDate()).toBe(1);
    // parseDay puts it at local midnight, so the LOCAL day is the one named.
    expect(parseDay("2026-05-01").getDate()).toBe(1);
  });

  it("handles month and year boundaries, where the old bug rolled backwards", () => {
    expect(parseDay("2026-01-01").getFullYear()).toBe(2026);
    expect(parseDay("2026-01-01").getMonth()).toBe(0);
    expect(parseDay("2026-01-01").getDate()).toBe(1);
    expect(parseDay("2026-03-01").getMonth()).toBe(2);
    expect(parseDay("2026-03-01").getDate()).toBe(1);
  });

  it("passes a full timestamp straight through, unshifted", () => {
    // An instant is an instant. Only bare calendar days get reinterpreted.
    const iso = "2026-05-01T12:00:00Z";
    expect(parseDay(iso).getTime()).toBe(new Date(iso).getTime());
    const offset = "2026-05-01T12:00:00-04:00";
    expect(parseDay(offset).getTime()).toBe(new Date(offset).getTime());
  });

  it("passes Dates and numbers through", () => {
    const now = new Date();
    expect(parseDay(now).getTime()).toBe(now.getTime());
    expect(parseDay(now.getTime()).getTime()).toBe(now.getTime());
  });

  it("does not treat a partial or malformed date as a calendar day", () => {
    // "2026-05" is not the DAY_ONLY shape, so it takes the native path.
    expect(parseDay("2026-05").getTime()).toBe(new Date("2026-05").getTime());
  });
});

describe("formatDay", () => {
  it("emits the LOCAL calendar day", () => {
    const d = new Date(2026, 4, 1, 21, 30); // 9:30pm local on May 1
    expect(formatDay(d)).toBe("2026-05-01");
  });

  it("zero-pads month and day", () => {
    expect(formatDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("round-trips with parseDay", () => {
    for (const day of ["2026-01-01", "2026-05-01", "2026-12-31", "2026-02-28"]) {
      expect(formatDay(parseDay(day))).toBe(day);
    }
  });

  it("does not roll a late-evening instant into tomorrow", () => {
    // The old write path used toISOString(), which at UTC-4 turned 9pm May 1
    // into "2026-05-02". This is the regression that mattered for data entry.
    const evening = new Date(2026, 4, 1, 23, 59);
    expect(formatDay(evening)).toBe("2026-05-01");
  });
});

describe("todayLocal", () => {
  it("matches the local clock's calendar day", () => {
    const n = new Date();
    const expected = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    expect(todayLocal()).toBe(expected);
  });

  it("is a valid calendar day that parseDay can read back", () => {
    const today = todayLocal();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatDay(parseDay(today))).toBe(today);
  });
});

describe("fd", () => {
  it("renders a date-only string as the day it names", () => {
    // Before the fix this returned "Apr 30, 2026" for anyone west of UTC.
    expect(fd("2026-05-01")).toContain("May 1");
    expect(fd("2026-05-01")).toContain("2026");
  });

  it("renders the first of January as January, not the prior December", () => {
    expect(fd("2026-01-01")).toContain("Jan 1");
    expect(fd("2026-01-01")).toContain("2026");
  });

  it("still renders an em dash for a missing date", () => {
    expect(fd(null)).toBe("—");
    expect(fd("")).toBe("—");
    expect(fd(undefined)).toBe("—");
  });

  it("leaves real timestamps alone", () => {
    // A timestamp names an instant, so it must still localise normally.
    const iso = "2026-05-01T12:00:00Z";
    expect(fd(iso)).toBe(new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
  });
});

describe("ft", () => {
  it("leaves timestamps unshifted", () => {
    const iso = "2026-05-01T15:30:00Z";
    expect(ft(iso)).toBe(new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }));
  });
});

describe("detSt", () => {
  // The one place the skew reached logic rather than pixels: it subtracted a
  // UTC-midnight parse from the local clock, mixing reference frames, so the
  // interval read up to a full timezone offset long and tripped early.
  const daysAgo = (n) => formatDay(new Date(Date.now() - n * 86400000));

  it("is ok well inside the interval", () => {
    expect(detSt({ ldd: daysAgo(10), dii: 90 })).toBe("ok");
  });

  it("warns as the interval approaches", () => {
    expect(detSt({ ldd: daysAgo(80), dii: 90 })).toBe("soon");
  });

  it("is overdue past the interval", () => {
    expect(detSt({ ldd: daysAgo(100), dii: 90 })).toBe("overdue");
  });

  it("does not trip early at the boundary", () => {
    // Detailed exactly dii-1 days ago is not yet overdue, in any timezone.
    expect(detSt({ ldd: daysAgo(89), dii: 90 })).not.toBe("overdue");
  });

  it("treats a vehicle with no detail date as overdue", () => {
    expect(detSt({ ldd: "", dii: 90 })).toBe("overdue");
  });
});
