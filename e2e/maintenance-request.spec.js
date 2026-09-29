// e2e/maintenance-request.spec.js
//
// A maintenance ticket across the two people it passes between, each in their
// own browser session: a driver files it, the fleet manager is alerted on their
// dashboard, schedules it, and closes it out with a service record, and the
// driver is told on theirs. MaintenanceRequestsView.test.jsx already covers each
// button against a fake database; what only a real run can show is the hand-off
// — the driver's insert passing RLS, the manager's session seeing that row, the
// complete_maintenance_service RPC (supabase/38) logging the service onto the
// truck in the same transaction, and the requester flag reaching the driver.
import { test, expect } from "@playwright/test";
import { state, login, serviceClient } from "./helpers.js";

const veh = state.vehicle;
const vname = `${veh.name} (${veh.plate})`;
const modalTitled = (page, title) =>
  page.locator(".mrr-modal").filter({ has: page.getByRole("heading", { name: title }) });

test("maintenance request: driver files -> manager schedules -> manager completes -> driver is told", async ({
  browser,
}) => {
  const notes = `Grinding when stopping (e2e ${Date.now()})`;
  const card = (page) => page.locator(".mrr-card-hover").filter({ hasText: notes });

  // ── Driver files the ticket ────────────────────────────────────────────
  const driverCtx = await browser.newContext();
  const driver = await driverCtx.newPage();
  await login(driver, state.driverEmail, state.driverPassword);
  await driver.goto("/requests");
  await driver.getByRole("button", { name: "New Request" }).click();

  const form = modalTitled(driver, "File Maintenance Request");
  await form
    .getByLabel("Select Fleet Vehicle")
    .selectOption({ label: `${veh.name} — ${veh.yr} ${veh.make} ${veh.model} (${veh.plate})` });
  // `exact`: the whole checkbox group sits inside the section's own <label>, so
  // the first box also answers to "Issue Classification ... Brake System Service".
  await form.getByRole("checkbox", { name: "Brake System Service", exact: true }).check();
  await form.getByPlaceholder("Describe exactly what is wrong...").fill(notes);
  await form.getByRole("button", { name: "Submit Work Order" }).click();

  await expect(driver.getByText("Maintenance request filed successfully!")).toBeVisible();
  await expect(card(driver)).toBeVisible();
  await expect(card(driver).getByText(vname)).toBeVisible();
  // A driver can file but not act on it.
  await expect(card(driver).getByRole("button", { name: "Schedule" })).toHaveCount(0);
  await driverCtx.close();

  // ── Manager is alerted, and schedules it ───────────────────────────────
  const managerCtx = await browser.newContext();
  const manager = await managerCtx.newPage();
  await login(manager, state.adminEmail, state.adminPassword);

  const newReqAlert = modalTitled(manager, "New Maintenance Request");
  await expect(newReqAlert).toBeVisible();
  await expect(newReqAlert.getByText(notes)).toBeVisible();
  await expect(newReqAlert.getByText(state.driverName)).toBeVisible();
  await newReqAlert.getByRole("button", { name: "Got It, Open Maintenance Requests →" }).click();
  await manager.waitForURL(/\/requests/);

  await card(manager).getByRole("button", { name: "Schedule" }).click();
  const review = modalTitled(manager, `Review Request — ${vname}`);
  await review.getByLabel("Schedule Date").fill("2030-01-15");
  await review
    .getByPlaceholder("e.g., Booked with auto shop for Tuesday...")
    .fill("Booked with the e2e shop");
  await review.getByRole("button", { name: "Approve & Schedule" }).click();

  await expect(manager.getByText("Ticket status updated successfully!")).toBeVisible();
  await expect(card(manager).getByRole("button", { name: "Complete" })).toBeVisible();

  // ── Manager closes it out with a service record ────────────────────────
  await card(manager).getByRole("button", { name: "Complete" }).click();
  await modalTitled(manager, `Review Request — ${vname}`)
    .getByRole("button", { name: "Complete & Close Request" })
    .click();

  const complete = modalTitled(manager, `Complete Service — ${vname}`);
  await expect(complete.getByText("Booked with the e2e shop")).toBeVisible();
  // "Brake System Service" (what the driver ticked) isn't one of the service
  // types, so nothing is pre-guessed and it has to be chosen.
  await complete.getByLabel("Service Performed *").selectOption("Brake Service");
  await complete.getByLabel("Cost").fill("240");
  await complete.getByLabel("Odometer at Completion").fill(String(veh.mi + 250));
  await complete.getByLabel("Resolution Notes").fill("Replaced front pads (e2e)");
  await complete.getByRole("button", { name: "Complete Service", exact: true }).click();

  await expect(manager.getByText("Ticket status updated successfully!").first()).toBeVisible();
  await expect(complete).toHaveCount(0);
  await expect(card(manager).getByRole("button", { name: "Download PDF" })).toBeVisible();

  // Still completed after a full reload, i.e. read back from the database.
  await manager.reload();
  await expect(card(manager).getByRole("button", { name: "Download PDF" })).toBeVisible();
  await expect(card(manager).getByRole("button", { name: "Complete" })).toHaveCount(0);
  await managerCtx.close();

  // What the RPC wrote to the truck, which no screen on this path renders.
  const db = serviceClient();
  const { data: truck, error: truckErr } = await db
    .from("vehicles")
    .select("mi, sl")
    .eq("company_id", state.companyId)
    .eq("id", veh.id)
    .single();
  expect(truckErr).toBeNull();
  expect(truck.mi).toBe(veh.mi + 250);
  expect(truck.sl).toEqual([
    expect.objectContaining({
      type: "Brake Service",
      mi: veh.mi + 250,
      cost: 240,
      by: state.adminName,
      notes: "Replaced front pads (e2e)",
    }),
  ]);

  // ── Driver is told on their next visit ─────────────────────────────────
  const driverCtx2 = await browser.newContext();
  const driver2 = await driverCtx2.newPage();
  await login(driver2, state.driverEmail, state.driverPassword);

  const update = modalTitled(driver2, "Maintenance Update");
  await expect(update).toBeVisible();
  await expect(update.getByText("Your maintenance request is now completed.")).toBeVisible();
  await expect(update.getByText("Replaced front pads (e2e)")).toBeVisible();
  await update.getByRole("button", { name: "Got It, View My Requests →" }).click();
  await driver2.waitForURL(/\/requests/);
  await expect(card(driver2).getByRole("button", { name: "Download PDF" })).toBeVisible();

  // Acknowledging clears the flag, so it doesn't pop again next time.
  const { data: ticket } = await db
    .from("maintenance_requests")
    .select("status, newforrequester")
    .eq("company_id", state.companyId)
    .eq("notes", notes)
    .single();
  expect(ticket).toEqual({ status: "completed", newforrequester: false });
  await driverCtx2.close();
});
