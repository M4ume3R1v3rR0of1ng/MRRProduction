import { describe, it, expect } from "vitest";
import { resolveUserAdmin, roleAssignmentError, targetGuardError } from "./userAdmin.js";

const COMPANY = "co-1";

const caller = (over = {}) => ({
  userId: "u-caller",
  email: "caller@example.com",
  companyId: COMPANY,
  companyName: "Maumee River Roofing",
  companySlug: "mrr",
  role: "manager",
  isPlatformAdmin: false,
  isVisiting: false,
  integrations: {},
  ...over,
});

// A fake of the handful of supabase-js calls these helpers make. Every table read
// is `.from(t).select(...).eq(...).eq(...).maybeSingle()`, so one chainable stub
// that remembers the filters and answers from a fixture covers all of them.
function fakeAdmin({ rolePermissions = {}, overrides = {}, memberships = [] } = {}) {
  return {
    from(table) {
      const filters = {};
      const chain = {
        select: () => chain,
        eq(col, val) {
          filters[col] = val;
          return chain;
        },
        maybeSingle: async () => {
          if (table === "role_permissions") {
            return { data: { permissions: rolePermissions[filters.role] ?? null } };
          }
          if (table === "user_permission_overrides") {
            return { data: { overrides: overrides[filters.user_id] ?? null } };
          }
          if (table === "memberships") {
            const row = memberships.find(
              (m) => m.user_id === filters.user_id && m.company_id === filters.company_id,
            );
            return { data: row ?? null };
          }
          throw new Error(`fakeAdmin: unexpected table ${table}`);
        },
      };
      return chain;
    },
  };
}

describe("resolveUserAdmin", () => {
  it("treats a company admin as a full admin without reading the matrix", async () => {
    // No fixtures at all: if this touched role_permissions the stub would throw.
    const result = await resolveUserAdmin(fakeAdmin(), caller({ role: "admin" }));
    expect(result).toEqual({ fullAdmin: true });
  });

  it("treats the visiting platform owner as a full admin", async () => {
    const result = await resolveUserAdmin(
      fakeAdmin(),
      caller({ role: "admin", isPlatformAdmin: true, isVisiting: true }),
    );
    expect(result).toEqual({ fullAdmin: true });
  });

  // The whole point of this change: the Settings toggle now means something.
  it("admits a non-admin whose role was granted users_manage", async () => {
    const admin = fakeAdmin({ rolePermissions: { manager: { users_manage: true } } });
    const result = await resolveUserAdmin(admin, caller());
    expect(result).toEqual({ fullAdmin: false });
  });

  it("admits a non-admin granted users_manage as a personal override", async () => {
    const admin = fakeAdmin({
      rolePermissions: { manager: { users_manage: false } },
      overrides: { "u-caller": { users_manage: true } },
    });
    const result = await resolveUserAdmin(admin, caller());
    expect(result).toEqual({ fullAdmin: false });
  });

  // An override is the more specific answer and must win in BOTH directions,
  // or revoking one person's access by override would silently do nothing.
  it("lets a personal override revoke what the role grants", async () => {
    const admin = fakeAdmin({
      rolePermissions: { manager: { users_manage: true } },
      overrides: { "u-caller": { users_manage: false } },
    });
    const result = await resolveUserAdmin(admin, caller());
    expect(result.error).toEqual({ status: 403, message: "Admin access required" });
  });

  it("refuses a role that holds no users_manage, keeping the old message", async () => {
    const admin = fakeAdmin({ rolePermissions: { manager: { jobs_view: true } } });
    const result = await resolveUserAdmin(admin, caller());
    expect(result.fullAdmin).toBeUndefined();
    expect(result.error).toEqual({ status: 403, message: "Admin access required" });
  });

  it("fails closed when the company has no matrix row for the role", async () => {
    const result = await resolveUserAdmin(fakeAdmin(), caller());
    expect(result.error?.status).toBe(403);
  });
});

describe("roleAssignmentError (rule 1)", () => {
  it("refuses a delegate handing out admin", () => {
    expect(roleAssignmentError("admin", false)).toMatch(/Only an admin can give someone admin/);
  });

  it("allows an admin to hand out admin", () => {
    expect(roleAssignmentError("admin", true)).toBeNull();
  });

  it("allows a delegate every other role", () => {
    for (const role of ["warehouse", "coordinator", "manager", "field", "employee", "bookkeeper"]) {
      expect(roleAssignmentError(role, false)).toBeNull();
    }
  });
});

describe("targetGuardError (rules 2 and 3)", () => {
  const admin = fakeAdmin({
    memberships: [
      { user_id: "u-admin", company_id: COMPANY, role: "admin" },
      { user_id: "u-field", company_id: COMPANY, role: "field" },
      { user_id: "u-caller", company_id: COMPANY, role: "manager" },
    ],
  });

  it("waves an admin through regardless of the target", async () => {
    expect(await targetGuardError(admin, caller(), "u-admin", true)).toBeNull();
  });

  it("refuses a delegate acting on an admin", async () => {
    expect(await targetGuardError(admin, caller(), "u-admin", false)).toMatch(
      /Only an admin can change another admin's account/,
    );
  });

  it("allows a delegate acting on an ordinary member", async () => {
    expect(await targetGuardError(admin, caller(), "u-field", false)).toBeNull();
  });

  it("refuses a delegate acting on their own account by default", async () => {
    expect(await targetGuardError(admin, caller(), "u-caller", false)).toMatch(
      /cannot change your own access/,
    );
  });

  it("permits self when the caller opted in, as name and email edits do", async () => {
    expect(
      await targetGuardError(admin, caller(), "u-caller", false, { allowSelf: true }),
    ).toBeNull();
  });

  // The callers that already fetched the membership pass its role through. A
  // knownRole of null means "looked, found nothing" and must not re-query.
  it("trusts knownRole instead of querying", async () => {
    const exploding = {
      from() {
        throw new Error("should not have queried");
      },
    };
    expect(
      await targetGuardError(exploding, caller(), "u-x", false, { knownRole: "field" }),
    ).toBeNull();
    expect(
      await targetGuardError(exploding, caller(), "u-x", false, { knownRole: "admin" }),
    ).toMatch(/Only an admin/);
    expect(
      await targetGuardError(exploding, caller(), "u-x", false, { knownRole: null }),
    ).toBeNull();
  });

  // A uuid from another tenant has no membership here, so there is no role to
  // judge. The caller's own 404 covers it; this guard must not invent a pass or
  // a failure for it.
  it("returns null for a target with no membership in this company", async () => {
    expect(await targetGuardError(admin, caller(), "u-stranger", false)).toBeNull();
  });
});
