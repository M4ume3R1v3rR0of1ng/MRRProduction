// src/shared/database/permissions.js
// @ts-check

/**
 * @typedef {Object} PermDef
 * @property {string} label - Short name shown next to the checkbox in Settings.
 * @property {string} desc  - Longer explanation of what the permission unlocks.
 * @property {string} g     - The PERM_GROUPS heading (with emoji) this belongs to.
 */

// 1. Core Permission Rules & UI Descriptions
//
// `@satisfies` (rather than `@type {Record<string, PermDef>}`) is deliberate: it
// checks every entry against PermDef WITHOUT widening the object's own key type to
// `string`, so PermKey below stays the exact literal union of permission ids
// instead of collapsing to "any string". That's what lets PERM_GROUPS and
// DEFAULT_ROLE_PERMS below be checked against the real set of keys — a typo'd or
// removed permission id fails to compile instead of silently granting nothing.
/** @satisfies {Record<string, PermDef>} */
export const PERM_DEFS = {
  inv_view: { label: "View Inventory", desc: "Browse items & stock levels", g: "📦 Inventory" },
  inv_edit: {
    label: "Add & Edit Items",
    desc: "Create items & edit item details",
    g: "📦 Inventory",
  },
  inv_receive: {
    label: "Receive Batches",
    desc: "Receive individual item batches",
    g: "📦 Inventory",
  },
  inv_bulk_receive: {
    label: "Receive Bulk Orders",
    desc: "Multi-item bulk order receiving",
    g: "📦 Inventory",
  },
  inv_pricing_view: {
    label: "View Pricing",
    desc: "See purchase prices & batch costs",
    g: "📦 Inventory",
  },
  inv_pricing_edit: { label: "Edit Pricing", desc: "Change & set item pricing", g: "📦 Inventory" },
  inv_adjust: {
    label: "Adjust Stock",
    desc: "Manually correct on-hand quantities",
    g: "📦 Inventory",
  },
  // Needs inv_view as well: the count sheet is a tab inside Inventory, and
  // Inventory itself is gated on inv_view one level up in App.jsx. Granting this
  // alone to someone without inv_view gives them nothing, so the description says
  // so rather than leaving an admin to discover it.
  inv_count: {
    label: "Monthly Count",
    desc: "Run physical stock counts & see the bleed rate (needs View Inventory)",
    g: "📦 Inventory",
  },
  fleet_view: { label: "View Fleet", desc: "View vehicles & service history", g: "🚛 Fleet" },
  fleet_edit: { label: "Manage Fleet", desc: "Add & edit vehicles, assign drivers", g: "🚛 Fleet" },
  fleet_log_service: {
    label: "Log Service",
    desc: "Record completed service work on vehicles",
    g: "🚛 Fleet",
  },
  fleet_log_inspection: {
    label: "Log Inspections",
    desc: "File formal vehicle condition inspection reports",
    g: "🚛 Fleet",
  },
  fleet_photo_delete: {
    label: "Delete Vehicle Photos",
    desc: "Remove or replace truck & trailer photos",
    g: "🚛 Fleet",
  },
  fleet_log_mi: { label: "Log Mileage", desc: "Submit vehicle mileage readings", g: "🚛 Fleet" },
  maint_submit: {
    label: "Submit Requests",
    desc: "Submit maintenance & service requests",
    g: "🔧 Maintenance",
  },
  maint_manage: {
    label: "Manage Requests",
    desc: "Schedule & close maintenance requests",
    g: "🔧 Maintenance",
  },
  jobs_view: { label: "View Jobs", desc: "View job pipeline & job details", g: "🏗️ Jobs" },
  jobs_build: { label: "Build Jobs", desc: "Create & edit jobs, plan materials", g: "🏗️ Jobs" },
  jobs_approve: {
    label: "Approve & Assign",
    desc: "Approve jobs & assign supervisors",
    g: "🏗️ Jobs",
  },
  jobs_pull: { label: "Pull Inventory", desc: "Pull materials from approved jobs", g: "🏗️ Jobs" },
  jobs_edit_pull: {
    label: "Edit Job (Pull Inventory)",
    desc: "Edit job info & reassign site supervisor from Pull Inventory",
    g: "🏗️ Jobs",
  },
  jobs_complete: {
    label: "Complete Jobs",
    desc: "Return inventory & mark jobs done",
    g: "🏗️ Jobs",
  },
  // Contract value is more sensitive than material cost: it is what the customer
  // was charged. Kept separate from inv_pricing_view so a warehouse manager can
  // see what stock costs without seeing what the job sold for.
  jobs_revenue: {
    label: "View & Set Contract Value",
    desc: "See what a job sold for, and job profitability",
    g: "🏗️ Jobs",
  },
  jobs_close: {
    label: "Close Completed Jobs",
    desc: "Archive completed jobs once payment is confirmed in AccuLynx",
    g: "🏗️ Jobs",
  },
  reports_view: { label: "View Reports", desc: "Access reports & analytics", g: "📊 Reports" },
  users_manage: {
    label: "Manage Users",
    desc: "Add, edit & deactivate user accounts",
    g: "⚙️ Admin",
  },
  settings_manage: {
    label: "System Settings",
    desc: "Settings, permissions & API config",
    g: "⚙️ Admin",
  },
};

