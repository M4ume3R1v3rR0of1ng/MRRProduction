import { useState, useEffect, useMemo, useRef } from "react";

const C = {
  blue: '#1B52B8', navy: '#0E2D6B', gold: '#F5A800', gL: '#FFFBEB',
  w: '#fff', bg: '#EEF2FA', lg: '#F1F5F9', bd: '#D1D9E6', sub: '#64748B',
  gr: '#16A34A', gB: '#DCFCE7', rd: '#DC2626', rB: '#FEE2E2',
  am: '#D97706', aB: '#FEF3C7', pu: '#7C3AED', pB: '#EDE9FE',
  tl: '#0D9488', tB: '#CCFBF1', sl: '#0369A1', sB: '#E0F2FE'
};
const uid = () => Math.random().toString(36).slice(2, 10);
const fd = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const ft = d => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const fm = n => '$' + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const tot = i => i.batches.reduce((s, b) => s + b.rem, 0);
const newestPrice = i => !i.batches.length ? 0 : [...i.batches].sort((a, b) => new Date(b.rcvd) - new Date(a.rcvd))[0].price;

const storage = typeof window !== 'undefined' && window.storage ? window.storage : {
  get: async key => ({ value: window.localStorage.getItem(key) }),
  set: async (key, value) => { window.localStorage.setItem(key, value); return { ok: true }; },
};

const doFifo = (item, qty) => {
  const s = [...item.batches].sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd));
  let r = qty, c = 0;
  const u = s.map(b => {
    if (r <= 0 || b.rem <= 0) return b;
    const t = Math.min(r, b.rem);
    r -= t;
    c += t * b.price;
    return { ...b, rem: b.rem - t };
  });
  return r > 0 ? null : { batches: u, cost: c };
};

const oilSt = v => {
  if (v.type !== 'truck') return null;
  const p = (v.mi - v.lomi) / v.oii;
  return p >= 1 ? 'overdue' : p >= 0.8 ? 'soon' : 'ok';
};

const predDays = v => {
  if (v.type !== 'truck' || !v.mil || v.mil.length < 2) return null;
  const l = [...v.mil].sort((a, b) => new Date(a.dt) - new Date(b.dt));
  const sp = (new Date(l[l.length - 1].dt) - new Date(l[0].dt)) / 86400000;
  if (sp < 1) return null;
  const d = (l[l.length - 1].mi - l[0].mi) / sp;
  if (d <= 0) return null;
  const lf = v.oii - (v.mi - v.lomi);
  return lf <= 0 ? 0 : Math.round(lf / d);
};

const detSt = v => {
  if (!v.ldd) return 'overdue';
  const d = (new Date() - new Date(v.ldd)) / 86400000;
  return d >= v.dii ? 'overdue' : d >= v.dii * 0.8 ? 'soon' : 'ok';
};

function compressImg(file, maxDim, quality, cb) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', quality));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Permission System ─────────────────────────────
const PERM_DEFS = {
  inv_view: { label: 'View Inventory', desc: 'Browse items & stock levels', g: '📦 Inventory' },
  inv_edit: { label: 'Add & Edit Items', desc: 'Create items & edit item details', g: '📦 Inventory' },
  inv_receive: { label: 'Receive Batches', desc: 'Receive individual item batches', g: '📦 Inventory' },
  inv_bulk_receive: { label: 'Receive Bulk Orders', desc: 'Multi-item bulk order receiving', g: '📦 Inventory' },
  inv_pricing_view: { label: 'View Pricing', desc: 'See purchase prices & batch costs', g: '📦 Inventory' },
  inv_pricing_edit: { label: 'Edit Pricing', desc: 'Change & set item pricing', g: '📦 Inventory' },
  fleet_view: { label: 'View Fleet', desc: 'View vehicles & service history', g: '🚛 Fleet' },
  fleet_edit: { label: 'Manage Fleet', desc: 'Log service, assign drivers, photos', g: '🚛 Fleet' },
  fleet_log_mi: { label: 'Log Mileage', desc: 'Submit vehicle mileage readings', g: '🚛 Fleet' },
  maint_submit: { label: 'Submit Requests', desc: 'Submit maintenance & service requests', g: '🔧 Maintenance' },
  maint_manage: { label: 'Manage Requests', desc: 'Schedule & close maintenance requests', g: '🔧 Maintenance' },
  jobs_view: { label: 'View Jobs', desc: 'View job pipeline & job details', g: '🏗️ Jobs' },
  jobs_build: { label: 'Build Jobs', desc: 'Create & edit jobs, plan materials', g: '🏗️ Jobs' },
  jobs_approve: { label: 'Approve & Assign', desc: 'Approve jobs & assign supervisors', g: '🏗️ Jobs' },
  jobs_pull: { label: 'Pull Inventory', desc: 'Pull materials from approved jobs', g: '🏗️ Jobs' },
  jobs_complete: { label: 'Complete Jobs', desc: 'Return inventory & mark jobs done', g: '🏗️ Jobs' },
  reports_view: { label: 'View Reports', desc: 'Access reports & analytics', g: '📊 Reports' },
  users_manage: { label: 'Manage Users', desc: 'Add, edit & deactivate user accounts', g: '⚙️ Admin' },
  settings_manage: { label: 'System Settings', desc: 'Settings, permissions & API config', g: '⚙️ Admin' },
};
const PERM_GROUPS = [
  ['📦 Inventory', ['inv_view', 'inv_edit', 'inv_receive', 'inv_bulk_receive', 'inv_pricing_view', 'inv_pricing_edit']],
  ['🚛 Fleet', ['fleet_view', 'fleet_edit', 'fleet_log_mi']],
  ['🔧 Maintenance', ['maint_submit', 'maint_manage']],
  ['🏗️ Jobs', ['jobs_view', 'jobs_build', 'jobs_approve', 'jobs_pull', 'jobs_complete']],
  ['📊 Reports', ['reports_view']],
  ['⚙️ Admin', ['users_manage', 'settings_manage']]
];
const ALL_PERM_KEYS = Object.keys(PERM_DEFS);
const ROLE_COLS = [['warehouse', 'Warehouse Mgr'], ['coordinator', 'Coordinator'], ['manager', 'Manager'], ['field', 'Site Supervisor'], ['employee', 'Employee']];
const DEFAULT_ROLE_PERMS = {
  warehouse: { inv_view: true, inv_edit: true, inv_receive: true, inv_bulk_receive: true, inv_pricing_view: true, inv_pricing_edit: false, fleet_view: true, fleet_edit: true, fleet_log_mi: true, maint_submit: true, maint_manage: true, jobs_view: true, jobs_build: false, jobs_approve: false, jobs_pull: true, jobs_complete: true, reports_view: true, users_manage: false, settings_manage: false },
  coordinator: { inv_view: true, inv_edit: true, inv_receive: true, inv_bulk_receive: true, inv_pricing_view: true, inv_pricing_edit: true, fleet_view: true, fleet_edit: true, fleet_log_mi: true, maint_submit: true, maint_manage: true, jobs_view: true, jobs_build: true, jobs_approve: true, jobs_pull: true, jobs_complete: true, reports_view: true, users_manage: false, settings_manage: false },
  manager: { inv_view: true, inv_edit: true, inv_receive: true, inv_bulk_receive: true, inv_pricing_view: true, inv_pricing_edit: true, fleet_view: true, fleet_edit: false, fleet_log_mi: false, maint_submit: true, maint_manage: false, jobs_view: true, jobs_build: true, jobs_approve: true, jobs_pull: true, jobs_complete: true, reports_view: true, users_manage: false, settings_manage: false },
  field: { inv_view: true, inv_edit: true, inv_receive: true, inv_bulk_receive: false, inv_pricing_view: false, inv_pricing_edit: false, fleet_view: true, fleet_edit: false, fleet_log_mi: true, maint_submit: true, maint_manage: false, jobs_view: true, jobs_build: false, jobs_approve: false, jobs_pull: true, jobs_complete: true, reports_view: false, users_manage: false, settings_manage: false },
};
function getEffectivePerms(user, rolePerms, userOverrides = {}) {
  if (!user) return {};
  if (user.role === 'admin') return Object.fromEntries(ALL_PERM_KEYS.map(k => [k, true]));
  const base = { ...(rolePerms[user.role] || {}) };
  const ov = userOverrides[user.id] || {};
  return { ...base, ...ov };
}

const ROLES = { admin: { label: 'Admin', color: 'red' }, warehouse: { label: 'Warehouse Mgr', color: 'purple' }, coordinator: { label: 'Coordinator', color: 'blue' }, manager: { label: 'Manager', color: 'amber' }, field: { label: 'Site Supervisor', color: 'green' }, employee: { label: 'Employee', color: 'gray' } };
const jSC = { draft: { c: 'gray', l: 'Draft', icon: '📝' }, approved: { c: 'blue', l: 'Approved', icon: '✅' }, active: { c: 'amber', l: 'Active', icon: '🔄' }, completed: { c: 'green', l: 'Completed', icon: '🏁' }, closed: { c: 'purple', l: 'Closed', icon: '🔒' } };

