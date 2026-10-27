// src/features/inventory/inventoryCatalog.js
//
// Steadwerk's library of generic inventory positions, and the logic for copying
// them into one company's own catalog. See supabase/61_inventory_catalog.sql.
//
// WHY THIS EXISTS
//
// A company coming aboard starts with an empty Inventory and otherwise has to add
// every position by hand through ItemFormModal. Most of those positions are the
// same for every roofer; only the stock levels and the prices are theirs.
//
// COPIES, NOT REFERENCES
//
// Importing INSERTS a row into public.inventory. Nothing links it back to the
// library afterwards, which is the whole design: a company renaming their copy
// keeps the rename, and Steadwerk editing the library never rewrites anybody's
// catalog. The price never travels either — price lives on a batch and is what
// THAT company paid THAT week, so an imported position starts with no batches at
// all and is picked up by the normal receive flow.
//
// That means the library and a tenant's catalog drift apart over time. Intended,
// not a defect waiting to be fixed.
import { supabase } from "@/shared/utils/supabase";
import { uid } from "@/shared/utils/helpers";

// Every signed-in user may read the library (61's select policy), so this needs no
// permission check of its own. Retired lines are filtered server-side rather than
// in the picker: `active = false` means retired for everybody, and there is no
// view in which a tenant should see one.
export async function fetchInventoryCatalog() {
  const { data, error } = await supabase
    .from("inventory_catalog")
    .select("*")
    .eq("active", true)
    .order("cat", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

// The Owner Console's own read: retired lines included, because curating them is
// the point of that screen. Writes there are refused by RLS for anyone who is not
// a platform admin, so this does not gate on anything either.
export async function fetchInventoryCatalogAll() {
  const { data, error } = await supabase
    .from("inventory_catalog")
    .select("*")
    .order("cat", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Compared on a trimmed, lower-cased name, matching the case-insensitive unique
// index in 61. A company that already carries "Drip Edge" should not be offered a
// second one, and should not get a duplicate if they tick it anyway.
export const normalizeName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase();

// Which library positions this company does not already have. Everything else in
// the picker is derived from this, so a name they already carry can never be
// selected, imported, or counted in the "n selected" total.
//
// `inv` is the company's own catalog; a row with no usable name is ignored rather
// than treated as a blank match, so one bad row cannot suppress a whole category.
export function availableCatalog(catalog = [], inv = []) {
  const have = new Set((inv || []).map((i) => normalizeName(i?.name)).filter((n) => n.length > 0));
  return (catalog || []).filter((c) => {
    const n = normalizeName(c?.name);
    return n.length > 0 && !have.has(n);
  });
}

// Group for display: categories alphabetical, positions in the order the query
// returned them (sort_order, then name). A Map keeps that insertion order, which
// a plain object would also do for string keys but less explicitly.
export function groupByCategory(rows = []) {
  const out = new Map();
  [...(rows || [])]
    .sort((a, b) => String(a?.cat || "").localeCompare(String(b?.cat || "")))
    .forEach((r) => {
      const key = r?.cat || "Uncategorized";
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(r);
    });
  return out;
}

// Narrow to a search term across name and category, so typing "nail" or
// "fasteners" both work. An empty term matches everything.
export function searchCatalog(rows = [], query = "") {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return rows || [];
  return (rows || []).filter((r) => `${r?.name || ""} ${r?.cat || ""}`.toLowerCase().includes(q));
}

// The public.inventory rows to insert. Deliberately the same shape ItemFormModal's
// create path builds, because this IS that operation in bulk:
//
//   - id is app-generated with the same "i_" prefix. The ids are only unique
//     within one company (02 made the primary key composite), which is why a
//     fresh one is minted per import rather than reusing the library row's uuid.
//   - company_id is left off entirely so the column DEFAULT stamps it from the
//     session, the same way every other insert in this app works. Passing it from
//     the client would be the one way to write into another tenant.
//   - batches is empty. The position exists with zero stock until somebody
//     receives against it, and that receipt is what sets the price.
//   - alrt comes from the library as a starting threshold, and is theirs after.
export function catalogItemsToRows(rows = []) {
  return (rows || [])
    .filter((r) => normalizeName(r?.name).length > 0)
    .map((r) => ({
      id: "i_" + uid(),
      name: String(r.name).trim(),
      cat: r.cat,
      unit: r.unit,
      alrt: Number.isFinite(r.alrt) ? r.alrt : parseInt(r.alrt, 10) || 10,
      batches: [],
    }));
}

// Insert in one round trip. Returns the rows as inserted so the caller can push
// them into local state without a refetch — `select()` gives back what the
// database actually stored, company_id default included.
export async function importCatalogItems(catalogRows) {
  const records = catalogItemsToRows(catalogRows);
  if (records.length === 0) return [];
  const { data, error } = await supabase.from("inventory").insert(records).select();
  if (error) throw error;
  return data || records;
}
