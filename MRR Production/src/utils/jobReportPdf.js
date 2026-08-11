// src/utils/jobReportPdf.js
//
// The job completion report as a real PDF file, for uploading to AccuLynx.
//
// generatePDF() in pdfGenerator.js renders the same report as HTML in a popup and
// waits for a human to hit "Save as PDF" — there is no file, and a browser print
// dialog can't be driven from code. AccuLynx's document endpoint wants actual bytes,
// so this renders the report a second way. Both renderers read buildJobReportModel(),
// so the arithmetic is shared: only the drawing differs.

import { buildJobReportModel } from './pdfGenerator';

const NAVY = [14, 45, 107];
const AMBER = [245, 168, 0];
const GREEN = [22, 163, 74];
const BLUE = [27, 82, 184];
const SLATE = [100, 116, 139];
const MIST = [148, 163, 184];
const CAT_BG = [238, 242, 250];
const ROW_BG = [241, 245, 249];
const WHITE = [255, 255, 255];

const fp = (n) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// AccuLynx strips spaces and special characters from uploaded file names. Doing it
// here means the name we report back to the user is the name that actually lands.
export function pdfFileNameFor(job) {
  const po = String(job?.po || job?.title || job?.name || 'job').replace(/[^A-Za-z0-9]/g, '');
  return `JobReport${po || 'Job'}.pdf`;
}

function drawLogo(doc, activeLogo, x, y) {
  if (!activeLogo || typeof activeLogo !== 'string') return 0;
  const mime = /^data:image\/(png|jpe?g)/i.exec(activeLogo);
  if (!mime) return 0;
  try {
    const fmt = mime[1].toLowerCase().startsWith('jp') ? 'JPEG' : 'PNG';
    const props = doc.getImageProperties(activeLogo);
    // Match the HTML report: 42pt tall (56px), width scaled to the source aspect ratio.
    const h = 42;
    const w = props.width && props.height ? (props.width / props.height) * h : h;
    doc.addImage(activeLogo, fmt, x, y, w, h);
    return h + 6;
  } catch {
    // A corrupt or unsupported logo must not cost the company its invoice upload.
    return 0;
  }
}

/**
 * Render the completion report for `job` as a PDF.
 * Returns { blob, base64, filename } — base64 is the bare payload with no data: prefix.
 */
export async function buildJobReportPdf(job, users, activeLogo, inv = [], company = null) {
  const m = buildJobReportModel(job, users, inv, company);

  // Dynamically imported so jsPDF (~350KB) stays out of the main bundle and only
  // loads for the companies that actually complete a job with AccuLynx upload on.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();
  let y = margin;

  y += drawLogo(doc, activeLogo, margin, y);

  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...NAVY);
  doc.text(String(m.companyName).toUpperCase(), margin, y + 12);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SLATE);
  doc.text('JOB COMPLETION REPORT', margin, y + 26);
  y += 40;

  doc.setDrawColor(...AMBER).setLineWidth(2);
  doc.line(margin, y, pageW - margin, y);
  y += 18;

  const meta = [
    ['JOB NAME', m.jobName],
    ['PO NUMBER', m.po],
    ['ADDRESS', m.addr],
    ['SITE SUPERVISOR', m.supervisor],
    ['DATE COMPLETED', m.completedAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })],
  ];
  if (m.notes) meta.push(['NOTES', m.notes]);

  autoTable(doc, {
    startY: y,
    body: meta,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: { top: 2, bottom: 2, left: 0, right: 0 } },
    columnStyles: {
      0: { cellWidth: 110, fontStyle: 'bold', textColor: SLATE },
      1: { textColor: [26, 32, 44] },
    },
    margin: { left: margin, right: margin },
  });
  y = doc.lastAutoTable.finalY + 22;

  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...NAVY);
  doc.text('MATERIALS USED - PULLED MINUS RETURNED', margin, y);
  y += 8;

  const body = [];
  for (const cat of m.categories) {
    body.push([{
      content: cat.name,
      colSpan: 7,
      styles: { fillColor: CAT_BG, textColor: NAVY, fontStyle: 'bold' },
    }]);
    for (const i of cat.items) {
      body.push([
        i.iname,
        String(parseFloat(i.planned) || 0),
        String(i.pulled),
        String(i.returned),
        { content: String(i.used), styles: { fontStyle: 'bold', textColor: NAVY } },
        '$' + i.unitPrice.toFixed(2),
        { content: '$' + i.total.toFixed(2), styles: { fontStyle: 'bold', textColor: GREEN } },
      ]);
    }
    body.push([
      { content: 'Category Subtotal:', colSpan: 6, styles: { halign: 'right', fontStyle: 'italic', fillColor: ROW_BG } },
      { content: fp(cat.subtotal), styles: { halign: 'right', fontStyle: 'bold', textColor: BLUE, fillColor: ROW_BG } },
    ]);
  }

  const totalRow = (label, value, styles = {}) => ([
    { content: label, colSpan: 6, styles: { halign: 'right', fontStyle: 'bold', fillColor: ROW_BG, ...styles } },
    { content: value, styles: { halign: 'right', fontStyle: 'bold', fillColor: ROW_BG, ...styles } },
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Item', 'Planned', 'Pulled', 'Returned', 'Used', 'Unit Price', 'Total Cost']],
    body,
    foot: [
      totalRow('Materials Subtotal:', fp(m.grandTotal)),
      totalRow(`${m.taxLabel} (${m.taxPct}%):`, fp(m.salesTax)),
      [
        { content: 'TOTAL MATERIAL COST', colSpan: 6, styles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 11 } },
        { content: fp(m.totalWithTax), styles: { fillColor: NAVY, textColor: AMBER, fontStyle: 'bold', fontSize: 13, halign: 'right' } },
      ],
    ],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 5, lineColor: [229, 231, 235], lineWidth: 0.5 },
    headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
    footStyles: { textColor: [26, 32, 44] },
    columnStyles: {
      1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' },
      4: { halign: 'center' }, 5: { halign: 'right' }, 6: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  // The footer credits the PRODUCT, not the tenant — same rule the HTML report follows.
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MIST);
    doc.text(
      `Generated by Steadwerk - ${new Date().toLocaleString()}    Page ${p} of ${pages}`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 24,
      { align: 'center' }
    );
  }

  const blob = doc.output('blob');
  // `datauristring` is "data:application/pdf;filename=…;base64,XXXX" — the payload is
  // everything after the LAST comma, since the filename segment can contain commas.
  const uri = doc.output('datauristring');
  const base64 = uri.slice(uri.lastIndexOf(',') + 1);

  return { blob, base64, filename: pdfFileNameFor(job), model: m };
}
