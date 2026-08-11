// src/utils/jobReport.js
//
// One entry point for "produce the job report", used by every PDF button in the app
// and by job completion. Before this, generatePDF() was called from five places and
// the AccuLynx upload was wired into exactly one of them, so a report regenerated
// from the Completed list never reached the CRM and had to be filed by hand.

import { generatePDF } from "./pdfGenerator";
import { uploadJobReportToAccuLynx } from "./accuLynxSync";

/**
 * Open the printable report AND file it on the AccuLynx job.
 *
 * The two halves are deliberately independent: a blocked popup still uploads, and a
 * failed upload still leaves the user with a report on screen. Returns whether the
 * popup opened, so callers keep their existing "popup blocked" warning.
 */
export function openJobReport({
  job, users, activeLogo, inv, company, acculynxConfig,
  showToast, t, popupBlockedMsg, setJobs,
}) {
  const opened = generatePDF(job, users, activeLogo, inv, company);
  if (!opened && popupBlockedMsg) showToast(popupBlockedMsg, "warning");

  if (acculynxConfig?.uploadReport) {
    uploadJobReportToAccuLynx({ job, users, activeLogo, inv, company, config: acculynxConfig })
      .then((r) => {
        if (r.ok) {
          showToast(t.pullReportUploaded, "success");
          // Mirror the row the upload just persisted into local state so the
          // "Report Filed" badge appears now rather than on the next page load.
          if (typeof setJobs === "function") {
            setJobs((p) => p.map((j) => (j.id === job.id
              ? { ...j, report_uploaded_at: r.uploadedAt, report_file_name: r.filename }
              : j)));
          }
        } else if (!r.skipped) {
          // Name the part that failed. The job itself is complete and the cost sync
          // may well have landed, so "upload failed" must not read as "job failed".
          showToast(`${t.pullReportUploadFail} ${r.error}`, "warning");
        }
      });
  }

  return opened;
}
