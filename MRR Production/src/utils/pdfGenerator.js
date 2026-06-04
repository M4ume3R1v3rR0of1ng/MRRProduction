// src/utils/pdfGenerator.js

import { fd, fm } from './helpers';

export function generatePDF(job, users, activeLogo) {
  const sup = users.find(u => u.id === job.assignedTo);
  const cats = {};
  
  // Group pulled materials by their categories dynamically
  job.items.forEach(item => {
    const used = item.pulled - item.returned;
    const total = used * item.priceAtPull;
    if (!cats[item.icat]) cats[item.icat] = [];
    cats[item.icat].push({ ...item, used, total });
  });
  
  const grandTotal = Object.values(cats).flat().reduce((s, i) => s + i.total, 0);
  const fp = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  const catRows = Object.entries(cats).map(([cat, items]) => {
    const catTotal = items.reduce((s, i) => s + i.total, 0);
    return `
      <tr style="background:#EEF2FA">
        <td colspan="7" style="padding:8px 14px;font-weight:900;color:#0E2D6B">${cat}</td>
      </tr>
      ${items.map(i => `
        <tr>
          <td style="padding:7px 14px">${i.iname}</td>
          <td style="padding:7px 14px;text-align:center">${i.planned}</td>
          <td style="padding:7px 14px;text-align:center">${i.pulled}</td>
          <td style="padding:7px 14px;text-align:center">${i.returned}</td>
          <td style="padding:7px 14px;text-align:center;font-weight:700;color:#0E2D6B">${i.used}</td>
          <td style="padding:7px 14px;text-align:right">$${i.priceAtPull.toFixed(2)}</td>
          <td style="padding:7px 14px;text-align:right;font-weight:700;color:#16A34A">$${i.total.toFixed(2)}</td>
        </tr>
      `).join('')}
      <tr style="background:#F1F5F9">
        <td colspan="6" style="padding:7px 14px;font-weight:700;text-align:right;font-style:italic">Category Subtotal:</td>
        <td style="padding:7px 14px;text-align:right;font-weight:900;color:#1B52B8">${fp(catTotal)}</td>
      </tr>
    `;
  }).join('');
  
  const logoHtml = activeLogo 
    ? `<img src="${activeLogo}" style="height:56px;object-fit:contain;display:block;margin-bottom:4px"/>` 
    : `<div style="width:50px;height:50px;background:#F5A800;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:4px">🏠</div>`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Job Report — ${job.po}</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#1A202C}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        th{background:#0E2D6B;color:#fff;padding:10px 14px;text-align:left;font-size:12px;letter-spacing:.5px;text-transform:uppercase}
        td{border-bottom:1px solid #E5E7EB;font-size:13px}
        @media print{.no-print{display:none}}
      </style>
    </head>
    <body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
        <div>
          ${logoHtml}
          <div style="font-size:20px;font-weight:900;color:#0E2D6B">MAUMEE RIVER ROOFING</div>
          <div style="font-size:12px;color:#64748B;letter-spacing:1px">JOB COMPLETION REPORT</div>
        </div>
        <button class="no-print" onclick="window.print()" style="padding:10px 20px;background:#F5A800;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px">🖨️ Save as PDF</button>
      </div>
      <hr style="border:2px solid #F5A800;margin-bottom:24px">
      <table style="margin-top:0;width:auto;min-width:400px">
        <tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">Job Name</td><td style="border:none;font-weight:700;font-size:14px">${job.name}</td></tr>
        <tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">PO Number</td><td style="border:none">${job.po}</td></tr>
        <tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">Address</td><td style="border:none">${job.addr}</td></tr>
        <tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">Site Supervisor</td><td style="border:none">${sup ? sup.name : 'N/A'}</td></tr>
        <tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">Date Completed</td><td style="border:none">${new Date(job.completedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
        ${job.notes ? `<tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">Notes</td><td style="border:none">${job.notes}</td></tr>` : ''}
      </table>
      <h3 style="margin:28px 0 4px;color:#0E2D6B;font-size:14px;text-transform:uppercase;letter-spacing:.5px">Materials Used — Pulled minus Returned</h3>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th style="text-align:center">Planned</th>
            <th style="text-align:center">Pulled</th>
            <th style="text-align:center">Returned</th>
            <th style="text-align:center">Used</th>
            <th style="text-align:right">Unit Price</th>
            <th style="text-align:right">Total Cost</th>
          </tr>
        </thead>
        <tbody>
          ${catRows}
        </tbody>
        <tfoot>
          <tr style="background:#0E2D6B">
            <td colspan="6" style="padding:14px;font-weight:900;font-size:15px;color:#fff;letter-spacing:.5px;border:none">TOTAL MATERIAL COST</td>
            <td style="padding:14px;text-align:right;font-weight:900;font-size:20px;color:#F5A800;border:none">${fp(grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin-top:40px;font-size:11px;color:#94A3B8;text-align:center;border-top:1px solid #E5E7EB;padding-top:16px">Generated by Maumee River Roofing WMS · ${new Date().toLocaleString()}</p>
    </body>
    </html>
  `;
  
  const win = window.open('', '_blank', 'width=1000,height=750');
  if (win) { win.document.write(html); win.document.close(); }
};