/** Every valid permission id — the exact keys of PERM_DEFS, not `string`. */
/** @typedef {keyof typeof PERM_DEFS} PermKey */

/** @typedef {[group: string, keys: PermKey[]]} PermGroup */

// 2. Navigation & Settings Groupings Map
/** @type {PermGroup[]} */
export const PERM_GROUPS = [
  [
    "📦 Inventory",
    [
      "inv_view",
      "inv_edit",
      "inv_receive",
      "inv_bulk_receive",
      "inv_pricing_view",
      "inv_pricing_edit",
      "inv_adjust",
      "inv_count",
    ],
  ],
  [
    "🚛 Fleet",
    [
      "fleet_view",
      "fleet_edit",
      "fleet_log_service",
      "fleet_log_inspection",
      "fleet_photo_delete",
      "fleet_log_mi",
    ],
  ],
  ["🔧 Maintenance", ["maint_submit", "maint_manage"]],
  [
    "🏗️ Jobs",
    [
      "jobs_view",
      "jobs_build",
      "jobs_approve",
      "jobs_pull",
      "jobs_edit_pull",
      "jobs_complete",
      "jobs_close",
      "jobs_revenue",
    ],
  ],
  ["📊 Reports", ["reports_view"]],
  ["⚙️ Admin", ["users_manage", "settings_manage"]],
];

export const ALL_PERM_KEYS = /** @type {PermKey[]} */ (Object.keys(PERM_DEFS));

/**
 * Every role that has an entry in the DEFAULT_ROLE_PERMS matrix — i.e. every role
 * except "admin", which never consults the matrix (see getEffectivePerms below).
 * Defined ahead of DEFAULT_ROLE_PERMS's own declaration; that's fine for a type
 * (unlike the const itself, types aren't evaluated top-to-bottom).
 * @typedef {keyof typeof DEFAULT_ROLE_PERMS} RoleKey
 */

/** @typedef {RoleKey | "admin"} Role */

/** @typedef {[role: RoleKey, label: string]} RoleCol */

// 3. User Roster System Display Mapping Array
/** @type {RoleCol[]} */
export const ROLE_COLS = [
  ["warehouse", "Warehouse Mgr"],
  ["coordinator", "Coordinator"],
  ["manager", "Manager"],
  ["field", "Site Supervisor"],
  ["employee", "Employee"],
  ["bookkeeper", "Book Keeper"],
];

