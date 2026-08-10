// src/utils/automations.js
//
// One registry for every automatic email the app sends. Settings → Automations renders
// straight off this list, so adding an automation is a single entry here plus a call to
// the matching notify* helper at the point the event happens. Before this existed, the
// four job toggles were hardcoded in three places (the row list, the save handler, and
// the defaults), which is why maintenance never got the same treatment.
//
// Storage stays split by group: each group owns one settings row, keyed by `settingsKey`
// and holding a flat { [automationKey]: boolean } blob. Jobs keep the exact
// settings(key='job_notifications') shape they already had in the database, so nothing
// needs backfilling and no saved preference resets.

export const AUTOMATION_GROUPS = [
  {
    id: "jobs",
    label: "Jobs",
    icon: "🏗️",
    settingsKey: "job_notifications",
    blurb:
      "Email the assigned site supervisor when one of their jobs changes status. A job with no assigned supervisor, or one without an email on file, is skipped silently.",
  },
  {
    id: "maintenance",
    label: "Maintenance",
    icon: "🔧",
    settingsKey: "maintenance_notifications",
    blurb:
      "Email the shop when a request comes in, and the person who filed it when their ticket moves. New requests go to everyone holding the Manage Requests permission (Warehouse Managers, Coordinators and Admins by default).",
  },
];

// `key` is unique WITHIN a group, not globally — jobs and maintenance both have a
// "completed" automation and they are stored under different settings rows.
export const AUTOMATIONS = [
  // ── Jobs ──
  // `approved` defaults ON because an approval email already fired unconditionally
  // before the toggles existed; defaulting it off would silently stop a notification
  // people rely on. Everything else defaults OFF: turning on new outbound email is a
  // deliberate admin choice, not a surprise.
  {
    group: "jobs",
    key: "approved",
    label: "Approved",
    desc: "A draft is approved and assigned, and the supervisor gets the go-ahead.",
    recipient: "Assigned site supervisor",
    default: true,
  },
  {
    group: "jobs",
    key: "active",
    label: "Materials pulled",
    desc: "Inventory is pulled and the job goes active.",
    recipient: "Assigned site supervisor",
    default: false,
  },
  {
    group: "jobs",
    key: "completed",
    label: "Completed",
    desc: "Unused stock is returned and the job is marked done.",
    recipient: "Assigned site supervisor",
    default: false,
  },
  {
    group: "jobs",
    key: "closed",
    label: "Closed",
    desc: "The job is closed out and archived.",
    recipient: "Assigned site supervisor",
    default: false,
  },

  // ── Maintenance ──
  // All default OFF. Nothing in this group emailed anyone before, so there is no
  // existing behaviour to preserve and every one of these is genuinely new outbound mail.
  {
    group: "maintenance",
    key: "filed",
    label: "Request filed",
    desc: "Someone reports a problem with a truck or trailer. Covers every new request, whatever its urgency.",
    recipient: "Everyone with Manage Requests",
    default: false,
  },
  {
    group: "maintenance",
    key: "urgent",
    label: "Urgent request filed",
    desc: "A request comes in flagged urgent (safety concern or vehicle down). Independent of the row above, so you can page the shop on urgent tickets only.",
    recipient: "Everyone with Manage Requests",
    default: false,
  },
  {
    group: "maintenance",
    key: "scheduled",
    label: "Request scheduled",
    desc: "The shop approves a ticket and books a date for it.",
    recipient: "Whoever filed the request",
    default: false,
  },
  {
    group: "maintenance",
    key: "completed",
    label: "Request completed",
    desc: "The work is finished and the ticket is closed out.",
    recipient: "Whoever filed the request",
    default: false,
  },
];

export function automationsForGroup(groupId) {
  return AUTOMATIONS.filter((a) => a.group === groupId);
}

export function groupById(groupId) {
  return AUTOMATION_GROUPS.find((g) => g.id === groupId) || null;
}

// The all-defaults blob for one group, used as initial state and as the base every
// stored value is merged onto. A group that has never been saved, or a key added to the
// registry after a company last saved, both resolve to the registry default rather than
// to undefined.
export function defaultPrefs(groupId) {
  return Object.fromEntries(automationsForGroup(groupId).map((a) => [a.key, a.default]));
}

// Stored value → the prefs object the notify helpers read. Unknown keys in the stored
// blob are dropped, so a renamed or removed automation can't keep firing.
export function mergePrefs(groupId, stored) {
  const base = defaultPrefs(groupId);
  if (!stored || typeof stored !== "object") return base;
  for (const key of Object.keys(base)) {
    if (typeof stored[key] === "boolean") base[key] = stored[key];
  }
  return base;
}

// Form state → what gets written back. Coerces to real booleans and drops anything the
// registry doesn't define.
export function serializePrefs(groupId, form) {
  return Object.fromEntries(automationsForGroup(groupId).map((a) => [a.key, !!(form && form[a.key])]));
}