async function attemptAccuLynxSync(job, users, config, setJobs) {
  const sup = users.find(u => u.id === job.assignedTo);
  const totalCost = job.items.reduce((s, i) => s + (i.pulled - i.returned) * i.priceAtPull, 0);
  const payload = {
    acculynxJobReference: job.po,
    jobName: job.name,
    address: job.addr,
    supervisor: sup?.name || 'N/A',
    completedDate: job.completedAt,
    totalMaterialCost: parseFloat(totalCost.toFixed(2)),
    actions: ['upload_pdf_document', 'add_payment_line_item'],
    documentName: `Material_Cost_Report_${job.po}_${new Date(job.completedAt).toISOString().split('T')[0]}.pdf`,
    paymentDescription: `Material Cost — ${job.name}`,
    lineItems: job.items.filter(i => i.pulled - i.returned > 0).map(i => ({
      name: i.iname, category: i.icat, unit: i.unit,
      planned: i.planned, pulled: i.pulled, returned: i.returned,
      used: i.pulled - i.returned, unitPrice: i.priceAtPull,
      totalCost: parseFloat(((i.pulled - i.returned) * i.priceAtPull).toFixed(2)),
    })),
  };
  if (!config.enabled || !config.proxyUrl) {
    setJobs(p => p.map(j => j.id === job.id ? { ...j, syncStatus: 'manual', syncPayload: payload, syncNote: 'Configure AccuLynx in Settings to enable auto-sync.' } : j));
    return;
  }
  try {
    const res = await fetch(config.proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` }, body: JSON.stringify(payload) });
    if (res.ok) {
      setJobs(p => p.map(j => j.id === job.id ? { ...j, syncStatus: 'synced', syncedAt: new Date().toISOString(), syncPayload: payload, syncNote: 'PDF uploaded & cost added to AccuLynx.' } : j));
    } else throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    setJobs(p => p.map(j => j.id === job.id ? { ...j, syncStatus: 'failed', syncPayload: payload, syncNote: err.message } : j));
  }
}

// ── Seed Data ─────────────────────────────────────
const mkB = (id, rcvd, qty, price, by, rem) => ({ id, rcvd, qty, price, by, rem });
const mkI = (id, name, cat, unit, alrt, ...batches) => ({ id, name, cat, unit, alrt, batches });
const mkT = (id, name, mi, lomi, oii, dii, ldd, mil, sl) => ({ id, name, type: 'truck', mi, lomi, oii, dii, ldd, mil: mil || [], sl: sl || [] });
const mkTr = (id, name, dii, ldd) => ({ id, name, type: 'trailer', dii, ldd, mi: 0, mil: [], sl: [] });
const mkJI = (iid, iname, icat, unit, planned, pulled = 0, ret = 0, ppu = 0, cost = 0) => ({ iid, iname, icat, unit, planned, pulled, returned: ret, priceAtPull: ppu, pullCost: cost });

const SEED_U = [
  { id: 'u1', name: 'Sam', email: 'sam@maumeeriverroofing.com', pass: 'Admin123!', role: 'admin', active: true },
  { id: 'u2', name: 'Ian', email: 'ian@maumeeriverroofing.com', pass: 'Admin123!', role: 'admin', active: true },
  { id: 'u3', name: 'Adam', email: 'adam@maumeeriverroofing.com', pass: 'Mgr123!', role: 'Project Manager', active: true },
  { id: 'u4', name: 'Jerry', email: 'jerry@maumeeriverroofing.com', pass: 'Coord123!', role: 'Production Coordinator', active: true },
  { id: 'u5', name: 'Jorge', email: 'jorge@maumeeriverroofing.com', pass: 'Super123!', role: 'Site Supervisor', active: true },
  { id: 'u6', name: 'Jason', email: 'jason@maumeeriverroofing.com', pass: 'Super123!', role: 'Site Supervisor', active: true },
];
const SEED_W = [{ id: 'w1', name: 'Saint Joe Road Warehouse', location: 'Toledo, OH', active: true }];
const SEED_I = [
  mkI('i1', 'Underlayment', 'Roofing Materials', 'rolls', 10, mkB('b1', '2025-04-01', 50, 45, 'u1', 12), mkB('b2', '2025-05-01', 50, 47.5, 'u1', 50)),
  mkI('i2', 'Ice & Water Shield', 'Roofing Materials', 'rolls', 5, mkB('b3', '2025-05-01', 20, 85, 'u1', 4)),
  mkI('i3', 'Smooth Shank Coil Nails', 'Fasteners', 'boxes', 20, mkB('b4', '2025-04-15', 100, 52, 'u1', 45)),
  mkI('i4', 'Ring Shank Coil Nails', 'Fasteners', 'boxes', 20, mkB('b5', '2025-04-15', 80, 58, 'u1', 32)),
  mkI('i5', 'SEBS - White', 'Sealants', 'tubes', 15, mkB('b6', '2025-05-01', 48, 12.5, 'u1', 30)),
  mkI('i6', 'SEBS - Black', 'Sealants', 'tubes', 15, mkB('b7', '2025-05-01', 48, 12.5, 'u1', 18)),
  mkI('i7', 'SEBS - Brown', 'Sealants', 'tubes', 15, mkB('b8', '2025-05-01', 48, 12.5, 'u1', 40)),
  mkI('i8', 'Solar Seal - White', 'Sealants', 'tubes', 10, mkB('b9', '2025-05-01', 24, 18, 'u1', 9)),
  mkI('i9', 'Solar Seal - Black', 'Sealants', 'tubes', 10, mkB('b10', '2025-05-01', 24, 18, 'u1', 15)),
  mkI('i10', 'Solar Seal - Brown', 'Sealants', 'tubes', 10, mkB('b11', '2025-05-01', 24, 18, 'u1', 22)),
  mkI('i11', 'Atlas Rolled Ridge Vent', 'Ventilation', 'rolls', 5, mkB('b12', '2025-04-20', 30, 95, 'u1', 14)),
  mkI('i12', 'Atlas Box Vent - Black', 'Ventilation', 'each', 20, mkB('b13', '2025-04-20', 100, 22, 'u1', 65)),
  mkI('i13', 'Atlas Box Vent - Brown', 'Ventilation', 'each', 20, mkB('b14', '2025-04-20', 100, 22, 'u1', 72)),
  mkI('i14', 'OSB', 'Decking', 'each', 30, mkB('b15', '2025-05-05', 200, 28, 'u1', 155)),
  mkI('i15', '3M Tape', 'Accessories', 'rolls', 10, mkB('b16', '2025-05-05', 50, 15, 'u1', 7)),
  mkI('i16', '9" Roller Frames', 'Tools', 'each', 5, mkB('b17', '2025-04-01', 20, 8.5, 'u1', 12)),
  mkI('i17', '9" Roller Covers', 'Tools', 'each', 10, mkB('b18', '2025-04-01', 50, 4.5, 'u1', 23)),
  mkI('i18', "4'x10' Flat Stock - Black", 'Sheet Metal', 'each', 10, mkB('b19', '2025-05-01', 50, 42, 'u1', 33)),
  mkI('i19', "4'x10' Flat Stock - Brown", 'Sheet Metal', 'each', 10, mkB('b20', '2025-05-01', 50, 42, 'u1', 28)),
  mkI('i20', "4'x10' Flat Stock - White", 'Sheet Metal', 'each', 10, mkB('b21', '2025-05-01', 50, 42, 'u1', 41)),
  mkI('i21', '1" Stinger Nail Packs', 'Fasteners', 'boxes', 25, mkB('b22', '2025-04-15', 150, 8, 'u1', 6)),
];
const mkJob = (id, po, name, addr, notes, status, assignedTo, createdBy, createdAt, approvedAt, completedAt, newFor, items, sync = null) => ({ id, po, name, addr, notes, status, assignedTo, createdBy, createdAt, approvedAt, completedAt, newForAssigned: newFor, items, syncStatus: sync, syncedAt: '', syncPayload: null, syncNote: '' });
const SEED_JOBS = [
  mkJob('j1', 'PO-2025-001', 'Smith Residence Re-roof', '1234 Oak St, Toledo OH', 'Full tear-off, GAF Timberline HDZ.', 'completed', 'u3', 'u6', '2025-05-08T10:00:00', '2025-05-09T08:00:00', '2025-05-10T17:00:00', false, [mkJI('i1', 'Underlayment', 'Roofing Materials', 'rolls', 8, 8, 0, 47.5, 380), mkJI('i2', 'Ice & Water Shield', 'Roofing Materials', 'rolls', 3, 3, 0, 85, 255), mkJI('i3', 'Smooth Shank Coil Nails', 'Fasteners', 'boxes', 10, 10, 0, 52, 520), mkJI('i14', 'OSB', 'Decking', 'each', 6, 6, 0, 28, 168)], 'manual'),
  mkJob('j2', 'PO-2025-005', 'Westside Commercial Center', '789 Industrial Blvd, Toledo OH', 'Commercial flat roof + pitched front.', 'approved', 'u3', 'u6', '2025-05-15T09:00:00', '2025-05-16T08:00:00', '', true, [mkJI('i1', 'Underlayment', 'Roofing Materials', 'rolls', 15), mkJI('i11', 'Atlas Rolled Ridge Vent', 'Ventilation', 'rolls', 4), mkJI('i3', 'Smooth Shank Coil Nails', 'Fasteners', 'boxes', 8), mkJI('i14', 'OSB', 'Decking', 'each', 12), mkJI('i5', 'SEBS - White', 'Sealants', 'tubes', 6)]),
  mkJob('j3', 'PO-2025-006', 'Lakewood HOA — Building B', '500 Lakewood Dr, Maumee OH', '', 'draft', '', 'u6', '2025-05-17T14:00:00', '', '', false, [mkJI('i5', 'SEBS - White', 'Sealants', 'tubes', 12), mkJI('i12', 'Atlas Box Vent - Black', 'Ventilation', 'each', 8), mkJI('i1', 'Underlayment', 'Roofing Materials', 'rolls', 10)]),
  mkJob('j4', 'PO-2025-007', 'Henderson Residence', '4521 Sylvania Ave, Maumee OH', 'Insurance claim re-roof.', 'active', 'u7', 'u6', '2025-05-14T11:00:00', '2025-05-15T07:00:00', '', false, [mkJI('i1', 'Underlayment', 'Roofing Materials', 'rolls', 10, 10, 0, 47.5, 475), mkJI('i4', 'Ring Shank Coil Nails', 'Fasteners', 'boxes', 6, 6, 0, 58, 348), mkJI('i11', 'Atlas Rolled Ridge Vent', 'Ventilation', 'rolls', 3, 3, 0, 95, 285), mkJI('i14', 'OSB', 'Decking', 'each', 8, 4, 0, 28, 112)]),
];
const SEED_V = [
  { ...mkT('v1', 'Truck 1', 87500, 83200, 5000, 90, '2025-02-15', [{ dt: '2025-05-14', mi: 87500, by: 'u1' }], [{ id: 's1', type: 'Oil Change', dt: '2025-03-01', mi: 83200, by: 'Quick Lube', notes: '5W-30 Synthetic', cost: 89 }]), plate: 'MRR-001', yr: 2020, make: 'Ford', model: 'F-250', assignedTo: 'u3' },
  { ...mkT('v2', 'Truck 2', 62300, 58900, 5000, 90, '2025-03-10', [{ dt: '2025-05-14', mi: 62300, by: 'u2' }]), plate: 'MRR-002', yr: 2021, make: 'Ford', model: 'F-250', assignedTo: 'u7' },
  { ...mkT('v3', 'Truck 3', 112000, 108500, 5000, 90, '2025-01-20', []), plate: 'MRR-003', yr: 2019, make: 'Ram', model: '2500', assignedTo: '' },
  { ...mkT('v4', 'Truck 4', 45200, 43500, 5000, 90, '2025-04-01', []), plate: 'MRR-004', yr: 2022, make: 'Chevy', model: 'Silverado 2500', assignedTo: '' },
  { ...mkTr('v13', 'Trailer 1', 90, '2025-03-01'), plate: 'TRL-001', yr: 2020, make: 'PJ Trailers', model: "Flatbed 20'", assignedTo: '' },
  { ...mkTr('v14', 'Trailer 2', 90, '2025-01-15'), plate: 'TRL-002', yr: 2021, make: 'PJ Trailers', model: "Flatbed 18'", assignedTo: '' },
];
const SEED_REQ = [
  { id: 'r1', vid: 'v1', vname: 'Truck 1 (MRR-001)', vtype: 'truck', type: 'Oil Change', urgency: 'normal', notes: 'Due soon based on mileage.', uid: 'u3', uname: 'Tyler Field', at: '2025-05-15T08:30:00', status: 'pending', scheduledDate: '', completedAt: '', whNotes: '' },
  { id: 'r2', vid: 'v2', vname: 'Truck 2 (MRR-002)', vtype: 'truck', type: 'Repair', urgency: 'urgent', notes: 'Brakes grinding when stopping.', uid: 'u7', uname: 'Marco Rivera', at: '2025-05-16T14:15:00', status: 'scheduled', scheduledDate: '2025-05-20', completedAt: '', whNotes: 'Scheduled with Toledo Truck Service.' },
];

function generatePDF(job, users, activeLogo) {
  const sup = users.find(u => u.id === job.assignedTo);
  const cats = {};
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
    return `<tr style="background:#EEF2FA"><td colspan="7" style="padding:8px 14px;font-weight:900;color:#0E2D6B">${cat}</td></tr>${items.map(i => `<tr><td style="padding:7px 14px">${i.iname}</td><td style="padding:7px 14px;text-align:center">${i.planned}</td><td style="padding:7px 14px;text-align:center">${i.pulled}</td><td style="padding:7px 14px;text-align:center">${i.returned}</td><td style="padding:7px 14px;text-align:center;font-weight:700;color:#0E2D6B">${i.used}</td><td style="padding:7px 14px;text-align:right">$${i.priceAtPull.toFixed(2)}</td><td style="padding:7px 14px;text-align:right;font-weight:700;color:#16A34A">$${i.total.toFixed(2)}</td></tr>`).join('')}<tr style="background:#F1F5F9"><td colspan="6" style="padding:7px 14px;font-weight:700;text-align:right;font-style:italic">Category Subtotal:</td><td style="padding:7px 14px;text-align:right;font-weight:900;color:#1B52B8">${fp(catTotal)}</td></tr>`;
  }).join('');
  const logoHtml = activeLogo ? `<img src="${activeLogo}" style="height:56px;object-fit:contain;display:block;margin-bottom:4px"/>` : `<div style="width:50px;height:50px;background:#F5A800;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:4px">🏠</div>`;
  const html = `<!DOCTYPE html><html><head><title>Job Report — ${job.po}</title><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#1A202C}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#0E2D6B;color:#fff;padding:10px 14px;text-align:left;font-size:12px;letter-spacing:.5px;text-transform:uppercase}td{border-bottom:1px solid #E5E7EB;font-size:13px}@media print{.no-print{display:none}}</style></head><body><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px"><div>${logoHtml}<div style="font-size:20px;font-weight:900;color:#0E2D6B">MAUMEE RIVER ROOFING</div><div style="font-size:12px;color:#64748B;letter-spacing:1px">JOB COMPLETION REPORT</div></div><button class="no-print" onclick="window.print()" style="padding:10px 20px;background:#F5A800;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px">🖨️ Save as PDF</button></div><hr style="border:2px solid #F5A800;margin-bottom:24px"><table style="margin-top:0;width:auto;min-width:400px"><tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">Job Name</td><td style="border:none;font-weight:700;font-size:14px">${job.name}</td></tr><tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">PO Number</td><td style="border:none">${job.po}</td></tr><tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">Address</td><td style="border:none">${job.addr}</td></tr><tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">Site Supervisor</td><td style="border:none">${sup ? sup.name : 'N/A'}</td></tr><tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">Date Completed</td><td style="border:none">${new Date(job.completedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>${job.notes ? `<tr><td style="padding:5px 24px 5px 0;font-weight:700;color:#64748B;border:none;font-size:12px;text-transform:uppercase">Notes</td><td style="border:none">${job.notes}</td></tr>` : ''}</table><h3 style="margin:28px 0 4px;color:#0E2D6B;font-size:14px;text-transform:uppercase;letter-spacing:.5px">Materials Used — Pulled minus Returned</h3><table><thead><tr><th>Item</th><th style="text-align:center">Planned</th><th style="text-align:center">Pulled</th><th style="text-align:center">Returned</th><th style="text-align:center">Used</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total Cost</th></tr></thead><tbody>${catRows}</tbody><tfoot><tr style="background:#0E2D6B"><td colspan="6" style="padding:14px;font-weight:900;font-size:15px;color:#fff;letter-spacing:.5px;border:none">TOTAL MATERIAL COST</td><td style="padding:14px;text-align:right;font-weight:900;font-size:20px;color:#F5A800;border:none">${fp(grandTotal)}</td></tr></tfoot></table><p style="margin-top:40px;font-size:11px;color:#94A3B8;text-align:center;border-top:1px solid #E5E7EB;padding-top:16px">Generated by Maumee River Roofing WMS · ${new Date().toLocaleString()}</p></body></html>`;
  const win = window.open('', '_blank', 'width=1000,height=750');
  if (win) { win.document.write(html); win.document.close(); }
}

// ── UI Primitives ─────────────────────────────────
function Modal({ title, onClose, children, wide, extraWide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,45,107,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.w, borderRadius: 14, width: '100%', maxWidth: extraWide ? 900 : wide ? 740 : 480, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: '16px 20px', borderBottom: `3px solid ${C.gold}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: C.w, zIndex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.navy }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 24, color: C.sub, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

function Fld({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.navy, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
      {children}
      {hint && <p style={{ margin: '3px 0 0', fontSize: 11, color: C.sub }}>{hint}</p>}
    </div>
  );
}

function Inp(p) {
  return <input {...p} style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: C.w, ...p.style }} />;
}

function TA(p) {
  return <textarea {...p} style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: C.w, resize: 'vertical', fontFamily: 'inherit', minHeight: 70, ...p.style }} />;
}

function Sel({ children, ...p }) {
  return <select {...p} style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, background: C.w, boxSizing: 'border-box', ...p.style }}>{children}</select>;
}

function Btn({ children, v = 'primary', sz = 'md', ...p }) {
  const vs = { primary: { background: C.blue, color: C.w, border: 'none' }, gold: { background: C.gold, color: C.navy, border: 'none' }, outline: { background: 'transparent', color: C.blue, border: `2px solid ${C.blue}` }, ghost: { background: C.lg, color: '#1A202C', border: 'none' }, danger: { background: C.rd, color: C.w, border: 'none' }, purple: { background: C.pu, color: C.w, border: 'none' }, green: { background: C.gr, color: C.w, border: 'none' }, teal: { background: C.tl, color: C.w, border: 'none' }, sky: { background: C.sl, color: C.w, border: 'none' } };
  const ss = { sm: { padding: '5px 11px', fontSize: 12 }, md: { padding: '9px 16px', fontSize: 13 }, lg: { padding: '12px 22px', fontSize: 15 } };
  return <button {...p} style={{ ...vs[v], ...ss[sz], borderRadius: 8, cursor: 'pointer', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, ...p.style }}>{children}</button>;
}

function Bdg({ children, color = 'blue' }) {
  const bg = { blue: 'rgba(27,82,184,0.12)', green: C.gB, red: C.rB, amber: C.aB, gold: C.gL, purple: C.pB, gray: '#F1F5F9', teal: C.tB, sky: C.sB };
  const fg = { blue: C.blue, green: C.gr, red: C.rd, amber: C.am, gold: '#C78D00', purple: C.pu, gray: C.sub, teal: C.tl, sky: C.sl };
  return <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg[color] || C.lg, color: fg[color] || C.sub, display: 'inline-block' }}>{children}</span>;
}

function RoleBdg({ role }) {
  const r = ROLES[role] || { label: 'Employee', color: 'gray' };
  return <Bdg color={r.color}>{r.label}</Bdg>;
}

function Toggle({ on, onChange, disabled = false }) {
  return (
    <div onClick={!disabled ? onChange : undefined} style={{ width: 38, height: 22, borderRadius: 11, background: disabled ? '#CBD5E0' : on ? C.gr : '#CBD5E0', cursor: disabled ? 'default' : 'pointer', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: disabled ? '#A0AEC0' : C.w, transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </div>
  );
}

function PhotoUpload({ current, onUpload, maxDim = 350, quality = 0.72, label = 'Upload Photo', previewHeight = 160 }) {
  const ref = useRef();
  const handle = e => { const f = e.target.files[0]; if (f) compressImg(f, maxDim, quality, onUpload); e.target.value = ''; };
  return (
    <div>
      {current ? (
        <div style={{ position: 'relative', marginBottom: 10, borderRadius: 10, overflow: 'hidden', border: `1.5px solid ${C.bd}` }}>
          <img src={current} alt="" style={{ width: '100%', height: previewHeight, objectFit: 'cover', display: 'block' }} />
          <button onClick={() => onUpload(null)} style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: '50%', width: 26, height: 26, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
      ) : (
        <div style={{ height: previewHeight, background: C.lg, borderRadius: 10, border: `2px dashed ${C.bd}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginBottom: 10, cursor: 'pointer', gap: 6 }} onClick={() => ref.current.click()}>
          <span style={{ fontSize: 28 }}>📷</span>
          <span style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>{label}</span>
        </div>
      )}
      <input ref={ref} type="file" accept="image/*" onChange={handle} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn v="ghost" sz="sm" onClick={() => ref.current.click()} style={{ flex: 1, justifyContent: 'center' }}>📷 {current ? 'Change' : 'Upload'} Photo</Btn>
        {current && <Btn v="ghost" sz="sm" onClick={() => onUpload(null)} style={{ color: C.rd }}>🗑️</Btn>}
      </div>
    </div>
  );
}

// ── Login ─────────────────────────────────────────
import { supabase } from "./utils/supabase";

const COMPANY_DOMAIN = '@maumeeriverroofing.com';

