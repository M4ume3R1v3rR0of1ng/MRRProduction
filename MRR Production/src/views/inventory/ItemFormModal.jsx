// src/views/inventory/ItemFormModal.jsx
//
// Create or edit a catalog position. One dialog, because the fields are the same
// either way; only the save path and the price field differ.
//
// Extracted from InventoryView, where add and edit shared a single `form` state
// bag with receive and adjust. Four dialogs writing to one object is why opening
// any of them required remembering to seed `form` first, and why a stale field
// from a previous dialog could ride along into a save.
import { useState } from "react";
import { supabase, updateRowStrict } from "../../utils/supabase";
import { C, uid, fm, newestPrice, todayLocal } from "../../utils/helpers";
import { Btn, Fld, Inp, Modal, Sel } from "../../components/UIPrimitives";
import { logAction } from "../../utils/logger";
import { useNotify } from "../../context/NotificationContext";

export const CATEGORIES = [
  "Roofing Materials", "Fasteners", "Sealants", "Ventilation",
  "Decking", "Sheet Metal", "Accessories", "Tools",
];

export const UNITS = ["rolls", "boxes", "each", "tubes", "bundles", "packs", "sheets", "gallons", "lbs"];

// Did the operator actually change the price? Only true when they can edit
// pricing at all, typed something, it parses, and it differs from what the
// newest batch already says. Anything less must not rewrite a batch.
export const isPriceChange = (raw, oldPrice, canEditPricing) => {
  if (!canEditPricing) return false;
  if (raw === "" || raw == null) return false;
  const next = parseFloat(raw);
  return Number.isFinite(next) && next !== oldPrice;
};

// Current price lives on the newest batch by received date, so a price edit
// rewrites it there. With no receipt history there is nothing to rewrite, so a
// zero-quantity batch is seeded to carry the price instead.
export const applyPriceToBatches = (batches, newPrice, byUserId) => {
  const list = [...(batches || [])];
  if (list.length === 0) {
    return [{
      id: "b_" + uid(),
      rcvd: todayLocal(),
      qty: 0,
      price: newPrice,
      by: byUserId || "system",
      rem: 0,
    }];
  }
  let newest = 0;
  list.forEach((b, i) => {
    if (new Date(b.rcvd) - new Date(list[newest].rcvd) > 0) newest = i;
  });
  list[newest] = { ...list[newest], price: newPrice };
  return list;
};

// `item` null means create. Anything else is an edit of that item.
export default function ItemFormModal({ item = null, user, perms = {}, fetchLiveBatches, onCreated, onSaved, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = useState(() =>
    isEdit
      ? { name: item.name || "", cat: item.cat || "", unit: item.unit || "rolls", alrt: item.alrt ?? "", price: "" }
      : { name: "", cat: "", unit: "rolls", alrt: "10", price: "" },
  );
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const close = () => { if (!saving) onClose?.(); };

  const create = async () => {
    if (!form.name || !form.cat || !form.unit) {
      showToast("Please fill out all required item fields.", "warning");
      return;
    }
    setSaving(true);
    const record = {
      id: "i_" + uid(),
      name: form.name.trim(),
      cat: form.cat,
      unit: form.unit,
      alrt: parseInt(form.alrt) || 5,
      batches: [],
    };
    try {
      const { error } = await supabase.from("inventory").insert([record]);
      if (error) throw error;

      onCreated?.(record);
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Created new catalog material item: "${record.name}"`,
        { item_id: record.id, category: record.cat, unit: record.unit },
        "inventory",
      );
      showToast("Catalog item added successfully.", "success");
      onClose?.();
    } catch (err) {
      console.error(err);
      showToast(`Database Error adding item: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const update = async () => {
    setSaving(true);
    const updatedFields = {
      name: form.name?.trim(),
      cat: form.cat,
      unit: form.unit,
      alrt: parseInt(form.alrt) || item.alrt,
    };
    const oldPrice = newestPrice(item);
    const newPrice = parseFloat(form.price);
    const priceChanged = isPriceChange(form.price, oldPrice, perms.inv_pricing_edit);

    try {
      if (priceChanged) {
        // Live batches, not the in-memory copy: another device may have received
        // stock since this session loaded, and rewriting a stale array erases it.
        updatedFields.batches = applyPriceToBatches(await fetchLiveBatches(item.id), newPrice, user?.id);
      }

      const { error } = await updateRowStrict("inventory", item.id, updatedFields);
      if (error) throw error;

      onSaved?.(item.id, updatedFields);
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Modified catalog specifications for item: "${item.name}"${priceChanged ? ` (price ${fm(oldPrice)} → ${fm(newPrice)})` : ""}`,
        {
          item_id: item.id,
          changes: {
            name: updatedFields.name,
            cat: updatedFields.cat,
            unit: updatedFields.unit,
            alrt: updatedFields.alrt,
            ...(priceChanged ? { price: { from: oldPrice, to: newPrice } } : {}),
          },
        },
        "inventory",
      );
      showToast("Changes saved successfully.", "success");
      onClose?.();
    } catch (err) {
      console.error(err);
      showToast(`Database Error modifying catalog record: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? `Modify Specifications: ${item.name}` : "Add New Catalog Position"} onClose={close}>
      <Fld label={isEdit ? "Item Name" : "Item Name *"}>
        <Inp value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Drip Edge - White" disabled={saving} />
      </Fld>
      <Fld label={isEdit ? "Category" : "Category *"}>
        <Sel value={form.cat} onChange={(e) => set({ cat: e.target.value })} disabled={saving}>
          <option value="">— Select a category —</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Sel>
      </Fld>
      <Fld label={isEdit ? "Unit" : "Unit *"}>
        <Sel value={form.unit} onChange={(e) => set({ unit: e.target.value })} disabled={saving}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </Sel>
      </Fld>
      <Fld label={isEdit ? "Low Threshold Alert Level" : "Low Alert Threshold"}>
        <Inp type="number" value={form.alrt} onChange={(e) => set({ alrt: e.target.value })} disabled={saving} />
      </Fld>
      {isEdit && perms.inv_pricing_edit && (
        <Fld label="Current Price Per Unit">
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.sub }}>$</span>
            <Inp type="number" step="0.01" value={form.price} onChange={(e) => set({ price: e.target.value })} style={{ paddingLeft: 22 }} disabled={saving} />
          </div>
        </Fld>
      )}
      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <Btn v="ghost" onClick={close} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Cancel</Btn>
        <Btn v="primary" onClick={isEdit ? update : create} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>
          {saving ? (isEdit ? "Saving..." : "Creating...") : isEdit ? "Save Changes" : "Add Position"}
        </Btn>
      </div>
    </Modal>
  );
}
