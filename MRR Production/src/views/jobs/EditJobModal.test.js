// src/views/jobs/EditJobModal.test.js
//
// Previously unreachable: this dialog rendered behind `modal === "edit"` in
// BuildJobsView, and its form was seeded by a separate startEditJob() call on
// parent state.
//
// The field-normalising helpers are the part worth pinning. Job rows carry their
// materials under `items` on newer records and `materials` on older ones, and
// their supervisor under `assignedto` or `assignedTo`. Reading the wrong one
// silently blanks a field on save.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import EditJobModal, { formFromJob, itemsFromJob, addableInventory } from "./EditJobModal.jsx";
import { NotificationProvider } from "../../context/NotificationContext";

const inv = [
  { id: "i1", name: "Shingle", cat: "Roofing", unit: "bd" },
  { id: "i2", name: "Ridge Cap", cat: "Roofing", unit: "bx" },
];

const modernJob = {
  id: "j1", po: "PO-77", title: "Maumee Re-roof", addr: "1 Main St", notes: "back lot",
  scheduledDate: "2026-08-01", assignedto: "u1",
  items: [{ iid: "i1", iname: "Shingle", unit: "bd", planned: 10, pulled: 4 }],
};

// Same job as an older record would have stored it.
const legacyJob = {
  id: "j1", po: "PO-77", name: "Maumee Re-roof", addr: "1 Main St",
  assignedTo: "u1",
  materials: [{ iid: "i1", iname: "Shingle", unit: "bd", planned: 10, pulled: 4 }],
};

describe("formFromJob", () => {
  it("reads a modern record", () => {
    expect(formFromJob(modernJob)).toEqual({
      po: "PO-77", name: "Maumee Re-roof", addr: "1 Main St", notes: "back lot",
      scheduledDate: "2026-08-01", assignedto: "u1",
    });
  });

  it("reads name and supervisor from the legacy field names", () => {
    const f = formFromJob(legacyJob);
    expect(f.name).toBe("Maumee Re-roof");
    expect(f.assignedto).toBe("u1");
  });

  it("returns empty strings rather than undefined for missing fields", () => {
    const f = formFromJob({});
    expect(Object.values(f).every((v) => v === "")).toBe(true);
  });

  it("does not throw on a missing job", () => {
    expect(() => formFromJob()).not.toThrow();
  });
});

describe("itemsFromJob", () => {
  it("reads items on a modern record and materials on a legacy one", () => {
    expect(itemsFromJob(modernJob)).toHaveLength(1);
    expect(itemsFromJob(legacyJob)).toHaveLength(1);
  });

  it("prefers items when a record somehow carries both", () => {
    const both = { items: [{ iid: "a" }], materials: [{ iid: "b" }, { iid: "c" }] };
    expect(itemsFromJob(both).map((i) => i.iid)).toEqual(["a"]);
  });

  it("drops null entries and copes with no materials at all", () => {
    expect(itemsFromJob({ items: [null, { iid: "a" }, undefined] })).toHaveLength(1);
    expect(itemsFromJob({})).toEqual([]);
    expect(itemsFromJob()).toEqual([]);
  });
});

describe("addableInventory", () => {
  it("excludes materials already on the job", () => {
    expect(addableInventory(inv, [{ iid: "i1" }], "").map((i) => i.id)).toEqual(["i2"]);
  });

  it("matches case-insensitively", () => {
    expect(addableInventory(inv, [], "RIDGE").map((i) => i.id)).toEqual(["i2"]);
  });

  it("handles no arguments without throwing", () => {
    expect(() => addableInventory()).not.toThrow();
    expect(addableInventory()).toEqual([]);
  });
});

describe("EditJobModal render", () => {
  const render = (props) =>
    renderToString(
      h(NotificationProvider, null, h(EditJobModal, {
        job: modernJob, inv, fieldUsers: [{ id: "u1", name: "Sam Schwartz" }],
        activeUser: { id: "u1", email: "sam@example.com" }, onSaved: () => {}, onClose: () => {}, ...props,
      })),
    );

  it("titles itself with the job PO and pre-fills the form from the job", () => {
    const html = render();
    expect(html).toContain("Edit Job");
    expect(html).toContain("PO-77");
    expect(html).toContain("Maumee Re-roof");
  });

  it("lists the job's existing materials", () => {
    expect(render()).toContain("Shingle");
  });

  it("warns that material has already been pulled", () => {
    // Removing a partly-pulled line does not return the stock, so the dialog says so.
    expect(render()).toContain("already pulled");
  });

  it("seeds itself from a legacy record just as well", () => {
    const html = render({ job: legacyJob });
    expect(html).toContain("Maumee Re-roof");
    expect(html).toContain("Shingle");
  });

  it("renders a job with no materials", () => {
    expect(() => render({ job: { ...modernJob, items: [] } })).not.toThrow();
  });
});
