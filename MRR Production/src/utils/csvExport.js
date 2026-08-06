// src/utils/csvExport.js
//
// One CSV writer for the whole app.
//
// There were three before this: downloadCSV here (imported by nobody),
// triggerNativeDownload in ReportsView, and exportCsv in InventoryCountTab. Two
// of the three wrapped every field in quotes and escaped nothing, which is not a
// style difference — it is a correctness bug, and this catalog already trips it.
//
// The item "9\" Roller Covers" is real, live inventory. Hand-wrapping it produces
//
//     "9" Roller Covers"
//
// which every CSV parser reads as the field `9`, followed by junk. The row's
// columns shift left from that point on, so the export silently reports the wrong
// price against the wrong material. Any job name with an inch mark, a comma, or a
// quoted nickname does the same thing.
//
// RFC 4180: quote a field only when it contains a quote, a comma or a newline,
// and escape an embedded quote by doubling it.

export const escapeCsvCell = (value) => {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Rows are arrays of RAW values. Callers must not pre-quote: doing so is what
// produced the bug above, and this would then escape their quotes as literal
// characters, making it visibly worse rather than silently wrong.
export const toCsv = (headers, rows) =>
  [headers, ...rows]
    .map((row) => (row || []).map(escapeCsvCell).join(","))
    .join("\r\n"); // CRLF per RFC 4180; Excel is the destination for most of these

// The leading BOM is for Excel specifically. Without it Excel decodes UTF-8 as
// the local ANSI codepage, so a Spanish item name or an accented supplier comes
// out mojibake ("Jos√©"). Every other consumer tolerates it.
export const downloadCSV = (filename, headers, rows) => {
  const blob = new Blob(["﻿" + toCsv(headers, rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // The old ReportsView copy never revoked, so every export leaked the whole
  // file until the tab was closed.
  URL.revokeObjectURL(url);
};
