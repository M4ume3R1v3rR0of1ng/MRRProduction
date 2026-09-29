// e2e/inventory-receiving.spec.js
//
// Receiving a delivery against one catalog item: Inventory -> item detail ->
// + Receive Batch -> fill the receipt -> the new batch is on the shelf. The
// write is a read-modify-write of the item's `batches` array
// (ReceiveBatchModal.jsx: fetchLiveBatches + updateRowStrict), so the thing
// worth proving end to end is that the batch actually persisted alongside the
// seeded one — checked after a full reload, and against the stored row — not
// just that the modal closed.
import { test, expect } from "@playwright/test";
import { state, login, serviceClient } from "./helpers.js";

const item = state.receivingItem;
const detailModal = (page) =>
  page.locator(".mrr-modal").filter({ has: page.getByRole("heading", { name: item.name }) });

async function openItem(page) {
  await page.goto("/inventory");
  await page.getByText(item.name, { exact: true }).click();
  await expect(detailModal(page)).toBeVisible();
}

test("inventory receiving: a received batch adds to stock and survives a reload", async ({
  page,
}) => {
  await login(page, state.adminEmail, state.adminPassword);
  await openItem(page);
  await expect(detailModal(page).getByText(`${item.qty} ${item.unit}`)).toBeVisible();

  await detailModal(page).getByRole("button", { name: "+ Receive Batch" }).click();
  const receive = page
    .locator(".mrr-modal")
    .filter({ has: page.getByRole("heading", { name: `Receive Inbound Stock: ${item.name}` }) });
  await expect(receive).toBeVisible();

  // A blank submit is refused by name, and the modal stays open to be fixed.
  await receive.getByRole("button", { name: "Receive Batch", exact: true }).click();
  await expect(
    page.getByText("Nothing was received — please fill in the quantity, price, received date."),
  ).toBeVisible();
  await expect(receive).toBeVisible();

  const today = new Date().toISOString().slice(0, 10);
  const po = `PO-E2E-${Date.now()}`;
  const vendor = "ZZ E2E Supply";
  await receive.getByLabel("Date Received").fill(today);
  await receive.getByLabel(`Quantity to Inject (${item.unit})`).fill("25");
  await receive.getByLabel("Invoice / PO Number").fill(po);
  await receive.getByLabel("Supplier / Vendor").fill(vendor);
  await receive.getByLabel("Price Per Unit").fill("27.5");
  await receive.getByRole("button", { name: "Receive Batch", exact: true }).click();

  await expect(page.getByText("Batch successfully received.")).toBeVisible();
  await expect(receive).toHaveCount(0);

  // Back on the detail view, which re-reads the item the modal reported back.
  const received = item.qty + 25;
  await expect(detailModal(page).getByText(`${received} ${item.unit}`)).toBeVisible();
  await expect(detailModal(page).getByText(po)).toBeVisible();
  await expect(detailModal(page).getByText("25/25 remaining")).toBeVisible();

  // A full reload rebuilds everything from the database, so this is the check
  // that the receipt was stored rather than only folded into React state.
  await page.reload();
  await openItem(page);
  await expect(detailModal(page).getByText(`${received} ${item.unit}`)).toBeVisible();
  await expect(detailModal(page).getByText(po)).toBeVisible();

  // And the stored row: the seeded batch untouched, the new one appended with
  // its paperwork and who received it.
  const { data, error } = await serviceClient()
    .from("inventory")
    .select("batches")
    .eq("company_id", state.companyId)
    .eq("id", item.id)
    .single();
  expect(error).toBeNull();
  expect(data.batches).toHaveLength(2);
  expect(data.batches[0]).toMatchObject({ qty: item.qty, rem: item.qty });
  expect(data.batches[1]).toMatchObject({
    rcvd: today,
    qty: 25,
    rem: 25,
    price: 27.5,
    ref: po,
    vendor,
    by: state.adminUserId,
  });
});
