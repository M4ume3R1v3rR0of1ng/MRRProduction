import { describe, it, expect, vi } from "vitest";

// email.js imports the Vite-only supabase client at module load; stub it.
vi.mock("./email", () => ({
  sendEmail: vi.fn(),
  escapeHtml: (v) =>
    v == null
      ? ""
      : String(v)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;"),
}));

const {
  driverIdOf,
  vehicleLabel,
  buildAssignmentEmail,
  notifyVehicleAssigned,
  buildSpareLoanEmail,
  notifySpareLent,
} = await import("./fleetNotifications");

const vehicle = {
  id: "v1",
  name: "Truck 12",
  plate: "ABC-1234",
  year: "2019",
  make: "Ford",
  model: "F-250",
  mi: 84210,
  assignedTo: "emp1",
};

const users = [
  { id: "emp1", name: "Jason", email: "jason@example.com", role: "employee", active: true },
  { id: "emp2", name: "Maria", email: "maria@example.com", role: "employee", active: true },
  { id: "wh1", name: "Dana", email: "dana@example.com", role: "warehouse", active: true },
];

const on = { assigned: true };

describe("driverIdOf", () => {
  it("reads the camelCase column the database actually has", () => {
    expect(driverIdOf({ assignedTo: "emp1" })).toBe("emp1");
  });

  it("tolerates the all-lowercase spelling a raw select can return", () => {
    expect(driverIdOf({ assignedto: "emp2" })).toBe("emp2");
  });

  it("returns an empty string for an unassigned or missing vehicle", () => {
    expect(driverIdOf({ assignedTo: "" })).toBe("");
    expect(driverIdOf({ assignedTo: null })).toBe("");
    expect(driverIdOf({})).toBe("");
    expect(driverIdOf(null)).toBe("");
  });
});

describe("vehicleLabel", () => {
  it("combines name and plate when it has both", () => {
    expect(vehicleLabel(vehicle)).toBe("Truck 12 (ABC-1234)");
  });

  it("falls back through whichever one it has", () => {
    expect(vehicleLabel({ name: "Truck 12" })).toBe("Truck 12");
    expect(vehicleLabel({ plate: "ABC-1234" })).toBe("ABC-1234");
    expect(vehicleLabel({ lp: "XYZ-9" })).toBe("XYZ-9");
  });

  it("never renders undefined into a subject line", () => {
    expect(vehicleLabel({})).toBe("a vehicle");
    expect(vehicleLabel(null)).toBe("a vehicle");
  });
});

