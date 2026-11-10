// netlify/functions/_shared/reorder.js
//
// The decision half of automatic reordering: given a company's inventory and the
// proposals it already has, which items need a new proposal? Pure, so it can be tested
// without a database, a clock or a network.
//
// WHAT "LOW" MEANS HERE
//
// The same rule the rest of the product already uses (chat.js get_inventory_status,
// anvilBriefing.js): on hand is the sum of the item's batch `rem`, and the item is low when
// on hand is AT OR BELOW its `alrt` threshold. Not a new definition. An item with no
// threshold (alrt empty or 0) is NOT low: a shop that never set a line has not asked to be
// told, and a proposal for every item that happens to hit zero would be noise on day one.
//
// WHY AN ITEM ALREADY PROPOSED IS SKIPPED
//
// One pending proposal per item is enforced by a unique index (supabase/65), but the
// scan filters first so it does not rely on an insert failing to know what to do. The
// index is the backstop against two overlapping runs, not the plan.
// @ts-check

/**
 * @param {{ batches?: Array<{ rem?: unknown }> | null } | null | undefined} item
 * @returns {number}
 */
export function onHand(item) {
  return (item?.batches || []).reduce((sum, b) => sum + (parseFloat(String(b?.rem)) || 0), 0);
}

/**
 * @param {{ alrt?: unknown }} item
 * @returns {number | null} The threshold, or null when none is set.
 */
export function alertLevel(item) {
  const n = Number(item?.alrt);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @typedef {Object} InventoryRow
 * @property {string | number} id
 * @property {string} name
 * @property {string | null} [unit]
 * @property {unknown} [alrt]
 * @property {Array<{ rem?: unknown }> | null} [batches]
 * @property {number | string | null} [reorder_qty]
 * @property {string | null} [supplier_name]
 * @property {string | null} [supplier_email]
 */

/**
 * @param {InventoryRow[]} inventory
 * @param {Array<{ inventory_id: string }>} pending - proposals already waiting, same company
 * @returns {Array<{
 *   inventory_id: string, item_name: string, unit: string | null, on_hand: number,
 *   alert_level: number, suggested_qty: number | null,
 *   supplier_name: string | null, supplier_email: string | null
 * }>}
 */
export function findReorderCandidates(inventory, pending) {
  const already = new Set((pending || []).map((p) => String(p.inventory_id)));
  const out = [];
  for (const item of inventory || []) {
    const level = alertLevel(item);
    if (level === null) continue;
    if (already.has(String(item.id))) continue;
    const have = onHand(item);
    if (have > level) continue;
    const qty = Number(item.reorder_qty);
    out.push({
      inventory_id: String(item.id),
      item_name: item.name,
      unit: item.unit ?? null,
      on_hand: have,
      alert_level: level,
      suggested_qty: Number.isFinite(qty) && qty > 0 ? qty : null,
      supplier_name: item.supplier_name || null,
      supplier_email: item.supplier_email || null,
    });
  }
  // Emptiest first, so the email and the queue lead with what is closest to a stop-work.
  return out.sort((a, b) => a.on_hand / a.alert_level - b.on_hand / b.alert_level);
}

/** @param {unknown} value */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {number} n */
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The email to the people who approve orders. Plain on purpose: it says what is low, what
 * the suggestion is, and where to approve it. It does not carry an approve link, because an
 * email that commits an order on a click is an email that can be forwarded.
 * @param {{ companyName: string, proposals: ReturnType<typeof findReorderCandidates>, appUrl: string }} args
 * @returns {{ subject: string, html: string }}
 */
export function buildReorderEmail({ companyName, proposals, appUrl }) {
  const n = proposals.length;
  const rows = proposals
    .map(
      (p) =>
        `<tr><td style="padding:6px 12px 6px 0">${esc(p.item_name)}</td>` +
        `<td style="padding:6px 12px 6px 0">${fmt(p.on_hand)} ${esc(p.unit || "")} left (line: ${fmt(p.alert_level)})</td>` +
        `<td style="padding:6px 0">${
          p.suggested_qty === null
            ? "<em>no reorder quantity set</em>"
            : `suggest ${fmt(p.suggested_qty)} ${esc(p.unit || "")}`
        }</td></tr>`,
    )
    .join("");
  return {
    subject: `${n} ${n === 1 ? "item needs" : "items need"} reordering — ${companyName}`,
    html:
      `<p>A.N.V.I.L. found ${n} ${n === 1 ? "item" : "items"} at or below the low-stock line.</p>` +
      `<table style="border-collapse:collapse">${rows}</table>` +
      `<p>Nothing has been ordered. Review and approve in Inventory: ` +
      `<a href="${esc(appUrl)}">${esc(appUrl)}</a></p>`,
  };
}

// ── The Free low-stock notice ────────────────────────────────────────────────────────
//
// A plain "these items are under their line" email, for every company. It is the Free half
// of the split decided in docs/ANVIL_CAPABILITIES.md: telling people is Free; drafting the
// reorder, queueing it for approval and learning usage rates is Pro.
//
// It is a WEEKLY digest, not a daily email, on purpose. The Pro email can fire once per
// item because it has a notified_at column to remember what it already said. This one has
// no such memory, and adding a table just to remember would be more machinery than a notice
// deserves, so it stays quiet by being infrequent and by sending nothing when nothing is low.

/**
 * Items at or below their line, emptiest first. Same definition of "low" as the Pro scan
 * (onHand <= alrt, no line set means never low), minus the proposal bookkeeping.
 * @param {InventoryRow[]} inventory
 */
export function findLowStockItems(inventory) {
  return findReorderCandidates(inventory, []).map((c) => ({
    item_name: c.item_name,
    unit: c.unit,
    on_hand: c.on_hand,
    alert_level: c.alert_level,
  }));
}

/**
 * Who gets the Free notice. Not a company whose Pro reorder scan already emails the
 * approvers about the same items: two emails about one shelf is a reason to mute both.
 * @param {{ anvil_pro?: boolean | null, anvil_pro_comped?: boolean | null, subscription_status?: string | null, is_platform_company?: boolean | null }} company
 * @param {boolean} proReorderRuns - Pro is in effect AND auto-reorder is switched on
 * @param {string[]} usableStates
 */
export function wantsFreeLowStockNotice(company, proReorderRuns, usableStates) {
  if (!company || company.is_platform_company === true) return false;
  if (!usableStates.includes(company.subscription_status ?? "")) return false;
  return !proReorderRuns;
}

/**
 * @param {{ companyName: string, items: ReturnType<typeof findLowStockItems>, appUrl: string }} args
 * @returns {{ subject: string, html: string }}
 */
export function buildLowStockEmail({ companyName, items, appUrl }) {
  const n = items.length;
  const rows = items
    .map(
      (p) =>
        `<tr><td style="padding:6px 12px 6px 0">${esc(p.item_name)}</td>` +
        `<td style="padding:6px 0">${fmt(p.on_hand)} ${esc(p.unit || "")} left (line: ${fmt(p.alert_level)})</td></tr>`,
    )
    .join("");
  return {
    subject: `${n} ${n === 1 ? "item is" : "items are"} low on stock — ${companyName}`,
    html:
      `<p>${n} ${n === 1 ? "item is" : "items are"} at or below the low-stock line.</p>` +
      `<table style="border-collapse:collapse">${rows}</table>` +
      `<p>See Inventory: <a href="${esc(appUrl)}">${esc(appUrl)}</a></p>`,
  };
}