function LoginScreen({ onLogin, activeLogo }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');

  // 1. Live Supabase Login + Secure Profiles Hook
  const tryLogin = async (demoUser) => {
    setErr('');

    // Handle standard database authentication
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: pass,
    });

    if (authError) return setErr(authError.message);

    if (authData.user) {
      // Fetch the role and active state verified by the Postgres database
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, role, active')
        .eq('id', authData.user.id)
        .single();

      if (profileError) return setErr("Failed to verify user profile access.");
      if (!profileData.active) return setErr("This account has been deactivated by an administrator.");

      // Remap properties to match your App.jsx global authorization keys
      const formattedUser = {
        id: authData.user.id,
        email: authData.user.email,
        name: profileData.full_name,
        role: profileData.role, 
        active: profileData.active
      };
      
      onLogin(formattedUser);
    }
  };

  // 2. Live Supabase Registration 
  const trySignup = async () => {
    setErr('');
    const trimmedEmail = email.trim().toLowerCase();

    // Core validation checks prior to sending database payloads
    if (!name.trim()) return setErr('Please enter your full name.');
    if (!trimmedEmail.endsWith(COMPANY_DOMAIN)) return setErr(`Use your ${COMPANY_DOMAIN} email address.`);
    if (!pass) return setErr('Please choose a password.');
    if (pass.length < 8) return setErr('Password must be at least 8 characters.');
    if (pass !== confirm) return setErr('Passwords do not match.');

    // Fire signup request to Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password: pass,
      options: {
        data: {
          full_name: name.trim(),
          role: 'employee', // Fallback default for self-registrations
        },
      },
    });

    if (authError) return setErr(authError.message);

    if (authData.user) {
      // Map properties for immediate access
      const formattedUser = {
        id: authData.user.id,
        email: authData.user.email,
        name: name.trim(),
        role: 'employee',
        active: true
      };
      onLogin(formattedUser);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: `linear-gradient(135deg,${C.navy} 0%,${C.blue} 55%,${C.navy} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.w, borderRadius: 18, padding: 36, width: '100%', maxWidth: 420, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ width: 54, height: 54, background: C.gold, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {activeLogo ? <img src={activeLogo} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 28 }}>🏠</span>}
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.navy }}>MAUMEE RIVER</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, letterSpacing: '1px' }}>ROOFING</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.sub }}>{mode === 'login' ? 'Warehouse & Fleet Management System' : `Register with ${COMPANY_DOMAIN}`}</div>
        </div>
        {mode === 'signup' && <Fld label="Full Name"><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} /></Fld>}
        <Fld label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@maumeeriverroofing.com" style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} /></Fld>
        <Fld label="Password"><input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && (mode === 'login' ? tryLogin() : trySignup())} placeholder="Password" style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} /></Fld>
        {mode === 'signup' && <Fld label="Confirm Password"><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && trySignup()} placeholder="Confirm password" style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} /></Fld>}
        {err && <div style={{ background: C.rB, color: C.rd, padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{err}</div>}
        <button onClick={() => mode === 'login' ? tryLogin() : trySignup()} style={{ width: '100%', padding: '12px', background: C.gold, color: C.navy, border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 800, cursor: 'pointer', marginBottom: 12 }}>{mode === 'login' ? 'Sign In →' : 'Create Account →'}</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: C.sub }}>
          <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); }} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', padding: 0, fontWeight: 700 }}>{mode === 'login' ? 'Create an account' : 'Back to sign in'}</button>
          <span>{COMPANY_DOMAIN}</span>
        </div>
      </div>
    </div>
  );
}
// ── Dashboard ─────────────────────────────────────
function Dashboard({ inv, vehs, reqs, jobs, users, user, perms, onNav }) {
  const low = inv.filter(i => tot(i) <= i.alrt);
  const pendingReqs = reqs.filter(r => r.status === 'pending');
  const myJobs = user.role === 'field' ? jobs.filter(j => j.assignedTo === user.id && j.status !== 'completed') : jobs;
  const newJobs = myJobs.filter(j => j.newForAssigned && j.assignedTo === user.id);

  const SC = ({ label, value, color, icon, onClick, sub }) => (
    <div onClick={onClick} style={{ background: C.w, borderRadius: 12, padding: 14, cursor: onClick ? 'pointer' : 'default', borderLeft: `5px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>Good morning, {user.name.split(' ')[0]}! 👋</h1>
        <p style={{ margin: '3px 0 0', color: C.sub, fontSize: 12 }}>Saint Joe Road Warehouse · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
      </div>
      {user.role === 'field' && newJobs.length > 0 && (
        <div onClick={() => onNav('pull')} style={{ background: C.tB, border: `2px solid ${C.tl}`, borderRadius: 10, padding: '12px 16px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
          <div style={{ fontWeight: 700, color: C.tl, fontSize: 13 }}>🎉 {newJobs.length} new job{newJobs.length !== 1 ? 's' : ''} assigned to you!</div>
          <Btn v="teal" sz="sm">View →</Btn>
        </div>
      )}
      {perms.maint_manage && pendingReqs.length > 0 && (
        <div onClick={() => onNav('requests')} style={{ background: C.pB, border: `2px solid ${C.pu}`, borderRadius: 10, padding: '12px 16px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
          <div style={{ fontWeight: 700, color: C.pu, fontSize: 13 }}>🔔 {pendingReqs.length} pending maintenance request{pendingReqs.length !== 1 ? 's' : ''}</div>
          <Btn v="purple" sz="sm">View →</Btn>
        </div>
      )}
      {low.length > 0 && <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: C.am, fontWeight: 600 }}>⚠️ {low.length} item(s) at or below low stock threshold.</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {user.role === 'field' ? (
          <>
            <SC label="My Assigned Jobs" value={myJobs.filter(j => j.status !== 'completed').length} color={C.tl} icon="📋" onClick={() => onNav('pull')} />
            <SC label="Active" value={myJobs.filter(j => j.status === 'active').length} color={C.am} icon="🔄" onClick={() => onNav('pull')} />
            <SC label="Completed" value={myJobs.filter(j => j.status === 'completed').length} color={C.gr} icon="🏁" onClick={() => onNav('pull')} />
          </>
        ) : (
          <>
            <SC label="Draft Jobs" value={jobs.filter(j => j.status === 'draft').length} color={C.sub} icon="📝" onClick={perms.jobs_build ? () => onNav('buildjobs') : undefined} />
            <SC label="Approved" value={jobs.filter(j => j.status === 'approved').length} color={C.blue} icon="✅" onClick={() => onNav('pull')} />
            <SC label="Active" value={jobs.filter(j => j.status === 'active').length} color={C.am} icon="🔄" onClick={() => onNav('pull')} />
            <SC label="Low Stock" value={low.length} color={low.length > 0 ? C.rd : C.gr} icon={low.length > 0 ? '🚨' : '✅'} onClick={perms.inv_view ? () => onNav('inventory') : undefined} />
            <SC label="Pending Requests" value={pendingReqs.length} color={pendingReqs.length > 0 ? C.pu : C.gr} icon="🔧" onClick={() => onNav('requests')} />
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 800, color: C.navy }}>📋 Job Pipeline</h3>
          {jobs.filter(j => user.role === 'field' ? j.assignedTo === user.id : true).filter(j => j.status !== 'completed').slice(0, 5).map(j => {
            const sup = users.find(u => u.id === j.assignedTo);
            const st = jSC[j.status];
            return (
              <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: C.lg, borderRadius: 7, marginBottom: 6, fontSize: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, color: C.navy }}>{j.name}</div>
                  <div style={{ color: C.sub, fontSize: 10 }}>{j.po}{sup ? ` · ${sup.name}` : ''}</div>
                </div>
                <Bdg color={st.c}>{st.l}</Bdg>
              </div>
            );
          })}
          {jobs.filter(j => j.status !== 'completed').length === 0 && <p style={{ color: C.gr, fontSize: 12, margin: 0 }}>✅ No active jobs.</p>}
        </div>
        <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 800, color: C.navy }}>🚨 Low Stock Items</h3>
          {low.length === 0 ? <p style={{ color: C.gr, fontSize: 12, margin: 0 }}>✅ All items well stocked!</p> : low.slice(0, 5).map(item => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', background: C.rB, borderRadius: 7, marginBottom: 6, fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: C.navy }}>{item.name}</span>
              <span style={{ color: C.rd, fontWeight: 800 }}>{tot(item)} {item.unit}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Inventory ─────────────────────────────────────
function Inventory({ inv, setInv, users, user, perms, invPhotos, setInvPhotos }) {
  const [srch, setSrch] = useState('');
  const [cat, setCat] = useState('All');
  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState({});
  const [bulkItems, setBulkItems] = useState([]);
  const [bulkMeta, setBulkMeta] = useState({ date: new Date().toISOString().split('T')[0], po: '', vendor: '' });
  const [bulkSrch, setBulkSrch] = useState('');
  const cats = ['All', ...new Set(inv.map(i => i.cat))].sort();
  const filtered = inv.filter(i => i.name.toLowerCase().includes(srch.toLowerCase()) && (cat === 'All' || i.cat === cat));
  const sClr = i => { const s = tot(i); if (s <= i.alrt) return C.rd; if (s <= i.alrt * 1.5) return C.am; return C.gr; };
  const setPhoto = (id, data) => setInvPhotos(p => data ? { ...p, [id]: data } : Object.fromEntries(Object.entries(p).filter(([k]) => k !== id)));
  const [selectedIds, setSelectedIds] = useState([]);
  

  const addItem = () => {
    if (!form.name || !form.cat || !form.unit) return;
    setInv(p => [...p, { id: uid(), name: form.name, cat: form.cat, unit: form.unit, alrt: parseInt(form.alrt) || 5, batches: [] }]);
    setModal(null); setForm({});
  };
  const editItem = () => {
    setInv(p => p.map(i => i.id === sel.id ? { ...i, ...form, alrt: parseInt(form.alrt) || i.alrt } : i));
    setModal(null); setForm({});
  };
  const rcvBatch = () => {
    if (!form.qty || !form.price || !form.date) return;
    const b = { id: uid(), rcvd: form.date, qty: parseFloat(form.qty), price: parseFloat(form.price), by: user.id, rem: parseFloat(form.qty) };
    setInv(p => p.map(i => i.id === sel.id ? { ...i, batches: [...i.batches, b] } : i));
    setModal(null); setForm({});
  };
  const bulkFiltered = inv.filter(i => i.name.toLowerCase().includes(bulkSrch.toLowerCase()) && !bulkItems.find(b => b.iid === i.id));
  const addToBulk = item => setBulkItems(p => [...p, { iid: item.id, iname: item.name, unit: item.unit, qty: '', price: newestPrice(item) ? String(newestPrice(item)) : '' }]);
  const removeBulk = iid => setBulkItems(p => p.filter(b => b.iid !== iid));
  const updateBulk = (iid, field, val) => setBulkItems(p => p.map(b => b.iid === iid ? { ...b, [field]: val } : b));
  const bulkTotal = bulkItems.reduce((s, b) => s + (parseFloat(b.qty) || 0) * (parseFloat(b.price) || 0), 0);
  const confirmBulk = () => {
    if (!bulkMeta.date) { alert('Please set a received date.'); return; }
    const valid = bulkItems.filter(b => parseFloat(b.qty) > 0);
    if (valid.length === 0) { alert('Add at least one item with a quantity > 0.'); return; }
    setInv(p => p.map(item => {
      const bi = valid.find(b => b.iid === item.id);
      if (!bi) return item;
      const nb = { id: uid(), rcvd: bulkMeta.date, qty: parseFloat(bi.qty), price: parseFloat(bi.price) || 0, by: user.id, rem: parseFloat(bi.qty), ref: bulkMeta.po || '', vendor: bulkMeta.vendor || '' };
      return { ...item, batches: [...item.batches, nb] };
    }));
    setModal(null); setBulkItems([]); setBulkMeta({ date: new Date().toISOString().split('T')[0], po: '', vendor: '' }); setBulkSrch('');
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>📦 Inventory</h1>
          <p style={{ margin: '2px 0 0', color: C.sub, fontSize: 12 }}>{inv.length} items</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {perms.inv_bulk_receive && <Btn v="gold" onClick={() => { setBulkItems([]); setBulkMeta({ date: new Date().toISOString().split('T')[0], po: '', vendor: '' }); setBulkSrch(''); setModal('bulk'); }}>📦 Receive Bulk Order</Btn>}
          {perms.inv_edit && <Btn v="primary" onClick={() => { setModal('add'); setForm({ unit: 'rolls', alrt: '10' }); }}>+ Add Item</Btn>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Inp placeholder="🔍 Search items..." value={srch} onChange={e => setSrch(e.target.value)} style={{ flex: 1, minWidth: 160, maxWidth: 300 }} />
        <Sel value={cat} onChange={e => setCat(e.target.value)} style={{ width: 'auto' }}>{cats.map(c => <option key={c}>{c}</option>)}</Sel>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
        {filtered.map(item => {
          const stock = tot(item);
          const isLow = stock <= item.alrt;
          const photo = invPhotos[item.id];
          return (
            <div key={item.id} onClick={() => { setSel(item); setModal('detail'); }} style={{ background: C.w, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: `2px solid ${isLow ? C.rd : 'transparent'}`, cursor: 'pointer' }}>
              {photo ? <div style={{ height: 110, overflow: 'hidden', background: C.lg }}><img src={photo} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div> : <div style={{ height: 6, background: sClr(item) }} />}
              <div style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800, color: C.navy, fontSize: 13 }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: C.sub }}>{item.cat}</div>
                  </div>
                  {isLow && <span style={{ fontSize: 16 }}>🚨</span>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: sClr(item) }}>{stock}</div>
                    <div style={{ fontSize: 11, color: C.sub }}>{item.unit} in stock</div>
                  </div>
                  {perms.inv_pricing_view ? (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.blue }}>{fm(newestPrice(item))}</div>
                      <div style={{ fontSize: 10, color: C.sub }}>per {item.unit.replace(/s$/, '')}</div>
                    </div>
                  ) : <div style={{ fontSize: 11, color: C.sub }}>Pricing restricted</div>}
                </div>
                {!photo && <div style={{ marginTop: 8, height: 4, background: C.lg, borderRadius: 2 }}><div style={{ height: '100%', background: sClr(item), borderRadius: 2, width: `${Math.min(100, (stock / (item.alrt * 3)) * 100)}%` }} /></div>}
                <div style={{ fontSize: 10, color: C.sub, marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Alert: {item.alrt} {item.unit}</span>
                  <span>{item.batches.length} batch{item.batches.length !== 1 ? 'es' : ''}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modal === 'detail' && sel && (
        <Modal title={sel.name} onClose={() => setModal(null)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Product Photo</div>
              <PhotoUpload current={invPhotos[sel.id] || null} onUpload={data => setPhoto(sel.id, data)} label="Upload product photo" previewHeight={180} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Item Details</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[['Total Stock', `${tot(sel)} ${sel.unit}`], ['Category', sel.cat], ['Unit', sel.unit], ...(perms.inv_pricing_view ? [['Current Price', fm(newestPrice(sel))], ['Low Alert', `${sel.alrt} ${sel.unit}`]] : [['Low Alert', `${sel.alrt} ${sel.unit}`]]), ['Batches', sel.batches.length]].map(([k, v]) => (
                  <div key={k} style={{ background: C.lg, borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: 'uppercase' }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {perms.inv_edit && <Btn v="outline" sz="sm" onClick={() => { setForm({ name: sel.name, cat: sel.cat, unit: sel.unit, alrt: sel.alrt }); setModal('edit'); }}>✏️ Edit</Btn>}
                {perms.inv_receive && <Btn v="primary" sz="sm" onClick={() => { setForm({ date: new Date().toISOString().split('T')[0] }); setModal('rcv'); }}>+ Receive Batch</Btn>}
                {perms.inv_edit && (
  <Btn v="danger" sz="sm" onClick={() => { 
    if(window.confirm(`Permanently delete ${sel.name} from inventory?`)) { 
      setInv(p => p.filter(i => i.id !== sel.id)); 
      setModal(null); 
    } 
  }}>
    🗑️ Delete Product
  </Btn>
)}
              </div>
            </div>
          </div>
          <h4 style={{ margin: '0 0 8px', color: C.navy, fontSize: 12, textTransform: 'uppercase' }}>Batch History (FIFO)</h4>
          {[...sel.batches].sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd)).map((b, i) => (
            <div key={b.id} style={{ padding: '10px 14px', background: i === 0 && b.rem > 0 ? 'rgba(27,82,184,0.08)' : C.lg, borderRadius: 8, border: i === 0 && b.rem > 0 ? `1.5px solid ${C.blue}` : 'none', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>
                    {i === 0 && b.rem > 0 && <span style={{ color: C.blue }}>▶ ACTIVE · </span>}{fd(b.rcvd)}{b.vendor && <span style={{ color: C.sub }}> · {b.vendor}</span>}{b.ref && <span style={{ color: C.tl }}> · {b.ref}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.sub }}>By: {users.find(u => u.id === b.by)?.name || 'Unknown'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: b.rem === 0 ? C.sub : C.gr, fontSize: 12 }}>{b.rem}/{b.qty} remaining</div>
                  {perms.inv_pricing_view && <div style={{ fontSize: 11, color: C.blue, fontWeight: 700 }}>{fm(b.price)} ea.</div>}
                </div>
              </div>
            </div>
          ))}
          {sel.batches.length === 0 && <p style={{ color: C.sub, fontSize: 13 }}>No batches yet.</p>}
        </Modal>
      )} 

      {modal === 'add' && (
        <Modal title="Add New Item" onClose={() => setModal(null)}>
          <Fld label="Item Name"><Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Drip Edge - White" /></Fld>
          <Fld label="Category"><Inp value={form.cat || ''} onChange={e => setForm({ ...form, cat: e.target.value })} /></Fld>
          <Fld label="Unit"><Sel value={form.unit || 'rolls'} onChange={e => setForm({ ...form, unit: e.target.value })}>{['rolls', 'boxes', 'each', 'tubes', 'bundles', 'packs', 'sheets', 'gallons', 'lbs'].map(u => <option key={u}>{u}</option>)}</Sel></Fld>
          <Fld label="Low Alert Threshold"><Inp type="number" value={form.alrt || ''} onChange={e => setForm({ ...form, alrt: e.target.value })} /></Fld>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={addItem} style={{ flex: 1, justifyContent: 'center' }}>Add Item</Btn>
          </div>
        </Modal>
      )}

      {modal === 'edit' && sel && (
        <Modal title={`Edit: ${sel.name}`} onClose={() => setModal(null)}>
          <Fld label="Item Name"><Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label="Category"><Inp value={form.cat || ''} onChange={e => setForm({ ...form, cat: e.target.value })} /></Fld>
          <Fld label="Unit"><Sel value={form.unit || 'rolls'} onChange={e => setForm({ ...form, unit: e.target.value })}>{['rolls', 'boxes', 'each', 'tubes', 'bundles', 'packs', 'sheets', 'gallons', 'lbs'].map(u => <option key={u}>{u}</option>)}</Sel></Fld>
          <Fld label="Low Alert"><Inp type="number" value={form.alrt || ''} onChange={e => setForm({ ...form, alrt: e.target.value })} /></Fld>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={editItem} style={{ flex: 1, justifyContent: 'center' }}>Save</Btn>
          </div>
        </Modal>
      )}

      {modal === 'rcv' && sel && (
        <Modal title={`Receive: ${sel.name}`} onClose={() => setModal(null)}>
          <Fld label="Date Received"><Inp type="date" value={form.date || ''} onChange={e => setForm({ ...form, date: e.target.value })} /></Fld>
          <Fld label={`Quantity (${sel.unit})`}><Inp type="number" value={form.qty || ''} onChange={e => setForm({ ...form, qty: e.target.value })} /></Fld>
          {perms.inv_pricing_edit ? (
            <Fld label="Price Per Unit">
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.sub }}>$</span>
                <Inp type="number" step="0.01" value={form.price || ''} onChange={e => setForm({ ...form, price: e.target.value })} style={{ paddingLeft: 22 }} />
              </div>
            </Fld>
          ) : <div style={{ background: C.aB, border: `1px solid ${C.am}`, borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: C.am }}>Pricing is set by authorized personnel. Price will carry over from the last batch.</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={rcvBatch} style={{ flex: 1, justifyContent: 'center' }}>Receive</Btn>
          </div>
        </Modal>
      )}

      {modal === 'bulk' && perms.inv_bulk_receive && (
        <Modal title="📦 Receive Bulk Order" onClose={() => { setModal(null); setBulkItems([]); setBulkSrch(''); }} wide>
          <div style={{ background: C.gL, border: `1.5px solid ${C.gold}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.navy }}>⭐ <strong>FIFO applied automatically.</strong> Each item gets one new batch. Older batches are consumed first.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, padding: 14, background: C.lg, borderRadius: 10, marginBottom: 16 }}>
            <Fld label="Date Received *"><Inp type="date" value={bulkMeta.date} onChange={e => setBulkMeta({ ...bulkMeta, date: e.target.value })} /></Fld>
            <Fld label="PO / Order #"><Inp value={bulkMeta.po} onChange={e => setBulkMeta({ ...bulkMeta, po: e.target.value })} placeholder="e.g. PO-2025-100" /></Fld>
            <Fld label="Vendor / Supplier"><Inp value={bulkMeta.vendor} onChange={e => setBulkMeta({ ...bulkMeta, vendor: e.target.value })} placeholder="e.g. ABC Roofing Supply" /></Fld>
          </div>
          <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Select Items to Receive</div>
              <Inp value={bulkSrch} onChange={e => setBulkSrch(e.target.value)} placeholder="🔍 Search inventory..." style={{ marginBottom: 8 }} />
              <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {bulkFiltered.map(item => (
                  <div key={item.id} style={{ background: C.w, border: `1.5px solid ${C.bd}`, borderRadius: 8, padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>{item.name}</div>
                      <div style={{ fontSize: 10, color: C.sub }}>{item.cat} · {tot(item)} {item.unit} in stock</div>
                    </div>
                    <Btn v="primary" sz="sm" onClick={() => addToBulk(item)}>+ Add</Btn>
                  </div>
                ))}
                {bulkFiltered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: C.sub, fontSize: 12, background: C.lg, borderRadius: 8 }}>{bulkItems.length > 0 ? 'All items added ✓' : 'No items found'}</div>}
              </div>
            </div>
            <div style={{ flex: '0 0 360px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Order Items {bulkItems.length > 0 && `(${bulkItems.length})`}</div>
                {bulkItems.length > 0 && <button onClick={() => setBulkItems([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.rd, fontSize: 11, fontWeight: 700 }}>Clear All</button>}
              </div>
              {bulkItems.length === 0 ? (
                <div style={{ height: 200, background: C.lg, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.sub, gap: 8 }}>
                  <span style={{ fontSize: 32 }}>📋</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>No items added yet</span>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto', marginBottom: 10 }}>
                    {bulkItems.map(b => {
                      const sub = (parseFloat(b.qty) || 0) * (parseFloat(b.price) || 0);
                      return (
                        <div key={b.iid} style={{ background: C.w, border: `1.5px solid ${C.bd}`, borderRadius: 8, padding: '10px 12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                            <span style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>{b.iname}</span>
                            <button onClick={() => removeBulk(b.iid)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.rd, fontSize: 18, lineHeight: 1 }}>×</button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                            <div>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Qty ({b.unit})</div>
                              <Inp type="number" min="1" value={b.qty} onChange={e => updateBulk(b.iid, 'qty', e.target.value)} placeholder="0" style={{ padding: '5px 8px' }} />
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Unit Price</div>
                              <div style={{ position: 'relative' }}>
                                <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: C.sub, fontSize: 11 }}>$</span>
                                {perms.inv_pricing_edit ? <Inp type="number" step="0.01" min="0" value={b.price} onChange={e => updateBulk(b.iid, 'price', e.target.value)} placeholder="0.00" style={{ padding: '5px 8px', paddingLeft: 16 }} /> : <Inp value={b.price} readOnly style={{ padding: '5px 8px', paddingLeft: 16, color: C.sub, background: C.lg }} />}
                              </div>
                            </div>
                            <div style={{ paddingBottom: 2, textAlign: 'right' }}>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Subtotal</div>
                              <div style={{ fontSize: 13, fontWeight: 800, color: sub > 0 ? C.gr : C.sub }}>{fm(sub)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ background: C.navy, borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Order Total</div>
                      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 }}>{bulkItems.filter(b => parseFloat(b.qty) > 0).length} of {bulkItems.length} items with quantities</div>
                    </div>
                    <div style={{ fontWeight: 900, fontSize: 22, color: C.gold }}>{fm(bulkTotal)}</div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => { setModal(null); setBulkItems([]); setBulkSrch(''); }} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="gold" sz="lg" onClick={confirmBulk} style={{ flex: 2, justifyContent: 'center' }}>✅ Receive {bulkItems.filter(b => parseFloat(b.qty) > 0).length > 0 ? `${bulkItems.filter(b => parseFloat(b.qty) > 0).length} Items ` : ''}into Warehouse</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Build Jobs ────────────────────────────────────
function BuildJobs({ jobs, setJobs, inv, users, user, perms }) {
  const [filt, setFilt] = useState('all');
  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  const [wStep, setWStep] = useState(1);
  const [wPO, setWPO] = useState({ po: '', name: '', addr: '', notes: '' });
  const [wItems, setWItems] = useState([]);
  const [wAssign, setWAssign] = useState('');
  const [iSrch, setISrch] = useState('');
  const [axQ, setAxQ] = useState('');
  const [axR, setAxR] = useState([]);
  const [axL, setAxL] = useState(false);
  const [apAssign, setApAssign] = useState('');
  const [srch, setSrch] = useState('');

  const fieldUsers = users.filter(u => (u.role === 'field' || u.role === 'Site Supervisor') && u.active);  const counts = { all: jobs.length, draft: 0, approved: 0, active: 0, completed: 0, closed: 0 };
  jobs.forEach(j => { if (counts[j.status] !== undefined) counts[j.status]++; });
  const q = srch.toLowerCase().trim();
  const shown = jobs.filter(j => (filt === 'all' || j.status === filt) && (q === '' || j.po.toLowerCase().includes(q) || j.name.toLowerCase().includes(q) || (j.addr || '').toLowerCase().includes(q))).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const resetWiz = () => { setWStep(1); setWPO({ po: '', name: '', addr: '', notes: '' }); setWItems([]); setWAssign(''); setISrch(''); setAxQ(''); setAxR([]); };
  const searchAX = async () => {
    if (!axQ.trim()) return;
    setAxL(true);
    await new Promise(r => setTimeout(r, 600));
    const mock = [{ po: 'PO-2025-010', name: 'Henderson Re-roof', addr: '4521 Sylvania Ave, Maumee OH' }, { po: 'PO-2025-011', name: 'Lake View Church', addr: '890 Lake Shore Dr, Toledo OH' }, { po: 'PO-2025-012', name: 'Perrysburg Commercial', addr: '200 Commerce Dr, Perrysburg OH' }];
    setAxR(mock.filter(j => j.name.toLowerCase().includes(axQ.toLowerCase()) || j.po.toLowerCase().includes(axQ.toLowerCase())));
    setAxL(false);
  };
  const addWItem = item => { if (wItems.find(i => i.iid === item.id)) return; setWItems(p => [...p, { iid: item.id, iname: item.name, icat: item.cat, unit: item.unit, qty: 1, avail: tot(item) }]); };
  const saveJob = asDraft => {
    if (!wPO.po || !wPO.name || wItems.length === 0) { alert('Please complete all steps first.'); return; }
    const now = new Date().toISOString();
    const job = { id: uid(), ...wPO, status: asDraft ? 'draft' : 'approved', assignedTo: wAssign, createdBy: user.id, createdAt: now, approvedAt: asDraft ? '' : now, completedAt: '', newForAssigned: !asDraft && !!wAssign, syncStatus: null, syncedAt: '', syncPayload: null, syncNote: '', items: wItems.map(i => mkJI(i.iid, i.iname, i.icat, i.unit, i.qty)) };
    setJobs(p => [...p, job]);
    setModal(null); resetWiz();
  };
  const doApprove = () => {
    if (!apAssign) { alert('Please assign a site supervisor.'); return; }
    setJobs(p => p.map(j => j.id === sel.id ? { ...j, status: 'approved', approvedAt: new Date().toISOString(), assignedTo: apAssign, newForAssigned: true } : j));
    setSel(null); setModal(null); setApAssign('');
  };
  const filtInv = inv.filter(i => i.name.toLowerCase().includes(iSrch.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>🏗️ Build Jobs</h1>
          <p style={{ margin: '2px 0 0', color: C.sub, fontSize: 12 }}>Plan inventory, assign site supervisors, manage the pipeline</p>
        </div>
        {perms.jobs_build && <Btn v="primary" onClick={() => { resetWiz(); setModal('new'); }}>+ New Job</Btn>}
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Inp value={srch} onChange={e => setSrch(e.target.value)} placeholder="🔍 Search by PO #, job name, or address..." style={{ flex: 1, minWidth: 220, maxWidth: 380 }} />
        {srch && <Btn v="ghost" sz="sm" onClick={() => setSrch('')}>✕ Clear</Btn>}
        {srch && <span style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>{shown.length} result{shown.length !== 1 ? 's' : ''}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[['all', 'All Jobs'], ['draft', 'Drafts'], ['approved', 'Approved'], ['active', 'Active'], ['completed', 'Completed'], ['closed', 'Closed']].map(([k, l]) => (
          <Btn key={k} v={filt === k ? 'primary' : 'ghost'} sz="sm" onClick={() => setFilt(k)}>{l}{counts[k] > 0 && <span style={{ marginLeft: 4, background: filt === k ? 'rgba(255,255,255,0.3)' : C.lg, color: filt === k ? C.w : C.sub, borderRadius: 20, fontSize: 10, padding: '1px 6px', fontWeight: 800 }}>{counts[k]}</span>}</Btn>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.map(job => {
          const sup = users.find(u => u.id === job.assignedTo);
          const st = jSC[job.status];
          const pulledCount = job.items.filter(i => i.pulled > 0).length;
          return (
            <div key={job.id} onClick={() => { setSel(job); setModal('detail'); }} style={{ background: C.w, borderRadius: 12, padding: 16, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: `2px solid ${job.status === 'approved' ? C.blue : job.status === 'active' ? C.am : 'transparent'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <Bdg color={st.c}>{st.icon} {st.l}</Bdg>
                  <span style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>{job.po}</span>
                  {job.syncStatus === 'synced' && <Bdg color="sky">☁️ AccuLynx Synced</Bdg>}
                  {job.syncStatus === 'failed' && <Bdg color="red">⚠️ Sync Failed</Bdg>}
                  {job.syncStatus === 'manual' && <Bdg color="amber">📋 Sync Pending</Bdg>}
                </div>
                <div style={{ fontWeight: 800, color: C.navy, fontSize: 15, marginBottom: 2 }}>{job.name}</div>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>{job.addr}</div>
                <div style={{ display: 'flex', gap: 14, fontSize: 11, color: C.sub, flexWrap: 'wrap' }}>
                  <span>📦 {job.items.length} items</span>
                  {sup ? <span>👤 {sup.name}</span> : <span style={{ color: C.am }}>⚠️ Unassigned</span>}
                  <span>Created {fd(job.createdAt)}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {(job.status === 'active' || job.status === 'completed') && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: C.sub, marginBottom: 3 }}>{pulledCount}/{job.items.length} pulled</div>
                    <div style={{ height: 5, width: 90, background: C.lg, borderRadius: 3 }}><div style={{ height: '100%', background: C.gr, borderRadius: 3, width: `${job.items.length > 0 ? (pulledCount / job.items.length) * 100 : 0}%` }} /></div>
                  </div>
                )}
                {perms.jobs_approve && job.status === 'draft' && <Btn v="teal" sz="sm" onClick={e => { e.stopPropagation(); setSel(job); setApAssign(job.assignedTo || ''); setModal('approve'); }}>Approve & Assign →</Btn>}
{job.status === 'completed' && <Btn v="green" sz="sm" onClick={e => { e.stopPropagation(); generatePDF(job, users); }}>📄 PDF</Btn>}
{perms.jobs_approve && (
  <Btn v="danger" sz="sm" onClick={e => { 
    e.stopPropagation();
    if (window.confirm('Permanently delete this job record? This cannot be undone.')) { 
      setJobs(p => p.filter(j => j.id !== job.id)); 
      if (sel?.id === job.id) setSel(null);
    } 
  }}>
    🗑️ Delete
  </Btn>
)}
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <div style={{ background: C.w, borderRadius: 12, padding: 30, textAlign: 'center', color: C.sub, fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>No {filt === 'all' ? '' : filt + ' '}jobs.{perms.jobs_build && filt === 'all' && ' Click "+ New Job" to get started.'}</div>}
      </div>

      {modal === 'detail' && sel && (
        <Modal title={`${sel.po} — ${sel.name}`} onClose={() => { setModal(null); setSel(null); }} wide>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {perms.jobs_approve && sel.status === 'draft' && <Btn v="teal" sz="sm" onClick={() => { setApAssign(sel.assignedTo || ''); setModal('approve'); }}>✅ Approve & Assign</Btn>}
            {(sel.status === 'completed' || sel.status === 'closed') && <Btn v="green" sz="sm" onClick={() => generatePDF(sel, users)}>📄 Download PDF Report</Btn>}
            {perms.jobs_approve && sel.status === 'completed' && <Btn v="purple" sz="sm" onClick={() => { if (window.confirm('Close this job? It will be moved to the Closed list and archived from active work.')) { const updated = { ...sel, status: 'closed', closedAt: new Date().toISOString() }; setJobs(p => p.map(j => j.id === sel.id ? updated : j)); setSel(updated); } }}>🔒 Close Job</Btn>}
            {perms.jobs_approve && sel.status === 'closed' && <Btn v="ghost" sz="sm" onClick={() => { const updated = { ...sel, status: 'completed', closedAt: '' }; setJobs(p => p.map(j => j.id === sel.id ? updated : j)); setSel(updated); }}>↩ Reopen</Btn>}
            {perms.jobs_build && sel.status === 'draft' && <Btn v="danger" sz="sm" onClick={() => { if (window.confirm('Delete this draft?')) { setJobs(p => p.filter(j => j.id !== sel.id)); setModal(null); setSel(null); } }}>🗑️ Delete</Btn>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, marginBottom: 16 }}>
            {[['Status', <Bdg color={jSC[sel.status].c}>{jSC[sel.status].l}</Bdg>], ['PO', sel.po], ['Assigned To', users.find(u => u.id === sel.assignedTo)?.name || 'Unassigned'], ['Created', fd(sel.createdAt)], ['Approved', fd(sel.approvedAt)], ['Completed', fd(sel.completedAt)]].map(([k, v]) => (
              <div key={k} style={{ background: C.lg, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: C.lg }}>{['Item', 'Category', 'Planned', 'Pulled', 'Used', ...(perms.inv_pricing_view ? ['Cost'] : [])].map(h => <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: C.sub, fontWeight: 700 }}>{h}</th>)}</tr></thead>
            <tbody>{sel.items.map(item => (
              <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}` }}>
                <td style={{ padding: '8px 10px', fontWeight: 700, color: C.navy }}>{item.iname}</td>
                <td style={{ padding: '8px 10px', color: C.sub }}>{item.icat}</td>
                <td style={{ padding: '8px 10px' }}>{item.planned} {item.unit}</td>
                <td style={{ padding: '8px 10px', color: item.pulled > 0 ? C.gr : C.sub }}>{item.pulled}</td>
                <td style={{ padding: '8px 10px', fontWeight: 700 }}>{item.pulled - item.returned}</td>
                {perms.inv_pricing_view && <td style={{ padding: '8px 10px', fontWeight: 700, color: C.blue }}>{item.pullCost > 0 ? fm(item.pullCost) : '—'}</td>}
              </tr>
            ))}</tbody>
          </table>
        </Modal>
      )}

      {modal === 'approve' && sel && (
        <Modal title={`Approve: ${sel.name}`} onClose={() => setModal(null)}>
          <div style={{ background: C.tB, border: `1.5px solid ${C.tl}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.tl, fontWeight: 600 }}>Approving will notify the assigned Site Supervisor.</div>
          <div style={{ background: C.lg, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
            <strong style={{ color: C.navy }}>{sel.po} — {sel.name}</strong>
            <div style={{ color: C.sub, marginTop: 2 }}>{sel.items.length} items planned</div>
          </div>
          <Fld label="Assign to Site Supervisor *">
            <Sel value={apAssign} onChange={e => setApAssign(e.target.value)}>
              <option value="">— Select Site Supervisor —</option>
              {fieldUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Sel>
          </Fld>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="teal" onClick={doApprove} style={{ flex: 1, justifyContent: 'center' }}>✅ Approve & Notify</Btn>
          </div>
        </Modal>
      )}

      {modal === 'new' && (
        <Modal title={`New Job — Step ${wStep} of 3`} onClose={() => { setModal(null); resetWiz(); }} wide>
          <div style={{ display: 'flex', gap: 0, marginBottom: 18, background: C.lg, borderRadius: 8, overflow: 'hidden' }}>
            {['1. Find Job', '2. Add Inventory', '3. Assign & Save'].map((s, i) => (
              <div key={s} style={{ flex: 1, padding: '9px 6px', textAlign: 'center', fontSize: 11, fontWeight: 700, background: wStep === i + 1 ? C.blue : wStep > i + 1 ? C.gB : 'transparent', color: wStep === i + 1 ? C.w : wStep > i + 1 ? C.gr : C.sub }}>{wStep > i + 1 ? '✓ ' : ''}{s}</div>
            ))}
          </div>
          {wStep === 1 && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Inp value={axQ} onChange={e => setAxQ(e.target.value)} placeholder="Search AccuLynx job name or PO..." onKeyDown={e => e.key === 'Enter' && searchAX()} style={{ flex: 1 }} />
                <Btn v="primary" onClick={searchAX}>{axL ? 'Searching...' : '🔍 Search'}</Btn>
              </div>
              {axR.length > 0 && (
                <div style={{ border: `1.5px solid ${C.bd}`, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
                  {axR.map(j => (
                    <div key={j.po} onClick={() => { setWPO({ po: j.po, name: j.name, addr: j.addr, notes: '' }); setAxR([]); }} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: `1px solid ${C.lg}`, background: C.w }} onMouseEnter={e => e.currentTarget.style.background = C.lg} onMouseLeave={e => e.currentTarget.style.background = C.w}>
                      <div style={{ fontWeight: 700, color: C.navy }}>{j.name}</div>
                      <div style={{ fontSize: 11, color: C.sub }}>{j.po} · {j.addr}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ borderTop: `1px solid ${C.lg}`, paddingTop: 14 }}>
                <Fld label="Job PO Number *"><Inp value={wPO.po} onChange={e => setWPO({ ...wPO, po: e.target.value })} placeholder="PO-2025-XXX" /></Fld>
                <Fld label="Job Name *"><Inp value={wPO.name} onChange={e => setWPO({ ...wPO, name: e.target.value })} placeholder="Customer / Project Name" /></Fld>
                <Fld label="Job Address *"><Inp value={wPO.addr} onChange={e => setWPO({ ...wPO, addr: e.target.value })} placeholder="123 Main St, Toledo OH" /></Fld>
                <Fld label="Notes"><TA value={wPO.notes} onChange={e => setWPO({ ...wPO, notes: e.target.value })} placeholder="Job details..." /></Fld>
              </div>
              <Btn v="primary" sz="lg" onClick={() => { if (!wPO.po || !wPO.name) { alert('PO and Job Name required.'); return; } setWStep(2); }} style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}>Continue →</Btn>
            </div>
          )}
          {wStep === 2 && (
            <div>
              <div style={{ background: C.gL, border: `1.5px solid ${C.gold}`, borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, fontWeight: 700, color: C.navy }}>📋 {wPO.po} — {wPO.name}</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: 220 }}>
                  <Inp value={iSrch} onChange={e => setISrch(e.target.value)} placeholder="🔍 Search inventory..." style={{ marginBottom: 8 }} />
                  <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {filtInv.map(item => {
                      const added = wItems.find(i => i.iid === item.id);
                      return (
                        <div key={item.id} style={{ background: C.w, borderRadius: 8, padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1.5px solid ${added ? C.blue : 'transparent'}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                          <div>
                            <div style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>{item.name}</div>
                            <div style={{ fontSize: 10, color: C.sub }}>{tot(item)} {item.unit} available</div>
                          </div>
                          {added ? <Bdg color="blue">Added ✓</Bdg> : <Btn v="primary" sz="sm" onClick={() => addWItem(item)}>+ Add</Btn>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 170 }}>
                  <div style={{ background: C.w, borderRadius: 10, padding: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', position: 'sticky', top: 0 }}>
                    <h4 style={{ margin: '0 0 10px', color: C.navy, fontSize: 13 }}>📦 Job List ({wItems.length})</h4>
                    {wItems.length === 0 ? <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>Add items from the list</p> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {wItems.map(i => (
                          <div key={i.iid} style={{ background: C.lg, borderRadius: 7, padding: '7px 9px' }}>
                            <div style={{ fontWeight: 700, color: C.navy, fontSize: 11, marginBottom: 4 }}>{i.iname}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <Inp type="number" value={i.qty} min="1" max={i.avail} onChange={e => setWItems(p => p.map(x => x.iid === i.iid ? { ...x, qty: Math.max(1, parseInt(e.target.value) || 1) } : x))} style={{ width: 55, padding: '3px 6px' }} />
                              <span style={{ fontSize: 10, color: C.sub }}>{i.unit}</span>
                              <button onClick={() => setWItems(p => p.filter(x => x.iid !== i.iid))} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: C.rd, fontSize: 16, lineHeight: 1 }}>×</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <Btn v="ghost" onClick={() => setWStep(1)} style={{ flex: 1, justifyContent: 'center' }}>← Back</Btn>
                <Btn v="primary" onClick={() => { if (wItems.length === 0) { alert('Add at least one item.'); return; } setWStep(3); }} style={{ flex: 1, justifyContent: 'center' }}>Continue →</Btn>
              </div>
            </div>
          )}
          {wStep === 3 && (
            <div>
              <div style={{ background: C.lg, borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, color: C.navy }}>{wPO.po} — {wPO.name}</div>
                <div style={{ fontSize: 12, color: C.sub }}>{wItems.length} items planned</div>
              </div>
              <Fld label="Assign to Site Supervisor" hint="Leave blank to save as draft and assign later.">
                <Sel value={wAssign} onChange={e => setWAssign(e.target.value)}>
                  <option value="">— Assign later (save as draft) —</option>
                  {fieldUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Sel>
              </Fld>
              <div style={{ background: wAssign ? C.tB : C.aB, border: `1px solid ${wAssign ? C.tl : C.am}`, borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: wAssign ? C.tl : C.am, fontWeight: 600 }}>{wAssign ? `✅ ${users.find(u => u.id === wAssign)?.name} will be notified when you approve.` : '⚠️ No supervisor assigned — will save as draft.'}</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <Btn v="ghost" onClick={() => setWStep(2)} style={{ flex: 1, justifyContent: 'center' }}>← Back</Btn>
                <Btn v="ghost" onClick={() => saveJob(true)} style={{ flex: 1, justifyContent: 'center' }}>💾 Save Draft</Btn>
                <Btn v="teal" onClick={() => saveJob(false)} style={{ flex: 1, justifyContent: 'center' }}>✅ Approve & Notify</Btn>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ── Pull Inventory ────────────────────────────────
function PullInventory({ jobs, setJobs, inv, setInv, users, user, perms, activeLogo, acculynxConfig }) {
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [pullQtys, setPullQtys] = useState({});
  const [retQtys, setRetQtys] = useState({});
  const [syncModal, setSyncModal] = useState(null);
  const isField = user.role === 'field';
  const myJobs = isField ? jobs.filter(j => j.assignedTo === user.id && j.status !== 'draft') : jobs.filter(j => j.status !== 'draft').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const openJob = j => { setSel(j); if (j.newForAssigned && j.assignedTo === user.id) setJobs(p => p.map(x => x.id === j.id ? { ...x, newForAssigned: false } : x)); };

  const confirmPull = () => {
    if (!sel) return;
    const newInv = [...inv];
    let ok = true;
    const updItems = [...sel.items];
    for (const item of updItems) {
      const qty = parseFloat(pullQtys[item.iid]) ?? item.planned;
      if (qty <= 0) continue;
      const idx = newInv.findIndex(i => i.id === item.iid);
      if (idx < 0) continue;
      const res = doFifo(newInv[idx], qty);
      if (!res) { alert(`Not enough stock for ${item.iname}`); ok = false; break; }
      newInv[idx] = { ...newInv[idx], batches: res.batches };
      const ppu = qty > 0 ? res.cost / qty : 0;
      const ji = updItems.findIndex(i => i.iid === item.iid);
      updItems[ji] = { ...updItems[ji], pulled: qty, priceAtPull: ppu, pullCost: res.cost };
    }
    if (!ok) return;
    setInv(newInv);
    const upd = { ...sel, status: 'active', items: updItems };
    setJobs(p => p.map(j => j.id === sel.id ? upd : j));
    setSel(upd);
    setModal(null); setPullQtys({});
  };

  const confirmReturn = () => {
    if (!sel) return;
    const newInv = [...inv];
    const updItems = sel.items.map(item => {
      const ret = Math.min(parseFloat(retQtys[item.iid]) || 0, item.pulled);
      if (ret > 0) {
        const idx = newInv.findIndex(i => i.id === item.iid);
        if (idx >= 0) {
          const nb = { id: uid(), rcvd: new Date().toISOString().split('T')[0], qty: ret, price: item.priceAtPull, by: user.id, rem: ret };
          newInv[idx] = { ...newInv[idx], batches: [...newInv[idx].batches, nb] };
        }
      }
      return { ...item, returned: ret };
    });
    setInv(newInv);
    const upd = { ...sel, status: 'completed', completedAt: new Date().toISOString(), items: updItems };
    setJobs(p => p.map(j => j.id === sel.id ? upd : j));
    setModal(null); setRetQtys({});
    setTimeout(() => { generatePDF(upd, users, activeLogo); attemptAccuLynxSync(upd, users, acculynxConfig, setJobs); }, 300);
    setSel(null);
  };

  const syncBadge = job => {
    if (!job.syncStatus || job.status !== 'completed') return null;
    if (job.syncStatus === 'synced') return <Bdg color="sky">☁️ AccuLynx Synced</Bdg>;
    if (job.syncStatus === 'failed') return <Bdg color="red">⚠️ Sync Failed</Bdg>;
    if (job.syncStatus === 'manual') return <Bdg color="amber">📋 Configure Sync</Bdg>;
    return null;
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>📋 Pull Inventory</h1>
        <p style={{ margin: '2px 0 0', color: C.sub, fontSize: 12 }}>{isField ? 'Your assigned jobs' : 'All active jobs in pipeline'}</p>
      </div>
      {isField && myJobs.some(j => j.newForAssigned) && <div style={{ background: C.tB, border: `2px solid ${C.tl}`, borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 13, fontWeight: 700, color: C.tl }}>🎉 You have new jobs assigned to you!</div>}
      {myJobs.length === 0 && <div style={{ background: C.w, borderRadius: 12, padding: 40, textAlign: 'center', color: C.sub, fontSize: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>{isField ? 'No jobs assigned yet. Your Production Coordinator will assign jobs here.' : 'No jobs in pipeline yet.'}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {myJobs.map(job => {
          const sup = users.find(u => u.id === job.assignedTo);
          const st = jSC[job.status];
          const isNew = job.newForAssigned && job.assignedTo === user.id;
          const totalCost = job.items.reduce((s, i) => s + (i.pulled - i.returned) * i.priceAtPull, 0);
          return (
            <div key={job.id} style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: `2px solid ${isNew ? C.tl : job.status === 'active' ? C.am : 'transparent'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
                    <Bdg color={st.c}>{st.icon} {st.l}</Bdg>
                    {isNew && <Bdg color="teal">🔔 NEW</Bdg>}
                    <span style={{ fontSize: 12, color: C.sub }}>{job.po}</span>
                    {syncBadge(job)}
                  </div>
                  <div style={{ fontWeight: 800, color: C.navy, fontSize: 15, marginBottom: 2 }}>{job.name}</div>
                  <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>{job.addr}</div>
                  {!isField && sup && <div style={{ fontSize: 11, color: C.blue, fontWeight: 700 }}>👤 {sup.name}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-end' }}>
                  {perms.jobs_pull && job.status === 'approved' && <Btn v="teal" sz="sm" onClick={() => { openJob(job); const q = {}; job.items.forEach(i => { q[i.iid] = i.planned; }); setPullQtys(q); setModal('pull'); setSel(job); }}>🚛 Pull Materials</Btn>}
                  {perms.jobs_complete && job.status === 'active' && <Btn v="gold" sz="sm" onClick={() => { setSel(job); const q = {}; job.items.forEach(i => { q[i.iid] = 0; }); setRetQtys(q); setModal('return'); }}>📦 Return & Complete</Btn>}
                  {job.status === 'completed' && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Btn v="green" sz="sm" onClick={() => generatePDF(job, users, activeLogo)}>📄 PDF</Btn>
                      <Btn v="sky" sz="sm" onClick={() => setSyncModal(job)}>☁️ Sync Status</Btn>
                    </div>
                  )}
                  <Btn v="ghost" sz="sm" onClick={() => openJob(job)}>Details</Btn>
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${C.lg}`, paddingTop: 10, display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {job.items.slice(0, 6).map(item => (
                  <div key={item.iid} style={{ background: item.pulled > 0 ? C.gB : C.lg, borderRadius: 7, padding: '5px 10px', flexShrink: 0, border: item.pulled > 0 ? `1px solid ${C.gr}` : 'none' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, whiteSpace: 'nowrap' }}>{item.iname}</div>
                    <div style={{ fontSize: 10, color: C.sub }}>{item.pulled > 0 ? `${item.pulled - item.returned} used` : `${item.planned} ${item.unit} planned`}</div>
                  </div>
                ))}
                {job.items.length > 6 && <div style={{ background: C.lg, borderRadius: 7, padding: '5px 10px', flexShrink: 0, display: 'flex', alignItems: 'center', fontSize: 10, color: C.sub }}>+{job.items.length - 6} more</div>}
              </div>
              {perms.inv_pricing_view && job.status === 'completed' && totalCost > 0 && <div style={{ marginTop: 8, borderTop: `1px solid ${C.lg}`, paddingTop: 8, display: 'flex', justifyContent: 'flex-end' }}><span style={{ fontWeight: 900, fontSize: 15, color: C.gr }}>Total: {fm(totalCost)}</span></div>}
            </div>
          );
        })}
      </div>

      {modal === 'pull' && sel && (
        <Modal title={`Pull Materials — ${sel.name}`} onClose={() => { setModal(null); setSel(null); setPullQtys({}); }} wide>
          <div style={{ background: C.tB, border: `1.5px solid ${C.tl}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.tl, fontWeight: 600 }}>Adjust quantities if needed. Confirm to deduct from warehouse inventory (FIFO).</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14, fontSize: 13 }}>
            <thead><tr style={{ background: C.lg }}>{['Item', 'Planned', 'Actual to Pull', 'Available'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11 }}>{h}</th>)}</tr></thead>
            <tbody>{sel.items.map(item => {
              const avail = tot(inv.find(i => i.id === item.iid) || { batches: [] });
              const actual = parseFloat(pullQtys[item.iid]) ?? item.planned;
              const short = actual > avail;
              return (
                <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}`, background: short ? C.rB : 'transparent' }}>
                  <td style={{ padding: '9px 10px', fontWeight: 700, color: C.navy }}>{item.iname}</td>
                  <td style={{ padding: '9px 10px' }}>{item.planned} {item.unit}</td>
                  <td style={{ padding: '9px 10px' }}><Inp type="number" value={pullQtys[item.iid] ?? item.planned} min="0" max={avail} onChange={e => setPullQtys(p => ({ ...p, [item.iid]: Math.max(0, parseFloat(e.target.value) || 0) }))} style={{ width: 80, padding: '4px 8px' }} /></td>
                  <td style={{ padding: '9px 10px', color: short ? C.rd : C.gr, fontWeight: 700 }}>{avail} {item.unit}{short && ' ⚠️'}</td>
                </tr>
              );
            })}</tbody>
          </table>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => { setModal(null); setSel(null); setPullQtys({}); }} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="teal" sz="lg" onClick={confirmPull} style={{ flex: 2, justifyContent: 'center' }}>✅ Confirm Pull from Warehouse</Btn>
          </div>
        </Modal>
      )}

      {modal === 'return' && sel && (
        <Modal title={`Return Unused — ${sel.name}`} onClose={() => { setModal(null); setRetQtys({}); }} wide>
          <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.am, fontWeight: 600 }}>Enter quantities being returned. PDF report + AccuLynx sync will trigger on completion.</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14, fontSize: 13 }}>
            <thead><tr style={{ background: C.lg }}>{['Item', 'Pulled', 'Returning', 'Will Be Used'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11 }}>{h}</th>)}</tr></thead>
            <tbody>{sel.items.filter(i => i.pulled > 0).map(item => {
              const ret = Math.min(parseFloat(retQtys[item.iid]) || 0, item.pulled);
              const used = item.pulled - ret;
              return (
                <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}` }}>
                  <td style={{ padding: '9px 10px', fontWeight: 700, color: C.navy }}>{item.iname}</td>
                  <td style={{ padding: '9px 10px' }}>{item.pulled} {item.unit}</td>
                  <td style={{ padding: '9px 10px' }}><Inp type="number" value={retQtys[item.iid] ?? 0} min="0" max={item.pulled} onChange={e => setRetQtys(p => ({ ...p, [item.iid]: Math.min(item.pulled, Math.max(0, parseFloat(e.target.value) || 0)) }))} style={{ width: 80, padding: '4px 8px' }} /></td>
                  <td style={{ padding: '9px 10px', fontWeight: 800, color: used > 0 ? C.navy : C.sub }}>{used} {item.unit}</td>
                </tr>
              );
            })}</tbody>
            {perms.inv_pricing_view && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${C.navy}` }}>
                  <td colSpan={3} style={{ padding: '9px 10px', fontWeight: 700, color: C.navy }}>Estimated Cost</td>
                  <td style={{ padding: '9px 10px', fontWeight: 900, color: C.gr, fontSize: 15 }}>{fm(sel.items.filter(i => i.pulled > 0).reduce((s, i) => { const ret = Math.min(parseFloat(retQtys[i.iid]) || 0, i.pulled); return s + (i.pulled - ret) * i.priceAtPull; }, 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => { setModal(null); setRetQtys({}); }} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="green" sz="lg" onClick={confirmReturn} style={{ flex: 2, justifyContent: 'center' }}>🏁 Complete Job & Generate PDF</Btn>
          </div>
        </Modal>
      )}

      {modal === null && sel && (
        <Modal title={`${sel.po} — ${sel.name}`} onClose={() => setSel(null)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8, marginBottom: 14 }}>
            {[['Status', <Bdg color={jSC[sel.status].c}>{jSC[sel.status].l}</Bdg>], ['PO', sel.po], ['Assigned To', users.find(u => u.id === sel.assignedTo)?.name || '—'], ['Approved', fd(sel.approvedAt)], ['Completed', fd(sel.completedAt)]].map(([k, v]) => (
              <div key={k} style={{ background: C.lg, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: C.lg }}>{['Item', 'Planned', 'Pulled', 'Returned', 'Used', ...(perms.inv_pricing_view ? ['Cost'] : [])].map(h => <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: C.sub, fontWeight: 700 }}>{h}</th>)}</tr></thead>
            <tbody>{sel.items.map(item => (
              <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}` }}>
                <td style={{ padding: '8px 10px', fontWeight: 700, color: C.navy }}>{item.iname}</td>
                <td style={{ padding: '8px 10px' }}>{item.planned}</td>
                <td style={{ padding: '8px 10px', color: item.pulled > 0 ? C.gr : C.sub }}>{item.pulled}</td>
                <td style={{ padding: '8px 10px', color: item.returned > 0 ? C.am : C.sub }}>{item.returned}</td>
                <td style={{ padding: '8px 10px', fontWeight: 700 }}>{item.pulled - item.returned}</td>
                {perms.inv_pricing_view && <td style={{ padding: '8px 10px', color: C.blue, fontWeight: 700 }}>{item.pullCost > 0 ? fm((item.pulled - item.returned) * item.priceAtPull) : '—'}</td>}
              </tr>
            ))}</tbody>
          </table>
          {sel.status === 'completed' && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn v="green" onClick={() => generatePDF(sel, users, activeLogo)}>📄 PDF</Btn>
              <Btn v="sky" onClick={() => setSyncModal(sel)}>☁️ AccuLynx Sync</Btn>
            </div>
          )}
        </Modal>
      )}

      {syncModal && (
        <Modal title={`AccuLynx Sync — ${syncModal.po}`} onClose={() => setSyncModal(null)}>
          <div style={{ marginBottom: 14 }}>
            {syncModal.syncStatus === 'synced' && (
              <div style={{ background: C.sB, border: `1.5px solid ${C.sl}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontWeight: 700, color: C.sl, marginBottom: 4 }}>☁️ Successfully Synced to AccuLynx</div>
                <div style={{ fontSize: 12, color: C.sub }}>{syncModal.syncNote}</div>
                {syncModal.syncedAt && <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>Synced: {ft(syncModal.syncedAt)}</div>}
              </div>
            )}
            {syncModal.syncStatus === 'failed' && (
              <div style={{ background: C.rB, border: `1.5px solid ${C.rd}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontWeight: 700, color: C.rd, marginBottom: 4 }}>⚠️ Sync Failed</div>
                <div style={{ fontSize: 12, color: C.sub }}>{syncModal.syncNote}</div>
              </div>
            )}
            {(syncModal.syncStatus === 'manual' || !syncModal.syncStatus) && (
              <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontWeight: 700, color: C.am, marginBottom: 4 }}>📋 Auto-Sync Not Configured</div>
                <div style={{ fontSize: 12, color: C.navy }}>Configure AccuLynx in Settings → AccuLynx to enable automatic document upload and cost entry.</div>
              </div>
            )}
          </div>
          {syncModal.syncPayload && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', marginBottom: 6 }}>Payload Sent to AccuLynx</div>
              <div style={{ background: '#1A202C', borderRadius: 8, padding: 12, overflowX: 'auto', marginBottom: 12 }}>
                <pre style={{ margin: 0, fontSize: 10, color: '#68D391', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(syncModal.syncPayload, null, 2)}</pre>
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {(syncModal.syncStatus === 'failed' || syncModal.syncStatus === 'manual') && <Btn v="sky" onClick={() => { attemptAccuLynxSync(syncModal, users, acculynxConfig, setJobs); setSyncModal(null); }} style={{ flex: 1, justifyContent: 'center' }}>🔄 Retry Sync</Btn>}
            <Btn v="ghost" onClick={() => setSyncModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Close</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Fleet ─────────────────────────────────────────
function Fleet({ vehs, setVehs, reqs, setReqs, users, user, perms, vehPhotos, setVehPhotos }) {
  const [filt, setFilt] = useState('all');
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [reqModal, setReqModal] = useState(false);
  const [reqVid, setReqVid] = useState('');
  const [isEditingInfo, setIsEditingInfo] = useState(false); // Added State Flag
  const filtered = vehs.filter(v => filt === 'all' || v.type === filt);
  const setPhoto = (id, data) => setVehPhotos(p => data ? { ...p, [id]: data } : Object.fromEntries(Object.entries(p).filter(([k]) => k !== id)));
  
  const logMi = () => {
    if (!form.mi || !form.date) return;
    const mi = parseFloat(form.mi);
    if (mi < sel.mi) { alert('Cannot be less than current mileage.'); return; }
    const up = { ...sel, mi, mil: [...sel.mil, { dt: form.date, mi, by: user.id }] };
    setVehs(p => p.map(v => v.id === sel.id ? up : v));
    setSel(up); setModal(null); setForm({});
  };
  const logSvc = () => {
    if (!form.type || !form.date) return;
    const e = { id: uid(), type: form.type, dt: form.date, mi: parseFloat(form.mi) || sel.mi, by: form.by || user.name, notes: form.notes || '', cost: parseFloat(form.cost) || 0 };
    const up = { ...sel, sl: [...sel.sl, e], ...(form.type === 'Oil Change' ? { lomi: e.mi } : {}), ...(form.type === 'Detail' ? { ldd: form.date } : {}) };
    setVehs(p => p.map(v => v.id === sel.id ? up : v));
    setSel(up); setModal(null); setForm({});
  };
  const assignUser = () => {
    const up = { ...sel, assignedTo: form.assignedTo || '' };
    setVehs(p => p.map(v => v.id === sel.id ? up : v));
    setSel(up); setModal(null); setForm({});
  };
  const vReqs = sel ? reqs.filter(r => r.vid === sel.id && r.status !== 'completed') : [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>🚛 Fleet Management</h1>
          <p style={{ margin: '2px 0 0', color: C.sub, fontSize: 12 }}>{vehs.filter(v => v.type === 'truck').length} trucks · {vehs.filter(v => v.type === 'trailer').length} trailers</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {perms.maint_submit && <Btn v="purple" sz="sm" onClick={() => { setReqVid(''); setReqModal(true); }}>🔧 Request Maintenance</Btn>}
          <div style={{ display: 'flex', gap: 5 }}>{['all', 'truck', 'trailer'].map(f => <Btn key={f} v={filt === f ? 'primary' : 'ghost'} sz="sm" onClick={() => setFilt(f)} style={{ textTransform: 'capitalize' }}>{f === 'all' ? 'All' : f + 's'}</Btn>)}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(255px,1fr))', gap: 12 }}>
        {filtered.map(v => {
          const os = oilSt(v);
          const ds = detSt(v);
          const bc = os === 'overdue' || ds === 'overdue' ? C.rd : os === 'soon' || ds === 'soon' ? C.am : 'transparent';
          const oLeft = v.type === 'truck' ? v.oii - (v.mi - v.lomi) : null;
          const pd = predDays(v);
          const vOpenReqs = reqs.filter(r => r.vid === v.id && r.status !== 'completed');
          const asgn = users.find(u => u.id === v.assignedTo);
          const photo = vehPhotos[v.id];
          return (
            <div key={v.id} onClick={() => setSel(v)} style={{ background: C.w, borderRadius: 12, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: `2px solid ${bc}` }}>
              <div style={{ height: 130, background: photo ? '#000' : C.lg, overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {photo ? <img src={photo} alt={v.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 52, opacity: 0.25 }}>{v.type === 'truck' ? '🚛' : '🚜'}</span>}
                <div style={{ position: 'absolute', top: 8, left: 8 }}>{vOpenReqs.length > 0 && <span style={{ background: C.pu, color: C.w, borderRadius: 20, fontSize: 10, padding: '2px 8px', fontWeight: 800 }}>{vOpenReqs.length} req</span>}</div>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent,rgba(0,0,0,0.55))', padding: '8px 10px 6px' }}>
                  <div style={{ fontWeight: 800, color: photo ? C.w : C.navy, fontSize: 14, textShadow: photo ? '0 1px 3px rgba(0,0,0,0.5)' : 'none' }}>{v.name}</div>
                  <div style={{ fontSize: 10, color: photo ? 'rgba(255,255,255,0.8)' : C.sub }}>{v.yr} {v.make} {v.model} · #{v.plate}</div>
                </div>
              </div>
              <div style={{ padding: 12 }}>
                {asgn && <div style={{ fontSize: 10, color: C.blue, fontWeight: 700, marginBottom: 6 }}>👤 {asgn.name}</div>}
                {v.type === 'truck' && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                      <span style={{ color: C.sub }}>Mileage</span>
                      <span style={{ fontWeight: 700, color: C.navy }}>{v.mi.toLocaleString()} mi</span>
                    </div>
                    <div style={{ height: 4, background: C.lg, borderRadius: 3, marginBottom: 3 }}><div style={{ height: '100%', borderRadius: 3, background: os === 'overdue' ? C.rd : os === 'soon' ? C.am : C.gr, width: `${Math.max(0, Math.min(100, (1 - (oLeft / v.oii)) * 100))}%` }} /></div>
                    <div style={{ fontSize: 10, color: oLeft <= 0 ? C.rd : C.sub }}>{oLeft <= 0 ? '🚨 Oil overdue!' : `${Math.max(0, oLeft)} mi until oil change`}{pd !== null && <span style={{ color: C.blue }}> · ~{pd === 0 ? 'overdue' : `${pd}d`}</span>}</div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {v.type === 'truck' && <Bdg color={os === 'overdue' ? 'red' : os === 'soon' ? 'amber' : 'green'}>{os === 'overdue' ? 'Oil Overdue' : os === 'soon' ? 'Oil Soon' : 'Oil OK'}</Bdg>}
                  <Bdg color={ds === 'overdue' ? 'red' : ds === 'soon' ? 'amber' : 'green'}>{ds === 'overdue' ? 'Detail Overdue' : ds === 'soon' ? 'Detail Soon' : 'Detail OK'}</Bdg>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {sel && (
        <Modal title={`${sel.name} — ${sel.yr} ${sel.make} ${sel.model}`} onClose={() => { setSel(null); setIsEditingInfo(false); }} wide>
  <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
    {perms.fleet_log_mi && sel.type === 'truck' && <Btn v="primary" sz="sm" onClick={() => { setForm({ date: new Date().toISOString().split('T')[0], mi: sel.mi }); setModal('mi'); }}>📍 Log Mileage</Btn>}
    {perms.fleet_edit && <Btn v="outline" sz="sm" onClick={() => { setForm({ type: 'Oil Change', date: new Date().toISOString().split('T')[0], mi: sel.mi }); setModal('svc'); }}>🔧 Log Service</Btn>}
    {perms.fleet_edit && <Btn v="ghost" sz="sm" onClick={() => { setForm({ assignedTo: sel.assignedTo || '' }); setModal('assign'); }}>👤 Assign Driver</Btn>}
    {perms.fleet_edit && (
      <Btn v="outline" sz="sm" onClick={() => {
        setForm({ name: sel.name, plate: sel.plate, make: sel.make, model: sel.model, yr: sel.yr });
        setIsEditingInfo(!isEditingInfo);
      }}>
        ✏️ {isEditingInfo ? 'Cancel Details Edit' : 'Edit Vehicle Name/Plate'}
      </Btn>
    )}
  </div>
  {isEditingInfo && (
    <div style={{ background: C.lg, padding: 14, borderRadius: 10, marginBottom: 14, border: `1.5px solid ${C.bd}` }}>
      <Fld label="Vehicle Display Name / Nickname"><Inp value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} /></Fld>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Fld label="Year"><Inp type="number" value={form.yr || ''} onChange={e => setForm({...form, yr: e.target.value})} /></Fld>
        <Fld label="Make"><Inp value={form.make || ''} onChange={e => setForm({...form, make: e.target.value})} /></Fld>
        <Fld label="Model"><Inp value={form.model || ''} onChange={e => setForm({...form, model: e.target.value})} /></Fld>
      </div>
      <Fld label="License Plate"><Inp value={form.plate || ''} onChange={e => setForm({...form, plate: e.target.value})} /></Fld>
      <Btn v="green" sz="sm" onClick={() => {
        const updated = { ...sel, name: form.name, yr: parseInt(form.yr) || sel.yr, make: form.make, model: form.model, plate: form.plate };
        setVehs(p => p.map(v => v.id === sel.id ? updated : v));
        setSel(updated);
        setIsEditingInfo(false);
      }}>Save Vehicle Changes</Btn>
    </div>
  )}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Vehicle Photo</div>
            <PhotoUpload current={vehPhotos[sel.id] || null} onUpload={data => setPhoto(sel.id, data)} label="Upload vehicle photo" maxDim={600} quality={0.75} previewHeight={200} />
          </div>
          {vReqs.length > 0 && (
            <div style={{ background: C.pB, border: `1.5px solid ${C.pu}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, color: C.pu, fontSize: 12, marginBottom: 8 }}>🔧 Open Requests ({vReqs.length})</div>
              {vReqs.map(r => (
                <div key={r.id} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 7, padding: '8px 10px', marginBottom: 6, fontSize: 11 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                    <Bdg color={r.status === 'pending' ? 'amber' : 'blue'}>{r.status}</Bdg>
                    <strong>{r.type}</strong>
                    {r.urgency === 'urgent' && <span style={{ color: C.rd }}>🚨</span>}
                  </div>
                  <div style={{ color: C.sub }}>{r.notes}</div>
                  {r.scheduledDate && <div style={{ color: C.blue, fontWeight: 700, marginTop: 3 }}>📅 {fd(r.scheduledDate)}</div>}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8, marginBottom: 16 }}>
            {[['Plate', sel.plate], ['Assigned To', users.find(u => u.id === sel.assignedTo)?.name || 'Unassigned'], ...(sel.type === 'truck' ? [['Mileage', sel.mi.toLocaleString()], ['Last Oil @ Mi', sel.lomi.toLocaleString()], ['Miles Rem.', Math.max(0, sel.oii - (sel.mi - sel.lomi))]] : []), ['Last Detail', fd(sel.ldd)]].map(([k, v]) => (
              <div key={k} style={{ background: C.lg, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.navy, marginTop: 1 }}>{v}</div>
              </div>
            ))}
          </div>
          <h4 style={{ margin: '0 0 8px', color: C.navy, fontSize: 12, textTransform: 'uppercase' }}>Service History</h4>
          {sel.sl.length === 0 ? <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>No service records.</p> : [...sel.sl].sort((a, b) => new Date(b.dt) - new Date(a.dt)).map(s => (
            <div key={s.id} style={{ padding: '10px 14px', background: C.lg, borderRadius: 8, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <Bdg color={s.type === 'Oil Change' ? 'blue' : 'green'}>{s.type}</Bdg>
                  <div style={{ fontWeight: 700, color: C.navy, marginTop: 4, fontSize: 13 }}>{fd(s.dt)}</div>
                  <div style={{ fontSize: 11, color: C.sub }}>{s.by}{s.mi ? ` · ${s.mi.toLocaleString()} mi` : ''}</div>
                </div>
                {s.cost > 0 && <div style={{ fontWeight: 800, color: C.blue }}>{fm(s.cost)}</div>}
              </div>
            </div>
          ))}
        </Modal>
      )}

      {modal === 'assign' && sel && (
        <Modal title={`Assign Driver — ${sel.name}`} onClose={() => setModal(null)}>
          <Fld label="Assigned Driver">
            <Sel value={form.assignedTo || ''} onChange={e => setForm({ ...form, assignedTo: e.target.value })}>
              <option value="">— Unassigned —</option>
              {users.filter(u => u.active).map(u => <option key={u.id} value={u.id}>{u.name} ({ROLES[u.role]?.label || u.role})</option>)}
            </Sel>
          </Fld>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={assignUser} style={{ flex: 1, justifyContent: 'center' }}>Save</Btn>
          </div>
        </Modal>
      )}

      {modal === 'mi' && sel && (
        <Modal title={`Log Mileage — ${sel.name}`} onClose={() => setModal(null)}>
          <div style={{ background: C.lg, borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, color: C.sub }}>Current: <strong>{sel.mi.toLocaleString()} mi</strong></div>
          <Fld label="Date"><Inp type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Fld>
          <Fld label="Odometer (miles)"><Inp type="number" value={form.mi} onChange={e => setForm({ ...form, mi: e.target.value })} /></Fld>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={logMi} style={{ flex: 1, justifyContent: 'center' }}>Save</Btn>
          </div>
        </Modal>
      )}

      {modal === 'svc' && sel && (
        <Modal title={`Log Service — ${sel.name}`} onClose={() => setModal(null)}>
          <Fld label="Service Type"><Sel value={form.type || 'Oil Change'} onChange={e => setForm({ ...form, type: e.target.value })}>{['Oil Change', 'Tire Rotation', 'Brake Service', 'Repair', 'Detail', 'Inspection', 'Other'].map(t => <option key={t}>{t}</option>)}</Sel></Fld>
          <Fld label="Date"><Inp type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Fld>
          {sel.type === 'truck' && <Fld label="Mileage"><Inp type="number" value={form.mi} onChange={e => setForm({ ...form, mi: e.target.value })} /></Fld>}
          <Fld label="Performed By"><Inp value={form.by || ''} onChange={e => setForm({ ...form, by: e.target.value })} placeholder="Shop or employee" /></Fld>
          <Fld label="Cost ($)"><Inp type="number" step="0.01" value={form.cost || ''} onChange={e => setForm({ ...form, cost: e.target.value })} /></Fld>
          <Fld label="Notes"><Inp value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Fld>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={logSvc} style={{ flex: 1, justifyContent: 'center' }}>Save</Btn>
          </div>
        </Modal>
      )}

      {reqModal && perms.maint_submit && <ReqModal vehs={vehs} user={user} preVid={reqVid} onSave={r => setReqs(p => [r, ...p])} onClose={() => { setReqModal(false); setReqVid(''); }} />}
    </div>
  );
}

function ReqModal({ vehs, user, onSave, onClose, preVid }) {
  const [form, setForm] = useState({ vid: preVid || '', type: 'Oil Change', urgency: 'normal', notes: '', mileage: '' });
  const selV = vehs.find(v => v.id === form.vid);
  const submit = () => {
    if (!form.vid || !form.notes.trim()) { alert('Please select a vehicle and describe the issue.'); return; }
    const v = vehs.find(x => x.id === form.vid);
    onSave({ id: uid(), vid: form.vid, vname: `${v.name} (${v.plate})`, vtype: v.type, type: form.type, urgency: form.urgency, notes: form.notes, mileage: form.mileage, uid: user.id, uname: user.name, at: new Date().toISOString(), status: 'pending', scheduledDate: '', completedAt: '', whNotes: '' });
    onClose();
  };
  return (
    <Modal title="🔧 Submit Maintenance Request" onClose={onClose}>
      <div style={{ background: C.pB, border: `1.5px solid ${C.pu}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.pu, fontWeight: 600 }}>Your request will be sent to the Warehouse Manager for scheduling.</div>
      <Fld label="Vehicle *">
        <Sel value={form.vid} onChange={e => setForm({ ...form, vid: e.target.value, type: 'Oil Change' })}>
          <option value="">— Select a vehicle —</option>
          {vehs.map(v => <option key={v.id} value={v.id}>{v.name} — {v.yr} {v.make} {v.model} ({v.plate})</option>)}
        </Sel>
      </Fld>
      {selV && (
        <>
          <Fld label="Service Type"><Sel value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{(selV.type === 'truck' ? ['Oil Change', 'Tire Rotation', 'Brake Service', 'AC / Heat Issue', 'Electrical Issue', 'Engine Issue', 'Repair', 'Inspection', 'Other'] : ['Tire Check', 'Brake Check', 'Lighting Issue', 'Hitch / Coupler Issue', 'Repair', 'Inspection', 'Other']).map(t => <option key={t}>{t}</option>)}</Sel></Fld>
          <Fld label="Urgency">
            <Sel value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}>
              <option value="normal">Normal — Schedule when possible</option>
              <option value="soon">Soon — Within the next few days</option>
              <option value="urgent">Urgent — Safety concern / vehicle down</option>
            </Sel>
          </Fld>
          {selV.type === 'truck' && <Fld label="Current Mileage (optional)"><Inp type="number" value={form.mileage} onChange={e => setForm({ ...form, mileage: e.target.value })} /></Fld>}
          <Fld label="Description / Notes *" hint="Be specific — what you hear, feel, or see."><TA value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Brakes grinding when stopping..." /></Fld>
        </>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <Btn v="ghost" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
        <Btn v="purple" onClick={submit} style={{ flex: 1, justifyContent: 'center' }}>Submit Request 🔔</Btn>
      </div>
    </Modal>
  );
}

// ── Maintenance Requests ──────────────────────────
function MaintenanceRequests({ reqs, setReqs, vehs, users, user, perms }) {
  const [filt, setFilt] = useState('active');
  const [sel, setSel] = useState(null);
  const [schedForm, setSchedForm] = useState({ date: '', notes: '' });
  const shown = reqs.filter(r => filt === 'active' ? r.status !== 'completed' : r.status === filt);
  const markScheduled = () => {
    if (!schedForm.date) return;
    setReqs(p => p.map(r => r.id === sel.id ? { ...r, status: 'scheduled', scheduledDate: schedForm.date, whNotes: schedForm.notes } : r));
    setSel({ ...sel, status: 'scheduled', scheduledDate: schedForm.date, whNotes: schedForm.notes });
  };
  const markCompleted = () => {
    setReqs(p => p.map(r => r.id === sel.id ? { ...r, status: 'completed', completedAt: new Date().toISOString() } : r));
    setSel(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>🔧 Maintenance Requests</h1>
        {reqs.filter(r => r.status === 'pending').length > 0 && perms.maint_manage && <div style={{ background: C.pB, border: `2px solid ${C.pu}`, borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 700, color: C.pu }}>🔔 {reqs.filter(r => r.status === 'pending').length} awaiting scheduling</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {[['active', 'Active'], ['pending', 'Pending'], ['scheduled', 'Scheduled'], ['completed', 'Completed']].map(([k, l]) => (
          <Btn key={k} v={filt === k ? 'purple' : 'ghost'} sz="sm" onClick={() => setFilt(k)}>{l}</Btn>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.map(r => (
          <div key={r.id} onClick={() => setSel(r)} style={{ background: r.urgency === 'urgent' ? C.rB : r.urgency === 'soon' ? C.aB : C.w, borderRadius: 12, padding: 16, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: `2px solid ${r.urgency === 'urgent' ? C.rd : r.urgency === 'soon' ? C.am : 'transparent'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 7, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <Bdg color={r.status === 'pending' ? 'amber' : r.status === 'scheduled' ? 'blue' : 'green'}>{r.status}</Bdg>
                {r.urgency !== 'normal' && <Bdg color={r.urgency === 'urgent' ? 'red' : 'amber'}>{r.urgency === 'urgent' ? '🚨 URGENT' : '⚠️ Soon'}</Bdg>}
                <Bdg color="blue">{r.type}</Bdg>
              </div>
              <div style={{ fontWeight: 800, color: C.navy, fontSize: 14, marginBottom: 2 }}>{r.vname}</div>
              <div style={{ fontSize: 12, color: C.navy, marginBottom: 4, lineHeight: 1.5 }}>{r.notes}</div>
              <div style={{ fontSize: 11, color: C.sub }}>By {r.uname} · {ft(r.at)}</div>
              {r.scheduledDate && <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, marginTop: 3 }}>📅 {fd(r.scheduledDate)}</div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {perms.maint_manage && r.status === 'pending' && <Btn v="purple" sz="sm" onClick={e => { e.stopPropagation(); setSel(r); setSchedForm({ date: '', notes: '' }); }}>📅 Schedule</Btn>}
              {perms.maint_manage && r.status === 'scheduled' && <Btn v="green" sz="sm" onClick={e => { e.stopPropagation(); setReqs(p => p.map(x => x.id === r.id ? { ...x, status: 'completed', completedAt: new Date().toISOString() } : x)); }}>✅ Complete</Btn>}
            </div>
          </div>
        ))}
        {shown.length === 0 && <div style={{ background: C.w, borderRadius: 12, padding: 30, textAlign: 'center', color: C.sub, fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>No {filt === 'active' ? 'open' : filt} requests.</div>}
      </div>

      {sel && (
        <Modal title={`Request — ${sel.vname}`} onClose={() => setSel(null)} wide>
          <div style={{ display: 'flex', gap: 7, marginBottom: 14, flexWrap: 'wrap' }}>
            <Bdg color={sel.status === 'pending' ? 'amber' : sel.status === 'scheduled' ? 'blue' : 'green'}>{sel.status}</Bdg>
            <Bdg color={sel.urgency === 'urgent' ? 'red' : sel.urgency === 'soon' ? 'amber' : 'blue'}>{sel.urgency}</Bdg>
            <Bdg color="blue">{sel.type}</Bdg>
          </div>
          <div style={{ background: C.lg, borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Issue Description</div>
            <div style={{ fontSize: 13, color: C.navy, lineHeight: 1.6 }}>{sel.notes}</div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>By {sel.uname} · {ft(sel.at)}</div>
          </div>
          {perms.maint_manage && sel.status === 'pending' && (
            <div style={{ background: C.pB, border: `1.5px solid ${C.pu}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, color: C.pu, marginBottom: 10, fontSize: 13 }}>📅 Schedule This Service</div>
              <Fld label="Scheduled Date"><Inp type="date" value={schedForm.date} onChange={e => setSchedForm({ ...schedForm, date: e.target.value })} /></Fld>
              <Fld label="Warehouse Notes"><TA value={schedForm.notes} onChange={e => setSchedForm({ ...schedForm, notes: e.target.value })} placeholder="Shop, service details, parts needed..." style={{ minHeight: 60 }} /></Fld>
              <Btn v="purple" onClick={markScheduled} style={{ width: '100%', justifyContent: 'center' }}>Confirm Schedule</Btn>
            </div>
          )}
          {perms.maint_manage && sel.status === 'scheduled' && (
            <div style={{ background: C.gB, border: `1.5px solid ${C.gr}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, color: C.gr, marginBottom: 6 }}>📅 Scheduled for {fd(sel.scheduledDate)}</div>
              {sel.whNotes && <div style={{ fontSize: 12, color: C.navy, marginBottom: 10 }}>{sel.whNotes}</div>}
              <Btn v="green" onClick={markCompleted} style={{ width: '100%', justifyContent: 'center' }}>✅ Mark Completed</Btn>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ── Reports ───────────────────────────────────────
function Reports({ jobs, users, user, perms }) {
  const [filt, setFilt] = useState('all');
  const shown = jobs.filter(j => filt === 'all' || j.status === filt).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const completedJobs = jobs.filter(j => j.status === 'completed');
  const totalCost = completedJobs.reduce((s, j) => s + j.items.reduce((a, i) => a + (i.pulled - i.returned) * i.priceAtPull, 0), 0);
  const cards = [{ label: 'Total Jobs', value: jobs.length, color: C.blue }, { label: 'Completed', value: completedJobs.length, color: C.gr }, { label: 'Active', value: jobs.filter(j => j.status === 'active').length, color: C.am }];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}><h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>📊 Reports</h1></div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {cards.map(sc => (
          <div key={sc.label} style={{ background: C.w, borderRadius: 12, padding: 14, borderLeft: `5px solid ${sc.color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: sc.color }}>{sc.value}</div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>{sc.label}</div>
          </div>
        ))}
        {perms.inv_pricing_view && <div style={{ background: C.w, borderRadius: 12, padding: 14, borderLeft: `5px solid ${C.gr}`, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', flex: 1, minWidth: 120 }}><div style={{ fontSize: 18, fontWeight: 900, color: C.gr }}>{fm(totalCost)}</div><div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>Total Materials (Completed)</div></div>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>{[['all', 'All Jobs'], ['draft', 'Draft'], ['approved', 'Approved'], ['active', 'Active'], ['completed', 'Completed']].map(([k, l]) => (<Btn key={k} v={filt === k ? 'primary' : 'ghost'} sz="sm" onClick={() => setFilt(k)}>{l}</Btn>))}</div>
      <div style={{ background: C.w, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: C.lg }}>{['Job Name', 'PO', 'Site Supervisor', 'Status', 'Items', ...(perms.inv_pricing_view ? ['Material Cost'] : []), ''].map(h => (<th key={h} style={{ padding: '9px 12px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>))}</tr></thead>
          <tbody>
            {shown.map(job => {
              const sup = users.find(u => u.id === job.assignedTo);
              const st = jSC[job.status];
              const cost = job.items.reduce((s, i) => s + (i.pulled - i.returned) * i.priceAtPull, 0);
              return (
                <tr key={job.id} style={{ borderTop: `1px solid ${C.lg}` }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: C.navy }}>{job.name}<div style={{ fontSize: 11, color: C.sub, fontWeight: 400 }}>{job.addr}</div></td>
                  <td style={{ padding: '10px 12px', color: C.sub }}>{job.po}</td>
                  <td style={{ padding: '10px 12px', color: C.sub }}>{sup?.name || '—'}</td>
                  <td style={{ padding: '10px 12px' }}><Bdg color={st.c}>{st.l}</Bdg></td>
                  <td style={{ padding: '10px 12px' }}>{job.items.length}</td>
                  {perms.inv_pricing_view && <td style={{ padding: '10px 12px', fontWeight: 700, color: cost > 0 ? C.gr : C.sub }}>{cost > 0 ? fm(cost) : '—'}</td>}
                  <td style={{ padding: '10px 12px' }}>{job.status === 'completed' && <Btn v="ghost" sz="sm" onClick={() => generatePDF(job, users)}>📄 PDF</Btn>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: C.sub, fontSize: 13 }}>No jobs found.</div>}
      </div>
    </div>
  );
}

// ── Users ─────────────────────────────────────────
function Users({ users, setUsers, currentUser, rolePerms, userOverrides, setUserOverrides }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [editing, setEditing] = useState(null);
  const [permUser, setPermUser] = useState(null);
  const save = () => {
    if (!form.name || !form.email || !form.role) return;
    if (editing) setUsers(p => p.map(u => u.id === editing ? { ...u, ...form } : u));
    else setUsers(p => [...p, { id: uid(), active: true, pass: 'TempPass123!', ...form }]);
    setModal(null); setForm({}); setEditing(null);
  };
  const toggleOverride = (uid, perm, baseVal) => {
    setUserOverrides(p => {
      const uov = { ...(p[uid] || {}) };
      if (uov[perm] === undefined) { uov[perm] = !baseVal; }
      else if (uov[perm] === !baseVal) { delete uov[perm]; }
      else { uov[perm] = !uov[perm]; }
      return { ...p, [uid]: uov };
    });
  };
  const clearOverrides = uid => setUserOverrides(p => { const n = { ...p }; delete n[uid]; return n; });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>👥 User Management</h1>
        <Btn v="primary" onClick={() => { setForm({ role: 'employee' }); setEditing(null); setModal('user'); }}>+ Add User</Btn>
      </div>
      <div style={{ background: C.gL, border: `1px solid ${C.gold}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.navy, lineHeight: 1.7 }}>
        Role permissions are set in <strong>Settings → Role Permissions</strong>. You can also give individual users custom permission overrides here using the 🔒 button.
      </div>
      <div style={{ background: C.w, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: C.lg }}>{['Name', 'Email', 'Role', 'Status', ''].map(h => <th key={h} style={{ padding: '9px 14px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderTop: `1px solid ${C.lg}`, opacity: u.active ? 1 : 0.55 }}>
                <td style={{ padding: '11px 14px', fontWeight: 700, color: C.navy }}>
                  {u.name}
                  {userOverrides[u.id] && Object.keys(userOverrides[u.id]).length > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: C.am, fontWeight: 700 }}>({Object.keys(userOverrides[u.id]).length} override{Object.keys(userOverrides[u.id]).length !== 1 ? 's' : ''})</span>}
                </td>
                <td style={{ padding: '11px 14px', color: C.sub, fontSize: 12 }}>{u.email}</td>
                <td style={{ padding: '11px 14px' }}><RoleBdg role={u.role} /></td>
                <td style={{ padding: '11px 14px' }}><Bdg color={u.active ? 'green' : 'amber'}>{u.active ? 'Active' : 'Inactive'}</Bdg></td>
                <td style={{ padding: '11px 14px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn v="ghost" sz="sm" onClick={() => { setForm({ name: u.name, email: u.email, role: u.role }); setEditing(u.id); setModal('user'); }}>Edit</Btn>
                    {u.id !== currentUser.id && u.role !== 'admin' && <Btn v="ghost" sz="sm" onClick={() => { setPermUser(u); setModal('perms'); }} style={{ color: C.pu }}>🔒 Permissions</Btn>}
                    {u.id !== currentUser.id && <Btn v="ghost" sz="sm" onClick={() => setUsers(p => p.map(x => x.id === u.id ? { ...x, active: !x.active } : x))} style={{ color: u.active ? C.rd : C.gr }}>{u.active ? 'Deactivate' : 'Activate'}</Btn>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal === 'user' && (
        <Modal title={editing ? 'Edit User' : 'Add New User'} onClose={() => setModal(null)}>
          <Fld label="Full Name"><Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label="Email"><Inp type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="user@maumeeriverroofing.com" /></Fld>
          {!editing && <Fld label="Temp Password"><Inp value={form.pass || 'TempPass123!'} onChange={e => setForm({ ...form, pass: e.target.value })} /></Fld>}
          <Fld label="Role">
            <Sel value={form.role || 'field'} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option value="admin"> — Full System Access</option>
              <option value="warehouse">Warehouse Manager</option>
              <option value="coordinator">Production Coordinator</option>
              <option value="manager">Manager</option>
              <option value="field">Site Supervisor (Field)</option>
              <option value="employee">Employee / Field Staff</option>
            </Sel>
          </Fld>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={save} style={{ flex: 1, justifyContent: 'center' }}>{editing ? 'Save Changes' : 'Add User'}</Btn>
          </div>
        </Modal>
      )}

      {modal === 'perms' && permUser && (
        <Modal title={`Custom Permissions — ${permUser.name}`} onClose={() => { setModal(null); setPermUser(null); }} extraWide>
          <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.am, fontWeight: 600 }}>
            ⚠️ Overrides apply <em>on top of</em> the <strong>{ROLES[permUser.role]?.label}</strong> role permissions and only affect <strong>{permUser.name}</strong>.
          </div>
          {userOverrides[permUser.id] && Object.keys(userOverrides[permUser.id]).length > 0 && (
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'flex-end' }}>
              <Btn v="danger" sz="sm" onClick={() => clearOverrides(permUser.id)}>Clear All Overrides</Btn>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: C.lg }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', minWidth: 220 }}>Permission</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', width: 110 }}>Role Default</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', width: 110 }}>This User</th>
              </tr></thead>
              {PERM_GROUPS.map(([groupName, keys]) => (
                <tbody key={groupName}>
                  <tr><td colSpan={3} style={{ padding: '8px 14px', fontWeight: 900, color: C.w, background: C.navy, fontSize: 12 }}>{groupName}</td></tr>
                  {keys.map(key => {
                    const baseVal = (rolePerms[permUser.role] || {})[key] || false;
                    const ovVal = (userOverrides[permUser.id] || {})[key];
                    const effective = ovVal !== undefined ? ovVal : baseVal;
                    const hasOverride = ovVal !== undefined;
                    return (
                      <tr key={key} style={{ borderTop: `1px solid ${C.lg}`, background: hasOverride ? 'rgba(217,119,6,0.07)' : 'transparent' }}>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>
                            {PERM_DEFS[key].label}
                            {hasOverride && <span style={{ marginLeft: 6, fontSize: 10, color: C.am, fontWeight: 700 }}>OVERRIDDEN</span>}
                          </div>
                          <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>{PERM_DEFS[key].desc}</div>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}><div style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={baseVal} disabled={true} /></div></td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}><div style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={effective} onChange={() => toggleOverride(permUser.id, key, baseVal)} /></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Settings ──────────────────────────────────────
function Settings({ warehouses, setWarehouses, logos, setLogos, rolePerms, setRolePerms, acculynxConfig, setAccuLynxConfig }) {
  const [tab, setTab] = useState('permissions');
  const [whModal, setWhModal] = useState(false);
  const [whForm, setWhForm] = useState({});
  const [logoModal, setLogoModal] = useState(false);
  const [newLogoName, setNewLogoName] = useState('');
  const [newLogoData, setNewLogoData] = useState(null);
  const togglePerm = (role, perm) => setRolePerms(p => ({ ...p, [role]: { ...p[role], [perm]: !p[role][perm] } }));
  const resetRole = role => setRolePerms(p => ({ ...p, [role]: { ...DEFAULT_ROLE_PERMS[role] } }));
  const saveLogo = () => {
    if (!newLogoData) { alert('Upload an image first.'); return; }
    const logo = { id: uid(), name: newLogoName || `Logo ${logos.length + 1}`, data: newLogoData, isActive: logos.length === 0 };
    setLogos(p => [...p, logo]);
    setLogoModal(false); setNewLogoName(''); setNewLogoData(null);
  };
  const setActiveLogo = id => setLogos(p => p.map(l => ({ ...l, isActive: l.id === id })));
  const deleteLogo = id => setLogos(p => { const next = p.filter(l => l.id !== id); if (next.length > 0 && p.find(l => l.id === id)?.isActive) next[0].isActive = true; return next; });
  const TABS = [['permissions', '🔐 Permissions'], ['acculynx', '🔗 AccuLynx'], ['branding', '🏢 Branding'], ['warehouses', '🏭 Warehouses'], ['system', 'ℹ️ System']];

  return (
    <div>
      <h1 style={{ margin: '0 0 18px', fontSize: 20, fontWeight: 900, color: C.navy }}>⚙️ Settings</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap', borderBottom: `2px solid ${C.lg}`, paddingBottom: 14 }}>
        {TABS.map(([k, l]) => (<Btn key={k} v={tab === k ? 'primary' : 'ghost'} sz="sm" onClick={() => setTab(k)}>{l}</Btn>))}
      </div>

      {tab === 'permissions' && (
        <div>
          <div style={{ background: C.gL, border: `1px solid ${C.gold}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: C.navy, lineHeight: 1.7 }}>
            🔐 <strong>Role Permissions Matrix</strong> — Toggle each permission on/off per role. <strong>Admin always has full access.</strong> Per-user overrides can be set from <strong>Users → 🔒 Permissions</strong>.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 620 }}>
              <thead><tr style={{ background: C.lg }}>
                <th style={{ padding: '12px 14px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', minWidth: 230 }}>Permission</th>
                {ROLE_COLS.map(([role, label]) => (
                  <th key={role} style={{ padding: '12px 10px', textAlign: 'center', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', minWidth: 120, verticalAlign: 'top' }}>
                    <div style={{ marginBottom: 6, whiteSpace: 'nowrap' }}>{label}</div>
                    <Btn v="ghost" sz="sm" onClick={() => resetRole(role)} style={{ fontSize: 10, padding: '3px 8px' }}>↩ Reset</Btn>
                  </th>
                ))}
              </tr></thead>
              {PERM_GROUPS.map(([groupName, keys]) => (
                <tbody key={groupName}>
                  <tr><td colSpan={5} style={{ padding: '8px 14px', fontWeight: 900, color: C.w, background: C.navy, fontSize: 11, letterSpacing: '0.5px' }}>{groupName}</td></tr>
                  {keys.map((key, ki) => (
                    <tr key={key} style={{ borderTop: `1px solid ${C.lg}`, background: ki % 2 === 0 ? C.w : C.lg }}>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>{PERM_DEFS[key].label}</div>
                        <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>{PERM_DEFS[key].desc}</div>
                      </td>
                      {ROLE_COLS.map(([role]) => (
                        <td key={role} style={{ padding: '10px 10px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={!!((rolePerms[role] || {})[key])} onChange={() => togglePerm(role, key)} /></div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      )}

      {tab === 'acculynx' && (
        <div>
          <div style={{ background: C.w, borderRadius: 12, padding: 22, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 8px', color: C.navy, fontSize: 15, fontWeight: 800 }}>🔗 AccuLynx Auto-Sync</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: C.sub, lineHeight: 1.7 }}>When a job is marked <strong>Completed</strong>, this dashboard will automatically:<br />① Upload the material cost PDF to the AccuLynx job's <strong>Documents</strong><br />② Add the total material cost as a <strong>payment line item</strong></p>
            <div style={{ background: C.aB, border: `1px solid ${C.am}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: C.am }}>⚠️ <strong>A backend proxy server is required.</strong> AccuLynx API keys cannot run in the browser for security.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <Fld label="AccuLynx API Key" hint="Generated in AccuLynx → Account Settings → API Keys."><Inp type="password" value={acculynxConfig.apiKey || ''} onChange={e => setAccuLynxConfig(p => ({ ...p, apiKey: e.target.value }))} placeholder="ax_live_xxxxxxxxxxxx" /></Fld>
              <Fld label="Backend Proxy URL" hint="Your server endpoint that relays requests."><Inp value={acculynxConfig.proxyUrl || ''} onChange={e => setAccuLynxConfig(p => ({ ...p, proxyUrl: e.target.value }))} placeholder="https://your-server.com/api/acculynx-sync" /></Fld>
            </div>
            <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Toggle on={!!acculynxConfig.enabled} onChange={() => setAccuLynxConfig(p => ({ ...p, enabled: !p.enabled }))} />
                <div><div style={{ fontWeight: 700, color: C.navy, fontSize: 13 }}>Enable Integration</div><div style={{ fontSize: 11, color: C.sub }}>Allow dashboard to contact AccuLynx</div></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Toggle on={!!acculynxConfig.autoSync} onChange={() => setAccuLynxConfig(p => ({ ...p, autoSync: !p.autoSync }))} />
                <div><div style={{ fontWeight: 700, color: C.navy, fontSize: 13 }}>Auto-Sync on Completion</div><div style={{ fontSize: 11, color: C.sub }}>Fire automatically when job is completed</div></div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Bdg color={acculynxConfig.enabled && acculynxConfig.proxyUrl ? 'green' : 'gray'}>{acculynxConfig.enabled && acculynxConfig.proxyUrl ? '● Configured' : '● Not Configured'}</Bdg>
              <Btn v="sky" sz="sm" onClick={() => alert(acculynxConfig.apiKey && acculynxConfig.proxyUrl ? 'Test ping sent to proxy URL.' : 'Enter API Key and Proxy URL first.')}>Test Connection</Btn>
            </div>
          </div>
        </div>
      )}

      {tab === 'branding' && (
        <div style={{ background: C.w, borderRadius: 12, padding: 22, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
          <h3 style={{ margin: '0 0 8px', color: C.navy, fontSize: 15, fontWeight: 800 }}>🏢 Company Logos</h3>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: C.sub }}>Active logo appears in the sidebar, login screen, and all PDF reports.</p>
          {logos.length > 0 ? (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
              {logos.map(logo => (
                <div key={logo.id} style={{ background: C.lg, borderRadius: 12, padding: 14, width: 160, position: 'relative', border: `2px solid ${logo.isActive ? C.gr : 'transparent'}` }}>
                  {logo.isActive && <div style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', background: C.gr, color: C.w, fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>✓ ACTIVE</div>}
                  <div style={{ height: 80, background: C.w, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10, overflow: 'hidden', border: `1px solid ${C.bd}` }}><img src={logo.data} alt={logo.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /></div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginBottom: 8, wordBreak: 'break-word' }}>{logo.name}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!logo.isActive && <Btn v="green" sz="sm" onClick={() => setActiveLogo(logo.id)} style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}>Set Active</Btn>}
                    <Btn v="ghost" sz="sm" onClick={() => deleteLogo(logo.id)} style={{ color: C.rd, flex: logo.isActive ? 1 : undefined, justifyContent: 'center' }}>🗑️</Btn>
                  </div>
                </div>
              ))}
              <div onClick={() => setLogoModal(true)} style={{ width: 160, minHeight: 160, background: C.lg, borderRadius: 12, border: `2px dashed ${C.bd}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: 6, color: C.sub }}>
                <span style={{ fontSize: 28 }}>➕</span>
                <span style={{ fontSize: 11, fontWeight: 700 }}>Add Logo</span>
              </div>
            </div>
          ) : (
            <div onClick={() => setLogoModal(true)} style={{ height: 120, background: C.lg, borderRadius: 10, border: `2px dashed ${C.bd}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: 6, marginBottom: 14 }}>
              <span style={{ fontSize: 32 }}>🖼️</span>
              <span style={{ fontSize: 13, color: C.sub, fontWeight: 700 }}>Upload your company logo</span>
            </div>
          )}
          {logos.length === 0 && <Btn v="primary" onClick={() => setLogoModal(true)}>+ Upload First Logo</Btn>}
        </div>
      )}

      {tab === 'warehouses' && (
        <div style={{ background: C.w, borderRadius: 12, padding: 22, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, color: C.navy, fontSize: 15, fontWeight: 800 }}>🏭 Warehouses</h3>
            <Btn v="primary" sz="sm" onClick={() => { setWhForm({}); setWhModal(true); }}>+ Add</Btn>
          </div>
          {warehouses.map(w => (
            <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: C.lg, borderRadius: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, color: C.navy, fontSize: 13 }}>{w.name}</div>
                <div style={{ fontSize: 11, color: C.sub }}>{w.location}</div>
              </div>
              <Bdg color={w.active ? 'green' : 'amber'}>{w.active ? 'Active' : 'Inactive'}</Bdg>
            </div>
          ))}
        </div>
      )}

      {tab === 'system' && (
        <div style={{ background: C.w, borderRadius: 12, padding: 22, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
          <h3 style={{ margin: '0 0 14px', color: C.navy, fontSize: 15, fontWeight: 800 }}>ℹ️ System Information</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[['Version', 'WMS v5.0 — Permissions + AccuLynx'], ['Storage', 'Browser persistent (window.storage)'], ['Photos', 'Auto-compressed JPEG on upload'], ['PDF Engine', 'Browser Print → Save as PDF'], ['AccuLynx', acculynxConfig.enabled && acculynxConfig.proxyUrl ? 'Enabled' : 'Not configured'], ['Permissions', 'Role-based with per-user overrides']].map(([k, v]) => (
              <div key={k} style={{ background: C.lg, borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {logoModal && (
        <Modal title="Upload Company Logo" onClose={() => { setLogoModal(false); setNewLogoName(''); setNewLogoData(null); }}>
          <Fld label="Logo Name"><Inp value={newLogoName} onChange={e => setNewLogoName(e.target.value)} placeholder="e.g. Main Company Logo" /></Fld>
          <Fld label="Logo Image *"><PhotoUpload current={newLogoData} onUpload={setNewLogoData} label="Upload logo image" maxDim={400} quality={0.85} previewHeight={140} /></Fld>
          <div onClick={() => setShowProfile(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: 8, borderRadius: 7, background: 'rgba(255,255,255,0.06)', marginBottom: 6, cursor: 'pointer' }}>            <Btn v="ghost" onClick={() => { setLogoModal(false); setNewLogoName(''); setNewLogoData(null); }} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={saveLogo} style={{ flex: 1, justifyContent: 'center' }}>💾 Save Logo</Btn>
          </div>
        </Modal>
      )}

      {whModal && (
        <Modal title="Add Warehouse" onClose={() => setWhModal(false)}>
          <Fld label="Name"><Inp value={whForm.name || ''} onChange={e => setWhForm({ ...whForm, name: e.target.value })} /></Fld>
          <Fld label="Location"><Inp value={whForm.loc || ''} onChange={e => setWhForm({ ...whForm, loc: e.target.value })} /></Fld>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => setWhModal(false)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={() => { if (!whForm.name || !whForm.loc) return; setWarehouses(p => [...p, { id: uid(), name: whForm.name, location: whForm.loc, active: true }]); setWhModal(false); setWhForm({}); }} style={{ flex: 1, justifyContent: 'center' }}>Add</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────
function Sidebar({ cur, onNav, user, onLogout, collapsed, setCollapsed, pendingReqs, lowStock, newJobsForMe, activeLogo, perms }) {
  const navItems = [
    { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
    ...(perms.jobs_build ? [{ id: 'buildjobs', icon: '🏗️', label: 'Build Jobs' }] : []),
    { id: 'pull', icon: '📋', label: 'Pull Inventory', badge: newJobsForMe, badgeColor: C.tl },
    ...(perms.inv_view ? [{ id: 'inventory', icon: '📦', label: 'Inventory', badge: lowStock }] : []),
    ...(perms.fleet_view ? [{ id: 'fleet', icon: '🚛', label: 'Fleet' }] : []),
    ...((perms.maint_submit || perms.maint_manage) ? [{ id: 'requests', icon: '🔧', label: 'Maintenance', badge: perms.maint_manage ? pendingReqs : 0, badgeColor: C.pu }] : []),
    ...(perms.reports_view ? [{ id: 'reports', icon: '📊', label: 'Reports' }] : []),
    ...(perms.users_manage ? [{ id: 'users', icon: '👥', label: 'Users' }] : []),
    ...(perms.settings_manage ? [{ id: 'settings', icon: '⚙️', label: 'Settings' }] : []),
  ];
  
  const rColor = r => r === 'warehouse' ? C.pu : r === 'coordinator' ? C.tl : r === 'field' ? C.gr : r === 'employee' ? C.sub : C.gold;

  return (
    <div style={{ width: collapsed ? 60 : 215, background: C.navy, minHeight: '100vh', display: 'flex', flexDirection: 'column', transition: 'width 0.2s', flexShrink: 0 }}>
      {/* Sidebar Header/Logo Wrapper */}
      <div style={{ padding: collapsed ? '12px 0' : '12px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.1)', justifyContent: collapsed ? 'center' : 'flex-start', minHeight: 62 }}>
        <div style={{ width: 36, height: 36, background: activeLogo ? 'transparent' : C.gold, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
          {activeLogo ? <img src={activeLogo} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 19 }}>🏠</span>}
        </div>
        {!collapsed && <div><div style={{ fontSize: 11, fontWeight: 900, color: C.gold, lineHeight: 1.1 }}>MAUMEE RIVER</div><div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.5px' }}>ROOFING</div></div>}
      </div>

      {/* Main Navigation Links */}
      <nav style={{ flex: 1, padding: '10px 6px' }}>
        {navItems.map(item => (
          <button key={item.id} onClick={() => onNav(item.id)} style={{ width: '100%', padding: collapsed ? '11px' : '9px 10px', background: cur === item.id ? 'rgba(245,168,0,0.2)' : 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, color: cur === item.id ? C.gold : 'rgba(255,255,255,0.65)', justifyContent: collapsed ? 'center' : 'flex-start', position: 'relative' }}>
            <span style={{ fontSize: 17 }}>{item.icon}</span>
            {!collapsed && <span style={{ fontSize: 13, fontWeight: cur === item.id ? 700 : 500, flex: 1, textAlign: 'left' }}>{item.label}</span>}
            {(item.badge || 0) > 0 && !collapsed && <span style={{ background: item.badgeColor || C.rd, color: C.w, borderRadius: 20, fontSize: 10, padding: '1px 6px', fontWeight: 800 }}>{item.badge}</span>}
            {(item.badge || 0) > 0 && collapsed && <span style={{ position: 'absolute', top: 6, right: 8, width: 8, height: 8, background: item.badgeColor || C.rd, borderRadius: '50%' }} />}
          </button>
        ))}
      </nav>
      
      {/* Sidebar Collapse Toggle Button */}
      <button onClick={() => setCollapsed(!collapsed)} style={{ padding: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 16, textAlign: 'center' }}>{collapsed ? '▶' : '◀'}</button>
      
      {/* Restored Clean Footer Panel inside the Sidebar Wrapper */}
      <div style={{ padding: '10px 6px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <div 
          onClick={() => onNav('profile')}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: 8, borderRadius: 7, background: cur === 'profile' ? 'rgba(245,168,0,0.15)' : 'rgba(255,255,255,0.06)', border: cur === 'profile' ? `1px solid ${C.gold}` : '1px solid transparent', marginBottom: 6, cursor: 'pointer', transition: 'background 0.2s' }}
          title="Click to manage profile settings"
        >          
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: rColor(user.role), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: C.w, flexShrink: 0 }}>
            {user.name ? user.name[0] : (user.full_name ? user.full_name[0] : 'U')}
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.w, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name || user.full_name || 'Active User'}
              </div>
              <div style={{ fontSize: 9, color: rColor(user.role), textTransform: 'capitalize', fontWeight: 600 }}>
                {ROLES[user.role]?.label || user.role || 'Employee'}
              </div>
            </div>
          )}
        </div>
        
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 4px' }}>
            <button onClick={onLogout} style={{ width: '100%', padding: 5, background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600 }}>
              Sign Out
            </button>
          </div>
        )}
      </div>
        </div>
        
        
    
  );
}
// ── My Profile Page View ──────────────────────────
function ProfileView({ user, onUpdateUser }) {
  const [name, setName] = useState(user.name || '');
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [profileMsg, setProfileMsg] = useState({ text: '', isError: false });
  const [passMsg, setPassMsg] = useState({ text: '', isError: false });
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const [submittingPass, setSubmittingPass] = useState(false);

 // Handle General Profile Updates (Name)
  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setProfileMsg({ text: '', isError: false });
    if (!name.trim()) return setProfileMsg({ text: 'Name cannot be empty.', isError: true });

    setSubmittingProfile(true);
    
    // 1. Update the Supabase Auth Metadata
    const { error: authError } = await supabase.auth.updateUser({
      data: { display_name: name.trim() }
    });

    if (authError) {
      setSubmittingProfile(false);
      return setProfileMsg({ text: `Auth Error: ${authError.message}`, isError: true });
    }

    // 2. Update the Permanent Database Profiles Table (Using full_name)
    const { error: dbError } = await supabase.from('profiles')
      .update({ full_name: name.trim() }) // ✨ Fixed to match your database column perfectly!
      .eq('id', user.id);

    setSubmittingProfile(false);

    if (dbError) {
      setProfileMsg({ text: `Database Error: ${dbError.message}`, isError: true });
    } else {
      setProfileMsg({ text: '🎉 Profile permanently saved!', isError: false });
      // Update local state properties safely so the sidebar and components sync up instantly
      onUpdateUser({ ...user, name: name.trim(), full_name: name.trim() });
    }
  }; // Ends handleProfileUpdate cleanly

  // Handle Password Changes
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPassMsg({ text: '', isError: false });

    if (newPass.length < 8) {
      return setPassMsg({ text: 'New password must be at least 8 characters long.', isError: true });
    }
    if (newPass !== confirmPass) {
      return setPassMsg({ text: 'New passwords do not match.', isError: true });
    }

    setSubmittingPass(true);

    // Verify current credentials
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPass,
    });

    if (verifyError) {
      setSubmittingPass(false);
      return setPassMsg({ text: 'Incorrect current password. Please try again.', isError: true });
    }

    // Apply password change
    const { error: updateError } = await supabase.auth.updateUser({ password: newPass });
    setSubmittingPass(false);

    if (updateError) {
      setPassMsg({ text: `System Error: ${updateError.message}`, isError: true });
    } else {
      setPassMsg({ text: '🎉 Password updated successfully!', isError: false });
      setCurrentPass('');
      setNewPass('');
      setConfirmPass('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 500, margin: '20px auto' }}>
      
      {/* Box 1: General Information */}
      <div style={{ background: C.w, borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 900, color: C.navy }}>👤 Personal Profile</h1>
        <p style={{ margin: '0 0 20px', color: C.sub, fontSize: 13 }}>Manage your account identity details</p>
        
        <form onSubmit={handleProfileUpdate}>
          <Fld label="Full Name">
            <Inp type="text" value={name} onChange={e => setName(e.target.value)} required />
          </Fld>
          <Fld label="Email Address">
            <Inp type="email" value={user.email} disabled style={{ background: '#f5f5f5', color: C.sub, cursor: 'not-allowed' }} />
          </Fld>
          <Fld label="System Permissions Level">
            <div style={{ background: 'rgba(245,168,0,0.08)', border: `1px solid ${C.gold}`, color: C.navy, padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>
              🛡️ {user.role || 'Employee'} Account
            </div>
          </Fld>

          {profileMsg.text && (
            <div style={{ background: profileMsg.isError ? C.rB : C.gB, color: profileMsg.isError ? C.rd : C.gr, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16, fontWeight: 600 }}>
              {profileMsg.text}
            </div>
          )}

          <Btn v="gold" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={submittingProfile}>
            {submittingProfile ? 'Saving Changes...' : 'Save Profile Details'}
          </Btn>
        </form>
      </div>

      {/* Box 2: Password Management */}
      <div style={{ background: C.w, borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 900, color: C.navy }}>🔐 Access Credentials</h2>
        <p style={{ margin: '0 0 20px', color: C.sub, fontSize: 13 }}>Change your current login security details</p>
        
        <form onSubmit={handlePasswordChange}>
          <Fld label="Current Password">
            <Inp type="password" value={currentPass} onChange={e => setCurrentPass(e.target.value)} placeholder="Verify current password" required />
          </Fld>
          <hr style={{ border: 'none', borderTop: `1px dashed ${C.bd}`, margin: '16px 0' }} />
          <Fld label="New Password">
            <Inp type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Minimum 8 characters" required />
          </Fld>
          <Fld label="Confirm New Password">
            <Inp type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Repeat new password" required />
          </Fld>

          {passMsg.text && (
            <div style={{ background: passMsg.isError ? C.rB : C.gB, color: passMsg.isError ? C.rd : C.gr, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16, fontWeight: 600 }}>
              {passMsg.text}
            </div>
          )}

          <Btn v="gold" type="submit" style={{ width: '100%', justifyContent: 'center' }} disabled={submittingPass}>
            {submittingPass ? 'Updating...' : 'Update Password'}
          </Btn>
        </form>
      </div>
    </div>
  );
}
// ── App ───────────────────────────────────────────
export default function App() {
  const [loading, setLoading] = useState(true);
  const [curUser, setCurUser] = useState(null);
  const [view, setView] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [users, setUsers] = useState(SEED_U);
  const [warehouses, setWH] = useState(SEED_W);
  const [inv, setInv] = useState(SEED_I);
  const [vehs, setVehs] = useState(SEED_V);
  const [reqs, setReqs] = useState(SEED_REQ);
  const [jobs, setJobs] = useState(SEED_JOBS);
  const [rolePerms, setRolePerms] = useState({ warehouse: { ...DEFAULT_ROLE_PERMS.warehouse }, coordinator: { ...DEFAULT_ROLE_PERMS.coordinator }, manager: { ...DEFAULT_ROLE_PERMS.manager }, field: { ...DEFAULT_ROLE_PERMS.field } });
  const [userOverrides, setUserOverrides] = useState({});
  const [acculynxConfig, setAccuLynxConfig] = useState({ apiKey: '', enabled: false, autoSync: true, proxyUrl: '' });
  const [invPhotos, setInvPhotos] = useState({});
  const [vehPhotos, setVehPhotos] = useState({});
  const [logos, setLogos] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        // 1. Fetch ALL relational database tables and asset streams concurrently
        const [
          { data: dbInv, error: invErr },
          { data: dbVehs, error: vehErr },
          { data: dbJobs, error: jobErr },
          { data: dbReqs, error: reqErr },
          { data: dbWH, error: whErr },
          ip, vp, lg, rp, uo, ax
        ] = await Promise.all([
          supabase.from('inventory').select('*'),
          supabase.from('vehicles').select('*'),
          supabase.from('jobs').select('*'),
          supabase.from('maintenance_requests').select('*'),
          supabase.from('warehouses').select('*'),
          storage.get('mrr-v7-inv-photos').catch(() => null),
          storage.get('mrr-v7-veh-photos').catch(() => null),
          storage.get('mrr-v7-logos').catch(() => null),
          storage.get('mrr-v7-roleperms').catch(() => null),
          storage.get('mrr-v7-userov').catch(() => null),
          storage.get('mrr-v7-acculynx').catch(() => null),
        ]);

        // 2. Hydrate database streams safely into local app states
        if (invErr) console.error("Inventory load error:", invErr.message);
        else if (dbInv) setInv(dbInv);

        if (vehErr) console.error("Vehicles load error:", vehErr.message);
        else if (dbVehs) setVehs(dbVehs);

        if (jobErr) console.error("Jobs load error:", jobErr.message);
        else if (dbJobs) setJobs(dbJobs);

        if (reqErr) console.error("Maintenance Requests load error:", reqErr.message);
        else if (dbReqs) setReqs(dbReqs.sort((a, b) => new Date(b.at) - new Date(a.at))); // Keep newest requests on top

        if (whErr) console.error("Warehouses load error:", whErr.message);
        else if (dbWH) setWH(dbWH);

        // 3. Hydrate UI configuration preferences and media buckets
        if (ip?.value) setInvPhotos(JSON.parse(ip.value));
        if (vp?.value) setVehPhotos(JSON.parse(vp.value));
        if (lg?.value) setLogos(JSON.parse(lg.value));
        if (rp?.value) {
          const saved = JSON.parse(rp.value);
          setRolePerms(p => Object.fromEntries(Object.keys(p).map(r => [r, { ...p[r], ...(saved[r] || {}) }])));
        }
        if (uo?.value) setUserOverrides(JSON.parse(uo.value));
        if (ax?.value) setAccuLynxConfig(p => ({ ...p, ...JSON.parse(ax.value) }));
        
      } catch (e) {
        console.error("Critical dashboard loading error:", e);
      }
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => { if (!loading) storage.set('mrr-v7-inv-photos', JSON.stringify(invPhotos)).catch(() => { }); }, [invPhotos, loading]);
  useEffect(() => { if (!loading) storage.set('mrr-v7-veh-photos', JSON.stringify(vehPhotos)).catch(() => { }); }, [vehPhotos, loading]);
  useEffect(() => { if (!loading) storage.set('mrr-v7-logos', JSON.stringify(logos)).catch(() => { }); }, [logos, loading]);
  useEffect(() => { if (!loading) storage.set('mrr-v7-roleperms', JSON.stringify(rolePerms)).catch(() => { }); }, [rolePerms, loading]);
  useEffect(() => { if (!loading) storage.set('mrr-v7-userov', JSON.stringify(userOverrides)).catch(() => { }); }, [userOverrides, loading]);
  useEffect(() => { if (!loading) storage.set('mrr-v7-acculynx', JSON.stringify(acculynxConfig)).catch(() => { }); }, [acculynxConfig, loading]);

  const pendingReqCount = useMemo(() => reqs.filter(r => r.status === 'pending').length, [reqs]);
  const lowStockCount = useMemo(() => inv.filter(i => tot(i) <= i.alrt).length, [inv]);
  const newJobsForMe = useMemo(() => curUser ? jobs.filter(j => j.newForAssigned && j.assignedTo === curUser.id).length : 0, [jobs, curUser]);
  const activeLogo = useMemo(() => logos.find(l => l.isActive)?.data || null, [logos]);
  const userPerms = useMemo(() => { if (!curUser) return {}; return getEffectivePerms(curUser, rolePerms, userOverrides); }, [curUser, rolePerms, userOverrides]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: C.bg, flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 44 }}>🏠</div>
        <div style={{ color: C.navy, fontWeight: 700, fontSize: 16 }}>Loading Maumee River Roofing...</div>
      </div>
    );
  }

  if (!curUser) {
    return <LoginScreen onLogin={u => { setCurUser(u); setView('dashboard'); }} activeLogo={activeLogo} />;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg, fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <Sidebar cur={view} onNav={setView} user={curUser} onLogout={() => setCurUser(null)} collapsed={collapsed} setCollapsed={setCollapsed} pendingReqs={pendingReqCount} lowStock={lowStockCount} newJobsForMe={newJobsForMe} activeLogo={activeLogo} perms={userPerms} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ background: C.w, padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.lg}`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: C.sub }}>Maumee River Roofing · Saint Joe Road Warehouse</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {newJobsForMe > 0 && <div onClick={() => setView('pull')} style={{ background: C.tB, color: C.tl, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🎉 {newJobsForMe} new job{newJobsForMe !== 1 ? 's' : ''}</div>}
            {pendingReqCount > 0 && userPerms.maint_manage && <div onClick={() => setView('requests')} style={{ background: C.pB, color: C.pu, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🔧 {pendingReqCount} pending</div>}
            {lowStockCount > 0 && userPerms.inv_view && <div onClick={() => setView('inventory')} style={{ background: C.aB, color: C.am, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>⚠️ {lowStockCount} low stock</div>}
            <RoleBdg role={curUser.role} />
          </div>
        </div>
        <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
          {view === 'dashboard' && <Dashboard inv={inv} vehs={vehs} reqs={reqs} jobs={jobs} users={users} user={curUser} perms={userPerms} onNav={setView} />}
          {view === 'buildjobs' && userPerms.jobs_build && <BuildJobs jobs={jobs} setJobs={setJobs} inv={inv} users={users} user={curUser} perms={userPerms} />}
          {view === 'pull' && <PullInventory jobs={jobs} setJobs={setJobs} inv={inv} setInv={setInv} users={users} user={curUser} perms={userPerms} activeLogo={activeLogo} acculynxConfig={acculynxConfig} />}
          {view === 'inventory' && userPerms.inv_view && <Inventory inv={inv} setInv={setInv} users={users} user={curUser} perms={userPerms} invPhotos={invPhotos} setInvPhotos={setInvPhotos} />}
          {view === 'fleet' && userPerms.fleet_view && <Fleet vehs={vehs} setVehs={setVehs} reqs={reqs} setReqs={setReqs} users={users} user={curUser} perms={userPerms} vehPhotos={vehPhotos} setVehPhotos={setVehPhotos} />}
          {view === 'requests' && (userPerms.maint_submit || userPerms.maint_manage) && <MaintenanceRequests reqs={reqs} setReqs={setReqs} vehs={vehs} users={users} user={curUser} perms={userPerms} />}
          {view === 'reports' && userPerms.reports_view && <Reports jobs={jobs} users={users} user={curUser} perms={userPerms} />}
          {view === 'users' && userPerms.users_manage && <Users users={users} setUsers={setUsers} currentUser={curUser} rolePerms={rolePerms} userOverrides={userOverrides} setUserOverrides={setUserOverrides} />}
          {view === 'settings' && userPerms.settings_manage && <Settings warehouses={warehouses} setWarehouses={setWH} logos={logos} setLogos={setLogos} rolePerms={rolePerms} setRolePerms={setRolePerms} acculynxConfig={acculynxConfig} setAccuLynxConfig={setAccuLynxConfig} />}
          {view === 'profile' && <ProfileView user={curUser} onUpdateUser={setCurUser} />}        </div>
      </div>
    </div>
  );
}