// 4. Baseline Corporate Safety Rules Matrix
//
// `@satisfies {Record<string, Record<PermKey, boolean>>}` forces every role below
// to set EVERY permission explicitly — add a permission to PERM_DEFS without
// updating every role here and this stops compiling, rather than the role
// silently defaulting to "no access" (or, worse, `undefined` reading as falsy at
// one call site and truthy at another).
/** @satisfies {Record<string, Record<PermKey, boolean>>} */
export const DEFAULT_ROLE_PERMS = {
  warehouse: {
    inv_view: true,
    inv_edit: true,
    inv_receive: true,
    inv_bulk_receive: true,
    inv_pricing_view: true,
    inv_pricing_edit: false,
    inv_adjust: false,
    inv_count: true,
    fleet_view: true,
    fleet_edit: true,
    fleet_log_service: true,
    fleet_log_inspection: true,
    fleet_photo_delete: false,
    fleet_log_mi: true,
    maint_submit: true,
    maint_manage: true,
    jobs_view: true,
    jobs_build: false,
    jobs_approve: false,
    jobs_pull: true,
    jobs_edit_pull: false,
    jobs_complete: true,
    jobs_close: false,
    jobs_revenue: false,
    reports_view: true,
    users_manage: false,
    settings_manage: false,
  },
  coordinator: {
    inv_view: true,
    inv_edit: true,
    inv_receive: true,
    inv_bulk_receive: true,
    inv_pricing_view: true,
    inv_pricing_edit: true,
    inv_adjust: false,
    inv_count: false,
    fleet_view: true,
    fleet_edit: true,
    fleet_log_service: true,
    fleet_log_inspection: true,
    fleet_photo_delete: false,
    fleet_log_mi: true,
    maint_submit: true,
    maint_manage: true,
    jobs_view: true,
    jobs_build: true,
    jobs_approve: true,
    jobs_pull: true,
    jobs_edit_pull: true,
    jobs_complete: true,
    jobs_close: true,
    jobs_revenue: true,
    reports_view: true,
    users_manage: false,
    settings_manage: false,
  },
  manager: {
    inv_view: true,
    inv_edit: true,
    inv_receive: true,
    inv_bulk_receive: true,
    inv_pricing_view: true,
    inv_pricing_edit: true,
    inv_adjust: true,
    inv_count: false,
    fleet_view: true,
    fleet_edit: false,
    fleet_log_service: true,
    fleet_log_inspection: true,
    fleet_photo_delete: true,
    fleet_log_mi: false,
    maint_submit: true,
    maint_manage: false,
    jobs_view: true,
    jobs_build: true,
    jobs_approve: true,
    jobs_pull: true,
    jobs_edit_pull: true,
    jobs_complete: true,
    jobs_close: true,
    jobs_revenue: true,
    reports_view: true,
    users_manage: false,
    settings_manage: false,
  },
  employee: {
    inv_view: false,
    inv_edit: false,
    inv_receive: false,
    inv_bulk_receive: false,
    inv_pricing_view: false,
    inv_pricing_edit: false,
    inv_adjust: false,
    inv_count: false,
    fleet_view: true,
    fleet_edit: false,
    fleet_log_service: true,
    fleet_log_inspection: false,
    fleet_photo_delete: false,
    fleet_log_mi: false,
    maint_submit: true,
    maint_manage: false,
    jobs_view: false,
    jobs_build: false,
    jobs_approve: false,
    jobs_pull: false,
    jobs_edit_pull: false,
    jobs_complete: false,
    jobs_close: false,
    jobs_revenue: false,
    reports_view: false,
    users_manage: false,
    settings_manage: false,
  },
  field: {
    inv_view: true,
    inv_edit: true,
    inv_receive: true,
    inv_bulk_receive: false,
    inv_pricing_view: false,
    inv_pricing_edit: false,
    inv_adjust: true,
    inv_count: false,
    fleet_view: true,
    fleet_edit: false,
    fleet_log_service: true,
    fleet_log_inspection: false,
    fleet_photo_delete: false,
    fleet_log_mi: true,
    maint_submit: true,
    maint_manage: false,
    jobs_view: true,
    jobs_build: false,
    jobs_approve: false,
    jobs_pull: true,
    jobs_edit_pull: true,
    jobs_complete: true,
    jobs_close: false,
    jobs_revenue: false,
    reports_view: false,
    users_manage: false,
    settings_manage: false,
  },
  bookkeeper: {
    inv_view: false,
    inv_edit: false,
    inv_receive: false,
    inv_bulk_receive: false,
    inv_pricing_view: true,
    inv_pricing_edit: false,
    inv_adjust: false,
    inv_count: false,
    fleet_view: false,
    fleet_edit: false,
    fleet_log_service: false,
    fleet_log_inspection: false,
    fleet_photo_delete: false,
    fleet_log_mi: false,
    maint_submit: true,
    maint_manage: false,
    jobs_view: true,
    jobs_build: false,
    jobs_approve: false,
    jobs_pull: false,
    jobs_edit_pull: false,
    jobs_complete: false,
    jobs_close: true,
    jobs_revenue: true,
    reports_view: true,
    users_manage: false,
    settings_manage: false,
  },
};

/**
 * @typedef {Object} RoleDef
 * @property {string} label
 * @property {string} color
 */

// 5. Global Roles Map Interface
/** @satisfies {Record<Role, RoleDef>} */
export const ROLES = {
  admin: { label: "Admin", color: "red" },
  warehouse: { label: "Warehouse Mgr", color: "purple" },
  coordinator: { label: "Coordinator", color: "blue" },
  manager: { label: "Manager", color: "amber" },
  field: { label: "Site Supervisor", color: "green" },
  employee: { label: "Employee", color: "gray" },
  bookkeeper: { label: "Book Keeper", color: "teal" },
};

/**
 * The minimal shape getEffectivePerms actually reads. Deliberately loose (not
 * "the" User type) so any full user record — app state, a Supabase row, a test
 * fixture — satisfies it structurally as long as it has these two fields.
 * @typedef {Object} PermUser
 * @property {string} id
 * @property {Role} role
 */

/** @typedef {Partial<Record<PermKey, boolean>>} PermMap */

// 6. Real-time Security Access Resolver Function
/**
 * @param {PermUser | null | undefined} user
 * @param {Record<RoleKey, PermMap>} rolePerms
 * @param {Record<string, PermMap>} [userOverrides]
 * @returns {PermMap}
 */
export function getEffectivePerms(user, rolePerms, userOverrides = {}) {
  if (!user) return {};
  // Admins always bypass standard security gates and auto-resolve to true
  if (user.role === "admin") {
    return /** @type {PermMap} */ (Object.fromEntries(ALL_PERM_KEYS.map((k) => [k, true])));
  }

  const base = { ...(rolePerms[user.role] || {}) };
  const ov = userOverrides[user.id] || {};

  // Blend baseline role access patterns with explicit individual account locks
  return { ...base, ...ov };
}
