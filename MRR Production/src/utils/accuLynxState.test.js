// The sync columns on public.jobs are the quoted camelCase ones that predate the
// migration files. BuildJobsView inserts them as null/"" on every new job, so the
// accessors have to read "never attempted" out of BOTH null and empty string — and
// must never invent a status, since "no attempt" vs "misconfigured" is exactly the
// distinction whose collapse made the modal lie. See supabase/28.
import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {}, updateRowStrict: vi.fn(), getAccessToken: vi.fn() }));

const { syncStatusOf, syncNoteOf, syncedAtOf, reportUploadedAtOf } = await import("./accuLynxSync");

describe("sync state accessors", () => {
  it("reads the columns a reloaded job carries", () => {
    const job = {
      syncStatus: "synced",
      syncedAt: "2026-08-11T12:00:00.000Z",
      syncNote: "Cost recorded",
      report_uploaded_at: "2026-08-11T12:05:00.000Z",
    };
    expect(syncStatusOf(job)).toBe("synced");
    expect(syncedAtOf(job)).toBe("2026-08-11T12:00:00.000Z");
    expect(syncNoteOf(job)).toBe("Cost recorded");
    expect(reportUploadedAtOf(job)).toBe("2026-08-11T12:05:00.000Z");
  });

  it("treats a freshly built job as never attempted, not as misconfigured", () => {
    // Exactly what BuildJobsView inserts. If this ever returned a status, the modal
    // would go back to claiming AccuLynx is not set up on brand new jobs.
    const fresh = { syncStatus: null, syncedAt: "", syncNote: "", syncPayload: null };
    expect(syncStatusOf(fresh)).toBeNull();
    expect(syncedAtOf(fresh)).toBe("");
    expect(syncNoteOf(fresh)).toBe("");
    expect(reportUploadedAtOf(fresh)).toBeNull();
  });

  it("returns null rather than throwing on a missing job", () => {
    expect(syncStatusOf({ id: "j1" })).toBeNull();
    expect(reportUploadedAtOf({ id: "j1" })).toBeNull();
    expect(syncStatusOf(null)).toBeNull();
    expect(syncStatusOf(undefined)).toBeNull();
  });

  it("reads each of the three real statuses", () => {
    for (const s of ["synced", "failed", "manual"]) {
      expect(syncStatusOf({ syncStatus: s })).toBe(s);
    }
  });
});
