import { describe, it, expect } from "vitest";
import {
  seatCapacity,
  maxRemovablePacks,
  removalBlockedReason,
  validatePackChange,
  describePacks,
  isSubscribed,
  BASE_SEATS,
  PACK_SEATS,
} from "./seatPacks";

describe("isSubscribed", () => {
  it("counts past_due as still subscribed, so a failed card does not lock people out", () => {
    expect(isSubscribed("past_due")).toBe(true);
    expect(isSubscribed("trialing")).toBe(true);
    expect(isSubscribed("active")).toBe(true);
    expect(isSubscribed("canceled")).toBe(false);
    expect(isSubscribed(undefined)).toBe(false);
  });
});

describe("seatCapacity", () => {
  it("adds both kinds of pack while subscribed", () => {
    expect(seatCapacity({ grandfatheredPacks: 2, recurringPacks: 3, status: "active" })).toBe(
      BASE_SEATS + PACK_SEATS * 5,
    );
  });

  it("drops to the base allowance when the subscription lapses", () => {
    expect(seatCapacity({ grandfatheredPacks: 2, recurringPacks: 3, status: "canceled" })).toBe(BASE_SEATS);
  });

  it("keeps a comped company unlimited rather than capping them", () => {
    expect(seatCapacity({ baseSeats: null, status: "active" })).toBeNull();
  });

  it("treats a grandfathered pack exactly like a recurring one for capacity", () => {
    const a = seatCapacity({ grandfatheredPacks: 4, recurringPacks: 0, status: "active" });
    const b = seatCapacity({ grandfatheredPacks: 0, recurringPacks: 4, status: "active" });
    expect(a).toBe(b);
  });

  it("ignores negative junk", () => {
    expect(seatCapacity({ grandfatheredPacks: -5, recurringPacks: 1, status: "active" })).toBe(BASE_SEATS + PACK_SEATS);
  });
});

describe("maxRemovablePacks", () => {
  it("never offers to remove a grandfathered pack", () => {
    // 3 packs of capacity, but none of them recurring: nothing is removable.
    expect(maxRemovablePacks({ recurringPacks: 0, capacity: 25, used: 0 })).toBe(0);
  });

  it("stops short of cutting capacity below the seats in use", () => {
    // capacity 25, 18 in use → 7 spare → only 1 whole pack may go.
    expect(maxRemovablePacks({ recurringPacks: 3, capacity: 25, used: 18 })).toBe(1);
  });

  it("allows every recurring pack when the seats are empty", () => {
    expect(maxRemovablePacks({ recurringPacks: 3, capacity: 25, used: 10 })).toBe(3);
  });

  it("returns 0 when the company is completely full", () => {
    expect(maxRemovablePacks({ recurringPacks: 2, capacity: 20, used: 20 })).toBe(0);
  });

  it("treats unlimited capacity as nothing to protect", () => {
    expect(maxRemovablePacks({ recurringPacks: 2, capacity: null, used: 500 })).toBe(2);
  });
});

describe("removalBlockedReason", () => {
  it("distinguishes nothing-to-remove from seats-in-use", () => {
    expect(removalBlockedReason({ recurringPacks: 0, capacity: 10, used: 0 })).toBe("no-recurring-packs");
    expect(removalBlockedReason({ recurringPacks: 2, capacity: 20, used: 20 })).toBe("seats-in-use");
    expect(removalBlockedReason({ recurringPacks: 2, capacity: 20, used: 5 })).toBeNull();
  });
});

describe("validatePackChange", () => {
  it("always allows buying", () => {
    expect(validatePackChange({ delta: 1, recurringPacks: 0 })).toMatchObject({ ok: true, nextRecurring: 1 });
    expect(validatePackChange({ delta: 3, recurringPacks: 2 })).toMatchObject({ ok: true, nextRecurring: 5 });
  });

  it("rejects a no-op", () => {
    expect(validatePackChange({ delta: 0 }).ok).toBe(false);
    expect(validatePackChange({ delta: 1.5 }).ok).toBe(false);
  });

  it("refuses to remove what is not billed monthly", () => {
    const res = validatePackChange({ delta: -1, recurringPacks: 0, capacity: 25, used: 0 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no monthly crew packs/i);
  });

  it("refuses to strand users who are already logged in", () => {
    const res = validatePackChange({ delta: -1, recurringPacks: 2, capacity: 20, used: 20 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Deactivate a user/);
  });

  it("caps an over-large removal and says by how much", () => {
    const res = validatePackChange({ delta: -3, recurringPacks: 3, capacity: 25, used: 18 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at most 1 pack/);
  });

  it("allows a removal that stays within the spare seats", () => {
    expect(validatePackChange({ delta: -1, recurringPacks: 3, capacity: 25, used: 18 })).toMatchObject({
      ok: true,
      nextRecurring: 2,
    });
  });
});

describe("describePacks", () => {
  it("reports only the recurring packs as billed", () => {
    expect(describePacks({ grandfatheredPacks: 2, recurringPacks: 3 })).toEqual({
      grandfathered: 2,
      recurring: 3,
      total: 5,
      extraSeats: 25,
      billedPacks: 3,
    });
  });

  it("handles a company with neither", () => {
    expect(describePacks()).toMatchObject({ total: 0, extraSeats: 0, billedPacks: 0 });
  });
});
