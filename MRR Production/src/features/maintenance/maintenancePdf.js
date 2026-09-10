// src/features/maintenance/maintenancePdf.js
//
// A completed maintenance ticket, printable as a PDF. Same recipe as
// features/jobs/pdfGenerator.js: render a same-origin popup and let the human
// hit "Save as PDF" — a browser print dialog can't be driven from code, so
// there is no file, only the printable page. That's the same tradeoff the job
// report already makes, and it means no new PDF library for this feature.
//
// The service details (service type, date, performed by, cost, mileage) live
// on the ticket itself as of supabase/37 — complete_maintenance_service()
// writes them onto maintenance_requests in the same transaction that closes
// the ticket. A ticket completed before that migration ran simply has nulls
// there; this renders whatever it finds and omits the rest, it doesn't invent
// data for tickets that predate the column.
import { escapeHtml } from "@/shared/utils/email";

// Job/item fields render into an HTML popup without a framework escaping them,
// so free text entered by crew/shop (notes, performed-by, vehicle name) is
// escaped here the same way pdfGenerator.js escapes job fields.
function fmtDate(value, opts) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", opts);
}

function fmtCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Pure: the numbers/strings behind the report, computed once so a test can
// pin them without opening a popup window.
export function buildMaintenanceReportModel(req, company = null) {
  const companyName = company?.branding?.displayName || company?.name || "Steadwerk";
  const mileage =
    req?.mileage === null || req?.mileage === undefined || req?.mileage === ""
      ? null
      : Number(req.mileage);

  return {
    companyName,
    vehicle: req?.vname || "Unknown Vehicle",
    issueType: req?.type || "General",
    urgency: req?.urgency || "",
    reportedBy: req?.uname || "Unknown",
    filedAt: req?.at || null,
    reportedNotes: req?.notes || "",
    scheduledDate: req?.scheduled_date || req?.scheduledDate || null,
    serviceType: req?.service_type || req?.serviceType || "",
    serviceDate: req?.service_date || req?.serviceDate || null,
    performedBy: req?.performed_by || req?.performedBy || "",
    mileage,
    cost: req?.cost === null || req?.cost === undefined ? null : Number(req.cost),
    resolutionNotes: req?.wh_notes || req?.whNotes || "",
    completedAt: req?.completed_at || req?.completedAt || null,
    photo: req?.photo || null,
  };
}

// AccuLynx-style stripping isn't a concern here (this file never leaves the
// browser), but keeping the saved filename plain avoids surprising OS-level
// escaping of spaces/slashes in whatever vehicle name a crew typed in.
export function pdfFileNameFor(req) {
  const veh = String(req?.vname || "vehicle").replace(/[^A-Za-z0-9]/g, "");
  return `MaintenanceReport${veh || "Vehicle"}.pdf`;
}

const row = (label, value) =>
  value
    ? `<tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">${label}</td><td style="border:none">${value}</td></tr>`
    : "";

/**
 * Open a printable "Save as PDF" popup for one completed maintenance ticket.
 * Returns false (instead of throwing) when the popup was blocked, so the
 * caller can warn the user the same way BuildJobsView does for job reports.
 */
export function generateMaintenancePdf(req, company = null, activeLogo = null) {
  const m = buildMaintenanceReportModel(req, company);

  const logoHtml = activeLogo
    ? `<img src="${activeLogo}" style="height:56px;object-fit:contain;display:block;margin-bottom:4px"/>`
    : `<div style="width:50px;height:50px;background:#F5A800;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:4px">🔧</div>`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Maintenance Report — ${escapeHtml(m.vehicle)}</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#1A202C}
        table{width:100%;border-collapse:collapse}
        td{font-size:13px}
        @media print{.no-print{display:none}}
      </style>
    </head>
    <body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
        <div>
          ${logoHtml}
          <div style="font-size:20px;font-weight:900;color:#0E2D6B">${escapeHtml(m.companyName.toUpperCase())}</div>
          <div style="font-size:12px;color:#64748B;letter-spacing:1px">MAINTENANCE SERVICE REPORT</div>
        </div>
        <button id="mrr-print-btn" class="no-print" style="padding:10px 20px;background:#F5A800;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px">🖨️ Save as PDF</button>
      </div>
      <hr style="border:2px solid #F5A800;margin-bottom:24px">

      <table style="margin-top:0;width:auto;min-width:400px">
        ${row("Vehicle", escapeHtml(m.vehicle))}
        ${row("Reported Issue", escapeHtml(m.issueType))}
        ${row("Urgency", escapeHtml(m.urgency))}
        ${row("Reported By", escapeHtml(m.reportedBy))}
        ${row("Filed On", fmtDate(m.filedAt, { year: "numeric", month: "long", day: "numeric" }))}
        ${row("Scheduled For", fmtDate(m.scheduledDate, { year: "numeric", month: "long", day: "numeric" }))}
      </table>

      ${
        m.reportedNotes
          ? `<h3 style="margin:24px 0 4px;color:#0E2D6B;font-size:14px;text-transform:uppercase;letter-spacing:.5px">Reported Issue</h3>
             <p style="font-style:italic;margin:0">"${escapeHtml(m.reportedNotes)}"</p>`
          : ""
      }

      <h3 style="margin:24px 0 4px;color:#0E2D6B;font-size:14px;text-transform:uppercase;letter-spacing:.5px">Service Performed</h3>
      <table style="margin-top:0;width:auto;min-width:400px">
        ${row("Service Type", escapeHtml(m.serviceType) || "—")}
        ${row("Service Date", fmtDate(m.serviceDate, { year: "numeric", month: "long", day: "numeric" }) || "—")}
        ${row("Performed By", escapeHtml(m.performedBy) || "—")}
        ${row("Odometer", m.mileage !== null ? `${m.mileage.toLocaleString()} mi` : "")}
        ${row("Cost", m.cost !== null ? fmtCost(m.cost) : "")}
      </table>

      ${
        m.resolutionNotes
          ? `<h3 style="margin:24px 0 4px;color:#0E2D6B;font-size:14px;text-transform:uppercase;letter-spacing:.5px">Resolution Notes</h3>
             <p style="margin:0">${escapeHtml(m.resolutionNotes)}</p>`
          : ""
      }

      ${
        m.photo
          ? `<h3 style="margin:24px 0 8px;color:#0E2D6B;font-size:14px;text-transform:uppercase;letter-spacing:.5px">Photo</h3>
             <img src="${m.photo}" style="max-width:100%;max-height:360px;object-fit:contain;border:1px solid #E5E7EB;border-radius:8px"/>`
          : ""
      }

      <p style="margin-top:40px;font-size:11px;color:#94A3B8;text-align:center;border-top:1px solid #E5E7EB;padding-top:16px">
        Completed ${fmtDate(m.completedAt, { year: "numeric", month: "long", day: "numeric" })} · Generated by Steadwerk · ${new Date().toLocaleString()}
      </p>
    </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=900,height=750");
  if (!win) return false; // popup blocked — let the caller warn the user

  win.document.write(html);
  win.document.close();
  // Same CSP note as pdfGenerator.js: inline onclick is blocked, bind from here.
  win.document.getElementById("mrr-print-btn")?.addEventListener("click", () => win.print());
  return true;
}
