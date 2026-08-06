// src/views/views.render.test.js
//
// Render safety net for the three large views, added ahead of splitting them
// apart. It is not a feature test suite. Its whole job is to fail loudly if a
// refactor drops a section, breaks a prop contract, or throws on a code path
// that only runs when a modal is open.
//
// renderToString rather than a DOM: these views are pure enough to render on the
// server, so this needs no jsdom and no new dependency. The tradeoff is that
// effects and event handlers never run, so this proves "the tree builds and the
// expected content is present", not "clicking works".
//
// KNOWN GAP, and the reason the split is worth doing. Modals are 32-43% of these
// files by line count, but each one renders only when the view's own useState
// says so, and nothing outside the component can set that. So this net covers
// the container and the list, NOT the modals it is meant to protect during the
// refactor.
//
// That gap closes as a consequence of the split rather than in spite of it: once
// a modal is its own component with an explicit prop contract, it can be rendered
// directly. Each extracted modal gets a test in its own folder as it comes out.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";

import InventoryView from "./InventoryView.jsx";
import FleetManagementView from "./FleetManagementView.jsx";
import BuildJobsView from "./BuildJobsView.jsx";
import ScheduleView from "./ScheduleView.jsx";
import { tot, oilSt, detSt, predDays, fd, fm } from "../utils/helpers";
import { NotificationProvider } from "../context/NotificationContext";

const noop = () => {};
const user = { id: "u1", name: "Sam Schwartz", role: "admin", email: "sam@example.com", companyId: "c1" };
const users = [user, { id: "u2", name: "Alex Reed", role: "employee", email: "alex@example.com" }];

// Everything on, so no section is skipped for lack of a permission.
const perms = new Proxy({}, { get: () => true });

const jSC = {
  draft: { c: "gray", l: "Draft", icon: "📝" },
  approved: { c: "blue", l: "Approved", icon: "✅" },
  active: { c: "amber", l: "Active", icon: "🔄" },
  completed: { c: "green", l: "Completed", icon: "🏁" },
  closed: { c: "purple", l: "Closed", icon: "🔒" },
};

const inv = [
  {
    id: "i1", name: "Weathered Wood Shingle", cat: "Roofing", loc: "A-3", unit: "bd", alrt: 40,
    batches: [
      { id: "b1", rem: 100, qty: 120, price: 32.5, rcvd: "2026-05-01", vendor: "ABC Supply", po: "PO-1001" },
      { id: "b2", rem: 42, qty: 60, price: 34.0, rcvd: "2026-06-10", vendor: "ABC Supply", po: "PO-1044" },
    ],
  },
  { id: "i2", name: "Ridge Cap, Amber", cat: "Roofing", loc: "A-1", unit: "bx", alrt: 12, batches: [] },
];

const vehs = [
  {
    id: "v1", name: "Truck 3", type: "truck", vin: "1FTFW1ET5DFA00001", plate: "ABC-1234",
    mi: 84000, lomi: 79000, oii: 5000, year: 2019, make: "Ford", model: "F-250",
    assigned_to_id: "u1", services: [{ id: "s1", type: "Oil Change", date: "2026-05-02", mi: 79000, cost: 89.5 }],
  },
  { id: "v2", name: "Trailer 1", type: "trailer", year: 2021, make: "PJ", model: "Dump", services: [] },
];

const jobs = [
  {
    id: "j1", title: "Maumee Re-roof", po: "PO-77", status: "active", customer_name: "Acme",
    addr: "1 Main St", assignedto: "u1", createdAt: "2026-07-01", completedAt: null,
    items: [{ id: "i1", name: "Weathered Wood Shingle", pulled: 10, returned: 1, priceAtPull: 32.5 }],
  },
  {
    id: "j2", title: "Saint Joe Repair", po: "PO-78", status: "completed", customer_name: "Beta",
    addr: "2 Oak St", assignedto: "u2", createdAt: "2026-06-01", completedAt: "2026-07-16",
    items: [{ id: "i1", name: "Weathered Wood Shingle", pulled: 4, returned: 0, priceAtPull: 34 }],
  },
];

const reqs = [
  { id: "r1", vehicle_id: "v1", status: "pending", issue: "Brake noise", urgency: "high", submitted_by: "Sam Schwartz", created_at: "2026-07-10", acked_by: [] },
  { id: "r2", vehicle_id: "v1", status: "completed", issue: "Oil Change", urgency: "low", submitted_by: "Sam Schwartz", created_at: "2026-07-16", acked_by: [] },
];

const inventoryProps = {
  inv, setInv: noop, jobs, setJobs: noop, users, user, perms,
  inventorySearchQuery: "", setInventorySearchQuery: noop, lang: "en",
};

const fleetProps = {
  vehs, setVehs: noop, reqs, setReqs: noop, jobs, setJobs: noop,
  jobTrailers: [{ job_id: "j1", trailer_id: "v2" }], setJobTrailers: noop,
  jSC, users, user, perms, oilSt, detSt, predDays, fd, fm,
  openItemId: null, onOpenItemHandled: noop,
};

