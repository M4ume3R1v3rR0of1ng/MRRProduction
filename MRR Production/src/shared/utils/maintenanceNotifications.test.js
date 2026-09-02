import { describe, it, expect, vi } from "vitest";

// email.js imports the Vite-only supabase client at module load; stub it.
vi.mock("./email", () => ({
  sendEmail: vi.fn(),
  escapeHtml: (v) =>
    v == null ? "" : String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
}));

const {
  isUrgent,
  eventForStatus,
  eventForNewRequest,
  shouldNotifyMaint,
  resolveMaintManagers,
  buildMaintEmail,
  notifyMaintFiled,
  notifyMaintStatus,
} = await import("./maintenanceNotifications");

const req = {
  id: "r1",
  vname: "Truck 12 (ABC-1234)",
  type: "Brake Service",
  urgency: "normal",
  notes: "Grinding when stopping",
  uid: "emp1",
  uname: "Jason",
  mileage: "84210",
};

const users = [
  { id: "wh1", name: "Dana", email: "dana@example.com", role: "warehouse", active: true },
  { id: "co1", name: "Sam", email: "sam@example.com", role: "coordinator", active: true },
  { id: "mg1", name: "Pat", email: "pat@example.com", role: "manager", active: true },
  { id: "emp1", name: "Jason", email: "jason@example.com", role: "employee", active: true },
];

describe("isUrgent", () => {
  it("accepts the urgency words both create modals can produce", () => {
    expect(isUrgent({ urgency: "urgent" })).toBe(true);
    expect(isUrgent({ urgency: "URGENT" })).toBe(true);
    expect(isUrgent({ urgency: "high" })).toBe(true);
    expect(isUrgent({ urgency: "normal" })).toBe(false);
    expect(isUrgent({ urgency: "standard" })).toBe(false);
    expect(isUrgent({})).toBe(false);
  });
});

describe("eventForStatus", () => {
  it("maps only the two statuses that notify the requester", () => {
    expect(eventForStatus("scheduled")).toBe("scheduled");
    expect(eventForStatus("completed")).toBe("completed");
    expect(eventForStatus("pending")).toBeNull();
    expect(eventForStatus(undefined)).toBeNull();
  });
});

describe("eventForNewRequest", () => {
  it("prefers the urgent rule for an urgent ticket", () => {
    expect(eventForNewRequest({ urgency: "urgent" }, { filed: true, urgent: true })).toBe("urgent");
  });

  it("falls back to filed so urgent is never quieter than routine", () => {
    expect(eventForNewRequest({ urgency: "urgent" }, { filed: true, urgent: false })).toBe("filed");
  });

  it("lets urgent-only fire without emailing every routine ticket", () => {
    expect(eventForNewRequest({ urgency: "urgent" }, { filed: false, urgent: true })).toBe("urgent");
    expect(eventForNewRequest({ urgency: "normal" }, { filed: false, urgent: true })).toBeNull();
  });

  it("returns null when the group is entirely off", () => {
    expect(eventForNewRequest({ urgency: "urgent" }, { filed: false, urgent: false })).toBeNull();
    expect(eventForNewRequest(req, {})).toBeNull();
    expect(eventForNewRequest(req, null)).toBeNull();
  });
});

describe("shouldNotifyMaint", () => {
  it("fires only on an exact enabled key", () => {
    expect(shouldNotifyMaint("scheduled", { scheduled: true })).toBe(true);
    expect(shouldNotifyMaint("scheduled", { completed: true })).toBe(false);
  });

  it("rejects an unknown event even with a truthy pref", () => {
    expect(shouldNotifyMaint("deleted", { deleted: true })).toBe(false);
  });
});

