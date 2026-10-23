// @vitest-environment jsdom
//
// src/features/jobs/AddPullMaterialsModal.test.jsx
//
// The dialog a crew opens when the roof needs more than the job was planned for.
//
// Most of what is covered here is the case it used to have no row for at all:
//
//   "I can not add in more material once I pulled them. Job 22598 I pulled 6
//    osb but now I need 9 more and can not add them on. Why not?"
//
// Because a line at pulled > 0 was in neither half of this dialog — orphanLines
// dropped it for having a pull, addableForPull dropped it for being on the job —
// and both RPCs behind it refused it while naming each other. supabase/57 made a
// top-up a second pull against the same line, and these tests pin the two things
// that are easy to get subtly wrong about that: the quantity sent is what to ADD
// rather than the new total, and what lands on screen afterwards comes from the
// server rather than from that delta.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AddPullMaterialsModal from "./AddPullMaterialsModal.jsx";
import { renderStateful } from "@/test/renderView";
import { reset, respond, rpcCalls, auditLog } from "@/test/fakeSupabase";
import { translations } from "@/shared/utils/translations";

vi.mock("@supabase/supabase-js", async () => {
  const { fakeSupabase } = await import("@/test/fakeSupabase");
  return { createClient: () => fakeSupabase };
});

beforeEach(() => {
  reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const t = translations.en;
const user = { id: "u2", email: "rae@example.com", name: "Rae" };

// Already pulled: 6 of the 6 that were approved, from one batch at $14.
const osb = (over = {}) => ({
  iid: "i1",
  iname: "OSB 7/16",
  unit: "sheets",
  planned: 6,
  pulled: 6,
  returned: 0,
  pulledAt: "2026-10-01",
  priceAtPull: 14,
  pullCost: 84,
  consumed: [{ bid: "b1", rcvd: "2026-09-01", qty: 6, price: 14 }],
  ...over,
});

const inv = [
  {
    id: "i1",
    name: "OSB 7/16",
    cat: "Lumber",
    unit: "sheets",
    batches: [{ id: "b2", rcvd: "2026-09-20", price: 16, qty: 40, rem: 40 }],
  },
];

// The reply supabase/57 sends for a 9-sheet top-up of the line above: 15 out in
// total, planned revised to match, both draws in `consumed`, cost blended.
const topUpReply = {
  job_id: "j1",
  added: [],
  pulls: [
    {
      iid: "i1",
      qty: 9,
      pulled: 15,
      prevPulled: 6,
      planned: 15,
      prevPlanned: 6,
      pullCost: 228,
      priceAtPull: 15.2,
      pulledAt: "2026-10-01",
      consumed: [
        { bid: "b1", rcvd: "2026-09-01", qty: 6, price: 14 },
        { bid: "b2", rcvd: "2026-09-20", qty: 9, price: 16 },
      ],
      topUp: true,
    },
  ],
};

const open = (items, { onSaved = vi.fn(), onClose = vi.fn() } = {}) => {
  renderStateful(AddPullMaterialsModal, {
    state: {},
    props: {
      job: { id: "j1", po: "22598", title: "Smith Residence", status: "active", items },
      inv,
      users: [],
      activeUser: user,
      t,
      onSaved,
      onClose,
    },
  });
  return { onSaved, onClose };
};

const addMoreBox = (name) => screen.getByLabelText(`${t.pullAddMatAddMore} — ${name}`);
const confirmBtn = () => screen.getByRole("button", { name: new RegExp(t.pullAddMatConfirm, "i") });

describe("AddPullMaterialsModal — topping up a line that was already pulled", () => {
  it("offers the already-pulled line, with what has gone out so far", () => {
    open([osb()]);
    expect(screen.getByText(t.pullAddMatPulled)).toBeTruthy();
    expect(addMoreBox("OSB 7/16")).toBeTruthy();
    // The number the crew is adding to, on the row, so "9 more" never has to be
    // worked out as "15 total" in somebody's head.
    expect(screen.getByText("6 sheets")).toBeTruthy();
  });

  // The box starts empty on purpose: a quantity in it means "send this much
  // more", and every line on a pulled job has one.
  it("starts empty and sends nothing until a quantity is typed", async () => {
    open([osb()]);
    expect(addMoreBox("OSB 7/16").value).toBe("");
    await userEvent.click(confirmBtn());
    expect(rpcCalls("add_and_pull_job_materials")).toHaveLength(0);
  });

  it("shows the resulting total as the quantity is typed", async () => {
    open([osb()]);
    await userEvent.type(addMoreBox("OSB 7/16"), "9");
    expect(screen.getByText("15 sheets")).toBeTruthy();
  });

  it("sends the quantity to ADD, not the new total", async () => {
    respond({ op: "rpc", fn: "add_and_pull_job_materials" }, { data: topUpReply });
    respond(
      { table: "inventory", op: "select" },
      { data: [{ id: "i1", batches: inv[0].batches }] },
    );
    open([osb()]);

    await userEvent.type(addMoreBox("OSB 7/16"), "9");
    await userEvent.click(confirmBtn());

    const [call] = rpcCalls("add_and_pull_job_materials");
    expect(call.args.p_job_id).toBe("j1");
    // 9, never 15. The RPC adds it to what the line already has, so a new total
    // here would send out 15 more sheets on top of the 6 already gone.
    expect(call.args.p_lines.i1.pulled).toBe(9);
    // `planned` is the RPC's to revise (supabase/57), never this dialog's.
    expect(call.args.p_lines.i1.planned).toBeUndefined();
    // FIFO ran on the fresh batch, for the 9 being added only.
    expect(call.args.p_lines.i1.pullCost).toBe(144);
    expect(call.args.p_lines.i1.consumed).toEqual([
      { bid: "b2", rcvd: "2026-09-20", qty: 9, price: 16 },
    ]);
  });

  it("takes the new quantities from the reply, not from the delta it sent", async () => {
    respond({ op: "rpc", fn: "add_and_pull_job_materials" }, { data: topUpReply });
    respond(
      { table: "inventory", op: "select" },
      { data: [{ id: "i1", batches: inv[0].batches }] },
    );
    const { onSaved } = open([osb()]);

    await userEvent.type(addMoreBox("OSB 7/16"), "9");
    await userEvent.click(confirmBtn());

    expect(onSaved).toHaveBeenCalled();
    const [updated] = onSaved.mock.calls[0];
    const line = updated.items.find((i) => i.iid === "i1");
    // 15, not the 9 that was sent — otherwise the screen would claim 9 sheets
    // went out when 15 did, until the next read put it right.
    expect(line.pulled).toBe(15);
    expect(line.planned).toBe(15);
    expect(line.pullCost).toBe(228);
    expect(line.priceAtPull).toBe(15.2);
    // The first pull's date survives: it is when this line's material started
    // leaving the building.
    expect(line.pulledAt).toBe("2026-10-01");
    // Both draws, oldest first — the only record of which batch supplied which
    // units at which price.
    expect(line.consumed.map((c) => c.bid)).toEqual(["b1", "b2"]);
  });

  it("records the top-up on the line, keeping any earlier one", async () => {
    respond({ op: "rpc", fn: "add_and_pull_job_materials" }, { data: topUpReply });
    respond(
      { table: "inventory", op: "select" },
      { data: [{ id: "i1", batches: inv[0].batches }] },
    );
    const earlier = { qty: 2, prevPulled: 4, newPulled: 6, prevPlanned: 4, reason: "first time" };
    const { onSaved } = open([osb({ toppedUp: [earlier] })]);

    await userEvent.type(addMoreBox("OSB 7/16"), "9");
    await userEvent.click(confirmBtn());

    const [updated] = onSaved.mock.calls[0];
    const stamps = updated.items.find((i) => i.iid === "i1").toppedUp;
    // Appended, not replaced: a roof can come up short twice and the earlier
    // reason is the half a cost reconciliation reads.
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toEqual(earlier);
    expect(stamps[1]).toMatchObject({ qty: 9, prevPulled: 6, newPulled: 15, prevPlanned: 6 });
    expect(auditLog()).toContain("INVENTORY_PULL");
  });

  // A top-up IS a revision of the plan — 57 raises `planned` to match — so
  // warning that the result is over plan would be warning somebody about the
  // decision they just made on purpose, which is how a confirmation dialog
  // becomes a thing people click through without reading.
  it("does not stop to confirm a top-up against the plan", async () => {
    respond({ op: "rpc", fn: "add_and_pull_job_materials" }, { data: topUpReply });
    respond(
      { table: "inventory", op: "select" },
      { data: [{ id: "i1", batches: inv[0].batches }] },
    );
    open([osb()]);

    // 9 on top of 6 approved is well past the 25% over-plan threshold.
    await userEvent.type(addMoreBox("OSB 7/16"), "9");
    await userEvent.click(confirmBtn());

    expect(screen.queryByText(t.pullPlanHeading)).toBeNull();
    expect(rpcCalls("add_and_pull_job_materials")).toHaveLength(1);
  });

  // The other side of that, and the reason the exemption above is not simply
  // "skip the plan check on this screen". An ORPHAN line pulled past its plan is
  // nobody declaring anything — the number just came out high — so it still
  // stops, and supabase/57 leaves that line's `planned` alone so the pull review
  // list keeps showing it afterwards.
  it("still stops to confirm an over-plan pull of a line at zero", async () => {
    respond(
      { table: "inventory", op: "select" },
      { data: [{ id: "i1", batches: inv[0].batches }] },
    );
    open([osb({ pulled: 0, planned: 6, pullCost: 0, priceAtPull: 0, consumed: [] })]);

    const box = screen.getByLabelText(`${t.colActualPull} — OSB 7/16`);
    await userEvent.clear(box);
    await userEvent.type(box, "14");
    await userEvent.click(confirmBtn());

    expect(screen.getByText(t.pullPlanHeading)).toBeTruthy();
    expect(rpcCalls("add_and_pull_job_materials")).toHaveLength(0);
  });

  it("leaves the job alone when the RPC refuses", async () => {
    respond({ op: "rpc", fn: "add_and_pull_job_materials" }, { error: { message: "nope" } });
    respond(
      { table: "inventory", op: "select" },
      { data: [{ id: "i1", batches: inv[0].batches }] },
    );
    const { onSaved } = open([osb()]);

    await userEvent.type(addMoreBox("OSB 7/16"), "9");
    await userEvent.click(confirmBtn());

    expect(rpcCalls("add_and_pull_job_materials")).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  // The orphan path is the one supabase/52 shipped and 57 had to leave exactly
  // as it was: for a line at pulled = 0 the quantity typed IS the whole pull.
  it("still treats a line at zero as a plain pull, in its own section", async () => {
    respond(
      { op: "rpc", fn: "add_and_pull_job_materials" },
      {
        data: {
          job_id: "j1",
          added: [],
          pulls: [
            {
              iid: "i1",
              qty: 6,
              pulled: 6,
              prevPulled: 0,
              planned: 6,
              prevPlanned: 6,
              pullCost: 96,
              priceAtPull: 16,
              pulledAt: "2026-10-23",
              consumed: [{ bid: "b2", rcvd: "2026-09-20", qty: 6, price: 16 }],
              topUp: false,
            },
          ],
        },
      },
    );
    respond(
      { table: "inventory", op: "select" },
      { data: [{ id: "i1", batches: inv[0].batches }] },
    );
    const { onSaved } = open([osb({ pulled: 0, pullCost: 0, priceAtPull: 0, consumed: [] })]);

    // Listed as not-yet-pulled, prefilled with the approved quantity, and with
    // no top-up section at all.
    expect(screen.getByText(t.pullAddMatOnJob)).toBeTruthy();
    expect(screen.queryByText(t.pullAddMatPulled)).toBeNull();
    const box = screen.getByLabelText(`${t.colActualPull} — OSB 7/16`);
    expect(box.value).toBe("6");

    await userEvent.click(confirmBtn());
    expect(rpcCalls("add_and_pull_job_materials")[0].args.p_lines.i1.pulled).toBe(6);
    const [updated] = onSaved.mock.calls[0];
    const line = updated.items.find((i) => i.iid === "i1");
    expect(line.pulled).toBe(6);
    // 52's stamp, and no top-up record — this line was populated, not topped up.
    expect(line.addedAfterPull).toMatchObject({ byName: "Rae" });
    expect(line.toppedUp).toBeUndefined();
  });

  // An item on the job is reached through its own row, pulled or not. Offering
  // it in the search as well would create a SECOND line for the same item, and
  // `iid` is what every lookup in the pull path keys on.
  it("keeps an already-pulled item out of the add-something-new search", async () => {
    open([osb()]);
    await userEvent.type(screen.getByPlaceholderText(t.pullSearchInv), "OSB");
    expect(screen.getByText(t.pullNoMatchingInv)).toBeTruthy();
  });
});
