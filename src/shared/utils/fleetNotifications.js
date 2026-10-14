// src/shared/utils/fleetNotifications.js
//
// Automatic email for the fleet board. One direction, one event: a vehicle is put in
// someone's name, and that person is told which truck is theirs.
//
// Until now assigning a vehicle was silent — FleetManagementView wrote
// vehicles."assignedTo" and the driver found out when somebody mentioned it, or when the
// oil-due cron emailed them about a truck they didn't know they had.
//
// Company config lives in settings(key='fleet_notifications') and is described by the
// shared registry in ./automations. Defaults off, so nothing sends until an admin turns
// it on in Settings → Automations.
//
// Same split as jobNotifications and maintenanceNotifications: the decision and the
// template are pure and unit-tested, and the only impure part is the send, which is
// injectable.

import { sendEmail, escapeHtml } from "./email";

// THE COLUMN IS camelCase. vehicles."assignedTo" is the real, quoted column name —
// supabase/19_maintenance_vehicle_swap.sql:56 looks it up by that exact spelling and
// raises if it is missing, so it is not a shape this app gets to choose. Reading
// snake_case variants too because DashboardView did, against a column that has never
// existed under those names; see the comment on driverIdOf below.
export function driverIdOf(vehicle) {
  if (!vehicle) return "";
  const raw = vehicle.assignedTo ?? vehicle.assignedto ?? "";
  return String(raw ?? "").trim();
}

// A readable name for the truck in a subject line. Vehicles carry `name` plus an
// optional plate; fall back through both rather than emailing someone about "undefined".
export function vehicleLabel(vehicle) {
  const name = String(vehicle?.name || "").trim();
  const plate = String(vehicle?.plate || vehicle?.lp || "").trim();
  if (name && plate) return `${name} (${plate})`;
  return name || plate || "a vehicle";
}

// Pure: the subject/html for an assignment. Every interpolated value is user-entered
// (vehicle name, plate, the assigning user's name) and lands in HTML email, so it is
// escaped — same rule as every other sendEmail call site.
export function buildAssignmentEmail(vehicle, { assignedByName } = {}) {
  const rawLabel = vehicleLabel(vehicle);
  const label = escapeHtml(rawLabel);
  const year = escapeHtml(vehicle?.year || "");
  const make = escapeHtml(vehicle?.make || "");
  const model = escapeHtml(vehicle?.model || "");
  const mileage = vehicle?.mi == null || vehicle.mi === "" ? "" : escapeHtml(vehicle.mi);
  const by = escapeHtml(String(assignedByName || "").trim());

  const row = (lbl, value) => (value ? `<p><strong>${lbl}:</strong> ${value}</p>` : "");
  const spec = [year, make, model].filter(Boolean).join(" ");

  return {
    subject: `Vehicle Assigned: ${rawLabel}`,
    html:
      `<h2>You have been assigned a vehicle</h2>` +
      `<p><strong>${label}</strong> is now assigned to you.</p>` +
      row("Vehicle", spec) +
      row("Current mileage", mileage) +
      row("Assigned by", by) +
      `<p>Log in to the Fleet page to see its service history, log mileage, or report a problem with it.</p>`,
  };
}

// Pure: the subject/html for a spare lent while the driver's own vehicle is in for
// service. Deliberately NOT buildAssignmentEmail — "Truck 12 is now assigned to you"
// is wrong for a loan in both directions. It doesn't say the truck is a loaner, and it
// doesn't say which of their vehicles went in, which is the thing the driver needs in
// order to know what is happening to their day.
//
// Everything interpolated is user-entered and lands in HTML email, so it is escaped —
// same rule as every other sendEmail call site.
export function buildSpareLoanEmail(spare, { servicedVehicle, scheduledDate, lentByName } = {}) {
  const rawSpare = vehicleLabel(spare);
  const rawServiced = vehicleLabel(servicedVehicle);
  const label = escapeHtml(rawSpare);
  const serviced = escapeHtml(rawServiced);
  const year = escapeHtml(spare?.year || spare?.yr || "");
  const make = escapeHtml(spare?.make || "");
  const model = escapeHtml(spare?.model || "");
  const mileage = spare?.mi == null || spare.mi === "" ? "" : escapeHtml(spare.mi);
  const by = escapeHtml(String(lentByName || "").trim());

  // Dates arrive as a plain "YYYY-MM-DD" string from the request row. Formatted with
  // parseDay-style care would be nicer, but a wrong date here is worse than a plain
  // one, so the stored value is shown as-is.
  const when = escapeHtml(String(scheduledDate || "").trim());

  const row = (lbl, value) => (value ? `<p><strong>${lbl}:</strong> ${value}</p>` : "");
  const spec = [year, make, model].filter(Boolean).join(" ");

  return {
    subject: `Spare Vehicle: drive ${rawSpare}${rawServiced === "a vehicle" ? "" : ` while ${rawServiced} is in for service`}`,
    html:
      `<h2>You have been given a spare vehicle</h2>` +
      `<p>Drive <strong>${label}</strong> while <strong>${serviced}</strong> is in for service.</p>` +
      row("Spare vehicle", spec) +
      row("Current mileage", mileage) +
      row("Service scheduled", when) +
      row("Arranged by", by) +
      `<p>This is temporary — ${serviced} goes back in your name as soon as the service is marked complete.</p>` +
      `<p>Log in to the Fleet page to see the spare's service history, log mileage, or report a problem with it.</p>`,
  };
}

