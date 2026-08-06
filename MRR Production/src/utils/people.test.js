// Resolving a batch's `by` id to a person.
//
// The stakes are not cosmetic. This column is what an owner reads when material
// has gone missing, so a name shown here is close to an accusation and a wrong
// one is worse than none. Two rules the tests below enforce: never invent a name,
// and never show one company's staff to another.
import { describe, it, expect } from "vitest";
import { makePersonResolver, personLabel, resolvePersonName, resolveBatchPerson, displayNameOf } from "./people";
import { SEED_U } from "../data/seeds";

// A real profile row: the name lives in full_name, and `name` is usually absent.
const sam = { id: "3f9d2a10-0000-4000-8000-000000000001", full_name: "Sam Schwartz", email: "sam@maumeeriverroofing.com", active: true };
const ian = { id: "3f9d2a10-0000-4000-8000-000000000002", full_name: "Ian Doyle", email: "ian@maumeeriverroofing.com", active: true };
const roster = [sam, ian];

describe("the wrong-field bug", () => {
  it("reads full_name, which is where profiles actually keep the name", () => {
    // The original `?.name || "Unknown"` FOUND this person and then threw the
    // answer away, because profiles.name is null on nearly every row.
    expect(resolvePersonName(roster, sam.id)).toBe("Sam Schwartz");
  });

  it("still accepts a legacy row that carries `name` instead", () => {
    expect(resolvePersonName([{ id: "x", name: "Old Shape" }], "x")).toBe("Old Shape");
  });

  it("falls back to the email rather than to nothing", () => {
    expect(resolvePersonName([{ id: "x", email: "nobody@example.com" }], "x")).toBe("nobody@example.com");
  });

  it("says the name is missing rather than calling a real member unknown", () => {
    // They ARE on the roster. The failure is a blank profile, not an unknown id,
    // and the copy has to say which.
    expect(resolvePersonName([{ id: "x" }], "x")).toBe("Name not set");
  });
});

describe("legacy pre-Auth ids", () => {
  it("resolves a seed-era id to the person it belongs to today", () => {
    // Batches written before Supabase Auth recorded 'u1'. SEED_U says u1 is
    // sam@maumeeriverroofing.com, and that email is on the roster, so this is
    // Sam — under whatever name his profile carries now.
    expect(resolvePersonName(roster, "u1")).toBe("Sam Schwartz");
    expect(makePersonResolver(roster)("u1").kind).toBe("legacy");
  });

  it("matches the email case-insensitively", () => {
    const shouty = [{ ...sam, email: "SAM@MaumeeRiverRoofing.com" }];
    expect(resolvePersonName(shouty, "u1")).toBe("Sam Schwartz");
  });

  it("prefers a direct id match over the legacy table", () => {
    const impostor = { id: "u1", full_name: "Actual Current User", email: "other@example.com" };
    expect(resolvePersonName([impostor, sam], "u1")).toBe("Actual Current User");
  });
});

describe("the multi-tenant rule", () => {
  it("does not leak the seed roster's names to a company that has no such person", () => {
    // THE important test. SEED_U is Maumee River's staff. Another tenant with a
    // 'u1' row must not be told it was "Sam" — the old roster is a lookup table,
    // never a source of names in its own right.
    const otherCompany = [{ id: "aaaa-bbbb", full_name: "Dana Cole", email: "dana@othercompany.com" }];
    const label = resolvePersonName(otherCompany, "u1");
    expect(label).not.toContain("Sam");
    expect(label).toBe("Unrecognized (u1)");
  });

  it("resolves nothing at all against an empty roster", () => {
    expect(resolvePersonName([], "u1")).toBe("Unrecognized (u1)");
    expect(resolvePersonName(undefined, "u1")).toBe("Unrecognized (u1)");
  });

  it("keeps every seed id pointed at an email, or the legacy path silently does nothing", () => {
    // Guards the mapping itself: an entry without an email can never resolve.
    for (const u of SEED_U) expect(u.email).toBeTruthy();
  });
});

