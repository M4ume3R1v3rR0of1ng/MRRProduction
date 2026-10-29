// e2e/delegated-user-management.spec.js
//
// The delegate: a non-admin who holds users_manage and settings_manage, which an
// admin can grant to any role from Settings → Permissions.
//
// supabase/62 and 63 exist because granting those two used to give nothing away.
// The UI opened on the permission and the server tested for the literal role
// 'admin', so the toggle looked live and the screen behind it did not work. The
// audit log was the worst of them: RLS filters rather than raises, so the
// delegate reached the page their own sidebar offered and saw an EMPTY LIST —
// "nothing has ever happened here" rather than "you cannot see this".
//
// That is the failure this spec is for, and it is exactly the failure a unit test
// cannot see. SettingsView.test.jsx can prove which tabs render against a fake
// database; only a real session can prove that a policy lets the rows through.
//
// WHY THIS ONE CAN SKIP ITSELF
//
// It asserts behaviour that only exists once 62 and 63 have been applied to the
// database the run points at. global-setup probes that with a real delegate
// session and records the row count it got; zero means RLS filtered the seeded
// row and the migrations are not there. Skipping then, by name and with the file
// to run, is the honest outcome — the same treatment global-setup already gives
// a project with TOTP turned off. A hard failure here would report a missing
// migration as a broken build.
import { test, expect } from "@playwright/test";
import { state, login } from "./helpers.js";

const SEEDED_DESCRIPTION = "Seeded audit row for the delegated-read spec";

test.describe("delegated user management", () => {
  test.beforeEach(() => {
    if (state.delegateSetupError) {
      test.skip(true, `delegate probe failed in global-setup: ${state.delegateSetupError}`);
    }
    if (state.delegateAuditRows === 0) {
      test.skip(
        true,
        "a users_manage holder read 0 audit rows in global-setup, so RLS is still " +
          "admin-only — run supabase/62 and supabase/63 against this database",
      );
    }
  });

  test("a users_manage holder sees the audit log their nav offers", async ({ page }) => {
    await login(page, state.delegateEmail, state.delegatePassword);
    await page.goto("/logs");

    // The row seeded before anyone signed in. Finding it proves the SELECT policy
    // admits users_manage; its absence is the silent-empty bug 63 fixed.
    await expect(page.getByText(SEEDED_DESCRIPTION)).toBeVisible();

    // And the empty state is NOT what they get, which is the thing that read as
    // "this company has no history".
    await expect(page.getByText(/No matching historical logs found/i)).toHaveCount(0);
  });

  test("the delegate gets Settings without the two admin-only tabs", async ({ page }) => {
    await login(page, state.delegateEmail, state.delegatePassword);
    await page.goto("/settings");

    // Branding is the tab 63 handed over, so it has to be there and has to work.
    await expect(page.getByRole("tab", { name: "Branding" })).toBeVisible();

    // Permissions and CRM stay admin-only on the server. They are hidden rather
    // than shown-and-failing, which is the state this pair of migrations exists
    // to stop: a tab that saves nothing.
    await expect(page.getByRole("tab", { name: "Permissions" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "CRM Integration" })).toHaveCount(0);
  });

  test("an ordinary member is turned away from the audit log entirely", async ({ page }) => {
    // The other half of 63: widening the policy to users_manage must not widen it
    // to everybody. The driver is an employee with no grant, so /logs bounces them.
    //
    // This asserts the ROUTE GATE, not RLS, and the distinction matters: App.jsx
    // redirects before AuditLogView ever queries, so "the seeded row is not on
    // screen" would pass here even if the policy let the whole table through.
    // The RLS half is what global-setup probes with a real delegate session.
    await login(page, state.driverEmail, state.driverPassword);
    await page.goto("/logs");

    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByText(SEEDED_DESCRIPTION)).toHaveCount(0);
  });
});
