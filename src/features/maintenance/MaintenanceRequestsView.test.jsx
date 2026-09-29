// @vitest-environment jsdom
//
// src/features/maintenance/MaintenanceRequestsView.test.jsx
//
// A maintenance ticket's whole life on this screen: filed by a driver (pending),
// scheduled by the fleet manager (scheduled), closed out with a service record
// (completed), or deleted. Each step is a button that writes to the database and
// then re-renders the ticket from what it wrote, and each has a way to fail that
// must not leave the screen claiming success. Nothing in the e2e flow reaches
// this view at all.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MaintenanceRequestsView from "./MaintenanceRequestsView.jsx";
import { translations } from "@/shared/utils/translations";
import { renderStateful } from "@/test/renderView";
import { reset, respond, writes, rpcCalls, auditLog } from "@/test/fakeSupabase";
import { person, permsFor } from "@/test/fixtures/jobs";

vi.mock("@supabase/supabase-js", async () => {
  const { fakeSupabase } = await import("@/test/fakeSupabase");
  return { createClient: () => fakeSupabase };
});
vi.mock("@/shared/utils/email", async (orig) => ({ ...(await orig()), sendEmail: vi.fn() }));
vi.mock("./maintenancePdf", () => ({ generateMaintenancePdf: vi.fn(() => true) }));

const t = translations.en;

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const manager = person("morgan", "admin");
const driver = person("dana", "employee");

const truck = {
  id: "v1",
  name: "Truck 3",
  plate: "ABC-1234",
  type: "truck",
  yr: 2019,
  make: "Ford",
  model: "F-250",
  mi: 50000,
};

const ticket = (id, status, extra = {}) => ({
  id,
  vid: "v1",
  vname: "Truck 3 (ABC-1234)",
  vtype: "truck",
  type: "Brake Service",
  urgency: "standard",
  notes: "Grinding when stopping",
  uname: driver.name,
  uid: driver.id,
  status,
  at: "2026-07-01T12:00:00.000Z",
  ...extra,
});

const renderMaint = (reqs, user = manager) =>
  renderStateful(MaintenanceRequestsView, {
    state: { reqs, vehs: [truck] },
    props: {
      users: [manager, driver],
      user,
      perms: permsFor(user),
      maintenanceNotifications: {},
      maintManagers: [manager],
      lang: "en",
      company: { id: "c1", name: "Test Co" },
    },
  });

const modalTitled = (title) => screen.getByRole("heading", { name: title }).closest(".mrr-modal");
const reqWrites = () => writes().filter((w) => w.table === "maintenance_requests");

describe("Maintenance: filing a request", () => {
  const openForm = async () => {
    await userEvent.click(screen.getByRole("button", { name: t.maintNewRequest }));
    return modalTitled(t.maintFileRequest);
  };
  const submit = (form) =>
    userEvent.click(within(form).getByRole("button", { name: t.maintSubmit }));
  const fillIn = async (form) => {
    await userEvent.selectOptions(within(form).getByLabelText(t.maintSelectVehicle), "v1");
    await userEvent.click(within(form).getByRole("checkbox", { name: "Brake System Service" }));
    await userEvent.type(
      within(form).getByPlaceholderText(t.maintDescribePlaceholder),
      "  Grinding when stopping  ",
    );
  };

  it("names each missing field in turn and writes nothing until the form is complete", async () => {
    renderMaint([], driver);
    const form = await openForm();

    await submit(form);
    expect(await screen.findByText(t.maintSelectVehicleErr)).toBeTruthy();

    await userEvent.selectOptions(within(form).getByLabelText(t.maintSelectVehicle), "v1");
    await submit(form);
    expect(await screen.findByText(t.maintSelectIssueErr)).toBeTruthy();

    await userEvent.click(within(form).getByRole("checkbox", { name: "Brake System Service" }));
    await submit(form);
    expect(await screen.findByText(t.maintDescribeErr)).toBeTruthy();

    expect(reqWrites()).toEqual([]);
  });

  it("files a pending ticket against the unit number and lists it from the saved row", async () => {
    const view = renderMaint([], driver);
    const form = await openForm();

    await fillIn(form);
    await submit(form);

    expect(await screen.findByText(t.maintFiledOk)).toBeTruthy();
    expect(reqWrites()).toEqual([
      expect.objectContaining({
        op: "insert",
        returning: true,
        payload: [
          expect.objectContaining({
            vid: "v1",
            vname: "Truck 3 (ABC-1234)",
            type: "Brake System Service",
            notes: "Grinding when stopping",
            status: "pending",
            uid: "dana",
          }),
        ],
      }),
    ]);
    // The row the database handed back, id and all, not the payload it was sent.
    expect(view.state.reqs).toEqual([expect.objectContaining({ id: "new-1", status: "pending" })]);
    expect(screen.queryByRole("heading", { name: t.maintFileRequest })).toBeNull();
    expect(auditLog()).toEqual(["MAINTENANCE_REQUEST_CREATE"]);
  });

  it("does not list a ticket it could not read back", async () => {
    // Saved, but a SELECT policy hid the new row: without an id every later action
    // on it would fail, so it must not appear as if it had worked.
    respond({ table: "maintenance_requests", op: "insert" }, { data: [] });
    const view = renderMaint([], driver);
    const form = await openForm();

    await fillIn(form);
    await submit(form);

    expect(await screen.findByText(t.maintSubmitUnconfirmed)).toBeTruthy();
    expect(view.state.reqs).toEqual([]);
    expect(modalTitled(t.maintFileRequest)).toBeTruthy();
  });

  it("offers a driver no management actions on their own ticket", () => {
    renderMaint([ticket("r1", "pending"), ticket("r2", "scheduled")], driver);

    expect(screen.queryByRole("button", { name: t.maintScheduleBtn })).toBeNull();
    expect(screen.queryByRole("button", { name: t.maintCompleteBtn })).toBeNull();
    expect(screen.queryByRole("button", { name: t.maintRemoveTitle })).toBeNull();
  });
});

