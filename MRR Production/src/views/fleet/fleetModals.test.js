// src/views/fleet/fleetModals.test.js
//
// The three dialogs pulled out of FleetManagementView. None of this was testable
// before: each one rendered behind a boolean in the parent that nothing outside
// the component could set.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import MaintenanceRequestModal from "./MaintenanceRequestModal.jsx";
import AddVehicleModal, { buildVehicle } from "./AddVehicleModal.jsx";
import InspectionModal, { vehicleLabel } from "./InspectionModal.jsx";
import { oilSt } from "../../utils/helpers";
import { NotificationProvider } from "../../context/NotificationContext";

const vehs = [
  { id: "v1", name: "Truck 3", plate: "ABC-1234", type: "truck", yr: 2019, make: "Ford", model: "F-250" },
  { id: 7, name: "Trailer 1", plate: "TRL-99", type: "trailer", yr: 2021, make: "PJ", model: "Dump" },
];
const user = { id: "u1", name: "Sam Schwartz", email: "sam@example.com" };

const render = (Comp, props) =>
  renderToString(h(NotificationProvider, null, h(Comp, { user, onClose: () => {}, ...props })));

describe("buildVehicle", () => {
  const base = { name: " Truck 13 ", type: "truck", yr: "2022", make: " Ford ", model: " F-350 ", plate: " XYZ-1 ", mi: "12000", oii: "5000", dii: "90" };

  it("trims the free-text fields", () => {
    const v = buildVehicle(base);
    expect(v).toMatchObject({ name: "Truck 13", make: "Ford", model: "F-350", plate: "XYZ-1" });
  });

  it("seeds last-oil mileage to the starting odometer, not zero", () => {
    // The bug this prevents: with lomi at 0, oilSt() reads the entire starting
    // mileage as distance since the last oil change, so a freshly registered
    // truck shows up overdue on day one.
    const v = buildVehicle(base);
    expect(v.lomi).toBe(12000);
    expect(oilSt(v)).toBe("ok");
  });

  it("defaults a blank oil interval to 5000 rather than NaN", () => {
    const v = buildVehicle({ ...base, oii: "" });
    expect(v.oii).toBe(5000);
    expect(Number.isNaN(v.oii)).toBe(false);
  });

  it("defaults a blank detail interval to 90", () => {
    expect(buildVehicle({ ...base, dii: "" }).dii).toBe(90);
  });

  it("defaults a blank year to the current year", () => {
    expect(buildVehicle({ ...base, yr: "" }).yr).toBe(new Date().getFullYear());
  });

  it("treats blank mileage as zero on both odometer fields", () => {
    const v = buildVehicle({ ...base, mi: "" });
    expect(v.mi).toBe(0);
    expect(v.lomi).toBe(0);
  });

  it("gives every vehicle a distinct id", () => {
    expect(buildVehicle(base).id).not.toBe(buildVehicle(base).id);
  });

  it("starts active with empty mileage and service logs", () => {
    expect(buildVehicle(base)).toMatchObject({ status: "active", mil: [], sl: [], assignedTo: "" });
  });
});

describe("vehicleLabel", () => {
  it("names the vehicle and plate", () => {
    expect(vehicleLabel(vehs, "v1")).toBe("Truck 3 (ABC-1234)");
  });

  it("matches across string and number ids", () => {
    // The select yields a string; the row may carry a number. Comparing loosely
    // is why this is a named function rather than an inline find.
    expect(vehicleLabel(vehs, "7")).toBe("Trailer 1 (TRL-99)");
    expect(vehicleLabel(vehs, 7)).toBe("Trailer 1 (TRL-99)");
  });

  it("falls back rather than throwing on an unknown or missing id", () => {
    expect(vehicleLabel(vehs, "nope")).toBe("Unknown Fleet Asset");
    expect(vehicleLabel(vehs, "")).toBe("Unknown Fleet Asset");
    expect(vehicleLabel(undefined, "v1")).toBe("Unknown Fleet Asset");
  });
});

describe("renders", () => {
  it("MaintenanceRequestModal lists the fleet", () => {
    const html = render(MaintenanceRequestModal, { vehs, onSave: () => {} });
    expect(html).toContain("Submit Maintenance Request");
    expect(html).toContain("Truck 3");
  });

  it("MaintenanceRequestModal survives an empty fleet", () => {
    expect(() => render(MaintenanceRequestModal, { vehs: [], onSave: () => {} })).not.toThrow();
  });

  it("AddVehicleModal opens on the truck type, so mileage fields show", () => {
    const html = render(AddVehicleModal, { onCreated: () => {} });
    expect(html).toContain("Register New Fleet Vehicle");
    expect(html).toContain("Starting Mileage");
    expect(html).toContain("Oil Change Interval");
  });

  it("InspectionModal lists vehicles to inspect", () => {
    const html = render(InspectionModal, { vehs });
    expect(html).toContain("Inspection Report");
    expect(html).toContain("Truck 3");
  });

  it("InspectionModal renders with no fleet", () => {
    expect(() => render(InspectionModal, { vehs: [] })).not.toThrow();
  });
});
