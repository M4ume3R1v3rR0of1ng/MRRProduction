// src/database/permissions.js

// 1. Core Permission Rules & UI Descriptions
export const PERM_DEFS = {
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

// 2. Navigation & Settings Groupings Map
export const PERM_GROUPS = [
  ['📦 Inventory', ['inv_view', 'inv_edit', 'inv_receive', 'inv_bulk_receive', 'inv_pricing_view', 'inv_pricing_edit']],
  ['🚛 Fleet', ['fleet_view', 'fleet_edit', 'fleet_log_mi']],
  ['🔧 Maintenance', ['maint_submit', 'maint_manage']],
  ['🏗️ Jobs', ['jobs_view', 'jobs_build', 'jobs_approve', 'jobs_pull', 'jobs_complete']],
  ['📊 Reports', ['reports_view']],
  ['⚙️ Admin', ['users_manage', 'settings_manage']]
];

export const ALL_PERM_KEYS = Object.keys(PERM_DEFS);

// 3. User Roster System Display Mapping Array
export const ROLE_COLS = [
  ['warehouse', 'Warehouse Mgr'], 
  ['coordinator', 'Coordinator'], 
  ['manager', 'Manager'], 
  ['field', 'Site Supervisor'], 
  ['employee', 'Employee']
];

// 4. Baseline Corporate Safety Rules Matrix
export const DEFAULT_ROLE_PERMS = {
  warehouse: { inv_view: true, inv_edit: true, inv_receive: true, inv_bulk_receive: true, inv_pricing_view: true, inv_pricing_edit: false, fleet_view: true, fleet_edit: true, fleet_log_mi: true, maint_submit: true, maint_manage: true, jobs_view: true, jobs_build: false, jobs_approve: false, jobs_pull: true, jobs_complete: true, reports_view: true, users_manage: false, settings_manage: false },
  coordinator: { inv_view: true, inv_edit: true, inv_receive: true, inv_bulk_receive: true, inv_pricing_view: true, inv_pricing_edit: true, fleet_view: true, fleet_edit: true, fleet_log_mi: true, maint_submit: true, maint_manage: true, jobs_view: true, jobs_build: true, jobs_approve: true, jobs_pull: true, jobs_complete: true, reports_view: true, users_manage: false, settings_manage: false },
  manager: { inv_view: true, inv_edit: true, inv_receive: true, inv_bulk_receive: true, inv_pricing_view: true, inv_pricing_edit: true, fleet_view: true, fleet_edit: false, fleet_log_mi: false, maint_submit: true, maint_manage: false, jobs_view: true, jobs_build: true, jobs_approve: true, jobs_pull: true, jobs_complete: true, reports_view: true, users_manage: false, settings_manage: false },
  field: { inv_view: true, inv_edit: true, inv_receive: true, inv_bulk_receive: false, inv_pricing_view: false, inv_pricing_edit: false, fleet_view: true, fleet_edit: false, fleet_log_mi: true, maint_submit: true, maint_manage: false, jobs_view: true, jobs_build: false, jobs_approve: false, jobs_pull: true, jobs_complete: true, reports_view: false, users_manage: false, settings_manage: false },
};

// 5. Global Roles Map Interface
export const ROLES = { 
  admin: { label: 'Admin', color: 'red' }, 
  warehouse: { label: 'Warehouse Mgr', color: 'purple' }, 
  coordinator: { label: 'Coordinator', color: 'blue' }, 
  manager: { label: 'Manager', color: 'amber' }, 
  field: { label: 'Site Supervisor', color: 'green' }, 
  employee: { label: 'Employee', color: 'gray' } 
};

// 6. Real-time Security Access Resolver Function
export function getEffectivePerms(user, rolePerms, userOverrides = {}) {
  if (!user) return {};
  // Admins always bypass standard security gates and auto-resolve to true
  if (user.role === 'admin') return Object.fromEntries(ALL_PERM_KEYS.map(k => [k, true]));
  
  const base = { ...(rolePerms[user.role] || {}) };
  const ov = userOverrides[user.id] || {};
  
  // Blend baseline role access patterns with explicit individual account locks
  return { ...base, ...ov };
};