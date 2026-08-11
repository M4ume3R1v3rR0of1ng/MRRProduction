// openJobReport is the single place "make the job report" happens. The upload used to
// be wired into job completion only, so a report regenerated from the Completed list
// never reached AccuLynx and the office re-filed it by hand. These pin the two rules
// that matter: the upload follows the toggle, and it does not depend on the popup.
import { describe, it, expect, vi, beforeEach } from "vitest";

const generatePDF = vi.fn(() => true);
const uploadJobReportToAccuLynx = vi.fn(async () => ({ ok: true }));

vi.mock("./pdfGenerator", () => ({ generatePDF: (...a) => generatePDF(...a) }));
vi.mock("./accuLynxSync", () => ({
  uploadJobReportToAccuLynx: (...a) => uploadJobReportToAccuLynx(...a),
}));

const { openJobReport } = await import("./jobReport");

const t = { pullReportUploaded: "filed ok", pullReportUploadFail: "upload failed:" };
const base = () => ({
  job: { id: "j1", po: "PO-1" },
  users: [], activeLogo: null, inv: [], company: null,
  showToast: vi.fn(), t, popupBlockedMsg: "popup blocked",
});

beforeEach(() => {
  generatePDF.mockClear().mockReturnValue(true);
  uploadJobReportToAccuLynx.mockClear().mockResolvedValue({ ok: true });
});

describe("openJobReport", () => {
  it("does not touch AccuLynx when the upload toggle is off", () => {
    openJobReport({ ...base(), acculynxConfig: { enabled: true, uploadReport: false } });
    expect(generatePDF).toHaveBeenCalledOnce();
    expect(uploadJobReportToAccuLynx).not.toHaveBeenCalled();
  });

  it("uploads whenever the report is generated, not only on completion", () => {
    openJobReport({ ...base(), acculynxConfig: { enabled: true, uploadReport: true } });
    expect(uploadJobReportToAccuLynx).toHaveBeenCalledOnce();
  });

  it("marks the job as filed in local state so the badge shows without a reload", async () => {
    uploadJobReportToAccuLynx.mockResolvedValue({
      ok: true, uploadedAt: "2026-08-11T12:00:00.000Z", filename: "JobReportPO1.pdf",
    });
    const setJobs = vi.fn();
    openJobReport({ ...base(), acculynxConfig: { enabled: true, uploadReport: true }, setJobs });
    await vi.waitFor(() => expect(setJobs).toHaveBeenCalledOnce());

    const updated = setJobs.mock.calls[0][0]([{ id: "j1", po: "PO-1" }, { id: "j2" }]);
    expect(updated[0].report_uploaded_at).toBe("2026-08-11T12:00:00.000Z");
    expect(updated[0].report_file_name).toBe("JobReportPO1.pdf");
    // Only the job that was uploaded, never its neighbours.
    expect(updated[1].report_uploaded_at).toBeUndefined();
  });

  it("does not mark the job filed when the upload failed", async () => {
    uploadJobReportToAccuLynx.mockResolvedValue({ ok: false, error: "HTTP 500" });
    const setJobs = vi.fn();
    const args = base();
    openJobReport({ ...args, acculynxConfig: { enabled: true, uploadReport: true }, setJobs });
    await vi.waitFor(() => expect(args.showToast).toHaveBeenCalled());
    expect(setJobs).not.toHaveBeenCalled();
  });

  it("still uploads when the popup is blocked", () => {
    generatePDF.mockReturnValue(false);
    const args = base();
    const opened = openJobReport({ ...args, acculynxConfig: { enabled: true, uploadReport: true } });
    expect(opened).toBe(false);
    expect(args.showToast).toHaveBeenCalledWith("popup blocked", "warning");
    // The blocked popup is the user's problem to fix; AccuLynx should get the file
    // either way, which is the whole point of rendering the PDF ourselves.
    expect(uploadJobReportToAccuLynx).toHaveBeenCalledOnce();
  });

  it("reports an upload failure as the upload failing, not the job", async () => {
    uploadJobReportToAccuLynx.mockResolvedValue({ ok: false, error: "HTTP 404" });
    const args = base();
    openJobReport({ ...args, acculynxConfig: { enabled: true, uploadReport: true } });
    await vi.waitFor(() =>
      expect(args.showToast).toHaveBeenCalledWith("upload failed: HTTP 404", "warning")
    );
  });

  it("stays quiet when the upload is skipped for want of configuration", async () => {
    uploadJobReportToAccuLynx.mockResolvedValue({ ok: false, skipped: true, error: "not configured" });
    const args = base();
    openJobReport({ ...args, acculynxConfig: { enabled: true, uploadReport: true } });
    await new Promise((r) => setTimeout(r, 0));
    expect(args.showToast).not.toHaveBeenCalled();
  });
});