describe("resolveMaintManagers", () => {
  it("picks exactly the maint_manage holders, not a hardcoded role list", () => {
    const got = resolveMaintManagers(users, {}, {}).map((u) => u.id);
    // warehouse and coordinator hold maint_manage by default; manager and employee do not.
    expect(got).toEqual(["wh1", "co1"]);
  });

  it("includes admins, who bypass the permission matrix", () => {
    const withAdmin = [...users, { id: "ad1", email: "boss@example.com", role: "admin", active: true }];
    expect(resolveMaintManagers(withAdmin, {}, {}).map((u) => u.id)).toContain("ad1");
  });

  it("honours a per-user override that grants the permission", () => {
    const got = resolveMaintManagers(users, {}, { mg1: { maint_manage: true } }).map((u) => u.id);
    expect(got).toContain("mg1");
  });

  it("drops inactive accounts and accounts with no email", () => {
    const messy = [
      { id: "a", email: "a@example.com", role: "warehouse", active: false },
      { id: "b", email: "", role: "warehouse", active: true },
      { id: "c", email: "c@example.com", role: "warehouse", active: true },
    ];
    expect(resolveMaintManagers(messy, {}, {}).map((u) => u.id)).toEqual(["c"]);
  });

  it("can exclude the person who triggered the event", () => {
    const got = resolveMaintManagers(users, {}, {}, { excludeUserId: "wh1" }).map((u) => u.id);
    expect(got).toEqual(["co1"]);
  });
});

describe("buildMaintEmail", () => {
  it("names the vehicle in the subject and describes the event", () => {
    const m = buildMaintEmail("filed", req);
    expect(m.subject).toBe("New Maintenance Request: Truck 12 (ABC-1234)");
    expect(m.html).toMatch(/waiting to be scheduled/);
    expect(m.html).toMatch(/Grinding when stopping/);
  });

  it("marks an urgent request as urgent", () => {
    const m = buildMaintEmail("urgent", { ...req, urgency: "urgent" });
    expect(m.subject).toMatch(/^URGENT Maintenance Request:/);
  });

  it("escapes user-entered text so a crafted note can't inject markup", () => {
    const m = buildMaintEmail("filed", { ...req, vname: "<script>alert(1)</script>", notes: "<b>bad</b>" });
    expect(m.html).not.toMatch(/<script>alert/);
    expect(m.html).toMatch(/&lt;script&gt;/);
    expect(m.html).toMatch(/&lt;b&gt;bad/);
  });

  it("omits rows that have no value instead of printing empty labels", () => {
    const m = buildMaintEmail("filed", { vname: "Trailer 3", type: "Repair", uname: "Kim" });
    expect(m.html).not.toMatch(/Mileage/);
    expect(m.html).not.toMatch(/Shop notes/);
  });

  it("reads snake_case and camelCase shop notes alike", () => {
    expect(buildMaintEmail("completed", { ...req, wh_notes: "Pads replaced" }).html).toMatch(/Pads replaced/);
    expect(buildMaintEmail("completed", { ...req, whNotes: "Pads replaced" }).html).toMatch(/Pads replaced/);
  });

  it("keeps an unparseable date rather than rendering Invalid Date", () => {
    const m = buildMaintEmail("scheduled", { ...req, scheduled_date: "whenever" });
    expect(m.html).toMatch(/whenever/);
    expect(m.html).not.toMatch(/Invalid Date/);
  });

  it("returns null for an unknown event", () => {
    expect(buildMaintEmail("nope", req)).toBeNull();
  });
});

