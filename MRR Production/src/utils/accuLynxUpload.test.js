// Sync Upload does one thing: file the completion report PDF on the AccuLynx job.
//
// It used to also post the material cost as an Additional Job Expense. That is gone
// — the PDF already carries the itemised breakdown, and the expense was a second,
// lossier copy that had to survive a 250-character notes field and a create that
// could not be safely retried.
//
// The rule these pin: exactly one HTTP request per upload, and the outcome is
// always written down. Uploading a document is a create, so a retry files a SECOND
// copy — AccuLynx has no replace-document call.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getAccessToken = vi.fn(async () => "tok");
const updateRowStrict = vi.fn(async () => ({ error: null }));
vi.mock("./supabase", () => ({
  supabase: {},
  getAccessToken: (...a) => getAccessToken(...a),
  updateRowStrict: (...a) => updateRowStrict(...a),
}));

// jsPDF is heavy and irrelevant here — the upload path only needs bytes and a name.
vi.mock("./jobReportPdf", () => ({
  buildJobReportPdf: vi.fn(async () => ({ base64: "JVBERi0=", filename: "JobReportPO1.pdf" })),
}));

const { syncJobReportToAccuLynx } = await import("./accuLynxSync");

const job = { id: "j1", po: "22450", name: "Test", acculynx_job_id: "ax-1" };
const config = { enabled: true, proxyUrl: "https://example.test/sync", apiKey: "k" };
const okJson = (body) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  vi.restoreAllMocks();
  updateRowStrict.mockClear().mockResolvedValue({ error: null });
  getAccessToken.mockClear().mockResolvedValue("tok");
});

describe("syncJobReportToAccuLynx", () => {
  it("sends only the document upload, never a cost expense", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true, message: "filed" }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await syncJobReportToAccuLynx({ job, config });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe("uploadDocument");
    expect(r.ok).toBe(true);
  });

  it("does not retry, because a second attempt files a second copy", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await syncJobReportToAccuLynx({ job, config });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records the filing so the badge survives a reload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ ok: true, message: "filed" })));
    const setJobs = vi.fn();

    await syncJobReportToAccuLynx({ job, config, setJobs });

    const [table, id, fields] = updateRowStrict.mock.calls[0];
    expect(table).toBe("jobs");
    expect(id).toBe("j1");
    expect(fields.syncStatus).toBe("synced");
    expect(fields.report_uploaded_at).toBeTruthy();
    expect(fields.report_file_name).toBe("JobReportPO1.pdf");

    const applied = setJobs.mock.calls.at(-1)[0]([{ id: "j1" }, { id: "j2" }]);
    expect(applied[0].report_uploaded_at).toBeTruthy();
    expect(applied[1].report_uploaded_at).toBeUndefined();
  });

  it("records a failure with the reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "HTTP 404 no job" }), { status: 404 })));

    const r = await syncJobReportToAccuLynx({ job, config });

    expect(r.ok).toBe(false);
    const [, , fields] = updateRowStrict.mock.calls[0];
    expect(fields.syncStatus).toBe("failed");
    expect(fields.syncNote).toMatch(/no job/);
    // A failure must not claim the report was filed.
    expect(fields.report_uploaded_at).toBeUndefined();
  });

  it("marks an unconfigured company as manual without calling out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await syncJobReportToAccuLynx({ job, config: { enabled: false } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.skipped).toBe(true);
    expect(updateRowStrict.mock.calls[0][2].syncStatus).toBe("manual");
  });

  it("names the session, not AccuLynx, when the token has gone", async () => {
    getAccessToken.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await syncJobReportToAccuLynx({ job, config });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.error).toMatch(/session expired/i);
  });
});