describe("rows that name nobody", () => {
  it("separates 'never captured' from 'unknown person'", () => {
    // One means the app failed to record it, the other means the id is a mystery.
    // Both used to print "Unknown", which made the column unreadable.
    expect(resolvePersonName(roster, null)).toBe("Not recorded");
    expect(resolvePersonName(roster, "")).toBe("Not recorded");
    expect(resolvePersonName(roster, "zzz-nobody")).toBe("Unrecognized (zzz-nobody)");
  });

  it("labels automatic writes as the system", () => {
    expect(resolvePersonName(roster, "system")).toBe("System (automatic)");
  });
});

describe("the name stamped on the row", () => {
  // The last line of defence. "Remove" in User Management deletes the membership,
  // and if it was that person's last one it deletes the profile and the auth
  // account too. After that NOTHING in the database can name them, so a row that
  // only stored an id is permanently anonymous. Rows carry byName for that case.
  it("names someone whose profile no longer exists at all", () => {
    const batch = { by: "4598017f-0c73-4ab2-94dd-58d4efe10e4a", byName: "Sam Schwartz" };
    expect(resolveBatchPerson([], batch)).toBe("Sam Schwartz");
  });

  it("prefers the live roster, so a renamed person shows their current name", () => {
    // The stamp is a fallback, not the source of truth. Someone who married and
    // changed their name should not be stuck under the old one on every batch.
    const batch = { by: sam.id, byName: "Sam Oldname" };
    expect(resolveBatchPerson(roster, batch)).toBe("Sam Schwartz");
  });

  it("uses the stamp when the roster row exists but has no name on it", () => {
    const batch = { by: "blank-profile", byName: "Recorded At The Time" };
    expect(resolveBatchPerson([{ id: "blank-profile" }], batch)).toBe("Recorded At The Time");
  });

  it("ignores a blank or whitespace stamp rather than showing an empty name", () => {
    expect(resolveBatchPerson([], { by: "ghost", byName: "   " })).toBe("Unrecognized (ghost)");
    expect(resolveBatchPerson([], { by: "ghost", byName: "" })).toBe("Unrecognized (ghost)");
  });

  it("still reports system rows as automatic even with a stamp present", () => {
    expect(resolveBatchPerson(roster, { by: "system", byName: "Whoever" })).toBe("System (automatic)");
  });

  it("handles a batch with no person recorded at all", () => {
    expect(resolveBatchPerson(roster, { by: null })).toBe("Not recorded");
    expect(resolveBatchPerson(roster, undefined)).toBe("Not recorded");
  });
});

describe("displayNameOf — what gets stamped at write time", () => {
  it("reads curUser, which useAppData builds with full_name under `name`", () => {
    expect(displayNameOf({ id: "x", name: "Sam Schwartz", email: "sam@x.com" })).toBe("Sam Schwartz");
  });

  it("reads a raw profiles row, which uses full_name", () => {
    expect(displayNameOf({ id: "x", full_name: "Sam Schwartz" })).toBe("Sam Schwartz");
  });

  it("falls back to email rather than stamping nothing", () => {
    expect(displayNameOf({ id: "x", email: "sam@x.com" })).toBe("sam@x.com");
  });

  it("returns null when there is nothing to stamp", () => {
    expect(displayNameOf(null)).toBe(null);
    expect(displayNameOf({ id: "x" })).toBe(null);
  });
});

describe("personLabel", () => {
  it("shows the raw id so an unresolved row can be diagnosed", () => {
    // Not "no longer a member". That was a guess stated as a fact, and it was
    // wrong for the common case: a current employee whose old batches carry a
    // pre-Auth id.
    expect(personLabel({ kind: "unknown", id: "u9" })).toBe("Unrecognized (u9)");
  });

  it("takes translated copy when a view has it", () => {
    expect(personLabel({ kind: "system" }, { personSystem: "Sistema (automático)" })).toBe("Sistema (automático)");
  });

  it("works with no translations at all, for the dialogs that take no lang prop", () => {
    expect(personLabel({ kind: "absent" })).toBe("Not recorded");
  });
});
