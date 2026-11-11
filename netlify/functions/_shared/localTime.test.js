import { describe, it, expect } from "vitest";
import { PLATFORM_TZ, localParts, localDayOf, nextWorkingDay, isLocalHour } from "./localTime.js";

describe("localParts", () => {
  it("reads 5pm in winter (EST, UTC-5)", () => {
    expect(localParts(new Date("2026-11-11T22:30:00Z"))).toEqual({
      day: "2026-11-11",
      hour: 17,
      weekday: 3,
    });
  });

  it("reads 5pm in summer (EDT, UTC-4), an hour earlier in UTC", () => {
    expect(localParts(new Date("2026-07-15T21:30:00Z")).hour).toBe(17);
  });

  it("keeps the local day when UTC has already rolled over", () => {
    // 8:30pm Eastern on the 11th is already the 12th in UTC.
    expect(localParts(new Date("2026-11-12T01:30:00Z")).day).toBe("2026-11-11");
  });

  it("uses the platform time zone by default", () => {
    expect(PLATFORM_TZ).toBe("America/New_York");
  });
});

describe("isLocalHour", () => {
  it("is true only in the wanted local hour, so a pair of UTC crons fires once", () => {
    // Cron A (21:00 UTC) and cron B (22:00 UTC): exactly one is 5pm Eastern, in either season.
    const winter = ["2026-11-11T21:05:00Z", "2026-11-11T22:05:00Z"].map((d) =>
      isLocalHour(new Date(d), 17),
    );
    const summer = ["2026-07-15T21:05:00Z", "2026-07-15T22:05:00Z"].map((d) =>
      isLocalHour(new Date(d), 17),
    );
    expect(winter).toEqual([false, true]);
    expect(summer).toEqual([true, false]);
  });
});

describe("localDayOf", () => {
  it("leaves a date-only value alone", () => {
    expect(localDayOf("2026-11-11")).toBe("2026-11-11");
  });

  it("puts a late-evening timestamp on the local day, not the UTC day", () => {
    expect(localDayOf("2026-11-12T01:30:00Z")).toBe("2026-11-11");
  });

  it("returns null for nothing", () => {
    expect(localDayOf(null)).toBeNull();
    expect(localDayOf("")).toBeNull();
  });
});

describe("nextWorkingDay", () => {
  it("is tomorrow midweek", () => {
    expect(nextWorkingDay("2026-11-11")).toBe("2026-11-12"); // Wed -> Thu
  });

  it("skips the weekend from Friday", () => {
    expect(nextWorkingDay("2026-11-13")).toBe("2026-11-16"); // Fri -> Mon
  });
});
