// The rules that keep "view as" a rendering choice and nothing more. The one
// that matters most is the identity block: a preview must not reach the fields
// every write in the app stamps its rows with.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveRolePreview,
  canPreviewRoles,
  PREVIEW_ROLES,
  readPreviewRole,
  storePreviewRole,
} from "./rolePreview";
import { ROLE_PERMS } from "@/test/fixtures/rolePerms";

const owner = (role = "admin") => ({
  id: "owner",
  email: "kj@steadwerk.test",
  name: "KJ",
  role,
  companyId: "co1",
  isPlatformAdmin: true,
});

const crew = (role = "field") => ({
  id: "sam",
  email: "sam@maumee.test",
  name: "Sam",
  role,
  companyId: "co1",
  isPlatformAdmin: false,
});

const resolve = (user, previewRole, userOverrides) =>
  resolveRolePreview({ user, previewRole, rolePerms: ROLE_PERMS, userOverrides });

describe("canPreviewRoles", () => {
  it("is the platform operator only", () => {
    expect(canPreviewRoles(owner())).toBe(true);
    expect(canPreviewRoles(crew())).toBe(false);
    // A company's own admin is not the platform operator.
    expect(canPreviewRoles({ id: "a", role: "admin" })).toBe(false);
    expect(canPreviewRoles(null)).toBe(false);
  });
});

describe("resolveRolePreview", () => {
  it("renders the real app when nothing is selected", () => {
    const real = owner();
    const { viewUser, perms, previewing } = resolve(real, null);
    expect(previewing).toBe(null);
    // The very same object, not a copy: with no preview running, nothing
    // downstream should be able to tell this layer exists at all.
    expect(viewUser).toBe(real);
    expect(perms.users_manage).toBe(true);
  });

  it("swaps the role and recomputes permissions from that role's preset", () => {
    const { viewUser, perms, previewing } = resolve(owner(), "employee");
    expect(previewing).toBe("employee");
    expect(viewUser.role).toBe("employee");
    // The employee fixture carries no job keys at all, exactly as in production,
    // so these come back absent rather than false — deny by omission, same as
    // permissions.test.js asserts. Falsy is the contract the UI gates on.
    expect(perms.jobs_pull).toBeFalsy();
    expect(perms.users_manage).toBeFalsy();
    expect(perms.maint_submit).toBe(true);
  });

  it("drops platform-admin so the Owner Console and Billing leave the nav", () => {
    expect(resolve(owner(), "field").viewUser.isPlatformAdmin).toBe(false);
    // ...and only while previewing.
    expect(resolve(owner(), null).viewUser.isPlatformAdmin).toBe(true);
  });

  it("refuses the preview for anyone who is not the platform operator", () => {
    const { viewUser, previewing, perms } = resolve(crew("field"), "employee");
    expect(previewing).toBe(null);
    expect(viewUser.role).toBe("field");
    expect(perms.jobs_pull).toBe(true); // still their own field perms
  });

  it("treats an unknown role as nothing selected", () => {
    expect(resolve(owner(), "superuser").previewing).toBe(null);
    expect(resolve(owner(), "").previewing).toBe(null);
    expect(resolve(owner(), undefined).previewing).toBe(null);
  });

  // The platform owner's membership role IS 'admin' everywhere they can reach, so
  // treating "same role" as "nothing to preview" made the Admin option do nothing
  // at all for the only person who has the picker. Admin is a real preview: it is
  // how you record the screen a CUSTOMER's own admin gets, which is the owner's
  // screen minus the platform.
  it("previews admin as a company admin, stripped of platform-owner access", () => {
    const { previewing, viewUser, perms } = resolve(owner("admin"), "admin");
    expect(previewing).toBe("admin");
    expect(viewUser.role).toBe("admin");
    expect(viewUser.isPlatformAdmin).toBe(false);
    // Still everything a company admin has — the role short-circuit is untouched.
    expect(perms.users_manage).toBe(true);
    expect(perms.settings_manage).toBe(true);
    expect(perms.jobs_close).toBe(true);
  });

  it("keeps your own per-user overrides when off, and drops them while previewing", () => {
    const overrides = { owner: { jobs_close: true } };

    // Role 'manager' so the admin short-circuit doesn't mask the override.
    const off = resolve(owner("manager"), null, overrides);
    expect(off.perms.jobs_close).toBe(true);

    // Previewing shows that ROLE's preset, not the role plus your personal grants.
    const on = resolve(owner("manager"), "field", overrides);
    expect(on.previewing).toBe("field");
    expect(on.perms.jobs_close).toBeFalsy();
  });

  it("carries identity through untouched — this is what keeps writes attributable", () => {
    const real = owner();
    const { viewUser } = resolve(real, "employee");
    expect(viewUser.id).toBe(real.id);
    expect(viewUser.email).toBe(real.email);
    expect(viewUser.name).toBe(real.name);
    expect(viewUser.companyId).toBe(real.companyId);
    // And the real user object is never mutated.
    expect(real.role).toBe("admin");
    expect(real.isPlatformAdmin).toBe(true);
  });

  it("keeps the visiting flag, because whose live data you are in does not change", () => {
    const visiting = { ...owner(), isVisiting: true, companyName: "Maumee River" };
    const { viewUser } = resolve(visiting, "employee");
    expect(viewUser.isVisiting).toBe(true);
    expect(viewUser.companyName).toBe("Maumee River");
  });

  it("handles no user at all", () => {
    expect(resolveRolePreview({ user: null, previewRole: "field", rolePerms: ROLE_PERMS })).toEqual(
      { viewUser: null, perms: {}, previewing: null },
    );
  });

  it("offers every real role", () => {
    expect(PREVIEW_ROLES).toContain("admin");
    expect(PREVIEW_ROLES).toContain("warehouse");
    expect(PREVIEW_ROLES).toContain("coordinator");
    expect(PREVIEW_ROLES).toContain("manager");
    expect(PREVIEW_ROLES).toContain("field");
    expect(PREVIEW_ROLES).toContain("employee");
    expect(PREVIEW_ROLES).toContain("bookkeeper");
  });
});

// The suite runs in node (see vite.config.js), so the browser global this module
// guards against is also the one it needs. Stubbed here rather than switching the
// whole file to jsdom — the same bargain the pdfGenerator window.open test makes.
describe("remembering the choice", () => {
  let store;

  const fakeStorage = () => ({
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });

  const throwingStorage = () => {
    const boom = () => {
      throw new Error("site data blocked");
    };
    return { getItem: boom, setItem: boom, removeItem: boom };
  };

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("sessionStorage", fakeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a role and clears on null", () => {
    storePreviewRole("field");
    expect(readPreviewRole()).toBe("field");
    storePreviewRole(null);
    expect(readPreviewRole()).toBe(null);
  });

  it("ignores a stored value that is not a role", () => {
    store.set("steadwerk-role-preview", "admin-but-more");
    expect(readPreviewRole()).toBe(null);
  });

  it("reads as 'no preview' when storage throws, rather than taking the app down", () => {
    vi.stubGlobal("sessionStorage", throwingStorage());
    expect(readPreviewRole()).toBe(null);
    expect(() => storePreviewRole("field")).not.toThrow();
    expect(() => storePreviewRole(null)).not.toThrow();
  });

  it("survives a runtime with no sessionStorage at all", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(readPreviewRole()).toBe(null);
    expect(() => storePreviewRole("field")).not.toThrow();
  });
});
