// @vitest-environment jsdom
//
// src/test/rolePreviewUI.test.jsx
//
// core/rolePreview.test.js proves the resolution rules. This proves the chrome
// listens to them: that the picker reaches only the platform operator, and that
// feeding the resolved view user back into the sidebar really does produce the
// previewed role's nav rather than the owner's.
//
// The last part is the whole feature. A preview that computed the right
// permissions and still drew an Owner Console row would put a screen in a
// training clip that no crew member has ever seen, which is the bug this exists
// to avoid — and nothing in the pure test can catch it.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Sidebar from "@/shared/layouts/Sidebar.jsx";
import RolePreviewBanner from "@/shared/components/RolePreviewBanner.jsx";
import { resolveRolePreview } from "@/core/rolePreview";
import { ROLE_PERMS } from "./fixtures/rolePerms";

afterEach(cleanup);

const noop = () => {};

const owner = {
  id: "owner",
  name: "KJ",
  email: "kj@steadwerk.test",
  role: "admin",
  companyId: "co1",
  active: true,
  isPlatformAdmin: true,
};

// A company's own admin. Full access inside their tenant, not the platform operator.
const tenantAdmin = { ...owner, id: "boss", name: "Boss", isPlatformAdmin: false };

// Renders the sidebar the way App.jsx does: the resolved view user and perms,
// with the picker's entitlement read off the REAL user.
const renderSidebar = ({ user, previewRole = null, collapsed = false, setPreviewRole = noop }) => {
  const { viewUser, perms } = resolveRolePreview({
    user,
    previewRole,
    rolePerms: ROLE_PERMS,
    userOverrides: {},
  });
  return render(
    <Sidebar
      cur="dashboard"
      onNav={noop}
      user={viewUser}
      onLogout={noop}
      collapsed={collapsed}
      setCollapsed={noop}
      perms={perms}
      isPlatformAdmin={viewUser.isPlatformAdmin}
      canPreviewRole={user.isPlatformAdmin === true}
      previewRole={previewRole}
      setPreviewRole={setPreviewRole}
      lang="en"
      setLang={noop}
    />,
  );
};

const picker = () => screen.queryByLabelText("View as");

describe("the View as picker", () => {
  it("is offered to the platform operator", () => {
    renderSidebar({ user: owner });
    expect(picker()).toBeTruthy();
  });

  it("is not offered to a company's own admin", () => {
    renderSidebar({ user: tenantAdmin });
    expect(picker()).toBe(null);
  });

  it("is left out of the collapsed rail, where the banner carries the exit instead", () => {
    renderSidebar({ user: owner, collapsed: true });
    expect(picker()).toBe(null);
  });

  it("lists every role plus an off switch, under the same names the role badge uses", () => {
    renderSidebar({ user: owner });
    const options = [...picker().querySelectorAll("option")].map((o) => o.textContent);
    expect(options[0]).toBe("My own role");
    expect(options).toContain("Site Supervisor"); // not the raw key "field"
    expect(options).toContain("Employee");
    expect(options).toContain("Book Keeper");
  });

  it("reports the chosen role, and null when switched back off", async () => {
    const setPreviewRole = vi.fn();
    renderSidebar({ user: owner, setPreviewRole });

    await userEvent.selectOptions(picker(), "employee");
    expect(setPreviewRole).toHaveBeenCalledWith("employee");

    cleanup();
    setPreviewRole.mockClear();
    renderSidebar({ user: owner, previewRole: "employee", setPreviewRole });
    await userEvent.selectOptions(picker(), "");
    expect(setPreviewRole).toHaveBeenCalledWith(null);
  });

  it("stays on screen while a preview is running, so there is always a way back", () => {
    renderSidebar({ user: owner, previewRole: "employee" });
    expect(picker()).toBeTruthy();
    expect(picker().value).toBe("employee");
  });
});

