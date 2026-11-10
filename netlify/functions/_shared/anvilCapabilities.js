// netlify/functions/_shared/anvilCapabilities.js
//
// EVERYTHING A.N.V.I.L. CAN DO, in one list, each tagged with the plan it belongs to.
//
// This is the single place the free-versus-Pro decision lives. Changing what is
// included in Anvil Pro is a one-word edit to a `tier` below, not a hunt through
// chat.js, the cron jobs and the UI. Everything that gates on Pro reads this file:
//
//   - chat.js refuses a Pro tool for a company without the add-on (toolTier)
//   - the reorder cron and endpoint check the capability they implement
//   - docs/ANVIL_CAPABILITIES.md is the human-readable version of this list
//
// ⚠️ EVERY CAPABILITY STARTS AS WHAT IT ALREADY WAS. The fifteen that shipped before
// Anvil Pro are all 'free', so landing this file changes nothing for any company that
// has them today. Only the four reorder capabilities, which did not exist, are 'pro'.
// Moving an existing capability to 'pro' takes it away from companies that have it now;
// that is a product decision to make deliberately, not a side effect of a refactor.
//
// A tool name that is not in this list is treated as Pro (fail CLOSED). A new tool that
// somebody forgot to register should not quietly ship free; the unit test also fails if
// chat.js offers a tool this file does not know.

/** @typedef {"free" | "pro"} Tier */

/**
 * @typedef {Object} Capability
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {"ask" | "act" | "automatic"} kind - ask: answers questions · act: changes data
 *   after a Confirm · automatic: runs on its own, nobody asks
 * @property {string | null} tool - The chat tool name, when this is one.
 * @property {Tier} tier
 */

