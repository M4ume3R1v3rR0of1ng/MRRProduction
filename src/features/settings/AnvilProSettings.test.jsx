// @vitest-environment jsdom
//
// src/features/settings/AnvilProSettings.test.jsx
//
// The ANVIL Pro tab in Settings: status for everyone who can open Settings, and the
// automatic-reorder switch and email list only for people the server will let save them
// (Pro + inv_edit, checked again in netlify/functions/anvil-reorder.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import AnvilProSettings from "./AnvilProSettings.jsx";
import { NotificationProvider } from "@/shared/context/NotificationContext";
import { translations } from "@/shared/utils/translations";
import { reset, respond } from "@/test/fakeSupabase";
import { callReorder } from "@/features/inventory/reorderApi";

vi.mock("@supabase/supabase-js", async () => {
  const { fakeSupabase } = await import("@/test/fakeSupabase");
  return { createClient: () => fakeSupabase };
});
vi.mock("@/features/inventory/reorderApi", () => ({ callReorder: vi.fn() }));

const t = translations.en;

const company = (row) => respond({ table: "companies", op: "select" }, { data: row });

const renderPanel = (canEditInventory) =>
  render(
    <MemoryRouter>
      <NotificationProvider>
        <AnvilProSettings canEditInventory={canEditInventory} t={t} />
      </NotificationProvider>
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

describe("AnvilProSettings", () => {
  it("shows Off and a Billing link when the company has no Pro", async () => {
    company({ anvil_pro: false, anvil_pro_comped: false });
    renderPanel(true);
    expect(await screen.findByText(t.stProStatusOff)).toBeTruthy();
    expect(screen.getByRole("link", { name: t.stProGoBilling }).getAttribute("href")).toBe(
      "/billing",
    );
    expect(callReorder).not.toHaveBeenCalled();
  });

  it("shows Comped for a comped company", async () => {
    company({ anvil_pro: false, anvil_pro_comped: true });
    callReorder.mockResolvedValue({ enabled: false, notifyEmails: [] });
    renderPanel(true);
    expect(await screen.findByText(t.stProStatusComped)).toBeTruthy();
  });

  it("hides reorder controls without inv_edit", async () => {
    company({ anvil_pro: true, anvil_pro_comped: false });
    renderPanel(false);
    expect(await screen.findByText(t.stProNeedsInvEdit)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.stProTurnOn })).toBeNull();
    expect(callReorder).not.toHaveBeenCalled();
  });

  it("toggles automatic reordering", async () => {
    company({ anvil_pro: true, anvil_pro_comped: false });
    callReorder.mockResolvedValue({ enabled: false, notifyEmails: [] });
    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: t.stProTurnOn }));
    await waitFor(() =>
      expect(callReorder).toHaveBeenCalledWith({ action: "settings", enabled: true }),
    );
    await waitFor(() =>
      expect(callReorder.mock.calls.filter(([p]) => p.action === "list").length).toBe(2),
    );
  });

  it("saves the email list as a trimmed array", async () => {
    company({ anvil_pro: true, anvil_pro_comped: false });
    callReorder.mockResolvedValue({ enabled: true, notifyEmails: [] });
    renderPanel(true);
    const input = await screen.findByLabelText(t.stProAlsoEmail);
    fireEvent.change(input, { target: { value: " a@x.com,b@x.com\n c@x.com " } });
    fireEvent.click(screen.getByRole("button", { name: t.stProSave }));
    await waitFor(() =>
      expect(callReorder).toHaveBeenCalledWith({
        action: "settings",
        notifyEmails: ["a@x.com", "b@x.com", "c@x.com"],
      }),
    );
  });

  it("shows an error and no switch when loading fails", async () => {
    company({ anvil_pro: true, anvil_pro_comped: false });
    callReorder.mockRejectedValue(new Error("boom"));
    renderPanel(true);
    expect(await screen.findByText(/boom/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.stProTurnOn })).toBeNull();
    expect(screen.queryByRole("button", { name: t.stProTurnOff })).toBeNull();
  });
});
