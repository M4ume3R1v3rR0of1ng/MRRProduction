// @vitest-environment jsdom
//
// src/features/jobs/PullInventoryView.test.jsx
//
// The crew end of the pipeline: pulling a job's materials out of the warehouse
// (approved -> active) and returning what was left over (active -> completed).
// Both move stock, so both go through the commit_job_materials transaction, and
// both have a guard in front of it that exists because the old code lacked one:
//
//   pull    stock is re-read before FIFO runs, and going negative has to be
//           confirmed before anything is written
//   return  the report is produced before the job completes, and a reply lost
//           to a dropped connection is checked against the database rather than
//           reported as a failure
//
// These drive the real screen as a site supervisor would and assert on what
// reached the transaction.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PullInventoryView from "./PullInventoryView.jsx";
import { generatePDF } from "./pdfGenerator";
import { translations } from "@/shared/utils/translations";
import { renderStateful } from "@/test/renderView";
import { reset, respond, rpcCalls, auditLog, allCalls } from "@/test/fakeSupabase";
import { person, permsFor, jSC, job, line, batch } from "@/test/fixtures/jobs";

vi.mock("@supabase/supabase-js", async () => {
  const { fakeSupabase } = await import("@/test/fakeSupabase");
  return { createClient: () => fakeSupabase };
});
vi.mock("@/shared/utils/email", async (orig) => ({ ...(await orig()), sendEmail: vi.fn() }));
vi.mock("./pdfGenerator", () => ({ generatePDF: vi.fn(() => true) }));

const t = translations.en;

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  generatePDF.mockReturnValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A field supervisor: pulls and completes, sees only their own jobs, and cannot
// open Build Jobs.
const sam = person("sam", "field");

// What this device loaded when the screen opened. Deliberately wrong: the tests
// below answer the pull's fresh read with different batches, and the pull must
// use those.
const staleInv = [
  {
    id: "i1",
    name: "Shingle",
    cat: "Roofing",
    unit: "bd",
    batches: [batch("b-old", "2026-01-01", 100, 9)],
  },
];

const approved = job("j1", "approved", {
  assignedto: "sam",
  items: [line("i1", "Shingle", { planned: 10 })],
});
const active = job("j2", "active", {
  assignedto: "sam",
  items: [line("i1", "Shingle", { planned: 10, pulled: 10, priceAtPull: 12 })],
});

// The warehouse as the database has it right now, for the re-read.
const liveStock = (...batches) =>
  respond({ table: "inventory", op: "select" }, { data: [{ id: "i1", batches }] });

const renderPull = (jobs, props = {}) =>
  renderStateful(PullInventoryView, {
    state: { jobs, inv: staleInv },
    props: {
      users: [sam],
      user: sam,
      perms: permsFor(sam),
      jSC,
      lang: "en",
      acculynxConfig: {},
      jobNotifications: {},
      ...props,
    },
  });

const modalTitled = (title) => screen.getByRole("heading", { name: title }).closest(".mrr-modal");
const setQty = async (modal, value) => {
  const input = within(modal).getByRole("spinbutton");
  await userEvent.clear(input);
  await userEvent.type(input, String(value));
};
const commits = () => rpcCalls("commit_job_materials");