// A spare was lent out: tell the driver which vehicle is now theirs and why.
//
// WHY THIS EXISTS SEPARATELY FROM notifyVehicleAssigned
//
// The loan RPC (assign_replacement_vehicle, supabase/19) moves the driver off their own
// truck and onto the spare in one transaction, so the fleet board is correct and nobody
// is ever told. The "unassigned" branch below already claimed "a service loan emails
// separately" — this is the function that was supposed to be doing that, and until now
// was not. Completing the service pops the driver's dashboard alert (supabase/38), so
// before this they were told when they got their own truck BACK and never told they had
// been given a loaner in the first place.
//
// WHY IT SHARES THE `assigned` TOGGLE
//
// A loaner is a truck the driver has been given, which is exactly what that automation
// promises to email about ("Email a driver about the truck they have been given"). A
// separate key would default to off, which would mean this still silently did nothing
// until an admin went looking for a switch they have no reason to expect.
//
// Returns a result rather than throwing: the swap is already committed when this runs,
// and a loan must never fail on account of an email.
export async function notifySpareLent({
  spare,
  servicedVehicle,
  driverId,
  scheduledDate,
  users = [],
  prefs,
  actorId,
  lentByName,
  send = sendEmail,
}) {
  if (!prefs || prefs.assigned !== true) return { sent: false, reason: "disabled" };

  // The serviced vehicle had nobody on it. The loan still makes sense (the spare is
  // staged ready for whoever takes the work) but there is no driver to write to.
  const next = String(driverId ?? "").trim();
  if (!next) return { sent: false, reason: "no-driver" };

  // Same rule as everywhere else: nobody is emailed about their own action. A driver
  // who lends themselves a spare already knows which one they picked.
  if (actorId && String(actorId) === next) return { sent: false, reason: "self-assign" };

  const driver = users.find((u) => u && String(u.id) === next);
  if (!driver?.email || driver.active === false) return { sent: false, reason: "no-driver-email" };

  const mail = buildSpareLoanEmail(spare, { servicedVehicle, scheduledDate, lentByName });

  try {
    await send({ to: driver.email, subject: mail.subject, html: mail.html });
    return { sent: true, event: "spare-lent", to: driver.email };
  } catch (err) {
    return { sent: false, reason: "send-failed", error: err?.message };
  }
}

// A vehicle changed hands: tell the driver who now has it. Returns a result rather than
// throwing, because assigning a vehicle must never fail on account of an email.
//
// Silent in four cases, each deliberate:
//   no-event          the automation is off for this company.
//   unassigned        the vehicle was taken OFF a driver and given to nobody. There is
//                     no new owner to write to; the person who lost it is handled by
//                     whatever took it away (a service loan emails separately).
//   unchanged         the same driver was saved again. The assignment dialog writes on
//                     every Save, including one that changed nothing, and re-sending
//                     then would teach people to ignore the mail.
//   self-assign       the driver assigned the truck to themselves, matching the rule
//                     everywhere else in the app that nobody is alerted to their own
//                     action.
export async function notifyVehicleAssigned({
  vehicle,
  driverId,
  previousDriverId,
  users = [],
  prefs,
  actorId,
  assignedByName,
  send = sendEmail,
}) {
  if (!prefs || prefs.assigned !== true) return { sent: false, reason: "disabled" };

  const next = String(driverId ?? "").trim();
  if (!next) return { sent: false, reason: "unassigned" };

  const prev = String(previousDriverId ?? "").trim();
  if (prev && prev === next) return { sent: false, reason: "unchanged" };

  if (actorId && String(actorId) === next) return { sent: false, reason: "self-assign" };

  const driver = users.find((u) => u && String(u.id) === next);
  if (!driver?.email || driver.active === false) return { sent: false, reason: "no-driver-email" };

  const mail = buildAssignmentEmail(vehicle, { assignedByName });

  try {
    await send({ to: driver.email, subject: mail.subject, html: mail.html });
    return { sent: true, event: "assigned", to: driver.email };
  } catch (err) {
    return { sent: false, reason: "send-failed", error: err?.message };
  }
}