describe("the previewed sidebar", () => {
  it("is the owner's own nav when nothing is selected", () => {
    renderSidebar({ user: owner });
    expect(screen.queryByText("Owner Console")).toBeTruthy();
    expect(screen.queryByText("Build Jobs")).toBeTruthy();
    expect(screen.queryByText("Users")).toBeTruthy();
  });

  it("takes the Owner Console away while previewing Admin, and leaves the rest", () => {
    renderSidebar({ user: owner, previewRole: "admin" });
    // The whole point of previewing Admin: a customer's own admin runs the
    // platform's product, not the platform.
    expect(screen.queryByText("Owner Console")).toBe(null);
    // Everything a company admin does have stays, Billing included — that is
    // their own company's billing, which they manage.
    expect(screen.queryByText("Billing")).toBeTruthy();
    expect(screen.queryByText("Users")).toBeTruthy();
    expect(screen.queryByText("Build Jobs")).toBeTruthy();
    expect(screen.queryByText("Settings")).toBeTruthy();
  });

  it("drops the platform-owner and admin rows while previewing an employee", () => {
    renderSidebar({ user: owner, previewRole: "employee" });
    // The three a crew member has never seen.
    expect(screen.queryByText("Owner Console")).toBe(null);
    expect(screen.queryByText("Billing")).toBe(null);
    expect(screen.queryByText("Users")).toBe(null);
    // The employee fixture carries no job keys, so Build Jobs goes too.
    expect(screen.queryByText("Build Jobs")).toBe(null);
    // And what they DO get stays.
    expect(screen.queryByText("Fleet")).toBeTruthy();
    expect(screen.queryByText("Maintenance")).toBeTruthy();
    expect(screen.queryByText("Training")).toBeTruthy();
  });

  it("shows the previewed role in the footer, not the real one", () => {
    renderSidebar({ user: owner, previewRole: "field" });
    // Both names are also <option>s in the picker, so the footer copy is the one
    // that is not an option.
    const chrome = (name) => screen.queryAllByText(name).filter((el) => el.tagName !== "OPTION");
    expect(chrome("Site Supervisor")).toHaveLength(1);
    expect(chrome("Admin")).toEqual([]);
  });

  it("keeps the real name in the footer — identity is not previewed", () => {
    renderSidebar({ user: owner, previewRole: "employee" });
    expect(screen.queryByText("KJ")).toBeTruthy();
  });
});

// Not about the preview, but found while chasing it: inside the platform
// operator's own tenant the nav came from a separate list (supabase/32) that
// offered the Owner Console to every member of that company. Steadwerk's own
// staff are admins of the platform COMPANY without being operators of the
// platform, so the row rendered for them and /owner then bounced them to
// /dashboard — a tab that looks like access and is not.
describe("the Owner Console row inside the platform tenant", () => {
  const renderPlatformTenant = (isPlatformAdmin) =>
    render(
      <Sidebar
        cur="owner"
        onNav={noop}
        user={{ ...owner, isPlatformAdmin }}
        onLogout={noop}
        collapsed={false}
        setCollapsed={noop}
        perms={{ users_manage: true, settings_manage: true }}
        isPlatformAdmin={isPlatformAdmin}
        isPlatformCompany
        lang="en"
        setLang={noop}
      />,
    );

  it("is there for the platform operator", () => {
    renderPlatformTenant(true);
    expect(screen.queryByText("Owner Console")).toBeTruthy();
  });

  it("is not there for a company admin who is not the platform operator", () => {
    renderPlatformTenant(false);
    expect(screen.queryByText("Owner Console")).toBe(null);
    // The rest of the platform tenant's nav is still theirs to administer.
    expect(screen.queryByText("Users")).toBeTruthy();
    expect(screen.queryByText("Audit Logs")).toBeTruthy();
    expect(screen.queryByText("Settings")).toBeTruthy();
  });
});

describe("the role preview banner", () => {
  it("renders nothing when no preview is running", () => {
    const { container } = render(<RolePreviewBanner previewRole={null} onExit={noop} lang="en" />);
    expect(container.firstChild).toBe(null);
  });

  it("names the role and offers the exit", async () => {
    const onExit = vi.fn();
    render(<RolePreviewBanner previewRole="field" onExit={onExit} lang="en" />);
    expect(screen.getByText(/Site Supervisor/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /exit preview/i }));
    expect(onExit).toHaveBeenCalled();
  });

  it("says plainly that this does not change what the database allows", () => {
    render(<RolePreviewBanner previewRole="employee" onExit={noop} lang="en" />);
    expect(screen.getByText(/writes are still yours/i)).toBeTruthy();
  });
});
