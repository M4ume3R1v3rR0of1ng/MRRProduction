// src/data/seeds.js

// ── Document Factory Constructors ──
export const mkB = (id, rcvd, qty, price, by, rem) => ({ id, rcvd, qty, price, by, rem });
export const mkI = (id, name, cat, unit, alrt, ...batches) => ({ id, name, cat, unit, alrt, batches });
export const mkT = (id, name, mi, lomi, oii, dii, ldd, mil, sl) => ({ id, name, type: 'truck', mi, lomi, oii, dii, ldd, mil: mil || [], sl: sl || [] });
export const mkTr = (id, name, dii, ldd) => ({ id, name, type: 'trailer', dii, ldd, mi: 0, mil: [], sl: [] });
export const mkJI = (iid, iname, icat, unit, planned, pulled = 0, ret = 0, ppu = 0, cost = 0) => ({ iid, iname, icat, unit, planned, pulled, returned: ret, priceAtPull: ppu, pullCost: cost });
export const mkJob = (id, po, name, addr, notes, status, assignedTo, createdBy, createdAt, approvedAt, completedAt, newFor, items, sync = null) => ({ id, po, name, addr, notes, status, assignedTo, createdBy, createdAt, approvedAt, completedAt, newForAssigned: newFor, items, syncStatus: sync, syncedAt: '', syncPayload: null, syncNote: '' });