describe("Pull Inventory: pull materials", () => {
  const openPull = async () => {
    await userEvent.click(screen.getByRole("button", { name: t.pullPullMaterials }));
    return modalTitled(`${t.pullPullMaterials} — ${approved.title}`);
  };

  it("deducts FIFO from the live batches, not this device's copy, in one transaction", async () => {
    // Oldest first: 3 @ $10, then 5 of the 20 @ $15.
    liveStock(batch("b1", "2026-05-01", 3, 10), batch("b2", "2026-06-01", 20, 15));
    const view = renderPull([approved]);
    const modal = await openPull();

    await setQty(modal, 8);
    await userEvent.click(within(modal).getByRole("button", { name: t.pullConfirm }));

    expect(await screen.findByText(t.pullPulledOk)).toBeTruthy();
    expect(commits()).toHaveLength(1);
    const { args } = commits()[0];
    expect(args).toMatchObject({ p_job_id: "j1", p_status: "active" });
    expect(args.p_items[0]).toMatchObject({
      iid: "i1",
      pulled: 8,
      pullCost: 105,
      priceAtPull: 13.125,
    });
    expect(args.p_batches.i1.map((b) => [b.id, b.rem])).toEqual([
      ["b1", 0],
      ["b2", 15],
    ]);

    // The screen now reflects what was committed: job active, stock from the live read.
    expect(view.state.jobs[0]).toMatchObject({ status: "active" });
    expect(view.state.inv[0].batches.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(screen.getByText(t.pullHandoffPulledTitle)).toBeTruthy();
    expect(auditLog()).toEqual(["INVENTORY_PULL"]);
  });

  it("stops before writing when the pull would go negative, and only proceeds when told to", async () => {
    liveStock(batch("b1", "2026-05-01", 4, 10));
    const view = renderPull([approved]);
    const modal = await openPull();

    await userEvent.click(within(modal).getByRole("button", { name: t.pullConfirm }));
    const warn = modalTitled(t.pullShortTitle);
    expect(within(warn).getByText(/−6/)).toBeTruthy();
    expect(commits()).toEqual([]);

    // Backing out leaves the job exactly as it was.
    await userEvent.click(within(warn).getByRole("button", { name: t.pullShortCancel }));
    expect(screen.queryByRole("heading", { name: t.pullShortTitle })).toBeNull();
    expect(commits()).toEqual([]);
    expect(view.state.jobs[0].status).toBe("approved");

    // Second time through, choose to record the shortfall.
    await userEvent.click(within(modal).getByRole("button", { name: t.pullConfirm }));
    await userEvent.click(
      within(modalTitled(t.pullShortTitle)).getByRole("button", { name: t.pullShortProceed }),
    );

    expect(await screen.findByText(/Pulled past available stock: Shingle \(6 bd\)/)).toBeTruthy();
    expect(commits()).toHaveLength(1);
    const negative = commits()[0].args.p_batches.i1.find((b) => b.short);
    expect(negative).toMatchObject({ rem: -6, jobId: "j1", by: "sam" });
    expect(view.state.jobs[0].status).toBe("active");
  });

  it("leaves the job and stock untouched when the transaction fails", async () => {
    liveStock(batch("b1", "2026-05-01", 50, 10));
    respond(
      { fn: "commit_job_materials" },
      { error: { message: "deadlock detected", code: "40P01" } },
    );
    const view = renderPull([approved]);
    const modal = await openPull();

    await userEvent.click(within(modal).getByRole("button", { name: t.pullConfirm }));

    expect(await screen.findByText(`${t.pullPullAborted} deadlock detected`)).toBeTruthy();
    expect(view.state.jobs[0].status).toBe("approved");
    expect(view.state.inv).toBe(staleInv);
    // Still open, so the crew can simply press it again.
    expect(within(modal).getByRole("button", { name: t.pullConfirm })).toBeTruthy();
    expect(auditLog()).toEqual([]);
  });
});

describe("Pull Inventory: return & complete", () => {
  const openReturn = async () => {
    await userEvent.click(screen.getByRole("button", { name: t.pullReturnComplete }));
    return modalTitled(`${t.pullReturnUnused} — ${active.title}`);
  };
  const complete = (modal) =>
    userEvent.click(within(modal).getByRole("button", { name: t.pullCompleteJob }));

  it("puts the unused stock back as its own batch and completes the job", async () => {
    liveStock(batch("b2", "2026-06-01", 15, 15));
    const view = renderPull([active]);
    const modal = await openReturn();

    await setQty(modal, 3);
    await complete(modal);

    expect(await screen.findByText(t.pullHandoffCompletedTitle)).toBeTruthy();
    // The report comes first: it is the gate on completing.
    expect(generatePDF).toHaveBeenCalledTimes(1);
    expect(commits()).toHaveLength(1);
    const { args } = commits()[0];
    expect(args).toMatchObject({
      p_job_id: "j2",
      p_status: "completed",
      p_completed: expect.any(String),
    });
    expect(args.p_items[0]).toMatchObject({ pulled: 10, returned: 3 });
    expect(args.p_batches.i1).toEqual([
      expect.objectContaining({ id: "b2", rem: 15 }),
      // Priced at what it was pulled at, and a deterministic id so a retry re-posts
      // the same return rather than a second one.
      expect.objectContaining({ id: "ret_j2_i1", rem: 3, price: 12, by: "sam" }),
    ]);

    expect(view.state.jobs[0].status).toBe("completed");
    // A completed job leaves the crew's queue.
    expect(screen.queryByRole("button", { name: t.pullReturnComplete })).toBeNull();
    // A field supervisor cannot open Build Jobs, so is not pointed at it.
    expect(screen.getByText(t.pullHandoffCompletedMsgField)).toBeTruthy();
  });

  it("will not return more than was pulled", async () => {
    liveStock(batch("b2", "2026-06-01", 15, 15));
    renderPull([active]);
    const modal = await openReturn();

    await setQty(modal, 50);
    expect(within(modal).getByRole("spinbutton").value).toBe("10");
    await complete(modal);

    await screen.findByText(t.pullHandoffCompletedTitle);
    expect(commits()[0].args.p_items[0].returned).toBe(10);
  });

  it("leaves the job open when the report does not open and the crew says so", async () => {
    generatePDF.mockReturnValue(false);
    const view = renderPull([active]);
    const modal = await openReturn();

    await complete(modal);
    const ask = await screen.findByRole("alertdialog");
    expect(within(ask).getByText(t.pullPdfBlockedTitle)).toBeTruthy();
    await userEvent.click(within(ask).getByRole("button", { name: t.pullDontComplete }));

    expect(commits()).toEqual([]);
    expect(view.state.jobs[0].status).toBe("active");
    expect(within(modal).getByRole("button", { name: t.pullCompleteJob })).toBeTruthy();
  });

  it("completes anyway without the report when that is chosen", async () => {
    generatePDF.mockReturnValue(false);
    const view = renderPull([active]);
    const modal = await openReturn();

    await complete(modal);
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: t.pullCompleteAnyway,
      }),
    );

    expect(await screen.findByText(t.pullHandoffCompletedTitle)).toBeTruthy();
    expect(commits()).toHaveLength(1);
    expect(view.state.jobs[0].status).toBe("completed");
  });

  describe("when the connection drops mid-commit", () => {
    const lostReply = () =>
      respond(
        { fn: "commit_job_materials" },
        { error: { message: "TypeError: Failed to fetch", code: "" } },
      );
    const probe = (row) => respond({ table: "jobs", op: "select" }, { data: row });

    it("asks the database, and finishes the job if the commit had in fact landed", async () => {
      lostReply();
      probe({
        status: "completed",
        completed: "2026-07-20T15:00:00.000Z",
        completedAt: "2026-07-20T15:00:00.000Z",
      });
      const view = renderPull([active]);

      await complete(await openReturn());

      expect(await screen.findByText(t.pullHandoffCompletedTitle)).toBeTruthy();
      // The timestamp the database recorded, not the one this attempt made up.
      expect(view.state.jobs[0]).toMatchObject({
        status: "completed",
        completedAt: "2026-07-20T15:00:00.000Z",
      });
    });

    it("says it is safe to retry when the commit did not land", async () => {
      lostReply();
      probe({ status: "active", completed: null, completedAt: null });
      const view = renderPull([active]);

      await complete(await openReturn());

      expect(await screen.findByText(t.pullReturnOffline)).toBeTruthy();
      expect(view.state.jobs[0].status).toBe("active");
    });
  });

  it("reports a real database error as one, without probing", async () => {
    respond(
      { fn: "commit_job_materials" },
      { error: { message: "check constraint", code: "23514" } },
    );
    const view = renderPull([active]);

    await complete(await openReturn());

    expect(await screen.findByText(`${t.pullReturnError} check constraint`)).toBeTruthy();
    expect(view.state.jobs[0].status).toBe("active");
    expect(allCalls().filter((c) => c.table === "jobs" && c.op === "select")).toEqual([]);
  });
});
