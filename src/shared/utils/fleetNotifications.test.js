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

const { driverIdOf, vehicleLabel, buildAssignmentEmail, notifyVehicleAssigned } =
  await import("./fleetNotifications");

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