// ── Operational Fleet Seed Models ──
export const SEED_V = [
  { id: 'v1', name: 'Truck 1', type: 'truck', mi: 87500, lomi: 83200, oii: 5000, dii: 90, ldd: '2025-02-15', mil: [{ dt: '2025-05-14', mi: 87500, by: 'u1' }], sl: [{ id: 's1', type: 'Oil Change', dt: '2025-03-01', mi: 83200, by: 'Quick Lube', notes: '5W-30 Synthetic', cost: 89 }], plate: 'MRR-001', yr: 2020, make: 'Ford', model: 'F-250', assignedTo: 'u3' },
  { id: 'v2', name: 'Truck 2', type: 'truck', mi: 62300, lomi: 58900, oii: 5000, dii: 90, ldd: '2025-03-10', mil: [{ dt: '2025-05-14', mi: 62300, by: 'u2' }], sl: [], plate: 'MRR-002', yr: 2021, make: 'Ford', model: 'F-250', assignedTo: 'u7' },
  { id: 'v3', name: 'Truck 3', type: 'truck', mi: 112000, lomi: 108500, oii: 5000, dii: 90, ldd: '2025-01-20', mil: [], sl: [], plate: 'MRR-003', yr: 2019, make: 'Ram', model: '2500', assignedTo: '' },
  { id: 'v4', name: 'Truck 4', type: 'truck', mi: 45200, lomi: 43500, oii: 5000, dii: 90, ldd: '2025-04-01', mil: [], sl: [], plate: 'MRR-004', yr: 2022, make: 'Chevy', model: 'Silverado 2500', assignedTo: '' },
  { id: 'v5', name: 'Truck 5', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-005', yr: 2022, make: 'Ford', model: 'F-250', assignedTo: '' },
  { id: 'v6', name: 'Truck 6', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-006', yr: 2022, make: 'Ford', model: 'F-250', assignedTo: '' },
  { id: 'v7', name: 'Truck 7', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-007', yr: 2023, make: 'Ford', model: 'F-150', assignedTo: '' },
  { id: 'v8', name: 'Truck 8', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-008', yr: 2021, make: 'Ram', model: '1500', assignedTo: '' },
  { id: 'v9', name: 'Truck 9', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-009', yr: 2022, make: 'Chevy', model: 'Silverado', assignedTo: 'u3' },
  { id: 'v10', name: 'Truck 10', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-010', yr: 2022, make: 'Ford', model: 'F-250', assignedTo: '' },
  { id: 'v11', name: 'Truck 11', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-011', yr: 2023, make: 'Ford', model: 'F-250', assignedTo: '' },
  { id: 'v12', name: 'Production Truck 12', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-012', yr: 2022, make: 'GMC', model: 'Sierra 2500', assignedTo: '' },
  { id: 'v16', name: 'Gold F250', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-016', yr: 2021, make: 'Ford', model: 'F-250', assignedTo: 'u1' },
  { id: 'v17', name: 'Blue F150', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-017', yr: 2020, make: 'Ford', model: 'F-150', assignedTo: '' },
  { id: 'v18', name: 'Box Truck', type: 'truck', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'MRR-018', yr: 2019, make: 'Isuzu', model: 'NPR', assignedTo: '' },
  { id: 'v13', name: 'Dump Trailer 13', type: 'trailer', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2025-03-01', mil: [], sl: [], plate: 'TRL-013', yr: 2022, make: 'PJ Trailers', model: 'Dump 14\'', assignedTo: '' },
  { id: 'v14', name: 'Dump Trailer 14', type: 'trailer', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2025-01-15', mil: [], sl: [], plate: 'TRL-014', yr: 2022, make: 'PJ Trailers', model: 'Dump 14\'', assignedTo: '' },
  { id: 'v15', name: 'Dump Trailer 15', type: 'trailer', mi: 0, lomi: 0, oii: 5000, dii: 90, ldd: '2026-05-01', mil: [], sl: [], plate: 'TRL-015', yr: 2023, make: 'Big Tex', model: 'Dump 14\'', assignedTo: '' },
  { id: 'v19', name: 'Equipter Buggy', type: 'trailer', mi: 0, lomi: 0, oii: 5000, dii: 180, ldd: '2026-05-01', mil: [], sl: [], plate: 'EQP-001', yr: 2022, make: 'Equipter', model: '4000', assignedTo: '' }
];

// ── Maintenance Request Models ──
export const SEED_REQ = [
  { id: 'r1', vid: 'v1', vname: 'Truck 1 (MRR-001)', vtype: 'truck', type: 'Oil Change', urgency: 'normal', notes: 'Due soon based on mileage.', uid: 'u3', uname: 'Tyler Field', at: '2025-05-15T08:30:00', status: 'pending', scheduledDate: '', completedAt: '', whNotes: '' },
  { id: 'r2', vid: 'v2', vname: 'Truck 2 (MRR-002)', vtype: 'truck', type: 'Repair', urgency: 'urgent', notes: 'Brakes grinding when stopping.', uid: 'u7', uname: 'Marco Rivera', at: '2025-05-16T14:15:00', status: 'scheduled', scheduledDate: '2025-05-20', completedAt: '', whNotes: 'Scheduled with Toledo Truck Service.' },
];

// ── User Identity Roster (Passwords Completely Evicted) ──
export const SEED_U = [
  { id: 'u1', name: 'Sam', email: 'sam@maumeeriverroofing.com', role: 'admin', active: true },
  { id: 'u2', name: 'Ian', email: 'ian@maumeeriverroofing.com', role: 'admin', active: true },
  { id: 'u3', name: 'Adam', email: 'adam@maumeeriverroofing.com', role: 'Project Manager', active: true },
  { id: 'u4', name: 'Jerry', email: 'jerry@maumeeriverroofing.com', role: 'Production Coordinator', active: true },
  { id: 'u5', name: 'Jorge', email: 'jorge@maumeeriverroofing.com', role: 'Site Supervisor', active: true },
  { id: 'u6', name: 'Jason', email: 'jason@maumeeriverroofing.com', role: 'Site Supervisor', active: true },
];

// ── Corporate Facility Mapping Indexes ──
export const SEED_W = [{ id: 'w1', name: 'Saint Joe Road Warehouse', location: 'Toledo, OH', active: true }];

// ── Inventory Batch Matrix Catalog ──
export const SEED_I = [
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

// ── Production Workflow Job Pipeline Seeds ──
export const SEED_JOBS = [
  mkJob('j1', 'PO-2025-001', 'Smith Residence Re-roof', '1234 Oak St, Toledo OH', 'Full tear-off, GAF Timberline HDZ.', 'completed', 'u3', 'u6', '2025-05-08T10:00:00', '2025-05-09T08:00:00', '2025-05-10T17:00:00', false, [mkJI('i1', 'Underlayment', 'Roofing Materials', 'rolls', 8, 8, 0, 47.5, 380), mkJI('i2', 'Ice & Water Shield', 'Roofing Materials', 'rolls', 3, 3, 0, 85, 255), mkJI('i3', 'Smooth Shank Coil Nails', 'Fasteners', 'boxes', 10, 10, 0, 52, 520), mkJI('i14', 'OSB', 'Decking', 'each', 6, 6, 0, 28, 168)], 'manual'),
  mkJob('j2', 'PO-2025-005', 'Westside Commercial Center', '789 Industrial Blvd, Toledo OH', 'Commercial flat roof + pitched front.', 'approved', 'u3', 'u6', '2025-05-15T09:00:00', '2025-05-16T08:00:00', '', true, [mkJI('i1', 'Underlayment', 'Roofing Materials', 'rolls', 15), mkJI('i11', 'Atlas Rolled Ridge Vent', 'Ventilation', 'rolls', 4), mkJI('i3', 'Smooth Shank Coil Nails', 'Fasteners', 'boxes', 8), mkJI('i14', 'OSB', 'Decking', 'each', 12), mkJI('i5', 'SEBS - White', 'Sealants', 'tubes', 6)]),
  mkJob('j3', 'PO-2025-006', 'Lakewood HOA — Building B', '500 Lakewood Dr, Maumee OH', '', 'draft', '', 'u6', '2025-05-17T14:00:00', '', '', false, [mkJI('i5', 'SEBS - White', 'Sealants', 'tubes', 12), mkJI('i12', 'Atlas Box Vent - Black', 'Ventilation', 'each', 8), mkJI('i1', 'Underlayment', 'Roofing Materials', 'rolls', 10)]),
  mkJob('j4', 'PO-2025-007', 'Henderson Residence', '4521 Sylvania Ave, Maumee OH', 'Insurance claim re-roof.', 'active', 'u7', 'u6', '2025-05-14T11:00:00', '2025-05-15T07:00:00', '', false, [mkJI('i1', 'Underlayment', 'Roofing Materials', 'rolls', 10, 10, 0, 47.5, 475), mkJI('i4', 'Ring Shank Coil Nails', 'Fasteners', 'boxes', 6, 6, 0, 58, 348), mkJI('i11', 'Atlas Rolled Ridge Vent', 'Ventilation', 'rolls', 3, 3, 0, 95, 285), mkJI('i14', 'OSB', 'Decking', 'each', 8, 4, 0, 28, 112)]),
];

