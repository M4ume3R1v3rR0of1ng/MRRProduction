// e2e/mfa-login.spec.js
//
// Signing in to an account with a verified TOTP factor (enrolled by
// global-setup.js). supabase.auth.signInWithPassword hands back a live aal1
// session even for these accounts, so LoginScreen.jsx's gateOnMfa is the only
// thing between "password accepted" and "you're in" — these tests prove it holds
// that line in a real browser: the code prompt appears (and survives a reload),
// backing out of it ends
// the session rather than leaving the aal1 one in place, a wrong code is refused,
// and the right one lands on the dashboard with a session upgraded to aal2 (the
// level supabase/29_mfa_enforcement.sql checks).
import { test, expect } from "@playwright/test";
import { state, submitPassword } from "./helpers.js";
import { totpCode, totpStep, waitForStepAfter } from "./totp.js";

const PROMPT = "Enter the 6-digit code from your authenticator app.";

// Fail (not skip) when setup couldn't enrol the factor: a project that refuses
// TOTP enrolment also breaks Profile → Two-Factor Authentication for real users,
// and that shouldn't pass quietly.
test.beforeEach(() => {
  if (state.mfaSetupError) {
    throw new Error(`global-setup could not enrol a TOTP factor: ${state.mfaSetupError}`);
  }
});

// The access token's assurance level, read from supabase-js's own storage
// (the default `sb-<project-ref>-auth-token` localStorage key).
async function sessionAal(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
    if (!key) return null;
    const token = JSON.parse(localStorage.getItem(key))?.access_token;
    if (!token) return null;
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).aal;
  });
}

test("MFA login: the code prompt stops sign-in, and cancelling it signs out", async ({ page }) => {
  await submitPassword(page, state.mfaEmail, state.mfaPassword);

  await expect(page.getByText(PROMPT)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // The aal1 session is already in storage at this point. Reloading (or going
  // straight to a portal page) must bring the prompt back, not restore the app
  // from that session — useAppData used to do exactly that.
  await page.goto("/dashboard");
  await expect(page.getByText(PROMPT)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Sign In →" })).toBeVisible();
  // cancelMfa hides the prompt before its signOut() resolves, so wait for it.
  await expect.poll(() => sessionAal(page)).toBeNull();

  // Nothing to fall back into: the protected app sends this browser to login.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign In →" })).toBeVisible();
});

test("MFA login: a wrong code is refused, the right one reaches the dashboard at aal2", async ({
  page,
}) => {
  // Up to one 30-second TOTP window may be spent waiting below, on top of the
  // config's per-test ceiling.
  test.setTimeout(180_000);

  await submitPassword(page, state.mfaEmail, state.mfaPassword);
  await expect(page.getByText(PROMPT)).toBeVisible();
  const codeField = page.getByLabel("6-digit code");
  const verify = page.getByRole("button", { name: "Verify" });

  // Any code but the one currently valid.
  const valid = totpCode(state.mfaSecret, totpStep());
  const wrong = String((Number(valid) + 500_000) % 1_000_000).padStart(6, "0");
  await codeField.fill(wrong);
  await verify.click();

  // Refused: the field is cleared for another try and nothing moves on.
  await expect(codeField).toHaveValue("");
  await expect(page.getByText(PROMPT)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect(await sessionAal(page)).toBe("aal1");

  // Never answer with the code enrolment already spent.
  await waitForStepAfter(state.mfaEnrolledStep);
  await codeField.fill(totpCode(state.mfaSecret));
  await verify.click();

  await page.waitForURL(/\/dashboard/);
  expect(await sessionAal(page)).toBe("aal2");
});
