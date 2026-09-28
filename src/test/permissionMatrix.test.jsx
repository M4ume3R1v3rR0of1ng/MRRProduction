// @vitest-environment jsdom
//
// src/test/permissionMatrix.test.jsx
//
// The missing middle of the permission tests. permissions.test.js proves
// getEffectivePerms computes the right flags; verify-permission-enforcement.mjs
// proves the database refuses what those flags say no to. Neither proved the UI
// actually listens to them, so a gate could be dropped in a refactor and the only
// symptom would be a button the server then rejects.
//
// Both ends run on the SAME role rows (src/test/fixtures/rolePerms.js), passed
// through the real getEffectivePerms, so this is the production matrix, not a
// hand-written perms object that only resembles it.
//
// The gates hide controls rather than disabling them, so the assertions are
// "present" / "absent", never "disabled".
//
// jsdom and Testing Library rather than renderToString (views.render.test.js):
// the detail panel's Close Job button only exists after a card is clicked, and
// renderToString never runs a handler.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BuildJobsView from "@/features/jobs/BuildJobsView.jsx";
import PullInventoryView from "@/features/jobs/PullInventoryView.jsx";
import EditJobModal from "@/features/jobs/EditJobModal.jsx";
import Sidebar from "@/shared/layouts/Sidebar.jsx";
import { NotificationProvider } from "@/shared/context/NotificationContext";
import { getEffectivePerms } from "@/shared/database/permissions";
import { ROLE_PERMS } from "./fixtures/rolePerms";

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(cleanup);

// What each role must be able to see. Written out by hand rather than derived
// from ROLE_PERMS: deriving it would only test that the UI agrees with itself.
// Rows mirror the allow/deny list in verify-permission-enforcement.mjs.
const EXPECT = {
  admin: { build: true, approve: true, pull: true, complete: true, close: true },
  coordinator: { build: true, approve: true, pull: true, complete: true, close: false },
  bookkeeper: { build: false, approve: false, pull: false, complete: false, close: true },
  field: { build: false, approve: false, pull: true, complete: true, close: false },
  employee: { build: false, approve: false, pull: false, complete: false, close: false },
};
const ROLES = Object.keys(EXPECT);

const noop = () => {};
const me = (role) => ({ id: "me", name: "Pat Doe", role, email: "pat@example.com", active: true });
const permsFor = (role) => getEffectivePerms(me(role), ROLE_PERMS, {});

const StubIcon = () => null;
const jSC = {
  draft: { c: "gray", l: "Draft", icon: StubIcon },
  approved: { c: "blue", l: "Approved", icon: StubIcon },
  active: { c: "amber", l: "Active", icon: StubIcon },
  completed: { c: "green", l: "Completed", icon: StubIcon },
  closed: { c: "purple", l: "Closed", icon: StubIcon },
};

const inv = [{ id: "i1", name: "Shingle", cat: "Roofing", unit: "bd", batches: [] }];
const line = (pulled) => ({ iid: "i1", iname: "Shingle", unit: "bd", planned: 10, pulled });
// Every job is assigned to "me": Pull Inventory shows a field user only their own.
const job = (id, title, status, extra = {}) => ({
  id,
  title,
  po: `PO-${id}`,
  status,
  addr: "1 Main St",
  assignedto: "me",
  createdAt: "2026-07-01",
  items: [line(status === "draft" || status === "approved" ? 0 : 4)],
  ...extra,
});

const draftJob = job("j1", "Draft Job", "draft");
const approvedJob = job("j2", "Approved Job", "approved");
const activeJob = job("j3", "Active Job", "active");
const completedJob = job("j4", "Completed Job", "completed", { completedAt: "2026-07-16" });

const withNotify = (ui) => render(<NotificationProvider>{ui}</NotificationProvider>);
const button = (name) => screen.queryByRole("button", { name });

const renderBuildJobs = (role) =>
  withNotify(
    <BuildJobsView
      jobs={[draftJob, completedJob]}
      company={{ id: "c1", name: "Test Co", branding: {} }}
      jobNotifications={{}}
      setJobs={noop}
      inv={inv}
      vehs={[]}
      jobTrailers={[]}
      setJobTrailers={noop}
      users={[me(role)]}
      user={me(role)}
      curUser={me(role)}
      perms={permsFor(role)}
      jSC={jSC}
      onNav={noop}
      acculynxConfig={{}}
      openItemId={null}
      onOpenItemHandled={noop}
      activeLogo={null}
    />,
  );

describe.each(ROLES)("%s", (role) => {
  const can = EXPECT[role];

  it(`Build Jobs list: Close ${can.close ? "shown" : "hidden"}, Approve ${can.approve ? "shown" : "hidden"}`, () => {
    renderBuildJobs(role);
    expect(!!button(/^close$/i)).toBe(can.close);
    expect(!!button(/approve & assign/i)).toBe(can.approve);
  });

  it(`Build Jobs detail panel: Close Job ${can.close ? "shown" : "hidden"}`, async () => {
    renderBuildJobs(role);
    await userEvent.click(screen.getByText("Completed Job"));
    expect(!!button(/close job/i)).toBe(can.close);
  });

  it(`Pull Inventory: Pull ${can.pull ? "shown" : "hidden"}, Return & Complete ${can.complete ? "shown" : "hidden"}`, () => {
    withNotify(
      <PullInventoryView
        jobs={[approvedJob, activeJob]}
        setJobs={noop}
        inv={inv}
        setInv={noop}
        users={[me(role)]}
        user={me(role)}
        perms={permsFor(role)}
        jSC={jSC}
        lang="en"
        acculynxConfig={{}}
      />,
    );
    expect(!!button(/pull materials/i)).toBe(can.pull);
    expect(!!button(/return & complete/i)).toBe(can.complete);
  });

  it(`Edit Job: Correct Return ${can.close ? "shown" : "hidden"}, Pull Added ${can.pull ? "shown" : "hidden"}`, () => {
    // One line pulled, one added after the pull, so both follow-ups are in play
    // and only the permission decides whether each is offered.
    const edited = { ...completedJob, items: [line(4), { ...line(0), iid: "i2" }] };
    withNotify(
      <EditJobModal
        job={edited}
        inv={inv}
        activeUser={me(role)}
        perms={permsFor(role)}
        onSaved={noop}
        onClose={noop}
        onCorrectReturn={noop}
        onPullAdded={noop}
      />,
    );
    expect(!!button(/correct return/i)).toBe(can.close);
    expect(!!button(/pull added materials/i)).toBe(can.pull);
  });

  it(`Sidebar: Build Jobs ${can.build || can.close ? "shown" : "hidden"}`, () => {
    render(
      <Sidebar
        cur="dashboard"
        onNav={noop}
        user={me(role)}
        onLogout={noop}
        collapsed={false}
        setCollapsed={noop}
        perms={permsFor(role)}
        lang="en"
        setLang={noop}
      />,
    );
    // Close-only roles need the view too: it is where the close queue lives.
    expect(!!screen.queryByText("Build Jobs")).toBe(can.build || can.close);
    expect(screen.getByText("Pull Inventory")).toBeTruthy(); // ungated, for everyone
  });
});
