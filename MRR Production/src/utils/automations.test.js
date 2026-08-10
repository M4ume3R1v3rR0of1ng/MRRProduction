import { describe, it, expect } from "vitest";
import {
  AUTOMATIONS,
  AUTOMATION_GROUPS,
  automationsForGroup,
  defaultPrefs,
  mergePrefs,
  serializePrefs,
} from "./automations";

describe("registry shape", () => {
  it("keeps every automation attached to a declared group", () => {
    const ids = new Set(AUTOMATION_GROUPS.map((g) => g.id));
    for (const a of AUTOMATIONS) expect(ids.has(a.group)).toBe(true);
  });

  it("keeps keys unique within a group", () => {
    for (const g of AUTOMATION_GROUPS) {
      const keys = automationsForGroup(g.id).map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("gives each group its own settings row", () => {
    const keys = AUTOMATION_GROUPS.map((g) => g.settingsKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the stored job shape the database already has", () => {
    expect(automationsForGroup("jobs").map((a) => a.key)).toEqual(["approved", "active", "completed", "closed"]);
  });

  it("ships every maintenance automation off, since none of them sent mail before", () => {
    for (const a of automationsForGroup("maintenance")) expect(a.default).toBe(false);
  });
});

describe("defaultPrefs", () => {
  it("preserves the one job default that was already firing", () => {
    expect(defaultPrefs("jobs")).toEqual({ approved: true, active: false, completed: false, closed: false });
  });

  it("returns an empty object for an unknown group", () => {
    expect(defaultPrefs("nope")).toEqual({});
  });
});

describe("mergePrefs", () => {
  it("layers a stored blob over the registry defaults", () => {
    expect(mergePrefs("jobs", { closed: true })).toEqual({ approved: true, active: false, completed: false, closed: true });
  });

  it("falls back to defaults when nothing is stored yet", () => {
    expect(mergePrefs("maintenance", null)).toEqual(defaultPrefs("maintenance"));
    expect(mergePrefs("maintenance", "not json")).toEqual(defaultPrefs("maintenance"));
  });

  it("drops keys the registry no longer defines, so a removed automation stops firing", () => {
    expect(mergePrefs("jobs", { closed: true, deleted: true })).not.toHaveProperty("deleted");
  });

  it("ignores non-boolean values rather than coercing them on", () => {
    expect(mergePrefs("jobs", { active: "yes" }).active).toBe(false);
  });
});

describe("serializePrefs", () => {
  it("writes a real boolean for every registry key", () => {
    expect(serializePrefs("maintenance", { filed: 1, urgent: true })).toEqual({
      filed: true,
      urgent: true,
      scheduled: false,
      completed: false,
    });
  });

  it("drops anything the registry does not define", () => {
    expect(serializePrefs("jobs", { approved: true, bogus: true })).not.toHaveProperty("bogus");
  });
});
