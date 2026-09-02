// The UI half of the permission system. The DATABASE half is covered by
// scripts/verify-permission-enforcement.mjs, which signs in as each role for real —
// these two must agree, or a button appears that the server then rejects.
import { describe, it, expect } from "vitest";
import { getEffectivePerms } from "./permissions";

const ROLE_PERMS = {
  // Jerry's real production config: pull and complete yes, close NO.
  coordinator: { jobs_pull: true, jobs_complete: true, jobs_close: false, jobs_build: true },
  bookkeeper: { jobs_pull: false, jobs_complete: false, jobs_close: true },
  // field's stored row has no jobs_close key at all — mirrors production.
  field: { jobs_pull: true, jobs_complete: true },
};

describe("getEffectivePerms", () => {
  it("gives an admin everything without consulting the role table", () => {
    const p = getEffectivePerms({ id: "u1", role: "admin" }, {}, {});
    expect(p.jobs_close).toBe(true);
    expect(p.users_manage).toBe(true);
  });

  it("denies a coordinator jobs_close — the rule Jerry kept getting around", () => {
    const p = getEffectivePerms({ id: "jerry", role: "coordinator" }, ROLE_PERMS, {});
    expect(p.jobs_pull).toBe(true);
    expect(p.jobs_complete).toBe(true);
    expect(p.jobs_close).toBe(false);
  });

  it("lets the bookkeeper close and nothing else", () => {
    const p = getEffectivePerms({ id: "sabrina", role: "bookkeeper" }, ROLE_PERMS, {});
    expect(p.jobs_close).toBe(true);
    expect(p.jobs_pull).toBe(false);
  });

  it("lets a per-user override beat the role, in both directions", () => {
    const grant = getEffectivePerms({ id: "u2", role: "field" }, ROLE_PERMS, { u2: { jobs_close: true } });
    expect(grant.jobs_close).toBe(true);

    const revoke = getEffectivePerms({ id: "jerry", role: "coordinator" }, ROLE_PERMS, { jerry: { jobs_pull: false } });
    expect(revoke.jobs_pull).toBe(false);
    expect(revoke.jobs_complete).toBe(true); // untouched keys survive
  });

  it("applies an override only to the user it belongs to", () => {
    const other = getEffectivePerms({ id: "jason", role: "field" }, ROLE_PERMS, { someone_else: { jobs_close: true } });
    expect(other.jobs_close).toBeUndefined();
  });

  it("leaves a key absent when the role never stored it (deny by omission)", () => {
    // `field` has no jobs_close. It must NOT come back true — the UI treats
    // undefined as falsy, and the DB's default_job_perms() independently says false.
    const p = getEffectivePerms({ id: "jason", role: "field" }, ROLE_PERMS, {});
    expect(p.jobs_close).toBeFalsy();
  });

  it("grants nothing for an unknown role or no user", () => {
    expect(getEffectivePerms({ id: "u3", role: "intern" }, ROLE_PERMS, {}).jobs_pull).toBeFalsy();
    expect(getEffectivePerms(null, ROLE_PERMS, {})).toEqual({});
  });
});
