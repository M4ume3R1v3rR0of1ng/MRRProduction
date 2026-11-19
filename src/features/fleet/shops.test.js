import { describe, it, expect } from "vitest";
import {
  shopKey,
  shopFormError,
  parseSpecialties,
  shopHistory,
  shopName,
  pickableShops,
} from "./shops";

const tire = { id: "s1", name: "McMahon's Best-One Tire", active: true };
const ford = { id: "s2", name: "Jim Schmidt Ford", active: true };
const gone = { id: "s3", name: "Old Glass Co", active: false };

describe("shopKey / shopFormError", () => {
  it("treats case and spacing as the same name", () => {
    expect(shopKey("  Jim   Schmidt FORD ")).toBe("jim schmidt ford");
  });

  it("requires a name and refuses a second shop with the same one", () => {
    expect(shopFormError({ name: "  " }, [tire])).toBe("name_required");
    expect(shopFormError({ name: "jim schmidt ford" }, [tire, ford])).toBe("name_taken");
    expect(shopFormError({ name: "New Shop" }, [tire, ford])).toBeNull();
  });

  it("lets a shop keep its own name when edited", () => {
    expect(shopFormError({ name: "Jim Schmidt Ford" }, [tire, ford], "s2")).toBeNull();
  });
});

describe("parseSpecialties", () => {
  it("splits on commas, trims, and drops blanks and repeats", () => {
    expect(parseSpecialties("Tires, Alignment ,, tires,  Ford   dealer")).toEqual([
      "Tires",
      "Alignment",
      "Ford dealer",
    ]);
  });
});

describe("shopHistory", () => {
  const vehs = [
    {
      id: "v1",
      name: "Truck 3",
      sl: [
        { type: "Tire Rotation", dt: "2026-03-01", mi: 1000, cost: 120, shop_id: "s1" },
        { type: "Oil Change", dt: "2026-05-01", mi: 4000, cost: 60, by: "Bob" },
        { type: "Tires", dt: "2026-09-10", mi: 9000, cost: "640.50", shop_id: "s1" },
      ],
    },
    {
      id: "v2",
      name: "Truck 7",
      sl: [{ type: "Brakes", dt: "2026-07-04", cost: 300, shop_id: "s2" }],
    },
    { id: "v3", name: "Trailer 1" },
  ];
  const reqs = [
    {
      id: "r1",
      vname: "Truck 7",
      type: "Tires",
      status: "scheduled",
      scheduled_date: "2026-11-20",
      shop_id: "s1",
    },
    { id: "r2", vname: "Truck 3", type: "Tires", status: "completed", shop_id: "s1" },
    { id: "r3", vname: "Truck 9", type: "Tires", status: "pending", shop_id: "s2" },
  ];

  it("reads completed work from the service log, newest first, with spend", () => {
    const h = shopHistory(tire, vehs, reqs);
    expect(h.done.map((e) => e.date)).toEqual(["2026-09-10", "2026-03-01"]);
    expect(h.visits).toBe(2);
    expect(h.spend).toBeCloseTo(760.5);
    expect(h.lastVisit).toBe("2026-09-10");
  });

  it("lists open tickets as upcoming and never counts a completed ticket twice", () => {
    const h = shopHistory(tire, vehs, reqs);
    expect(h.upcoming).toEqual([
      {
        requestId: "r1",
        vehicleName: "Truck 7",
        type: "Tires",
        status: "scheduled",
        date: "2026-11-20",
      },
    ]);
  });

  it("is empty for a shop with nothing on it", () => {
    const h = shopHistory({ id: "nope" }, vehs, reqs);
    expect(h).toMatchObject({ visits: 0, spend: 0, lastVisit: null, upcoming: [] });
  });
});

describe("shopName / pickableShops", () => {
  it("names a shop by id, archived or not", () => {
    expect(shopName("s3", [tire, gone])).toBe("Old Glass Co");
    expect(shopName(null, [tire])).toBe("");
  });

  it("offers active shops A to Z, plus an archived one only when already selected", () => {
    expect(pickableShops([tire, ford, gone]).map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(pickableShops([tire, ford, gone], "s3").map((s) => s.id)).toEqual(["s2", "s1", "s3"]);
  });
});
