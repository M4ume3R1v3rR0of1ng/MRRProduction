// e2e/helpers.js
//
// The few things every spec needs: the seeded state global-setup.js wrote, a
// way to sign in through the real login form, and a service-role client for the
// handful of checks the UI can't show (e.g. what an RPC wrote to a row this
// screen never renders). Assertions still go through the browser wherever the
// app actually displays the result — the service-role client is for proving
// what landed in the database, not for driving the flow.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { STATE_FILE } from "./global-setup.js";
import { loadSupabaseEnv } from "./env.js";

export const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

export function serviceClient() {
  const { url, serviceKey } = loadSupabaseEnv();
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// Fills and submits the password form, and stops there: for an account with a
// verified factor the next screen is the code prompt, not the dashboard.
export async function submitPassword(page, email, password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In →" }).click();
}

export async function login(page, email, password) {
  await submitPassword(page, email, password);
  await page.waitForURL(/\/dashboard/);
}
