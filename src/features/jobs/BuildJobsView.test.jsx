// @vitest-environment jsdom
//
// src/features/jobs/BuildJobsView.test.jsx
//
// The office end of the job pipeline: draft -> approved, completed -> closed, and
// back again. permissionMatrix.test.jsx proves who SEES these buttons; this proves
// what pressing them does — the row written, the state the screen re-renders
// from, and that each guard in front of a write actually stops it.
//
// The e2e flow covers the same stages against a real database, but only the happy
// path and only once. These run in milliseconds and cover the refusals.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BuildJobsView from "./BuildJobsView.jsx";
import { syncJobReportToAccuLynx } from "./accuLynxSync";
import { sendEmail } from "@/shared/utils/email";
import { translations } from "@/shared/utils/translations";
import { renderStateful } from "@/test/renderView";
import { reset, respond, writes, auditLog } from "@/test/fakeSupabase";
import { person, permsFor, jSC, job, line } from "@/test/fixtures/jobs";

vi.mock("@supabase/supabase-js", async () => {
  const { fakeSupabase } = await import("@/test/fakeSupabase");
  return { createClient: () => fakeSupabase };
});
vi.mock("@/shared/utils/email", async (orig) => ({ ...(await orig()), sendEmail: vi.fn() }));
vi.mock("./pdfGenerator", () => ({ generatePDF: vi.fn(() => true) }));
vi.mock("./accuLynxSync", async (orig) => ({
  ...(await orig()),
  syncJobReportToAccuLynx: vi.fn(),
}));

const t = translations.en;

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  // logAction narrates every audit write to the console.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const admin = person("admin", "admin");
const sam = person("sam", "field");

const draft = job("j1", "draft", { title: "Smith Reroof", items: [line("i1", "Shingle")] });
const completed = job("j2", "completed", {
  title: "Jones Tearoff",
  assignedto: "sam",
  completedAt: "2026-07-16",
  items: [line("i1", "Shingle", { pulled: 8 })],
});
const closed = job("j3", "closed", { title: "Brown Gutters", closedAt: "2026-07-20" });

const renderBuildJobs = (jobs, props = {}) =>
  renderStateful(BuildJobsView, {
    state: { jobs, jobTrailers: [] },
    props: {
      company: { id: "c1", name: "Test Co", branding: {} },
      jobNotifications: {},
      inv: [],
      vehs: [],
      users: [admin, sam],
      user: admin,
      perms: permsFor(admin),
      jSC,
      acculynxConfig: {},
      onOpenItemHandled: () => {},
      ...props,
    },
  });

const jobWrites = () => writes().filter((w) => w.table === "jobs");
const modalTitled = (title) => screen.getByRole("heading", { name: title }).closest(".mrr-modal");

describe("Build Jobs: approve", () => {
  const openApprove = async () => {
    await userEvent.click(screen.getByRole("button", { name: t.bjApproveAssign }));
    return modalTitled(`Approve: ${draft.title}`);
  };

  it("refuses to approve a draft until a supervisor is picked, and writes nothing", async () => {
    const view = renderBuildJobs([draft]);
    const modal = await openApprove();

    await userEvent.click(within(modal).getByRole("button", { name: /approve & notify/i }));

    expect(await screen.findByText(t.bjAssignBeforeApprove)).toBeTruthy();
    expect(jobWrites()).toEqual([]);
    expect(view.state.jobs[0].status).toBe("draft");
  });

  it("writes approved + the supervisor, re-renders the card, and emails the crew", async () => {
    const view = renderBuildJobs([draft], { jobNotifications: { approved: true } });
    const modal = await openApprove();

    await userEvent.selectOptions(within(modal).getByRole("combobox"), "sam");
    await userEvent.click(within(modal).getByRole("button", { name: /approve & notify/i }));

    expect(await screen.findByText(t.bjApproved)).toBeTruthy();
    expect(jobWrites()).toEqual([
      expect.objectContaining({
        op: "update",
        filters: { id: "j1" },
        payload: expect.objectContaining({
          status: "approved",
          assignedto: "sam",
          newforassigned: true,
        }),
      }),
    ]);
    expect(view.state.jobs[0]).toMatchObject({ status: "approved", assignedto: "sam" });
    // The modal is gone and the draft-only button went with the draft.
    expect(screen.queryByRole("heading", { name: `Approve: ${draft.title}` })).toBeNull();
    expect(screen.queryByRole("button", { name: t.bjApproveAssign })).toBeNull();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "sam@example.com" }));
    expect(auditLog()).toEqual(["JOB_BUILD_CREATE"]);
  });

  it("does not email the crew when the company has the Approved notice off", async () => {
    renderBuildJobs([draft], { jobNotifications: {} });
    const modal = await openApprove();

    await userEvent.selectOptions(within(modal).getByRole("combobox"), "sam");
    await userEvent.click(within(modal).getByRole("button", { name: /approve & notify/i }));

    expect(await screen.findByText(t.bjApproved)).toBeTruthy();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the job a draft when the row no longer exists", async () => {
    // updateRowStrict's zero-rows case: deleted on another device, or RLS.
    respond({ table: "jobs", op: "update" }, { data: [] });
    const view = renderBuildJobs([draft]);
    const modal = await openApprove();

    await userEvent.selectOptions(within(modal).getByRole("combobox"), "sam");
    await userEvent.click(within(modal).getByRole("button", { name: /approve & notify/i }));

    expect(await screen.findByText(/no longer exists/i)).toBeTruthy();
    expect(view.state.jobs[0].status).toBe("draft");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(auditLog()).toEqual([]);
  });
});