/** @type {Capability[]} */
export const CAPABILITIES = [
  // ── Ask A.N.V.I.L. (read tools) ──────────────────────────────────────────
  {
    id: "jobs_search",
    label: "Search jobs",
    description: "Find production jobs by PO, name, address or status.",
    kind: "ask",
    tool: "search_jobs",
    tier: "free",
  },
  {
    id: "inventory_status",
    label: "Check inventory",
    description: "Stock on hand per item, and what is low or out.",
    kind: "ask",
    tool: "get_inventory_status",
    tier: "free",
  },
  {
    id: "fleet_status",
    label: "Fleet status",
    description: "Vehicle state, mileage, oil and detail status.",
    kind: "ask",
    tool: "get_fleet_status",
    tier: "free",
  },
  {
    id: "maintenance_requests",
    label: "Maintenance requests",
    description: "Look up open and past maintenance tickets.",
    kind: "ask",
    tool: "get_maintenance_requests",
    tier: "free",
  },
  {
    id: "maintenance_insights",
    label: "Maintenance insights",
    description: "Repeat-repair patterns and each vehicle's learned service cadence.",
    kind: "ask",
    tool: "get_maintenance_insights",
    tier: "free",
  },
  {
    id: "maintenance_recommend",
    label: "Maintenance to-do list",
    description: "A ranked, evidence-backed list of what the fleet needs next.",
    kind: "ask",
    tool: "recommend_maintenance",
    tier: "free",
  },
  {
    id: "schedule",
    label: "Schedule and clash check",
    description: "What is on the calendar, and any trailer double-booked.",
    kind: "ask",
    tool: "get_schedule",
    tier: "free",
  },
  {
    id: "job_costing",
    label: "Job costing",
    description: "Material cost and margin on jobs, for people allowed to see money.",
    kind: "ask",
    tool: "get_job_costing",
    tier: "free",
  },
  {
    id: "training_status",
    label: "Training status",
    description: "Who has outstanding or overdue training.",
    kind: "ask",
    tool: "get_training_status",
    tier: "free",
  },
  {
    id: "my_briefing",
    label: "On-demand briefing",
    description: "The same briefing as the morning one, whenever you ask.",
    kind: "ask",
    tool: "get_my_briefing",
    tier: "free",
  },

  // ── Do it for me (write tools, each behind a Confirm button) ─────────────
  {
    id: "file_maintenance",
    label: "File a maintenance request",
    description: "Open a ticket against a vehicle from chat.",
    kind: "act",
    tool: "file_maintenance_request",
    tier: "free",
  },
  {
    id: "schedule_maintenance",
    label: "Schedule a maintenance request",
    description: "Put a shop date on a pending ticket.",
    kind: "act",
    tool: "schedule_maintenance_request",
    tier: "free",
  },
  {
    id: "adjust_stock",
    label: "Correct a stock count",
    description: "Set an item's on-hand quantity to a counted number.",
    kind: "act",
    tool: "adjust_stock",
    tier: "free",
  },
  {
    id: "log_mileage",
    label: "Log mileage",
    description: "Record a vehicle's odometer reading.",
    kind: "act",
    tool: "log_mileage",
    tier: "free",
  },
  {
    id: "log_service",
    label: "Log a service record",
    description: "Record a service that was performed.",
    kind: "act",
    tool: "log_service_record",
    tier: "free",
  },

  // ── Runs on its own ──────────────────────────────────────────────────────
  {
    id: "morning_briefing",
    label: "Morning briefing",
    description:
      "Each weekday A.N.V.I.L. writes every person one message about their day. Silent when there is nothing to say.",
    kind: "automatic",
    tool: null,
    tier: "free",
  },
  {
    id: "translate",
    label: "Spanish / English translation",
    description:
      "Translates the notes people type, as a reading aid. The original is never changed.",
    kind: "automatic",
    tool: null,
    tier: "free",
  },
  {
    id: "photo_chat",
    label: "Photo in chat",
    description: "Send A.N.V.I.L. a photo with your question.",
    kind: "ask",
    tool: null,
    tier: "free",
  },

  {
    id: "lowstock_notice",
    label: "Low-stock email",
    description:
      "Every Monday, emails the people who manage stock which items are at or below their line. Silent when nothing is low. Free; drafting the reorder is Pro.",
    kind: "automatic",
    tool: null,
    tier: "free",
  },

  // ── New with Anvil Pro: automatic low-stock reordering ───────────────────
  {
    id: "reorder_watch",
    label: "Low-stock watch",
    description:
      "Every weekday, checks each item against its low-stock line and drafts a reorder for anything under it.",
    kind: "automatic",
    tool: null,
    tier: "pro",
  },
  {
    id: "reorder_email",
    label: "Reorder-waiting email",
    description: "Emails the people who approve orders when a drafted reorder is waiting.",
    kind: "automatic",
    tool: null,
    tier: "pro",
  },
  {
    id: "reorder_approval",
    label: "Reorder approval queue",
    description:
      "Review, edit the quantity, then approve or dismiss each drafted reorder. Nothing is ordered without a person saying yes.",
    kind: "act",
    tool: null,
    tier: "pro",
  },
  {
    id: "reorder_ask",
    label: "Ask about pending reorders",
    description: '"What are we about to order?" answered from chat.',
    kind: "ask",
    tool: "get_reorder_proposals",
    tier: "pro",
  },
];

const BY_TOOL = new Map(CAPABILITIES.filter((c) => c.tool).map((c) => [c.tool, c]));
const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

/**
 * Which plan a chat tool belongs to. Unknown tool = 'pro', so an unregistered tool fails
 * closed rather than shipping free by omission.
 * @param {string} toolName
 * @returns {Tier}
 */
export function toolTier(toolName) {
  return BY_TOOL.get(toolName)?.tier ?? "pro";
}

/**
 * @param {string} capabilityId
 * @returns {Tier}
 */
export function capabilityTier(capabilityId) {
  return BY_ID.get(capabilityId)?.tier ?? "pro";
}

/** @param {string} toolName */
export function isRegisteredTool(toolName) {
  return BY_TOOL.has(toolName);
}
