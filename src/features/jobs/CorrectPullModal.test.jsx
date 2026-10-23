// @vitest-environment jsdom
//
// src/features/jobs/CorrectPullModal.test.jsx
//
// The dialog that finally calls correct_job_pull (supabase/51), which shipped
// installed and granted and with nothing in the app reaching it.
//
// What these cover is mostly the gap that left, plus one thing that has since
// changed. 52 refused a line at pulled > 0 and named this screen, 51 refuses an
// increase and named 52, and the only way through that circle was to correct a
// line to 0 here and re-pull the new total next door. supabase/57 opened it
// properly — Need More Materials now adds to a pulled line — so that route is no
// longer the answer to "we need more", and the row's message says so.
//
// Correcting a line to 0 still has to work, and a 0 still has to survive as a
// real corrected total rather than read as an empty box: it is how a pull that
// should never have happened is backed out.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CorrectPullModal from "./CorrectPullModal.jsx";
import { renderStateful } from "@/test/renderView";
import { reset, respond, rpcCalls } from "@/test/fakeSupabase";
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

const line = (iid, over = {}) => ({
  iid,
  iname: iid === "i8" ? "Solar Seal - White" : iid.toUpperCase(),
  unit: "tubes",
  planned: 10,
  pulled: 10,
  returned: 0,
  consumed: [{ bid: "b9", rcvd: "2025-05-01", qty: 10, price: 18 }],
  ...over,
});

const open = (items, { onSaved = vi.fn(), onClose = vi.fn() } = {}) => {
  renderStateful(CorrectPullModal, {
    state: {},
    props: {
      job: { id: "j1", po: "22620", title: "Smith Residence", status: "active", items },
      activeUser: user,
      t,
      onSaved,
      onClose,
    },
  });
  return { onSaved, onClose };
};

const qtyBox = (name) => screen.getByLabelText(`${t.bjCorrectPullNewTotal} — ${name}`);
const saveBtn = () => screen.getByRole("button", { name: /save correction/i });

describe("CorrectPullModal", () => {
  it("lists only the lines something was pulled on", () => {
    open([line("i8"), line("i9", { iname: "Solar Seal - Black", pulled: 0 })]);
    expect(screen.getByText("Solar Seal - White")).toBeTruthy();
    expect(screen.queryByText("Solar Seal - Black")).toBeNull();
  });

  // Nothing typed yet, so there is nothing to send — the button should not be
  // a way to fire an empty correction at the RPC.
  it("will not save until a quantity actually changes", async () => {
    open([line("i8")]);
    expect(saveBtn().disabled).toBe(true);
  });

  it("sends only the changed line, as the corrected TOTAL", async () => {
    respond(
      { op: "rpc", fn: "correct_job_pull" },
      {
        data: {
          job_id: "j1",
          corrections: [
            {
              iid: "i8",
              old_pulled: 10,
              new_pulled: 4,
              credited: 6,
              pullCost: 72,
              priceAtPull: 18,
              consumed: [],
            },
          ],
          pulls: [],
        },
      },
    );
    const { onSaved } = open([line("i8"), line("i9")]);

    await userEvent.clear(qtyBox("Solar Seal - White"));
    await userEvent.type(qtyBox("Solar Seal - White"), "4");
    await userEvent.click(saveBtn());

    const [call] = rpcCalls("correct_job_pull");
    expect(call.args.p_job_id).toBe("j1");
    expect(call.args.p_unpull).toEqual({ i8: 4 });
    expect(onSaved).toHaveBeenCalled();
    // The server's recomputed numbers, not a second implementation here.
    const [updated] = onSaved.mock.calls[0];
    expect(updated.items.find((i) => i.iid === "i8").pulled).toBe(4);
    expect(updated.items.find((i) => i.iid === "i9").pulled).toBe(10);
  });

  // How a pull that should never have happened is backed out entirely.
  it("treats 0 as a real correction, not an empty box", async () => {
    respond(
      { op: "rpc", fn: "correct_job_pull" },
      {
        data: {
          job_id: "j1",
          corrections: [{ iid: "i8", old_pulled: 10, new_pulled: 0 }],
          pulls: [],
        },
      },
    );
    open([line("i8")]);

    await userEvent.clear(qtyBox("Solar Seal - White"));
    await userEvent.type(qtyBox("Solar Seal - White"), "0");
    expect(saveBtn().disabled).toBe(false);
    await userEvent.click(saveBtn());

    expect(rpcCalls("correct_job_pull")[0].args.p_unpull).toEqual({ i8: 0 });
  });

  // 51 refuses this and names Need More Materials. Saying so on the row is what
  // stops someone bouncing between the two dialogs.
  it("blocks an attempt to raise a pull and points at Need More Materials", async () => {
    open([line("i8")]);
    await userEvent.clear(qtyBox("Solar Seal - White"));
    await userEvent.type(qtyBox("Solar Seal - White"), "11");

    expect(screen.getByText(t.bjCorrectPullCannotRaise)).toBeTruthy();
    expect(saveBtn().disabled).toBe(true);
    expect(rpcCalls("correct_job_pull")).toHaveLength(0);
  });

  it("blocks a total below what has already come back", async () => {
    open([line("i8", { pulled: 10, returned: 4 })]);
    await userEvent.clear(qtyBox("Solar Seal - White"));
    await userEvent.type(qtyBox("Solar Seal - White"), "2");

    expect(screen.getByText(t.bjCorrectPullBelowReturned.replace("{n}", "4"))).toBeTruthy();
    expect(saveBtn().disabled).toBe(true);
  });

  // 51:251 refuses a line with no `consumed` split rather than guessing which
  // batches to credit, so the row says so instead of failing on save.
  it("disables a line pulled before batch tracking, with the reason", () => {
    open([line("i8", { consumed: [] })]);
    expect(screen.getByText(t.bjCorrectPullNoHistory)).toBeTruthy();
    expect(qtyBox("Solar Seal - White").disabled).toBe(true);
    expect(saveBtn().disabled).toBe(true);
  });

  it("keeps the job unchanged when the RPC refuses", async () => {
    respond({ op: "rpc", fn: "correct_job_pull" }, { error: { message: "nope" } });
    const { onSaved } = open([line("i8")]);

    await userEvent.clear(qtyBox("Solar Seal - White"));
    await userEvent.type(qtyBox("Solar Seal - White"), "4");
    await userEvent.click(saveBtn());

    expect(rpcCalls("correct_job_pull")).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
