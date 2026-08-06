// src/views/inventory/ReceiveBatchModal.jsx
//
// Receive a single inbound batch against one catalog item. The multi-item
// equivalent is BulkReceiveModal.
//
// Extracted from InventoryView, where it shared the `form` state bag with add,
// edit and adjust.
import { useState } from "react";
import { updateRowStrict } from "../../utils/supabase";
import { sendLowStockAlerts } from "../../utils/lowStockAlerts";
import { C, uid, tot, newestPrice } from "../../utils/helpers";
import { displayNameOf } from "../../utils/people";
import { Btn, Fld, Inp, Modal } from "../../components/UIPrimitives";
import { logAction } from "../../utils/logger";
import { useNotify } from "../../context/NotificationContext";

// Which required fields are blank. Returned as a list so the toast can name them
// all at once, rather than the user fixing one and being told about the next.
export const missingReceiveFields = (form = {}) => {
  const missing = [];
  if (!form.qty) missing.push("quantity");
  if (!form.price) missing.push("price");
  if (!form.date) missing.push("received date");
  return missing;
};

export default function ReceiveBatchModal({ item, user, users, perms = {}, fetchLiveBatches, onReceived, onClose }) {
  const [form, setForm] = useState({ date: "", qty: "", ref: "", vendor: "", price: "" });
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const close = () => { if (!saving) onClose?.(); };

  const receive = async () => {
    // Do not fail silently: a blank field otherwise looks like it "saved", since
    // the modal simply never closes.
    const missing = missingReceiveFields(form);
    if (missing.length) {
      showToast(`Nothing was received — please fill in the ${missing.join(", ")}.`, "warning");
      return;
    }
    const qty = parseFloat(form.qty);
    const price = parseFloat(form.price);
    // Negative qty and price are allowed on purpose: they are temporary
    // corrections ahead of a later batch that zeroes them back out. Only
    // non-numeric input is rejected.
    if (isNaN(qty)) { showToast("Quantity must be a valid number.", "warning"); return; }
    if (isNaN(price)) { showToast("Price must be a valid number.", "warning"); return; }

    setSaving(true);
    const batch = {
      id: "b_" + uid(),
      rcvd: form.date,
      qty,
      price: price || newestPrice(item),
      by: user?.id || "system",
      // See BulkReceiveModal: the id alone cannot survive the person leaving.
      byName: displayNameOf(user),
      rem: qty,
      // Bulk receive always captured these; this form never did, which is why 31
      // of 32 deliveries carry no paperwork. Optional: a correction batch has no
      // invoice behind it.
      ref: (form.ref || "").trim(),
      vendor: (form.vendor || "").trim(),
    };

    try {
      const liveBatches = await fetchLiveBatches(item.id);
      const updatedBatches = [...liveBatches, batch];
      const { error } = await updateRowStrict("inventory", item.id, { batches: updatedBatches });
      if (error) throw error;

      onReceived?.(item.id, updatedBatches);

      // Fires only when this change pushes the item below its threshold, e.g. a
      // negative correction batch. A normal receipt raises stock.
      sendLowStockAlerts(
        [{ item: { ...item, batches: updatedBatches }, prevTotal: tot({ batches: liveBatches }), newTotal: tot({ batches: updatedBatches }) }],
        users,
        showToast,
      );

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Received new inbound batch stack for material: "${item.name}"`,
        {
          item_id: item.id,
          batch_id: batch.id,
          quantity_added: batch.qty,
          unit_cost: batch.price,
          purchase_order: batch.ref || "N/A",
          vendor: batch.vendor || "N/A",
        },
      );

      showToast("Batch successfully received.", "success");
      onClose?.();
    } catch (err) {
      console.error(err);
      showToast(`Database Error posting receipt batch: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Receive Inbound Stock: ${item.name}`} onClose={close}>
      <Fld label="Date Received"><Inp type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} disabled={saving} /></Fld>
      <Fld label={`Quantity to Inject (${item.unit})`}><Inp type="number" value={form.qty} onChange={(e) => set({ qty: e.target.value })} disabled={saving} /></Fld>
      <Fld label="Invoice / PO Number"><Inp value={form.ref} onChange={(e) => set({ ref: e.target.value })} placeholder="e.g. 2011850932-001" disabled={saving} /></Fld>
      <Fld label="Supplier / Vendor"><Inp value={form.vendor} onChange={(e) => set({ vendor: e.target.value })} placeholder="e.g. ABC Supply" disabled={saving} /></Fld>
      {perms.inv_pricing_edit ? (
        <Fld label="Price Per Unit">
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.sub }}>$</span>
            <Inp type="number" step="0.01" value={form.price} onChange={(e) => set({ price: e.target.value })} style={{ paddingLeft: 22 }} disabled={saving} />
          </div>
        </Fld>
      ) : (
        <div style={{ background: C.aB, border: `1px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: 12, fontSize: "var(--text-sm)", color: C.am }}>
          Pricing is lock-restricted. Last batch unit valuations will automatically cycle carry over.
        </div>
      )}
      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <Btn v="ghost" onClick={close} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Cancel</Btn>
        <Btn v="primary" onClick={receive} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Processing..." : "Receive Batch"}</Btn>
      </div>
    </Modal>
  );
}
