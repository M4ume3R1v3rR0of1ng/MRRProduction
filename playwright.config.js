// playwright.config.js
//
// Chromium only, on purpose, for this first E2E pass — see the README known-
// gaps entry. Firefox/WebKit can be added later if the single flagship flow
// this covers earns a wider matrix; for now every extra browser is CI minutes
// spent on a real Supabase round-trip with no evidence it's needed.
//
// webServer builds the real production bundle and serves it with `vite
// preview` rather than the dev server — the same command Netlify runs, so a
// green E2E run here means the thing that actually ships works, not just the
// dev-mode build. This flow needs no Netlify Function (build/approve/pull/
// complete/close are plain Supabase writes, see e2e/job-pipeline.spec.js), so
// there's no `netlify dev` proxy layer to stand up.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.js",
  globalTeardown: "./e2e/global-teardown.js",
  // One disposable tenant, seeded once for the whole run — parallel workers
  // would mean concurrent tests fighting over the same seeded job/company.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