const buildJobsProps = {
  jobs, company: { id: "c1", name: "Maumee River Roofing", branding: {} },
  jobNotifications: {}, setJobs: noop, inv, vehs,
  jobTrailers: [{ job_id: "j1", trailer_id: "v2" }], setJobTrailers: noop,
  users, user, curUser: user, perms, jSC, onNav: noop,
  acculynxConfig: {}, openItemId: null, onOpenItemHandled: noop, activeLogo: null,
};

// Every view calls useNotify(), which destructures the context value, so it
// throws outright without the provider. Wrapping here rather than stubbing keeps
// the test exercising the real chain.
const render = (Comp, props) =>
  renderToString(h(NotificationProvider, null, h(Comp, props)));

describe("InventoryView", () => {
  it("renders the catalog with items, stock, and batch-derived values", () => {
    const html = render(InventoryView, inventoryProps);
    expect(html).toContain("Weathered Wood Shingle");
    expect(html).toContain("Ridge Cap, Amber");
    // 100 + 42 across two batches. If FIFO totalling breaks, this moves.
    expect(html).toContain("142");
  });

  it("survives a search that matches nothing", () => {
    const html = render(InventoryView, { ...inventoryProps, inventorySearchQuery: "zzzz-no-match" });
    expect(html).not.toContain("Weathered Wood Shingle");
  });

  it("renders with an empty catalog", () => {
    expect(() => render(InventoryView, { ...inventoryProps, inv: [] })).not.toThrow();
  });

  it("offers both tabs and opens on the catalog", () => {
    const html = render(InventoryView, inventoryProps);
    expect(html).toContain("Catalog");
    expect(html).toContain("Monthly Count");
    // The count sheet is a sibling tab, not the landing state. Opening on it
    // would put a data-entry screen in front of everyone who came to look up
    // stock, which is what this view is mostly used for.
    expect(html).toContain("Weathered Wood Shingle");
  });

  it("calls a negative balance something other than out of stock", () => {
    // These are two different problems with two different responses: empty means
    // reorder, negative means the books are wrong and someone has to recount.
    // Collapsing them lost the more serious of the two.
    const negative = [{ id: "i9", name: "Atlas Box Vent", cat: "Vents", unit: "ea", alrt: 5, batches: [{ id: "neg_1", rcvd: "2026-07-01", qty: -1, rem: -1, price: 24, short: true, by: "u1" }] }];
    const html = render(InventoryView, { ...inventoryProps, inv: negative, inventorySearchQuery: "" });
    expect(html).toContain("Negative, recount");
    expect(html).not.toContain("Out of Stock");
  });
});

describe("FleetManagementView", () => {
  it("renders the vehicle list with trucks and trailers", () => {
    const html = render(FleetManagementView, fleetProps);
    expect(html).toContain("Truck 3");
    expect(html).toContain("Trailer 1");
  });

  it("renders with no vehicles", () => {
    expect(() => render(FleetManagementView, { ...fleetProps, vehs: [] })).not.toThrow();
  });

  it("renders the calendar sub-view without throwing", () => {
    // subView is internal state, so this only proves the default path is safe.
    // Kept as a crash guard around the calendar import chain.
    expect(() => render(FleetManagementView, { ...fleetProps, reqs: [] })).not.toThrow();
  });
});

describe("BuildJobsView", () => {
  it("renders the job list", () => {
    const html = render(BuildJobsView, buildJobsProps);
    expect(html).toContain("Maumee Re-roof");
  });

  it("renders with no jobs", () => {
    expect(() => render(BuildJobsView, { ...buildJobsProps, jobs: [] })).not.toThrow();
  });

  it("renders for a close-only user, who defaults to the completed filter", () => {
    const closeOnly = { jobs_build: false, jobs_close: true };
    const html = render(BuildJobsView, { ...buildJobsProps, perms: closeOnly });
    expect(html).toContain("Saint Joe Repair");
  });
});

describe("shared helpers the views depend on", () => {
  it("totals FIFO batches", () => {
    expect(tot(inv[0])).toBe(142);
    expect(tot(inv[1])).toBe(0);
  });
});

// ── ScheduleView ──
// Added with the full month calendar. It is read-only, so a render test covers
// most of what can go wrong: the grid builds, history shows, and the nav works.
describe("ScheduleView", () => {
  const scheduleProps = {
    jobs, reqs, vehs, jobTrailers: [{ job_id: "j1", trailer_id: "v2" }],
    users, jSC, onNav: noop, lang: "en",
  };

  it("renders the current month with weekday headers", () => {
    const html = render(ScheduleView, scheduleProps);
    expect(html).toContain("Schedule");
    for (const d of ["Sun", "Wed", "Sat"]) expect(html).toContain(d);
  });

  it("shows a legend explaining the marks", () => {
    const html = render(ScheduleView, scheduleProps);
    expect(html).toContain("booked and in the shop");
    expect(html).toContain("faded = finished");
  });

  it("renders with nothing scheduled at all", () => {
    expect(() => render(ScheduleView, { ...scheduleProps, jobs: [], reqs: [] })).not.toThrow();
  });

  it("renders with no props beyond onNav", () => {
    expect(() => render(ScheduleView, { onNav: noop })).not.toThrow();
  });
});
