// src/views/inventory/AdjustStockModal.jsx
//
// Correct on-hand quantity to a counted number: a physical count, damaged goods,
// a miscount.
//
// Extracted from InventoryView. The batch arithmetic below is the interesting
// part and is exported pure: it decides which batches lose units and therefore
// what a later pull is costed at, and it was previously unreachable from a test.
import { useState } from "react";
import { updateRowStrict } from "../../utils/supabase";
import { sendLowStockAlerts } from "../../utils/lowStockAlerts";
import { C, uid, tot, newestPrice, todayLocal } from "../../utils/helpers";
import { displayNameOf } from "../../utils/people";
import { Btn, Fld, Inp, Modal, TA } from "../../components/UIPrimitives";
import { logAction } from "../../utils/logger";
import { useNotify } from "../../context/NotificationContext";

// Rewrite a batch list so its remaining total equals `newQty`.
//
// Going UP adds one correction batch. Its price is the newest known price, so
// found stock is valued the same as the stock beside it rather than at zero.
//
// Going DOWN drains oldest-first, matching how a pull consumes. Draining newest
// first would leave the oldest, cheapest units on the shelf forever and quietly
// inflate the cost of every later job.
export const applyStockCorrection = (liveBatches, newQty, { byUserId, byName = null, reasonSuffix = "", fallbackPrice = 0 } = {}) => {
  const batches = [...(liveBatches || [])];
  const current = tot({ batches });
  const delta = newQty - current;

  if (delta > 0) {
    return [
      ...batches,
      {
        id: "b_" + uid(),
        rcvd: todayLocal(),
        qty: delta,
        price: newestPrice({ batches }) || fallbackPrice || 0,
        by: byUserId || "system",
        // See utils/people: an id alone cannot survive the person being removed.
        byName: byName || null,
        rem: delta,
        ref: `Manual Adjustment${reasonSuffix}`,
      },
    ];
  }

  let deficit = Math.abs(delta);
  return [...batches]
    .sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd))
    .map((b) => {
      if (deficit <= 0) return b;
      const take = Math.min(parseFloat(b.rem) || 0, deficit);
      deficit -= take;
      return { ...b, rem: (parseFloat(b.rem) || 0) - take };
    });
};

export default function AdjustStockModal({ item, user, users, fetchLiveBatches, onAdjusted, onClose }) {
  const [form, setForm] = useState({ newQty: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();

  const close = () => { if (!saving) onClose?.(); };

  const save = async () => {
    if (form.newQty === undefined || form.newQty === "") {
      showToast("Please enter the corrected quantity.", "warning");
      return;
    }
    const newQty = parseFloat(form.newQty);
    if (isNaN(newQty) || newQty < 0) {
      showToast("Quantity must be a valid non-negative number.", "warning");
      return;
    }
    if (newQty === tot(item)) {
      showToast("No change — quantity already matches.", "info");
      return;
    }

    setSaving(true);
    const reasonSuffix = form.reason?.trim() ? ` — ${form.reason.trim()}` : "";
    try {
      // Correct against live batches so the final total lands on newQty even if
      // another device changed stock since this session loaded.
      const liveBatches = await fetchLiveBatches(item.id);
      const current = tot({ batches: liveBatches });
      const updatedBatches = applyStockCorrection(liveBatches, newQty, {
        byUserId: user?.id,
        byName: displayNameOf(user),
        reasonSuffix,
        fallbackPrice: newestPrice(item),
      });

      const { error } = await updateRowStrict("inventory", item.id, { batches: updatedBatches });
      if (error) throw error;

      onAdjusted?.(item.id, updatedBatches);
      sendLowStockAlerts([{ item, prevTotal: current, newTotal: newQty }], users, showToast);

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Manually adjusted stock for "${item.name}" from ${current} to ${newQty} ${item.unit}${reasonSuffix}`,
        { item_id: item.id, previous_total: current, new_total: newQty, delta: newQty - current },
        "inventory",
      );

      showToast("Stock quantity corrected.", "success");
      onClose?.();
    } catch (err) {
      console.error(err);
      showToast(`Database Error adjusting stock: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Adjust Stock: ${item.name}`} onClose={close}>
      <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.sub }}>
        Current on-hand: <strong style={{ color: C.navy }}>{tot(item)} {item.unit}</strong>
      </div>
      <Fld label={`Corrected Quantity (${item.unit})`}>
        <Inp type="number" min="0" value={form.newQty} onChange={(e) => setForm({ ...form, newQty: e.target.value })} disabled={saving} />
      </Fld>
      <Fld label="Reason for Correction" hint="e.g. physical count, damaged goods, miscount">
        <TA value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} disabled={saving} />
      </Fld>
      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <Btn v="ghost" onClick={close} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Cancel</Btn>
        <Btn v="gold" onClick={save} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Saving..." : "Save Correction"}</Btn>
      </div>
    </Modal>
  );
}
