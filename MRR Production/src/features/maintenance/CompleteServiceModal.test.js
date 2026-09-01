// src/features/maintenance/CompleteServiceModal.test.js
//
// Split out of features/fleet/fleetModals.test.js when CompleteServiceModal
// moved here: its only real consumer was always MaintenanceRequestsView, not
// FleetManagementView, even though the component used to live in views/fleet/
// and get tested alongside the three modals that view actually owns.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import CompleteServiceModal, { guessServiceType } from "./CompleteServiceModal.jsx";
import { NotificationProvider } from "@/context/NotificationContext";

const vehs = [
  { id: "v1", name: "Truck 3", plate: "ABC-1234", type: "truck", yr: 2019, make: "Ford", model: "F-250" },
  { id: 7, name: "Trailer 1", plate: "TRL-99", type: "trailer", yr: 2021, make: "PJ", model: "Dump" },
];
const user = { id: "u1", name: "Sam Schwartz", email: "sam@example.com" };

const render = (Comp, props) =>
  renderToString(h(NotificationProvider, null, h(Comp, { user, onClose: () => {}, ...props })));

describe("renders", () => {
  it("CompleteServiceModal shows the vehicle and the scheduling notes", () => {
    const req = { id: "r1", vid: "v1", vname: "Truck 3 (ABC-1234)", type: "Brake Service, Electrical Issue", wh_notes: "Bring it in Thursday" };
    const html = render(CompleteServiceModal, { req, vehs, users: [], onSubmit: () => {} });
    expect(html).toContain("Complete Service");
    expect(html).toContain("Truck 3 (ABC-1234)");
    expect(html).toContain("Bring it in Thursday");
  });

  it("CompleteServiceModal survives a request with no matching vehicle", () => {
    const req = { id: "r1", vid: "gone", vname: "Unknown Fleet Asset", type: "" };
    expect(() => render(CompleteServiceModal, { req, vehs, users: [], onSubmit: () => {} })).not.toThrow();
  });
});

describe("guessServiceType", () => {
  it("picks the first reported issue when it matches a known service type", () => {
    expect(guessServiceType("Brake Service, Electrical Issue")).toBe("Brake Service");
  });

  it("falls back to blank when nothing reported matches a known type", () => {
    expect(guessServiceType("Weird Noise")).toBe("");
  });

  it("falls back to blank on empty or missing input", () => {
    expect(guessServiceType("")).toBe("");
    expect(guessServiceType(undefined)).toBe("");
  });
});
