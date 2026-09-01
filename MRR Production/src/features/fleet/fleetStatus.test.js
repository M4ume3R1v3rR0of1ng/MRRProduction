import { describe, it, expect } from "vitest";
import {
  isGrounded,
  isUndispatchable,
  vehicleStatusKind,
  normalizeGroundReason,
  groundingPatch,
  VEHICLE_ACTIVE,
  VEHICLE_OUT_OF_SERVICE,
} from "./fleetStatus";

const truck = (over = {}) => ({ id: "v1", type: "truck", status: VEHICLE_ACTIVE, ...over });

describe("isGrounded", () => {
  it("is true only for the explicit out_of_service status", () => {
    expect(isGrounded(truck({ status: VEHICLE_OUT_OF_SERVICE }))).toBe(true);
    expect(isGrounded(truck())).toBe(false);
    expect(isGrounded(truck({ status: "service_due" }))).toBe(false);
    expect(isGrounded(undefined)).toBe(false);
  });

  it("does not treat a missing status as grounded, so legacy rows stay dispatchable", () => {
    expect(isGrounded({ id: "v9" })).toBe(false);
  });
});

describe("vehicleStatusKind", () => {
  it("puts a grounded truck above everything, including the shop", () => {
    const kind = vehicleStatusKind({
      vehicle: truck({ status: VEHICLE_OUT_OF_SERVICE }),
      oilStatus: "overdue",
      detailStatus: "soon",
      blocked: true,
    });
    expect(kind).toBe("grounded");
  });

  it("puts the shop above the mileage warnings", () => {
    expect(vehicleStatusKind({ vehicle: truck(), oilStatus: "overdue", blocked: true })).toBe("in_shop");
  });

  it("separates an overdue oil change from a grounded truck", () => {
    expect(vehicleStatusKind({ vehicle: truck(), oilStatus: "overdue" })).toBe("oil_overdue");
  });

  it("flags an approaching oil or detail service", () => {
    expect(vehicleStatusKind({ vehicle: truck(), oilStatus: "soon" })).toBe("service_due");
    expect(vehicleStatusKind({ vehicle: truck(), detailStatus: "soon" })).toBe("service_due");
    expect(vehicleStatusKind({ vehicle: truck({ status: "service_due" }) })).toBe("service_due");
  });

  it("shows an overdue detail instead of letting it render as a clean truck", () => {
    expect(vehicleStatusKind({ vehicle: truck(), oilStatus: "ok", detailStatus: "overdue" })).toBe("service_due");
  });

  it("never grounds a vehicle for overdue service alone", () => {
    for (const detailStatus of ["ok", "soon", "overdue"]) {
      for (const oilStatus of ["ok", "soon", "overdue"]) {
        expect(vehicleStatusKind({ vehicle: truck(), oilStatus, detailStatus })).not.toBe("grounded");
        expect(isUndispatchable(truck())).toBe(false);
      }
    }
  });

  it("falls through to active", () => {
    expect(vehicleStatusKind({ vehicle: truck(), oilStatus: "ok", detailStatus: "ok" })).toBe("active");
    expect(vehicleStatusKind({})).toBe("active");
  });

  it("treats a trailer with no oil status as active, not service due", () => {
    // oilSt returns null for trailers; null must not read as a warning.
    expect(vehicleStatusKind({ vehicle: truck({ type: "trailer" }), oilStatus: null, detailStatus: null })).toBe("active");
  });
});

describe("isUndispatchable", () => {
  it("blocks a grounded truck", () => {
    expect(isUndispatchable(truck({ status: VEHICLE_OUT_OF_SERVICE }))).toBe(true);
  });

  it("leaves an overdue oil change dispatchable, since that has always been advisory", () => {
    expect(isUndispatchable(truck())).toBe(false);
  });
});

describe("normalizeGroundReason", () => {
  it("trims, and turns blank into null", () => {
    expect(normalizeGroundReason("  blown transmission  ")).toBe("blown transmission");
    expect(normalizeGroundReason("   ")).toBeNull();
    expect(normalizeGroundReason("")).toBeNull();
    expect(normalizeGroundReason(null)).toBeNull();
    expect(normalizeGroundReason(undefined)).toBeNull();
  });

  it("caps a runaway reason", () => {
    expect(normalizeGroundReason("x".repeat(500))).toHaveLength(280);
  });
});

describe("groundingPatch", () => {
  it("sets the status and reason when grounding", () => {
    expect(groundingPatch(true, "expired plate")).toEqual({
      status: VEHICLE_OUT_OF_SERVICE,
      oos_reason: "expired plate",
    });
  });

  it("clears a stale reason when returning to service", () => {
    expect(groundingPatch(false, "expired plate")).toEqual({
      status: VEHICLE_ACTIVE,
      oos_reason: null,
    });
  });

  it("allows grounding with no reason given", () => {
    expect(groundingPatch(true, "")).toEqual({ status: VEHICLE_OUT_OF_SERVICE, oos_reason: null });
  });
});
