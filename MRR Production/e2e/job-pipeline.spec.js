// e2e/job-pipeline.spec.js
//
// The one flow named in the README's "known gaps" list: nothing automated
// proves a job survives build -> approve -> pull -> complete -> close in a
// real rendered browser. This drives all five stages against the disposable
// tenant e2e/global-setup.js seeded, using real Supabase writes end to end —
// no mocking.
//
// Locators are almost entirely getByLabel/getByRole on visible text, not
// data-testid: UIPrimitives.jsx's Fld already ties every form field to a real
// <label>, and every button here renders literal (non-translated) English
// text, so there was nothing to add just to make this test possible.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { STATE_FILE } from "./global-setup.js";

const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

// Two different things can leave a full-page ".mrr-backdrop" overlay open
// after an action commits, and they can be stacked at once: the JobHandoff
// card (src/features/jobs/JobHandoff.jsx, dismissed via its "Stay here"
// button — closeLabel={t.bjBuildAnother} at every call site) after
// build/pull/complete, and Pull Inventory's own job detail drawer (a Modal,
// dismissed via its "×" Close button) that stays open with the just-pulled
// job selected. `.last()` targets the topmost one — closing an underlying
// backdrop first is a no-op, since the one stacked above it still intercepts
// every click. Loops until none are left, since neither is guaranteed to
// appear (or to appear alone) every time.
async function closeAnyOverlay(page) {
  for (let i = 0; i < 5; i++) {
    if ((await page.locator(".mrr-backdrop").count()) === 0) return;
    // Deliberately re-queried fresh on every retry inside .click() rather than
    // decided once from an earlier isVisible() snapshot: the drawer and the
    // handoff card can mount one after the other (not atomically), so which
    // backdrop is topmost — and which button it offers, "Stay here" or the
    // drawer's "Close" — can change out from under a decision made too early.
    // That race is exactly what produced this test's flaky early failures.
    const dismiss = page
      .locator(".mrr-backdrop")
      .last()
      .getByRole("button", { name: /^(Stay here|Close)$/ });
    await dismiss
      .first()
      .click({ timeout: 10_000 })
      .catch(() => {});
    await page.waitForTimeout(400);
  }
}

test("job pipeline: build -> approve -> pull -> complete -> close", async ({ page, context }) => {
  // generatePDF() (src/features/jobs/pdfGenerator.js) opens a real popup window
  // as part of completing a job. Whether Chromium treats the click as a
  // trusted user gesture or blocks it can vary by environment; either way, a
  // window this test didn't ask to keep shouldn't linger.
  context.on("page", (p) => p.close().catch(() => {}));

  // ── Login ──────────────────────────────────────────────────────────────
  await page.goto("/login");
  await page.getByLabel("Email").fill(state.adminEmail);
  await page.getByLabel("Password").fill(state.adminPassword);
  await page.getByRole("button", { name: "Sign In →" }).click();
  await page.waitForURL(/\/dashboard/);

  // ── Build (saved as a draft, approved as its own step below) ────────────
  await page.goto("/buildjobs");
  await page.getByRole("button", { name: "+ New Job" }).click();

  await expect(page.getByText("New Job — Step 1 of 3")).toBeVisible();
  const po = `E2E-${Date.now()}`;
  await page.getByLabel("Job PO Number *").fill(po);
  await page.getByLabel("Job Name *").fill("ZZ E2E Test Job");
  await page.getByLabel("Job Address *").fill("1 Test Way, Toledo, OH");
  await page.getByRole("button", { name: "Continue →" }).click();

  await expect(page.getByText("New Job — Step 2 of 3")).toBeVisible();
  await page.getByPlaceholder("Search inventory...").fill(state.itemName);
  await page.getByRole("button", { name: "+ Add" }).click();
  await page.getByRole("button", { name: "Continue →" }).click();

  await expect(page.getByText("New Job — Step 3 of 3")).toBeVisible();
  await page.getByLabel("Job Notes / Description *").fill("Created by the E2E pipeline test.");
  await page.getByRole("button", { name: "Save Draft" }).click();
  await closeAnyOverlay(page);

  // ── Approve ───────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Approve & Assign →" }).click();
  await expect(page.getByText(`Approve: ZZ E2E Test Job`)).toBeVisible();
  await page
    .getByLabel("Assign to Site Supervisor *")
    .selectOption({ label: state.supervisorName });
  await page.getByRole("button", { name: "Approve & Notify" }).click();
  await expect(page.getByRole("button", { name: "Approve & Assign →" })).toHaveCount(0);

  // ── Pull ──────────────────────────────────────────────────────────────
  await page.goto("/pull");
  await page.getByRole("button", { name: "Pull Materials" }).click();
  await expect(page.getByText(`Pull Materials — ZZ E2E Test Job`)).toBeVisible();
  // Seeded stock (100) comfortably covers the planned qty (1) added in Build,
  // so the default row values need no editing before confirming.
  await page.getByRole("button", { name: "Confirm Pull from Warehouse" }).click();
  await expect(page.getByRole("button", { name: "Pull Materials" })).toHaveCount(0);
  await closeAnyOverlay(page);

  // ── Complete ──────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Return & Complete" }).click();
  await expect(page.getByText(`Return Unused — ZZ E2E Test Job`)).toBeVisible();
  await page.getByRole("button", { name: "Complete Job & Generate PDF" }).click();

  // If the report popup got blocked, a themed alertdialog asks whether to
  // complete anyway; if it opened fine, completion just proceeds. Handle both
  // without failing on whichever one didn't happen.
  const popupBlocked = page.getByRole("alertdialog").filter({ hasText: "The report did not open" });
  if (await popupBlocked.isVisible({ timeout: 5000 }).catch(() => false)) {
    await popupBlocked.getByRole("button", { name: "Complete anyway" }).click();
  }
  await expect(page.getByRole("button", { name: "Return & Complete" })).toHaveCount(0);
  await closeAnyOverlay(page);

  // ── Close ─────────────────────────────────────────────────────────────
  // Completed jobs are only actionable from Build Jobs, not Pull Inventory.
  await page.goto("/buildjobs");
  await page.getByRole("button", { name: "Completed" }).click();
  await expect(page.getByText("ZZ E2E Test Job")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const closeConfirm = page.getByRole("alertdialog").filter({ hasText: "Close this job?" });
  await expect(closeConfirm).toBeVisible();
  await closeConfirm.getByRole("button", { name: "File report and close" }).click();

  // Final state: the job has left "Completed" and shows up as Closed. (Not
  // `exact` — the pill's accessible name includes a count badge, e.g. "Closed 1".)
  // `.first()` — the close handoff card can still be on screen naming the same
  // job a second time, which would otherwise make this a strict-mode violation.
  await page.getByRole("button", { name: "Closed" }).click();
  await expect(page.getByText("ZZ E2E Test Job").first()).toBeVisible();
});
