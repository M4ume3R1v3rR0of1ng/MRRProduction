import { describe, it, expect, vi } from "vitest";

// email.js imports the Vite-only supabase client at module load; stub it.
vi.mock("./email", () => ({
  sendEmail: vi.fn(),
  escapeHtml: (v) =>
    v == null ? "" : String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
}));

const { shouldNotifyJobMove, buildJobMoveEmail, notifyJobMove, DEFAULT_JOB_NOTIFICATIONS } = await import("./jobNotifications");

const users = [
  { id: "sup1", name: "Jason", email: "jason@example.com" },
  { id: "sup2", name: "Travis", email: "" }, // no email on file
];
const job = { id: "j1", title: "Henderson Re-Roof", po: "PO-42", addr: "1 Main St", assignedto: "sup1" };

describe("shouldNotifyJobMove", () => {
  it("fires only when the company enabled that exact transition", () => {
    expect(shouldNotifyJobMove("approved", { approved: true })).toBe(true);
    expect(shouldNotifyJobMove("approved", { approved: false })).toBe(false);
    expect(shouldNotifyJobMove("closed", { approved: true })).toBe(false); // different key
  });

  it("defaults to off — a missing pref never sends", () => {
    expect(shouldNotifyJobMove("completed", DEFAULT_JOB_NOTIFICATIONS)).toBe(false);
    expect(shouldNotifyJobMove("completed", {})).toBe(false);
    expect(shouldNotifyJobMove("completed", null)).toBe(false);
  });

  it("rejects an unknown transition even if a truthy pref exists", () => {
    expect(shouldNotifyJobMove("deleted", { deleted: true })).toBe(false);
  });
});

describe("buildJobMoveEmail", () => {
  it("labels the email by the move and includes PO", () => {
    const m = buildJobMoveEmail("completed", job);
    expect(m.subject).toBe("Job Completed: Henderson Re-Roof (PO PO-42)");
    expect(m.html).toMatch(/has been marked completed/);
  });

  it("escapes user-entered job text so a crafted name can't inject markup", () => {
    const m = buildJobMoveEmail("approved", { title: "<script>alert(1)</script>", po: "<b>", assignedto: "sup1" });
    expect(m.html).not.toMatch(/<script>alert/);
    expect(m.html).toMatch(/&lt;script&gt;/);
    expect(m.html).toMatch(/&lt;b&gt;/);
  });

  it("returns null for an unknown transition", () => {
    expect(buildJobMoveEmail("nope", job)).toBeNull();
  });
});

describe("notifyJobMove", () => {
  it("emails the assigned supervisor when the move is enabled", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyJobMove({ transition: "approved", job, users, prefs: { approved: true }, send });
    expect(res).toEqual({ sent: true, to: "jason@example.com" });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].to).toBe("jason@example.com");
  });

  it("does not send when the transition is disabled", async () => {
    const send = vi.fn();
    const res = await notifyJobMove({ transition: "approved", job, users, prefs: { approved: false }, send });
    expect(res.reason).toBe("disabled");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send when the job has no assignable supervisor", async () => {
    const send = vi.fn();
    const noAssignee = await notifyJobMove({ transition: "approved", job: { ...job, assignedto: null }, users, prefs: { approved: true }, send });
    expect(noAssignee.reason).toBe("no-supervisor-email");
    const noEmail = await notifyJobMove({ transition: "approved", job: { ...job, assignedto: "sup2" }, users, prefs: { approved: true }, send });
    expect(noEmail.reason).toBe("no-supervisor-email");
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a send failure instead of throwing into the status change", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend down"));
    const res = await notifyJobMove({ transition: "closed", job, users, prefs: { closed: true }, send });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("send-failed");
  });

  it("reads assignedTo (camelCase) as well as assignedto", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyJobMove({ transition: "active", job: { ...job, assignedto: undefined, assignedTo: "sup1" }, users, prefs: { active: true }, send });
    expect(res.sent).toBe(true);
  });
});