describe("buildAssignmentEmail", () => {
  it("names the vehicle in the subject and the body", () => {
    const mail = buildAssignmentEmail(vehicle, { assignedByName: "Dana" });
    expect(mail.subject).toBe("Vehicle Assigned: Truck 12 (ABC-1234)");
    expect(mail.html).toContain("Truck 12 (ABC-1234)");
    expect(mail.html).toContain("2019 Ford F-250");
    expect(mail.html).toContain("84210");
    expect(mail.html).toContain("Dana");
  });

  it("omits rows it has no value for rather than printing empty labels", () => {
    const mail = buildAssignmentEmail({ name: "Trailer 3" }, {});
    expect(mail.html).not.toContain("Current mileage");
    expect(mail.html).not.toContain("Assigned by");
    expect(mail.html).not.toContain("<strong>Vehicle:</strong>");
  });

  it("escapes a vehicle name that contains markup", () => {
    const mail = buildAssignmentEmail({ name: "<script>alert(1)</script>" }, {});
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("keeps a zero mileage, which is a real reading and not a missing one", () => {
    const mail = buildAssignmentEmail({ name: "Truck 1", mi: 0 }, {});
    expect(mail.html).toContain("Current mileage");
  });
});

describe("notifyVehicleAssigned", () => {
  it("emails the driver the vehicle was just given to", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyVehicleAssigned({
      vehicle,
      driverId: "emp1",
      previousDriverId: "",
      users,
      prefs: on,
      actorId: "wh1",
      assignedByName: "Dana",
      send,
    });
    expect(res).toMatchObject({ sent: true, event: "assigned", to: "jason@example.com" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain("Truck 12");
  });

  it("emails the new driver when a truck moves from one person to another", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyVehicleAssigned({
      vehicle,
      driverId: "emp2",
      previousDriverId: "emp1",
      users,
      prefs: on,
      actorId: "wh1",
      send,
    });
    expect(res.to).toBe("maria@example.com");
  });

  it("does not send when the automation is off", async () => {
    const send = vi.fn();
    for (const prefs of [{ assigned: false }, {}, null, undefined]) {
      const res = await notifyVehicleAssigned({
        vehicle,
        driverId: "emp1",
        users,
        prefs,
        send,
      });
      expect(res.reason).toBe("disabled");
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("stays quiet when a vehicle is taken off a driver and given to nobody", async () => {
    const send = vi.fn();
    const res = await notifyVehicleAssigned({
      vehicle,
      driverId: "",
      previousDriverId: "emp1",
      users,
      prefs: on,
      send,
    });
    expect(res.reason).toBe("unassigned");
    expect(send).not.toHaveBeenCalled();
  });

  it("stays quiet when the same driver is saved again", async () => {
    const send = vi.fn();
    const res = await notifyVehicleAssigned({
      vehicle,
      driverId: "emp1",
      previousDriverId: "emp1",
      users,
      prefs: on,
      actorId: "wh1",
      send,
    });
    expect(res.reason).toBe("unchanged");
    expect(send).not.toHaveBeenCalled();
  });

  it("stays quiet when someone assigns a truck to themselves", async () => {
    const send = vi.fn();
    const res = await notifyVehicleAssigned({
      vehicle,
      driverId: "emp1",
      previousDriverId: "",
      users,
      prefs: on,
      actorId: "emp1",
      send,
    });
    expect(res.reason).toBe("self-assign");
    expect(send).not.toHaveBeenCalled();
  });

  it("skips a driver who is unknown, deactivated, or has no email on file", async () => {
    const send = vi.fn();
    const ghost = await notifyVehicleAssigned({
      vehicle,
      driverId: "nobody",
      users,
      prefs: on,
      send,
    });
    expect(ghost.reason).toBe("no-driver-email");

    const inactive = await notifyVehicleAssigned({
      vehicle,
      driverId: "emp1",
      users: [{ id: "emp1", email: "jason@example.com", active: false }],
      prefs: on,
      send,
    });
    expect(inactive.reason).toBe("no-driver-email");

    const noEmail = await notifyVehicleAssigned({
      vehicle,
      driverId: "emp1",
      users: [{ id: "emp1", name: "Jason", active: true }],
      prefs: on,
      send,
    });
    expect(noEmail.reason).toBe("no-driver-email");
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a send failure instead of throwing into the assignment", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend down"));
    const res = await notifyVehicleAssigned({
      vehicle,
      driverId: "emp1",
      users,
      prefs: on,
      send,
    });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("send-failed");
    expect(res.error).toBe("resend down");
  });
});

// ── Lending a spare ──
//
// The loan RPC moves the driver onto the spare and clears their own truck, so the
// fleet board ends up right and the one person who needed to know was never told.
// Completing the service pops their dashboard alert (supabase/38), so the driver was
// told when they got their own truck BACK and never told they had been lent one.
const spare = {
  id: "v9",
  name: "Truck 4",
  plate: "SPR-0099",
  year: "2021",
  make: "Chevy",
  model: "Silverado",
  mi: 12050,
};

const serviced = { id: "v1", name: "Truck 12", plate: "ABC-1234" };

describe("buildSpareLoanEmail", () => {
  it("names the spare AND the vehicle it stands in for", () => {
    // Both halves matter. "Truck 4 is now assigned to you" leaves the driver guessing
    // why, and naming only the serviced truck doesn't tell them what to drive.
    const mail = buildSpareLoanEmail(spare, { servicedVehicle: serviced });
    expect(mail.subject).toContain("Truck 4 (SPR-0099)");
    expect(mail.subject).toContain("Truck 12 (ABC-1234)");
    expect(mail.html).toContain("Truck 4 (SPR-0099)");
    expect(mail.html).toContain("Truck 12 (ABC-1234)");
  });

  it("says the loan is temporary and how it ends", () => {
    const mail = buildSpareLoanEmail(spare, { servicedVehicle: serviced });
    expect(mail.html).toMatch(/temporary/i);
    expect(mail.html).toMatch(/service is marked complete/i);
  });

  it("includes the spec, mileage, service date and who arranged it", () => {
    const mail = buildSpareLoanEmail(spare, {
      servicedVehicle: serviced,
      scheduledDate: "2026-10-20",
      lentByName: "Dana",
    });
    expect(mail.html).toContain("2021 Chevy Silverado");
    expect(mail.html).toContain("12050");
    expect(mail.html).toContain("2026-10-20");
    expect(mail.html).toContain("Dana");
  });

  it("leaves out rows it has no value for rather than printing blanks", () => {
    const mail = buildSpareLoanEmail({ name: "Truck 4" }, { servicedVehicle: serviced });
    expect(mail.html).not.toContain("Current mileage");
    expect(mail.html).not.toContain("Service scheduled");
    expect(mail.html).not.toContain("Arranged by");
  });

  it("escapes every interpolated value, since this is HTML email", () => {
    const mail = buildSpareLoanEmail(
      { name: '<img src=x onerror="alert(1)">', mi: "<b>1</b>" },
      { servicedVehicle: { name: "<script>" }, lentByName: "<i>Dana</i>" },
    );
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<i>Dana</i>");
    expect(mail.html).toContain("&lt;");
  });

  it("degrades to a readable subject when the serviced vehicle is unknown", () => {
    // req.vname can be missing on an older row; the subject must not read
    // "while a vehicle is in for service".
    const mail = buildSpareLoanEmail(spare, { servicedVehicle: null });
    expect(mail.subject).toBe("Spare Vehicle: drive Truck 4 (SPR-0099)");
  });
});

describe("notifySpareLent", () => {
  const lend = (over = {}) =>
    notifySpareLent({
      spare,
      servicedVehicle: serviced,
      driverId: "emp1",
      users,
      prefs: on,
      ...over,
    });

  it("emails the driver who was moved onto the spare", async () => {
    const send = vi.fn();
    const res = await lend({ send, lentByName: "Dana" });
    expect(res).toMatchObject({ sent: true, event: "spare-lent", to: "jason@example.com" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe("jason@example.com");
    expect(send.mock.calls[0][0].html).toContain("Truck 4 (SPR-0099)");
  });

  it("stays silent when the fleet automation is off", async () => {
    // Every outbound email in this app is an admin choice. Sharing the `assigned`
    // toggle rather than adding a key is why turning that one on is enough.
    const send = vi.fn();
    expect((await lend({ prefs: undefined, send })).reason).toBe("disabled");
    expect((await lend({ prefs: { assigned: false }, send })).reason).toBe("disabled");
    expect(send).not.toHaveBeenCalled();
  });

  it("stays silent when the serviced vehicle had no driver on it", async () => {
    // The loan still makes sense — the spare is staged for whoever takes the work —
    // but there is nobody to write to.
    const send = vi.fn();
    expect((await lend({ driverId: null, send })).reason).toBe("no-driver");
    expect((await lend({ driverId: "  ", send })).reason).toBe("no-driver");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not email a driver who lent the spare to themselves", async () => {
    const send = vi.fn();
    const res = await lend({ actorId: "emp1", send });
    expect(res.reason).toBe("self-assign");
    expect(send).not.toHaveBeenCalled();
  });

  it("still emails when somebody else arranged the loan", async () => {
    const send = vi.fn();
    const res = await lend({ actorId: "wh1", send });
    expect(res.sent).toBe(true);
  });

  it("skips a driver with no email or a deactivated one", async () => {
    const send = vi.fn();
    expect(
      (await lend({ users: [{ id: "emp1", name: "Jason", active: true }], send })).reason,
    ).toBe("no-driver-email");
    expect(
      (
        await lend({
          users: [{ id: "emp1", email: "jason@example.com", active: false }],
          send,
        })
      ).reason,
    ).toBe("no-driver-email");
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a send failure instead of throwing into the loan", async () => {
    // The swap is already committed by the time this runs. A dead relay must not
    // surface as a failed loan.
    const send = vi.fn().mockRejectedValue(new Error("resend down"));
    const res = await lend({ send });
    expect(res).toMatchObject({ sent: false, reason: "send-failed", error: "resend down" });
  });
});
