// Runs before every test file. Registered as `setupFiles` in vite.config.js.
//
// WHY THIS EXISTS
//
// src/utils/supabase.js THROWS at module load when VITE_SUPABASE_URL or
// VITE_SUPABASE_ANON_KEY are missing. That is correct and deliberate for the
// real app: a misconfigured deploy should fail immediately and loudly rather
// than serve a portal whose every query silently returns nothing.
//
// But it also means any test that transitively imports it explodes on import,
// before a single assertion runs. Nine suites do, mostly by way of
// utils/helpers.js or a view component:
//
//   dates, palette, schedule, views.render, fleetModals,
//   inventoryModals, BulkReceiveModal, JobTemplatesModal, EditJobModal
//
// Locally those suites passed, which is the dangerous part. They were not
// hermetic; they were quietly reading the .env file on disk, which Vite loads
// into import.meta.env for the test run. .env is gitignored, so it does not
// exist on a fresh clone, and the suite failed the first time it ran anywhere
// other than a developer machine — a GitHub macOS runner, in this case.
//
// The values below are deliberate nonsense. Nothing here talks to Supabase: the
// suites are pure logic, and the only thing they need is for the module to
// finish importing. A test that genuinely wants a client stubs its own.
//
// Do NOT "fix" this by adding real credentials to CI. That would make the test
// run depend on a live project and hand every fork's CI a working anon key, to
// no benefit — the tests would not exercise it either way.
import { vi } from "vitest";

vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
