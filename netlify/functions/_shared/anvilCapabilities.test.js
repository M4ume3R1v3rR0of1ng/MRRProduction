import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { CAPABILITIES, toolTier, capabilityTier, isRegisteredTool } from "./anvilCapabilities.js";
import { ACTION_TOOLS } from "./anvilActions.js";

// chat.js does not export its read tools, and importing it would pull in the Anthropic SDK
// and a service-role client. Reading the names out of the source is crude and exactly right
// for the one thing being asserted: that nobody adds a tool without deciding its plan.
const chatSource = fs.readFileSync(new URL("../chat.js", import.meta.url), "utf8");
const readToolsBlock = chatSource.slice(
  chatSource.indexOf("const READ_TOOLS = ["),
  chatSource.indexOf("const TOOLS = ["),
);
const readToolNames = [...readToolsBlock.matchAll(/^ {4}name: "([a-z_]+)"/gm)].map((m) => m[1]);

describe("capability registry", () => {
  it("found the chat tools it is checking against", () => {
    // A regex that silently matches nothing would make the next test vacuously pass.
    expect(readToolNames.length).toBeGreaterThanOrEqual(11);
  });

  it("registers every tool chat.js offers, so none ships by omission", () => {
    const offered = [...readToolNames, ...ACTION_TOOLS.map((t) => t.name)];
    const unregistered = offered.filter((n) => !isRegisteredTool(n));
    expect(unregistered).toEqual([]);
  });

  it("does not list a tool that chat.js no longer offers", () => {
    const offered = new Set([...readToolNames, ...ACTION_TOOLS.map((t) => t.name)]);
    const stale = CAPABILITIES.filter((c) => c.tool && !offered.has(c.tool)).map((c) => c.tool);
    expect(stale).toEqual([]);
  });

  it("has unique ids", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps everything that shipped before Anvil Pro free", () => {
    const pro = CAPABILITIES.filter((c) => c.tier === "pro").map((c) => c.id);
    expect(pro.sort()).toEqual(
      ["reorder_approval", "reorder_ask", "reorder_email", "reorder_watch"].sort(),
    );
  });

  it("fails closed for a tool nobody registered", () => {
    expect(toolTier("some_new_tool")).toBe("pro");
    expect(capabilityTier("not_a_capability")).toBe("pro");
  });

  it("reads the plan of a known tool", () => {
    expect(toolTier("get_inventory_status")).toBe("free");
    expect(toolTier("get_reorder_proposals")).toBe("pro");
  });
});