describe("notifyMaintFiled", () => {
  const recipients = [
    { id: "wh1", email: "dana@example.com" },
    { id: "co1", email: "sam@example.com" },
  ];

  it("emails every manager in one send", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyMaintFiled({ req, recipients, prefs: { filed: true }, send });
    expect(res.sent).toBe(true);
    expect(res.event).toBe("filed");
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].to).toEqual(["dana@example.com", "sam@example.com"]);
  });

  it("does not send when the group is off", async () => {
    const send = vi.fn();
    const res = await notifyMaintFiled({ req, recipients, prefs: { filed: false, urgent: false }, send });
    expect(res.reason).toBe("disabled");
    expect(send).not.toHaveBeenCalled();
  });

  it("reports no-recipients rather than calling the relay with an empty list", async () => {
    const send = vi.fn();
    const res = await notifyMaintFiled({ req, recipients: [], prefs: { filed: true }, send });
    expect(res.reason).toBe("no-recipients");
    expect(send).not.toHaveBeenCalled();
  });

  it("lowercases and de-duplicates addresses", async () => {
    const send = vi.fn().mockResolvedValue({});
    await notifyMaintFiled({
      req,
      recipients: [{ email: "Dana@Example.com" }, { email: "dana@example.com" }],
      prefs: { filed: true },
      send,
    });
    expect(send.mock.calls[0][0].to).toEqual(["dana@example.com"]);
  });

  it("splits into batches of 10, which is the relay's per-request cap", async () => {
    const send = vi.fn().mockResolvedValue({});
    const many = Array.from({ length: 23 }, (_, i) => ({ email: `m${i}@example.com` }));
    const res = await notifyMaintFiled({ req, recipients: many, prefs: { filed: true }, send });
    expect(res.sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][0].to).toHaveLength(10);
    expect(send.mock.calls[2][0].to).toHaveLength(3);
  });

  it("does not email the manager who filed the request themselves", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyMaintFiled({ req, recipients, prefs: { filed: true }, excludeUserId: "wh1", send });
    expect(res.sent).toBe(true);
    expect(send.mock.calls[0][0].to).toEqual(["sam@example.com"]);
  });

  it("stays silent when the only manager is the one who filed it", async () => {
    const send = vi.fn();
    const res = await notifyMaintFiled({ req, recipients: [recipients[0]], prefs: { filed: true }, excludeUserId: "wh1", send });
    expect(res.reason).toBe("no-recipients");
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a send failure instead of throwing into the insert", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend down"));
    const res = await notifyMaintFiled({ req, recipients, prefs: { filed: true }, send });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("send-failed");
  });
});

describe("notifyMaintStatus", () => {
  it("emails the person who filed the ticket", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyMaintStatus({ status: "scheduled", req, users, prefs: { scheduled: true }, actorId: "wh1", send });
    expect(res).toMatchObject({ sent: true, to: "jason@example.com", event: "scheduled" });
  });

  it("stays quiet when someone updates their own ticket", async () => {
    const send = vi.fn();
    const res = await notifyMaintStatus({ status: "completed", req, users, prefs: { completed: true }, actorId: "emp1", send });
    expect(res.reason).toBe("self-update");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send for a status nobody subscribed to", async () => {
    const send = vi.fn();
    const res = await notifyMaintStatus({ status: "pending", req, users, prefs: { scheduled: true, completed: true }, send });
    expect(res.reason).toBe("no-event-for-status");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send when the automation is off", async () => {
    const send = vi.fn();
    const res = await notifyMaintStatus({ status: "scheduled", req, users, prefs: { scheduled: false }, send });
    expect(res.reason).toBe("disabled");
    expect(send).not.toHaveBeenCalled();
  });

  it("skips a requester who has no email or has been deactivated", async () => {
    const send = vi.fn();
    const gone = await notifyMaintStatus({ status: "scheduled", req: { ...req, uid: "ghost" }, users, prefs: { scheduled: true }, send });
    expect(gone.reason).toBe("no-requester-email");
    const inactive = await notifyMaintStatus({
      status: "scheduled",
      req,
      users: [{ id: "emp1", email: "jason@example.com", active: false }],
      prefs: { scheduled: true },
      send,
    });
    expect(inactive.reason).toBe("no-requester-email");
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a send failure instead of throwing into the status update", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend down"));
    const res = await notifyMaintStatus({ status: "completed", req, users, prefs: { completed: true }, send });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("send-failed");
  });
});
