// src/utils/fleetStatus.js
//
// What colour a vehicle shows on the fleet board, and why.
//
// This used to be an inline ternary chain in FleetManagementView that folded two
// unrelated ideas into one red "Out of Service" badge: an explicit human decision
// (vehicles.status), and a derived mileage calculation (oil interval exceeded). Only the
// second one ever fired, because nothing in the app could write the first — so people saw
// trucks marked out of service and went looking for the switch that turned them back on.
// There wasn't one.
//
// Those are now separate states with separate labels. "Out of service" means somebody
// grounded the truck on purpose and can un-ground it. "Oil overdue" means go change the
// oil. Both are red, because both mean do not dispatch this truck, but they no longer
// read as the same problem.

export const VEHICLE_ACTIVE = "active";
export const VEHICLE_OUT_OF_SERVICE = "out_of_service";
export const VEHICLE_SERVICE_DUE = "service_due";

// Grounded by a person, as opposed to flagged by the mileage math.
export function isGrounded(vehicle) {
  return vehicle?.status === VEHICLE_OUT_OF_SERVICE;
}

// The status kinds, most severe first. The view maps these to a dot, a label and a
// colour; keeping them as plain strings means the precedence can be tested without
// pulling in theme tokens or translations.
export const STATUS_KINDS = ["grounded", "in_shop", "oil_overdue", "service_due", "active"];

// Precedence, and the reasoning for it:
//
//   grounded     a person said this truck cannot be driven. That outranks everything,
//                including being in the shop: the shop visit may be exactly why it was
//                grounded, and "in service" would read as reassuring on a truck someone
//                deliberately took off the road.
//   in_shop      a maintenance request reached `scheduled`, meaning somebody with
//                maint_manage agreed to it. Outranks the mileage warnings, because an
//                oil reminder on a truck already in the bay is noise.
//   oil_overdue  derived. Miles since the last oil change met or passed the interval.
//   service_due  derived. Oil or detail approaching, or a service_due status on the row.
//   active       nothing outstanding.
export function vehicleStatusKind({ vehicle, oilStatus, detailStatus, blocked = false } = {}) {
  if (isGrounded(vehicle)) return "grounded";
  if (blocked) return "in_shop";
  if (oilStatus === "overdue") return "oil_overdue";
  // detailStatus "overdue" is included here, not above. The old chain tested only for
  // "soon", so a vehicle overdue on detailing matched nothing and rendered green, which
  // read as a clean truck. A late detail is worth showing, but it is a wash, not a
  // reason to keep the truck in the yard.
  if (
    oilStatus === "soon" ||
    detailStatus === "soon" ||
    detailStatus === "overdue" ||
    vehicle?.status === VEHICLE_SERVICE_DUE
  ) {
    return "service_due";
  }
  return "active";
}

// A vehicle nobody should be dispatched in. Deliberately does NOT include oil_overdue:
// that has always been advisory, and treating it as blocking would ground a third of the
// fleet the moment this shipped. Grounding is the explicit, reversible decision.
export function isUndispatchable(vehicle) {
  return isGrounded(vehicle);
}

// Trim and cap a free-text grounding reason. Empty stays null rather than "" so the
// column reads as "no reason given" instead of an empty string that renders as a blank
// line on the card.
export function normalizeGroundReason(reason) {
  const trimmed = String(reason ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 280);
}

// The row patch for grounding or un-grounding, so the two call sites cannot drift on
// which fields they clear. Returning to service wipes the reason: a stale "blown
// transmission" on a truck back in rotation is worse than no reason at all.
export function groundingPatch(grounded, reason) {
  return grounded
    ? { status: VEHICLE_OUT_OF_SERVICE, oos_reason: normalizeGroundReason(reason) }
    : { status: VEHICLE_ACTIVE, oos_reason: null };
}
