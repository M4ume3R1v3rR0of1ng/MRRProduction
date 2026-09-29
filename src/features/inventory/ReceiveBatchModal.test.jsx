// @vitest-environment jsdom
//
// src/features/inventory/ReceiveBatchModal.test.jsx
//
// Receiving a batch with and without pricing rights. The price field only renders
// for inv_pricing_edit, and it used to be required regardless — so anyone who
// could receive but not price could never save a receipt at all. Without the
// right, the batch now carries the item's newest price; with it, a blank price is
// still refused.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ReceiveBatchModal from "./ReceiveBatchModal.jsx";
import { renderStateful } from "@/test/renderView";
import { reset, writes } from "@/test/fakeSupabase";

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

const seeded = [{ id: "b1", rcvd: "2026-06-01", qty: 10, rem: 4, price: 31.5, by: "u1" }];
const item = { id: "i1", name: "Underlayment", unit: "roll", alrt: 2, batches: seeded };
const user = { id: "u2", email: "rae@example.com", name: "Rae" };

const renderReceive = (perms) => {
  const onReceived = vi.fn();
  const onClose = vi.fn();
  renderStateful(ReceiveBatchModal, {
    state: {},
    props: {
      item,
      user,
      users: [user],
      perms,
      fetchLiveBatches: vi.fn(async () => seeded),
      onReceived,
      onClose,
    },
  });
  return { onReceived, onClose };
};

const fillQtyAndDate = async () => {
  fireEvent.change(screen.getByLabelText("Date Received"), { target: { value: "2026-07-01" } });
  await userEvent.type(screen.getByLabelText("Quantity to Inject (roll)"), "20");
};
const pressReceive = () => userEvent.click(screen.getByRole("button", { name: "Receive Batch" }));
const inventoryWrites = () => writes().filter((w) => w.table === "inventory");

describe("ReceiveBatchModal without pricing rights", () => {
  it("receives at the newest known price instead of demanding a hidden field", async () => {
    const { onReceived, onClose } = renderReceive({ inv_receive: true });
    expect(screen.queryByLabelText(/^Price Per Unit/)).toBeNull();

    await fillQtyAndDate();
    await pressReceive();

    expect(await screen.findByText("Batch successfully received.")).toBeTruthy();
    const newBatch = expect.objectContaining({ rcvd: "2026-07-01", qty: 20, rem: 20, price: 31.5 });
    expect(inventoryWrites()).toEqual([
      expect.objectContaining({
        op: "update",
        filters: { id: "i1" },
        payload: { batches: [seeded[0], newBatch] },
      }),
    ]);
    expect(onReceived).toHaveBeenCalledWith("i1", [seeded[0], newBatch]);
    expect(onClose).toHaveBeenCalled();
  });

  it("still names the fields that are actually missing", async () => {
    renderReceive({ inv_receive: true });

    await pressReceive();

    expect(
      await screen.findByText("Nothing was received — please fill in the quantity, received date."),
    ).toBeTruthy();
    expect(inventoryWrites()).toEqual([]);
  });
});

describe("ReceiveBatchModal with pricing rights", () => {
  it("refuses a blank price", async () => {
    renderReceive({ inv_receive: true, inv_pricing_edit: true });

    await fillQtyAndDate();
    await pressReceive();

    expect(
      await screen.findByText("Nothing was received — please fill in the price."),
    ).toBeTruthy();
    expect(inventoryWrites()).toEqual([]);
  });

  it("records the price that was entered", async () => {
    renderReceive({ inv_receive: true, inv_pricing_edit: true });

    await fillQtyAndDate();
    await userEvent.type(screen.getByLabelText(/^Price Per Unit/), "29.75");
    await pressReceive();

    expect(await screen.findByText("Batch successfully received.")).toBeTruthy();
    expect(inventoryWrites()[0].payload.batches[1]).toMatchObject({ qty: 20, price: 29.75 });
  });
});
