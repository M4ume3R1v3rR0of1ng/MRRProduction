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

const { excerpt, buildMentionEmail, notifyChatMention } = await import("./chatNotifications");

const users = [
  { id: "u1", full_name: "Jason Smith", email: "jason@example.com", active: true },
  { id: "u2", full_name: "Dana Flores", email: "dana@example.com", active: true },
  { id: "u3", full_name: "Jo", email: "jo@example.com", active: true },
  { id: "u4", full_name: "Gone Guy", email: "gone@example.com", active: false },
];

const on = { mentioned: true };

describe("excerpt", () => {
  it("leaves a short message alone", () => {
    expect(excerpt("hello")).toBe("hello");
  });

  it("truncates a wall of text with an ellipsis", () => {
    const long = "x".repeat(500);
    const out = excerpt(long);
    expect(out.length).toBeLessThan(500);
    expect(out.endsWith("…")).toBe(true);
  });

  it("handles missing input", () => {
    expect(excerpt(null)).toBe("");
    expect(excerpt(undefined)).toBe("");
  });
});

describe("buildMentionEmail", () => {
  it("names the sender in the subject and quotes the message", () => {
    const mail = buildMentionEmail({ senderName: "Dana", message: "@Jo check the brakes" });
    expect(mail.subject).toBe("Dana mentioned you in Team Chat");
    expect(mail.html).toContain("Dana");
    expect(mail.html).toContain("@Jo check the brakes");
  });

  it("escapes markup in the message and the sender name", () => {
    const mail = buildMentionEmail({
      senderName: "<b>Dana</b>",
      message: "<script>alert(1)</script>",
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>Dana</b>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("keeps newlines readable without letting other markup through", () => {
    const mail = buildMentionEmail({ senderName: "Dana", message: "line one\nline two" });
    expect(mail.html).toContain("line one<br>line two");
  });

  it("mentions an attached photo, and stays silent when there is none", () => {
    expect(buildMentionEmail({ senderName: "D", message: "hi", hasPhoto: true }).html).toContain(
      "A photo was attached",
    );
    expect(buildMentionEmail({ senderName: "D", message: "hi" }).html).not.toContain(
      "A photo was attached",
    );
  });

  it("falls back to a generic sender rather than printing undefined", () => {
    const mail = buildMentionEmail({ message: "hi" });
    expect(mail.subject).toBe("A teammate mentioned you in Team Chat");
  });

  it("omits the quote block for a photo-only message", () => {
    const mail = buildMentionEmail({ senderName: "D", message: "", hasPhoto: true });
    expect(mail.html).not.toContain("blockquote");
  });
});

describe("notifyChatMention", () => {
  it("emails the person who was mentioned", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyChatMention({
      message: "@Jo can you check the brakes",
      users,
      prefs: on,
      actorId: "u2",
      senderName: "Dana Flores",
      send,
    });
    expect(res).toMatchObject({ sent: true, event: "mentioned", to: ["jo@example.com"] });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("emails everyone a message names", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyChatMention({
      message: "@Jo and @Jason Smith, yard at 7",
      users,
      prefs: on,
      actorId: "u2",
      senderName: "Dana Flores",
      send,
    });
    expect(res.to.sort()).toEqual(["jason@example.com", "jo@example.com"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send when the automation is off", async () => {
    const send = vi.fn();
    for (const prefs of [{ mentioned: false }, {}, null, undefined]) {
      const res = await notifyChatMention({ message: "@Jo hi", users, prefs, send });
      expect(res.reason).toBe("disabled");
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send for a message that mentions nobody", async () => {
    const send = vi.fn();
    const res = await notifyChatMention({
      message: "yard at 7, bring the long ladder",
      users,
      prefs: on,
      send,
    });
    expect(res.reason).toBe("no-new-mentions");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not email someone for mentioning themselves", async () => {
    const send = vi.fn();
    const res = await notifyChatMention({
      message: "@Jo reminding myself",
      users,
      prefs: on,
      actorId: "u3",
      senderName: "Jo",
      send,
    });
    expect(res.reason).toBe("no-recipients");
    expect(send).not.toHaveBeenCalled();
  });

  // The whole point of the previousMessage parameter.
  it("emails nobody when an edit only fixed a typo", async () => {
    const send = vi.fn();
    const res = await notifyChatMention({
      message: "@Jo can you check the brakes",
      previousMessage: "@Jo can you chek the brakes",
      users,
      prefs: on,
      actorId: "u2",
      send,
    });
    expect(res.reason).toBe("no-new-mentions");
    expect(send).not.toHaveBeenCalled();
  });

  it("emails only the person an edit newly named", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyChatMention({
      message: "@Jo and @Jason Smith, yard at 7",
      previousMessage: "@Jo yard at 7",
      users,
      prefs: on,
      actorId: "u2",
      senderName: "Dana Flores",
      send,
    });
    expect(res.to).toEqual(["jason@example.com"]);
    expect(res.names).toEqual(["Jason Smith"]);
  });

  it("drops a deactivated mention without killing the email to everyone else", async () => {
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyChatMention({
      message: "@Gone Guy and @Jo, yard at 7",
      users,
      prefs: on,
      actorId: "u2",
      senderName: "Dana Flores",
      send,
    });
    // send-email.js 403s the WHOLE request if any one address is not an active member,
    // so leaving the departed name in would have silently dropped Jo's email too.
    expect(res.to).toEqual(["jo@example.com"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toEqual(["jo@example.com"]);
  });

  it("splits into batches of ten, which is the relay's per-request cap", async () => {
    const crowd = Array.from({ length: 23 }, (_, i) => ({
      id: `c${i}`,
      full_name: `Person${i}`,
      email: `p${i}@example.com`,
      active: true,
    }));
    const send = vi.fn().mockResolvedValue({});
    const res = await notifyChatMention({
      message: crowd.map((u) => `@${u.full_name}`).join(" "),
      users: crowd,
      prefs: on,
      senderName: "Dana",
      send,
    });
    expect(res.sent).toBe(true);
    expect(res.to).toHaveLength(23);
    expect(send).toHaveBeenCalledTimes(3);
    for (const call of send.mock.calls) expect(call[0].to.length).toBeLessThanOrEqual(10);
  });

  it("swallows a send failure instead of throwing into the chat post", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend down"));
    const res = await notifyChatMention({
      message: "@Jo hi",
      users,
      prefs: on,
      actorId: "u2",
      send,
    });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("send-failed");
    expect(res.error).toBe("resend down");
  });
});
