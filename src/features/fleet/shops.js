// src/features/fleet/shops.js
//
// The outside shops a company sends its trucks to (supabase/67_fleet_shops.sql).
// Pure helpers, so the history and spend a shop's page shows can be tested
// without a database.
//
// WHERE A SHOP'S HISTORY COMES FROM
//
// Completed work is read from each vehicle's service log (vehicles.sl), where an
// entry carries `shop_id` once it was logged against a shop. That log is the one
// place every completed service lands, whether it was closed from a maintenance
// ticket (complete_maintenance_service writes the entry) or logged straight on
// the Fleet page. Reading completed TICKETS as well would count each ticket's
// service twice.
//
// Open tickets (pending or scheduled, with a shop_id) are the shop's UPCOMING
// work: nothing has been done or paid for yet, so they never count toward spend.

/**
 * Lowercased, trimmed, inner spaces collapsed. What "the same name" means when
 * the form checks for a duplicate. Slightly stricter than supabase/67's unique
 * index and link_shop_history(), which only lowercase and trim: the form also
 * catches "Jim  Schmidt" against "Jim Schmidt", which the database would allow.
 * @param {unknown} name
 */
export function shopKey(name) {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Validates a shop form before it is saved. Returns an error message, or null.
 * @param {{ name?: string }} form
 * @param {Array<{ id: string, name: string }>} shops  the company's existing shops
 * @param {string | null} [editingId]  the shop being edited, which may keep its own name
 */
export function shopFormError(form, shops, editingId = null) {
  const key = shopKey(form?.name);
  if (!key) return "name_required";
  const clash = (shops || []).some((s) => s.id !== editingId && shopKey(s.name) === key);
  return clash ? "name_taken" : null;
}

/**
 * Splits "Tires, Alignment ,, Ford dealer" into ["Tires", "Alignment", "Ford dealer"].
 * @param {string} text
 * @returns {string[]}
 */
export function parseSpecialties(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || "").split(",")) {
    const word = raw.trim().replace(/\s+/g, " ");
    if (word && !seen.has(word.toLowerCase())) {
      seen.add(word.toLowerCase());
      out.push(word);
    }
  }
  return out;
}

/**
 * Everything a shop has done and has coming, newest first, with the totals its
 * card shows.
 *
 * @param {{ id: string }} shop
 * @param {Array<{ id: string, name?: string, sl?: Array<Record<string, any>> }>} vehs
 * @param {Array<Record<string, any>>} reqs
 */
export function shopHistory(shop, vehs, reqs) {
  const id = String(shop?.id ?? "");
  const done = [];
  for (const v of vehs || []) {
    for (const e of Array.isArray(v.sl) ? v.sl : []) {
      if (id && String(e?.shop_id ?? "") === id) {
        done.push({
          vehicleId: v.id,
          vehicleName: v.name || "",
          type: e.type || "",
          date: e.dt || "",
          mileage: e.mi ?? null,
          cost: Number(e.cost) || 0,
          notes: e.notes || "",
        });
      }
    }
  }
  done.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const upcoming = (reqs || [])
    .filter(
      (r) =>
        id &&
        String(r.shop_id ?? "") === id &&
        (r.status === "pending" || r.status === "scheduled"),
    )
    .map((r) => ({
      requestId: r.id,
      vehicleName: r.vname || "",
      type: r.type || "",
      status: r.status,
      date: r.scheduled_date || "",
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return {
    done,
    upcoming,
    visits: done.length,
    spend: done.reduce((sum, e) => sum + e.cost, 0),
    lastVisit: done[0]?.date || null,
  };
}

/**
 * The shop's name for an id, for labels on tickets and the calendar. Empty when
 * there is no shop or it is not in the list (archived shops are still in it).
 * @param {string | null | undefined} shopId
 * @param {Array<{ id: string, name: string }>} shops
 */
export function shopName(shopId, shops) {
  if (!shopId) return "";
  return (shops || []).find((s) => String(s.id) === String(shopId))?.name || "";
}

/**
 * The shops a picker offers: active ones, A to Z, plus the currently selected
 * one even when it has since been archived, so an existing ticket never shows a
 * blank where its shop used to be.
 * @param {Array<{ id: string, name: string, active?: boolean }>} shops
 * @param {string | null | undefined} selectedId
 */
export function pickableShops(shops, selectedId) {
  return (shops || [])
    .filter((s) => s.active !== false || String(s.id) === String(selectedId ?? ""))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
