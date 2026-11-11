import { describe, it, expect } from "vitest";
import { badgeCount, badgeLabel } from "./chatBadge";

describe("badgeCount", () => {
  it("is zero when nothing is waiting", () => {
    expect(badgeCount({})).toBe(0);
  });

  it("counts reorders waiting on a person", () => {
    expect(badgeCount({ waiting: 3 })).toBe(3);
  });

  it("counts a change A.N.V.I.L. lined up, while the window is closed", () => {
    expect(badgeCount({ waiting: 2, hasPendingAction: true, chatOpen: false })).toBe(3);
  });

  it("does not count a pending change once the window is open: the Confirm bar is right there", () => {
    expect(badgeCount({ waiting: 2, hasPendingAction: true, chatOpen: true })).toBe(2);
  });

  it("ignores nonsense counts", () => {
    expect(badgeCount({ waiting: -4 })).toBe(0);
    expect(badgeCount({ waiting: Number.NaN })).toBe(0);
  });
});

describe("badgeLabel", () => {
  it("shows small numbers as they are and caps the rest", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(120)).toBe("9+");
  });
});
