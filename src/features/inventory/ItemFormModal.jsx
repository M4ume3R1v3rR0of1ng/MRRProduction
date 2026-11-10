// src/features/inventory/ItemFormModal.jsx
//
// Create or edit a catalog position. One dialog, because the fields are the same
// either way; only the save path and the price field differ.
//
// Extracted from InventoryView, where add and edit shared a single `form` state
// bag with receive and adjust. Four dialogs writing to one object is why opening
// any of them required remembering to seed `form` first, and why a stale field
// from a previous dialog could ride along into a save.
import { useState } from "react";
import { supabase, updateRowStrict } from "@/shared/utils/supabase";
import { uid, fm, newestPrice, todayLocal } from "@/shared/utils/helpers";
import { displayNameOf } from "@/shared/utils/people";
import { Btn, Fld, Inp, Modal, Sel, Row } from "@/shared/components/UIPrimitives";
import { logAction } from "@/shared/utils/logger";
import { useNotify } from "@/shared/context/NotificationContext";

export const CATEGORIES = [
  "Roofing Materials",
  "Fasteners",
  "Sealants",
  "Ventilation",
  "Decking",
  "Sheet Metal",
  "Accessories",
  "Tools",
];

export const UNITS = [
  "rolls",
  "boxes",
  "each",
  "tubes",
  "bundles",
  "packs",
  "sheets",
  "gallons",
  "lbs",
];

// The three Anvil Pro reorder fields, as a patch, containing ONLY what changed.
//
// ⚠️ This must return {} for a shop that never touched them. These columns come from
// supabase/65; an insert or update naming a column the database does not have fails whole,
// and for an update that would mean nobody can edit ANY item on a database where 65 has not
// run. Writing only what moved keeps every existing edit exactly as it was until somebody
// actually uses the feature.
export const reorderFieldsToWrite = (form, item) => {
  const out = {};
  const was = (k) => ((item?.[k] ?? "") === "" ? "" : String(item[k]));
  const now = (k) => String(form[k] ?? "").trim();
  if (now("reorder_qty") !== was("reorder_qty")) {
    const n = parseFloat(now("reorder_qty"));
    out.reorder_qty = Number.isFinite(n) && n > 0 ? n : null;
  }
  for (const k of ["supplier_name", "supplier_email"]) {
    if (now(k) !== was(k)) out[k] = now(k) || null;
  }
  return out;
};

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
export const applyPriceToBatches = (batches, newPrice, byUserId, byName = null) => {
  const list = [...(batches || [])];
  if (list.length === 0) {
    return [
      {
        id: "b_" + uid(),
        rcvd: todayLocal(),
        qty: 0,
        price: newPrice,
        by: byUserId || "system",
        // See utils/people: an id alone cannot survive the person being removed.
        byName: byName || null,
        rem: 0,
      },
    ];
  }
  let newest = 0;
  list.forEach((b, i) => {
    if (new Date(b.rcvd) - new Date(list[newest].rcvd) > 0) newest = i;
  });
  list[newest] = { ...list[newest], price: newPrice };
  return list;
};

// `item` null means create. Anything else is an edit of that item.
export default function ItemFormModal({
  item = null,
  user,
  perms = {},
  fetchLiveBatches,
  onCreated,
  onSaved,
  onClose,
  anvilPro = false,
}) {
  const isEdit = !!item;
  const [form, setForm] = useState(() =>
    isEdit
      ? {
          name: item.name || "",
          cat: item.cat || "",
          unit: item.unit || "rolls",
          alrt: item.alrt ?? "",
          price: "",
          reorder_qty: item.reorder_qty ?? "",
          supplier_name: item.supplier_name ?? "",
          supplier_email: item.supplier_email ?? "",
        }
      : {
          name: "",
          cat: "",
          unit: "rolls",
          alrt: "10",
          price: "",
          reorder_qty: "",
          supplier_name: "",
          supplier_email: "",
        },
  );
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const close = () => {
    if (!saving) onClose?.();
  };

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
      ...reorderFieldsToWrite(form, null),
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
      ...reorderFieldsToWrite(form, item),
    };
    const oldPrice = newestPrice(item);
    const newPrice = parseFloat(form.price);
    const priceChanged = isPriceChange(form.price, oldPrice, perms.inv_pricing_edit);

    try {
      if (priceChanged) {
        // Live batches, not the in-memory copy: another device may have received
        // stock since this session loaded, and rewriting a stale array erases it.
        updatedFields.batches = applyPriceToBatches(
          await fetchLiveBatches(item.id),
          newPrice,
          user?.id,
          displayNameOf(user),
        );
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
    <Modal
      title={isEdit ? `Modify Specifications: ${item.name}` : "Add New Catalog Position"}
      onClose={close}
    >
      <Fld label={isEdit ? "Item Name" : "Item Name *"}>
        <Inp
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Drip Edge - White"
          disabled={saving}
        />
      </Fld>
      <Fld label={isEdit ? "Category" : "Category *"}>
        <Sel value={form.cat} onChange={(e) => set({ cat: e.target.value })} disabled={saving}>
          <option value="">— Select a category —</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Sel>
      </Fld>
      <Fld label={isEdit ? "Unit" : "Unit *"}>
        <Sel value={form.unit} onChange={(e) => set({ unit: e.target.value })} disabled={saving}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Sel>
      </Fld>
      <Fld label={isEdit ? "Low Threshold Alert Level" : "Low Alert Threshold"}>
        <Inp
          type="number"
          value={form.alrt}
          onChange={(e) => set({ alrt: e.target.value })}
          disabled={saving}
        />
      </Fld>
      {anvilPro && (
        <>
          <Fld label="Reorder Quantity (Anvil Pro)">
            <Inp
              type="number"
              min="0"
              value={form.reorder_qty}
              onChange={(e) => set({ reorder_qty: e.target.value })}
              placeholder="How much to order when this runs low"
              disabled={saving}
            />
          </Fld>
          <Fld label="Supplier (Anvil Pro)">
            <Inp
              value={form.supplier_name}
              onChange={(e) => set({ supplier_name: e.target.value })}
              placeholder="e.g. ABC Supply"
              disabled={saving}
            />
          </Fld>
          <Fld label="Supplier Email (Anvil Pro)">
            <Inp
              type="email"
              value={form.supplier_email}
              onChange={(e) => set({ supplier_email: e.target.value })}
              disabled={saving}
            />
          </Fld>
        </>
      )}
      {isEdit && perms.inv_pricing_edit && (
        <Fld label="Current Price Per Unit">
          <Inp
            prefix="$"
            type="number"
            step="0.01"
            value={form.price}
            onChange={(e) => set({ price: e.target.value })}
            disabled={saving}
          />
        </Fld>
      )}
      <Row gap={4}>
        <Btn
          v="ghost"
          onClick={close}
          style={{ flex: 1, justifyContent: "center" }}
          disabled={saving}
        >
          Cancel
        </Btn>
        <Btn
          v="primary"
          onClick={isEdit ? update : create}
          disabled={saving}
          style={{ flex: 1, justifyContent: "center" }}
        >
          {saving
            ? isEdit
              ? "Saving..."
              : "Creating..."
            : isEdit
              ? "Save Changes"
              : "Add Position"}
        </Btn>
      </Row>
    </Modal>
  );
}
