// @vitest-environment jsdom
//
// src/features/settings/SettingsAnvilProTab.test.jsx
//
// The ANVIL Pro tab is wired into Settings and hands the panel the viewer's inv_edit, and
// Inventory → Reorders no longer carries its own copy of the switch.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import SettingsView from "./SettingsView.jsx";
import ReorderTab from "@/features/inventory/ReorderTab.jsx";
import { NotificationProvider } from "@/shared/context/NotificationContext";
import { translations } from "@/shared/utils/translations";
import { reset } from "@/test/fakeSupabase";
import { callReorder } from "@/features/inventory/reorderApi";

vi.mock("@supabase/supabase-js", async () => {
  const { fakeSupabase } = await import("@/test/fakeSupabase");
  return { createClient: () => fakeSupabase };
});
vi.mock("@/features/inventory/reorderApi", () => ({
  callReorder: vi.fn(),
  waitingCount: () => 0,
}));
vi.mock("./AnvilProSettings.jsx", () => ({
  default: ({ canEditInventory }) => (
    <div data-testid="anvil-pro-panel">{canEditInventory ? "can-edit" : "read-only"}</div>
  ),
}));

const t = translations.en;
const wrap = (ui) =>
  render(
    <MemoryRouter>
      <NotificationProvider>{ui}</NotificationProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  reset();
  callReorder.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settings = (userPerms) => (
  <SettingsView
    warehouses={[]}
    company={{ name: "Acme" }}
    rolePerms={{}}
    currentUser={{ id: "u1", role: "manager" }}
    userPerms={userPerms}
    lang="en"
  />
);

describe("Settings → ANVIL Pro tab", () => {
  it("opens the panel with inv_edit passed through", () => {
    wrap(settings({ settings_manage: true, inv_edit: true }));
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(t.stTabAnvilPro) }));
    expect(screen.getByTestId("anvil-pro-panel").textContent).toBe("can-edit");
  });

  it("opens the panel read-only without inv_edit", () => {
    wrap(settings({ settings_manage: true }));
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(t.stTabAnvilPro) }));
    expect(screen.getByTestId("anvil-pro-panel").textContent).toBe("read-only");
  });
});

describe("Inventory → Reorders", () => {
  const emptyList = {
    enabled: false,
    notifyEmails: [],
    pending: [],
    approved: [],
    ordered: [],
    recent: [],
  };

  it("keeps the switch for inventory editors who cannot open Settings", async () => {
    callReorder.mockResolvedValue(emptyList);
    wrap(<ReorderTab pro canOpenSettings={false} t={t} />);
    expect(await screen.findByRole("button", { name: t.stProTurnOn })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Settings/ })).toBeNull();
  });

  it("points to Settings instead of carrying the switch", async () => {
    callReorder.mockResolvedValue(emptyList);
    wrap(<ReorderTab pro canOpenSettings t={t} />);
    const link = await screen.findByRole("link", { name: /Settings/ });
    expect(link.getAttribute("href")).toBe("/settings");
    expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
  });
});
