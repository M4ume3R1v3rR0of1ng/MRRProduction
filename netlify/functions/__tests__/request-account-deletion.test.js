import { describe, it, expect } from "vitest";
import { pickAdminRecipients, buildRequestEmail } from "../request-account-deletion.js";

describe("pickAdminRecipients", () => {
  it("emails the other admins, never the person asking", () => {
    expect(pickAdminRecipients(["Boss@Co.com", "me@co.com"], "ME@co.com")).toEqual(["boss@co.com"]);
  });

  it("drops blanks and duplicates", () => {
    expect(pickAdminRecipients(["a@co.com", null, "", " A@co.com "], "x@co.com")).toEqual([
      "a@co.com",
    ]);
  });

  it("returns nobody when the caller is the only admin", () => {
    expect(pickAdminRecipients(["owner@co.com"], "owner@co.com")).toEqual([]);
  });
});

describe("buildRequestEmail", () => {
  const base = {
    name: "Pat Crew",
    email: "pat@co.com",
    role: "field",
    companyName: "Acme Roofing",
    reason: "",
  };

  it("tells admins where to remove the person", () => {
    const { subject, html } = buildRequestEmail({ ...base, hasAdmins: true });
    expect(subject).toBe("Account deletion request: Pat Crew (pat@co.com)");
    expect(html).toMatch(/under <strong>Users<\/strong>/);
  });

  it("flags a sole admin for support instead", () => {
    const { html } = buildRequestEmail({ ...base, role: "admin", hasAdmins: false });
    expect(html).toMatch(/only admin of Acme Roofing/);
    expect(html).not.toMatch(/under <strong>Users<\/strong>/);
  });

  it("escapes what the person typed", () => {
    const { html } = buildRequestEmail({ ...base, hasAdmins: true, reason: "<b>bye</b>" });
    expect(html).toContain("&lt;b&gt;bye&lt;/b&gt;");
    expect(html).not.toContain("<b>bye</b>");
  });
});
