// src/views/inventory/JobTemplatesModal.test.js
//
// This file could not exist before the split. The template manager lived inside
// InventoryView behind `modal === "tpl"`, internal state nothing outside the
// component could set, so none of this logic was reachable from a test.
//
// Scope note: renderToString does not run effects, so the mount-time fetch never
// fires and the component always renders its loading branch here. The logic that
// matters is therefore exported as pure functions and tested directly, which is
// stronger than asserting on markup anyway.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import JobTemplatesModal, { upsertTemplate, selectableMaterials } from "./JobTemplatesModal.jsx";
import { NotificationProvider } from "../../context/NotificationContext";

const inv = [
  { id: "i1", name: "Weathered Wood Shingle", unit: "bd", batches: [{ rem: 100 }] },
  { id: "i2", name: "Ridge Cap, Amber", unit: "bx", batches: [] },
  { id: "i3", name: "Drip Edge, 10 ft", unit: "pc", batches: [{ rem: 20 }] },
];

describe("upsertTemplate", () => {
  const a = { id: "t1", name: "Economy Roof", items: [] };
  const b = { id: "t2", name: "Premium Roof", items: [] };

  it("appends a template whose id is not present", () => {
    expect(upsertTemplate([a], b)).toEqual([a, b]);
  });

  it("replaces in place rather than duplicating when the id is known", () => {
    const edited = { ...a, name: "Economy Roof v2" };
    const out = upsertTemplate([a, b], edited);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("Economy Roof v2");
    // Order matters: a replaced template must not jump to the end of the list.
    expect(out[1]).toBe(b);
  });

  it("does not mutate the list it was given", () => {
    const list = [a];
    upsertTemplate(list, b);
    expect(list).toHaveLength(1);
  });

  it("appends into an empty list", () => {
    expect(upsertTemplate([], a)).toEqual([a]);
  });
});

describe("selectableMaterials", () => {
  it("hides materials already on the template", () => {
    const out = selectableMaterials(inv, [{ iid: "i1" }], "");
    expect(out.map((i) => i.id)).toEqual(["i2", "i3"]);
  });

  it("matches the search case-insensitively", () => {
    expect(selectableMaterials(inv, [], "ridge").map((i) => i.id)).toEqual(["i2"]);
    expect(selectableMaterials(inv, [], "RIDGE").map((i) => i.id)).toEqual(["i2"]);
  });

  it("treats an empty or missing query as no filter", () => {
    expect(selectableMaterials(inv, [], "")).toHaveLength(3);
    expect(selectableMaterials(inv, [], undefined)).toHaveLength(3);
  });

  it("skips null entries instead of throwing on them", () => {
    expect(() => selectableMaterials([null, ...inv], [], "a")).not.toThrow();
  });

  it("returns nothing when every material is already chosen", () => {
    const chosen = inv.map((i) => ({ iid: i.id }));
    expect(selectableMaterials(inv, chosen, "")).toEqual([]);
  });
});

describe("JobTemplatesModal render", () => {
  const render = (props) =>
    renderToString(h(NotificationProvider, null, h(JobTemplatesModal, { inv, onClose: () => {}, ...props })));

  it("mounts and shows the dialog title", () => {
    expect(render()).toContain("Job Material Templates");
  });

  it("opens in a loading state, since templates are fetched on mount", () => {
    expect(render()).toContain("Loading templates...");
  });

  it("does not require a catalog to be passed", () => {
    expect(() => render({ inv: undefined })).not.toThrow();
  });
});