describe("Maintenance: scheduling", () => {
  it("moves a pending ticket to scheduled with the date and notes, and flags the requester", async () => {
    const view = renderMaint([ticket("r1", "pending")]);

    await userEvent.click(screen.getByRole("button", { name: t.maintScheduleBtn }));
    const review = modalTitled(`${t.maintReviewRequest} — Truck 3 (ABC-1234)`);
    fireEvent.change(within(review).getByLabelText(t.maintScheduleDate), {
      target: { value: "2026-08-03" },
    });
    await userEvent.type(
      within(review).getByPlaceholderText(t.maintSchedNotesPlaceholder),
      "Bring it to Joe's",
    );
    await userEvent.click(within(review).getByRole("button", { name: t.maintApproveSchedule }));

    expect(await screen.findByText(t.maintStatusUpdated)).toBeTruthy();
    expect(reqWrites()).toEqual([
      expect.objectContaining({
        op: "update",
        filters: { id: "r1" },
        payload: {
          status: "scheduled",
          scheduled_date: "2026-08-03",
          wh_notes: "Bring it to Joe's",
          completed_at: "",
          newforrequester: true,
        },
      }),
    ]);
    expect(view.state.reqs[0]).toMatchObject({ status: "scheduled", scheduled_date: "2026-08-03" });
    // The card now offers the next step.
    expect(screen.getByRole("button", { name: t.maintCompleteBtn })).toBeTruthy();
  });

  it("keeps the ticket pending when the row is gone", async () => {
    respond({ table: "maintenance_requests", op: "update" }, { data: [] });
    const view = renderMaint([ticket("r1", "pending")]);

    await userEvent.click(screen.getByRole("button", { name: t.maintScheduleBtn }));
    await userEvent.click(screen.getByRole("button", { name: t.maintApproveSchedule }));

    expect(await screen.findByText(/no longer exists/i)).toBeTruthy();
    expect(view.state.reqs[0].status).toBe("pending");
    expect(auditLog()).toEqual([]);
  });
});

describe("Maintenance: completing service", () => {
  const scheduled = ticket("r1", "scheduled", { wh_notes: "Bring it to Joe's" });
  const openCompleteService = async () => {
    await userEvent.click(screen.getByRole("button", { name: t.maintCompleteBtn }));
    await userEvent.click(screen.getByRole("button", { name: t.maintCompleteClose }));
    return screen.getByRole("button", { name: /complete service/i }).closest(".mrr-modal");
  };

  it("closes the ticket through one RPC and refreshes the truck from the database", async () => {
    // What the RPC wrote to the vehicle — only the database knows it.
    respond(
      { table: "vehicles", op: "select" },
      { data: [{ ...truck, mi: 51200, svc: [{ id: "s1", type: "Brake Service" }] }] },
    );
    const view = renderMaint([scheduled]);
    const modal = await openCompleteService();

    await userEvent.type(within(modal).getByLabelText(/^Cost/), "240");
    await userEvent.click(within(modal).getByRole("button", { name: /complete service/i }));

    expect(await screen.findByText(t.maintStatusUpdated)).toBeTruthy();
    expect(rpcCalls("complete_maintenance_service")).toEqual([
      expect.objectContaining({
        args: expect.objectContaining({
          p_request_id: "r1",
          // Guessed from what the driver reported.
          p_service_type: "Brake Service",
          p_performed_by: manager.name,
          p_cost: 240,
          // "No change" is sent as an explicit null, not left out.
          p_reassign_driver_id: null,
        }),
      }),
    ]);
    // No separate status write: the RPC did all of it.
    expect(reqWrites()).toEqual([]);
    expect(view.state.reqs[0]).toMatchObject({ status: "completed", newforrequester: true });
    expect(view.state.vehs[0]).toMatchObject({ mi: 51200 });
    expect(screen.getByRole("button", { name: t.maintDownloadPdf })).toBeTruthy();
    expect(auditLog()).toEqual(["FLEET_MAINTENANCE"]);
  });

  it("keeps the ticket scheduled and the form open when the RPC fails", async () => {
    respond(
      { fn: "complete_maintenance_service" },
      { error: { message: "request is not scheduled" } },
    );
    const view = renderMaint([scheduled]);
    const modal = await openCompleteService();

    await userEvent.click(within(modal).getByRole("button", { name: /complete service/i }));

    expect(
      await screen.findByText("Failed to complete service: request is not scheduled"),
    ).toBeTruthy();
    expect(view.state.reqs[0].status).toBe("scheduled");
    expect(within(modal).getByRole("button", { name: /complete service/i })).toBeTruthy();
    expect(auditLog()).toEqual([]);
  });
});

describe("Maintenance: deleting", () => {
  const pressDelete = () =>
    userEvent.click(screen.getByRole("button", { name: t.maintRemoveTitle }));

  it("does nothing when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = renderMaint([ticket("r1", "pending")]);

    await pressDelete();

    expect(reqWrites()).toEqual([]);
    expect(view.state.reqs).toHaveLength(1);
  });

  it("removes the ticket once confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = renderMaint([ticket("r1", "pending")]);

    await pressDelete();

    expect(await screen.findByText(t.maintDeletedOk)).toBeTruthy();
    expect(reqWrites()).toEqual([expect.objectContaining({ op: "delete", filters: { id: "r1" } })]);
    expect(view.state.reqs).toEqual([]);
  });
});
