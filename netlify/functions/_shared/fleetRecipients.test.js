import { describe, it, expect } from "vitest";
import {
  memberHoldsPerm,
  resolveFleetManagers,
  dropUser,
  FLEET_MANAGE_PERM,
} from "./fleetRecipients.js";

const member = (user_id, role, over = {}) => ({ user_id, role, active: true, ...over });
const profiles = (...rows) => new Map(rows.map((r) => [r.id, r]));
const person = (id, email, full_name = "") => ({ id, email, full_name });

describe("memberHoldsPerm", () => {
  const perm = FLEET_MANAGE_PERM;

  it("falls back to the default matrix when the company has saved nothing", () => {
    expect(memberHoldsPerm(member("u1", "warehouse"), { perm })).toBe(true);
    expect(memberHoldsPerm(member("u2", "coordinator"), { perm })).toBe(true);
    // The role literally called "manager" does NOT hold fleet_edit by default.
    // Resolving on role names instead of the permission would mail this person
    // and skip the two above.
    expect(memberHoldsPerm(member("u3", "manager"), { perm })).toBe(false);
    expect(memberHoldsPerm(member("u4", "field"), { perm })).toBe(false);
    expect(memberHoldsPerm(member("u5", "bookkeeper"), { perm })).toBe(false);
  });

  it("gives an admin every permission without consulting anything", () => {
    expect(memberHoldsPerm(member("u1", "admin"), { perm })).toBe(true);
  });

  it("lets a company's saved role row grant the permission", () => {
    expect(
      memberHoldsPerm(member("u1", "field"), {
        perm,
        rolePermissions: { field: { [perm]: true } },
      }),
    ).toBe(true);
  });

  it("lets a company's saved role row revoke it", () => {
    expect(
      memberHoldsPerm(member("u1", "warehouse"), {
        perm,
        rolePermissions: { warehouse: { [perm]: false } },
      }),
    ).toBe(false);
  });

  it("keeps the default for a saved row that predates the permission key", () => {
    // The real failure this guards: a shop that saved its permissions before
    // fleet_edit existed has a row with no opinion about it. Substituting that
    // row for the defaults would resolve to undefined and email nobody.
    expect(
      memberHoldsPerm(member("u1", "warehouse"), {
        perm,
        rolePermissions: { warehouse: { inv_view: true } },
      }),
    ).toBe(true);
  });

  it("lets one person's override win over their role", () => {
    expect(
      memberHoldsPerm(member("u1", "employee"), { perm, overrides: { u1: { [perm]: true } } }),
    ).toBe(true);
    expect(
      memberHoldsPerm(member("u2", "warehouse"), { perm, overrides: { u2: { [perm]: false } } }),
    ).toBe(false);
  });

  it("is false for an unknown role and for nothing at all", () => {
    expect(memberHoldsPerm(member("u1", "intern"), { perm })).toBe(false);
    expect(memberHoldsPerm(null, { perm })).toBe(false);
  });
});

describe("resolveFleetManagers", () => {
  it("returns the permission holders with an email, and only those", () => {
    const out = resolveFleetManagers({
      members: [
        member("u1", "warehouse"),
        member("u2", "coordinator"),
        member("u3", "field"),
        member("u4", "admin"),
      ],
      profilesById: profiles(
        person("u1", "wh@x.com", "Wanda"),
        person("u2", "co@x.com", "Carl"),
        person("u3", "fd@x.com", "Finn"),
        person("u4", "ad@x.com", "Ada"),
      ),
    });
    expect(out.map((p) => p.id)).toEqual(["u1", "u2", "u4"]);
    expect(out[0]).toEqual({ id: "u1", email: "wh@x.com", name: "Wanda" });
  });

  it("drops an inactive member even though the role still holds the permission", () => {
    const out = resolveFleetManagers({
      members: [member("u1", "warehouse", { active: false })],
      profilesById: profiles(person("u1", "wh@x.com")),
    });
    expect(out).toEqual([]);
  });

  it("drops a holder with no email on file rather than inventing a recipient", () => {
    const out = resolveFleetManagers({
      members: [member("u1", "warehouse"), member("u2", "coordinator")],
      profilesById: profiles(person("u1", ""), person("u2", "co@x.com")),
    });
    expect(out.map((p) => p.id)).toEqual(["u2"]);
  });

  it("drops a holder with no profile row at all", () => {
    expect(
      resolveFleetManagers({ members: [member("u1", "warehouse")], profilesById: profiles() }),
    ).toEqual([]);
  });

  it("returns nothing for a company with no members", () => {
    expect(resolveFleetManagers({})).toEqual([]);
  });
});

describe("dropUser", () => {
  const managers = [person("u1", "a@x.com"), person("u2", "b@x.com")];

  it("removes the truck's own driver, so they are not told twice in two voices", () => {
    expect(dropUser(managers, "u1").map((p) => p.id)).toEqual(["u2"]);
  });

  it("keeps everyone when the truck has no driver", () => {
    expect(dropUser(managers, null)).toHaveLength(2);
    expect(dropUser(managers, undefined)).toHaveLength(2);
  });

  it("compares as strings, since a uuid may arrive either way", () => {
    expect(dropUser([{ id: 7, email: "a@x.com" }], "7")).toEqual([]);
  });
});