describe("Build Jobs: close", () => {
  const pressClose = () => userEvent.click(screen.getByRole("button", { name: /^close$/i }));
  const answer = (name) =>
    userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name }));

  it("asks first, and cancelling writes nothing", async () => {
    const view = renderBuildJobs([completed]);

    await pressClose();
    expect(within(screen.getByRole("alertdialog")).getByText(t.bjCloseTitle)).toBeTruthy();
    await answer("Cancel");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(jobWrites()).toEqual([]);
    expect(view.state.jobs[0].status).toBe("completed");
  });

  it("closes on confirm and hands off to the Closed list", async () => {
    const view = renderBuildJobs([completed]);

    await pressClose();
    await answer(t.bjCloseAndFile);

    expect(await screen.findByText(t.bjClosedTitle)).toBeTruthy();
    expect(jobWrites()).toEqual([
      expect.objectContaining({
        op: "update",
        filters: { id: "j2" },
        payload: { status: "closed", closedAt: expect.any(String) },
      }),
    ]);
    expect(view.state.jobs[0].status).toBe("closed");
    expect(auditLog()).toEqual(["JOB_BUILD_CLOSE"]);
    // AccuLynx is not configured for this company, so there was nowhere to file.
    expect(syncJobReportToAccuLynx).not.toHaveBeenCalled();
  });

  it("stays open when the database refuses the close", async () => {
    respond({ table: "jobs", op: "update" }, { error: { message: "permission denied" } });
    const view = renderBuildJobs([completed]);

    await pressClose();
    await answer(t.bjCloseAndFile);

    expect(await screen.findByText(`${t.bjCloseFail} permission denied`)).toBeTruthy();
    expect(view.state.jobs[0].status).toBe("completed");
    expect(screen.queryByText(t.bjClosedTitle)).toBeNull();
  });

  describe("with AccuLynx configured", () => {
    const acculynxConfig = { enabled: true, proxyUrl: "https://ax.example" };

    it("files the report before closing, and a failed upload keeps it open unless told otherwise", async () => {
      syncJobReportToAccuLynx.mockResolvedValue({ ok: false, error: "AccuLynx is down" });
      const view = renderBuildJobs([completed], { acculynxConfig });

      await pressClose();
      await answer(t.bjCloseAndFile);
      // The second question: close with no report filed?
      expect(await screen.findByText("AccuLynx is down")).toBeTruthy();
      await answer(t.bjDontClose);

      expect(syncJobReportToAccuLynx).toHaveBeenCalledTimes(1);
      expect(await screen.findByText(`${t.bjCloseSyncFail} AccuLynx is down`)).toBeTruthy();
      expect(jobWrites()).toEqual([]);
      expect(view.state.jobs[0].status).toBe("completed");
    });

    it("closes without the report when that is chosen deliberately", async () => {
      syncJobReportToAccuLynx.mockResolvedValue({ ok: false, error: "AccuLynx is down" });
      const view = renderBuildJobs([completed], { acculynxConfig });

      await pressClose();
      await answer(t.bjCloseAndFile);
      await screen.findByText("AccuLynx is down");
      await answer(t.bjCloseAnyway);

      expect(await screen.findByText(t.bjClosedTitle)).toBeTruthy();
      expect(view.state.jobs[0].status).toBe("closed");
    });

    it("does not file a second copy of a report that already went up", async () => {
      const filed = { ...completed, syncStatus: "synced" };
      const view = renderBuildJobs([filed], { acculynxConfig });

      await pressClose();
      await answer(t.bjCloseAndFile);

      expect(await screen.findByText(t.bjClosedTitle)).toBeTruthy();
      expect(syncJobReportToAccuLynx).not.toHaveBeenCalled();
      expect(view.state.jobs[0].status).toBe("closed");
    });
  });
});

describe("Build Jobs: reopen", () => {
  it("returns a closed job to completed from its detail panel", async () => {
    const view = renderBuildJobs([closed]);

    await userEvent.click(screen.getByText(closed.title));
    await userEvent.click(screen.getByRole("button", { name: /reopen/i }));

    expect(await screen.findByText(t.bjReopened)).toBeTruthy();
    expect(jobWrites()).toEqual([
      expect.objectContaining({
        op: "update",
        filters: { id: "j3" },
        payload: { status: "completed", closedAt: "" },
      }),
    ]);
    expect(view.state.jobs[0]).toMatchObject({ status: "completed", closedAt: "" });
    expect(auditLog()).toEqual(["JOB_BUILD_REOPEN"]);
    // The panel now offers the close again, on the job it just reopened.
    expect(screen.getByRole("button", { name: /close job/i })).toBeTruthy();
  });
});
