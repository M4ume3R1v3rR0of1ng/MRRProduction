// src/views/inventory/BulkReceiveModal.jsx
//
// Receive a multi-item delivery as one manifest. Each row becomes its own FIFO
// batch, so vendor, PO and unit price stay attached to the units they arrived
// with rather than being blended into an average.
//
// Extracted from InventoryView, where its three useState hooks, three row
// handlers, two memos and a 150-line commit routine sat alongside item CRUD and
// stock adjustment. Nothing outside this dialog ever read that state.
//
// The pricing rules below are exported as pure functions on purpose. They decide
// what a job is later billed, they have three branches that are easy to get
// subtly wrong, and none of them were reachable from a test before this split.
import { useMemo, useState } from "react";
import { supabase, updateRowStrict } from "../../utils/supabase";
import { sendLowStockAlerts } from "../../utils/lowStockAlerts";
import { C, uid, fm, tot, newestPrice } from "../../utils/helpers";
import { Btn, Fld, Inp, Modal } from "../../components/UIPrimitives";
import { logAction } from "../../utils/logger";
import { useNotify } from "../../context/NotificationContext";

// A row counts as received when it carries a non-zero, numeric quantity.
// Negatives are deliberately allowed: they are corrections against an earlier
// over-receipt. Only blank and zero drop out.
export const hasQuantity = (row) => {
  const qty = parseFloat(row?.qty);
  return !isNaN(qty) && qty !== 0;
};

export const manifestTotal = (rows = []) =>
  rows.reduce((s, b) => s + (parseFloat(b.qty) || 0) * (parseFloat(b.price) || 0), 0);

// Resolve what each row will actually be costed at.
//
// A BLANK price must never become a $0 batch. FIFO charges each batch at its own
// price, so a $0 batch bills real material at nothing and prints $0 on the job
// report. Blank falls back to the item's last known price, matching single
// receive. With nothing to fall back on the row is returned unpriced so the
// caller can refuse and name it, rather than inventing a number.
//
// A TYPED zero is left alone. That is a deliberate free or warranty batch.
export const resolveBulkPrices = (rows, inv) =>
  rows.map((b) => {
    const typed = parseFloat(b.price);
    if (Number.isFinite(typed)) return { ...b, rate: typed };
    const last = newestPrice(inv.find((i) => i && i.id === b.iid));
    return { ...b, rate: last > 0 ? last : null };
  });

const emptyMeta = () => ({ date: new Date().toISOString().split("T")[0], po: "", vendor: "" });

export default function BulkReceiveModal({ inv = [], setInv, users, user, perms = {}, onClose }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(emptyMeta);
  const [srch, setSrch] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();

  const selectable = useMemo(
    () =>
      inv.filter(
        (i) => (i?.name || "").toLowerCase().includes(srch.toLowerCase()) && !rows.find((b) => b.iid === i.id),
      ),
    [inv, srch, rows],
  );

  const total = useMemo(() => manifestTotal(rows), [rows]);
  const validCount = rows.filter(hasQuantity).length;

  const addRow = (item) =>
    setRows((p) => [
      ...p,
      { iid: item.id, iname: item.name, unit: item.unit, qty: "", price: newestPrice(item) ? String(newestPrice(item)) : "" },
    ]);
  const removeRow = (iid) => setRows((p) => p.filter((b) => b.iid !== iid));
  const updateRow = (iid, field, val) => setRows((p) => p.map((b) => (b.iid === iid ? { ...b, [field]: val } : b)));

  const close = () => { setRows([]); setSrch(""); onClose?.(); };

  const commit = async () => {
    if (!meta.date) {
      showToast("Please set a received date.", "info");
      return;
    }
    const valid = rows.filter(hasQuantity);
    // Rows left blank would otherwise vanish without a trace. Capture them so we
    // can name them in a warning instead of silently swallowing the delivery.
    const skipped = rows.filter((b) => !hasQuantity(b));
    if (valid.length === 0) {
      showToast("Nothing was received — every row is missing a quantity. Enter a quantity for each item.", "warning");
      return;
    }

    const priced = resolveBulkPrices(valid, inv);
    const unpriced = priced.filter((b) => b.rate === null);
    if (unpriced.length > 0) {
      showToast(
        `Enter a unit price for: ${unpriced.map((b) => b.iname).join(", ")}. ${
          unpriced.length > 1 ? "They have" : "It has"
        } no previous price to fall back on, and receiving at $0 would bill the job nothing for real material.`,
        "warning",
      );
      return;
    }

    setSaving(true);
    try {
      // Append to the batches currently in the database. The in-memory list may
      // predate receipts or pulls made from another device.
      const { data: freshRows, error: freshErr } = await supabase
        .from("inventory")
        .select("id,batches")
        .in("id", valid.map((b) => b.iid));
      if (freshErr) throw freshErr;
      const freshById = new Map((freshRows || []).map((r) => [r.id, r.batches || []]));

      const changedBatches = new Map();
      for (const bi of priced) {
        if (!freshById.has(bi.iid)) continue;
        changedBatches.set(bi.iid, [
          ...freshById.get(bi.iid),
          {
            id: "b_" + uid(),
            rcvd: meta.date,
            qty: parseFloat(bi.qty),
            price: bi.rate,
            by: user?.id || "system",
            rem: parseFloat(bi.qty),
            ref: meta.po || "",
            vendor: meta.vendor || "",
          },
        ]);
      }

      const results = await Promise.all(
        [...changedBatches].map(([iid, batches]) => updateRowStrict("inventory", iid, { batches })),
      );
      // Supabase calls resolve (never throw) with an { error } payload. An
      // unchecked failure here would report success while nothing was saved.
      const firstError = results.map((r) => r?.error).find(Boolean);
      if (firstError) throw firstError;

      setInv?.((p) => p.map((i) => (changedBatches.has(i.id) ? { ...i, batches: changedBatches.get(i.id) } : i)));

      // Bulk rows can carry negative correction quantities, so a threshold
      // crossing is possible here too.
      sendLowStockAlerts(
        [...changedBatches]
          .map(([iid, batches]) => {
            const item = inv.find((i) => i.id === iid);
            return item ? { item, prevTotal: tot({ batches: freshById.get(iid) }), newTotal: tot({ batches }) } : null;
          })
          .filter(Boolean),
        users,
        showToast,
      );

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Processed bulk purchase order delivery into warehouse roster`,
        {
          purchase_order: meta.po || "N/A",
          vendor: meta.vendor || "N/A",
          item_count: priced.length,
          total_manifest_value: total,
          // WHICH items, not just how many. Without this a delivery logs as
          // "2 items" and the only way to learn what was in it is to reconstruct
          // it from the batches (see the Atlas box vent hunt on 2026-07-16).
          items: priced.map((b) => ({ item_id: b.iid, name: b.iname, qty: parseFloat(b.qty), unit_cost: b.rate })),
          ...(skipped.length > 0 ? { skipped_no_quantity: skipped.map((b) => b.iname) } : {}),
        },
      );

      showToast(`Bulk delivery received — ${valid.length} item${valid.length > 1 ? "s" : ""} added.`, "success");
      // Surface anything left out so a forgotten quantity cannot quietly disappear.
      if (skipped.length) {
        showToast(
          `${skipped.length} item${skipped.length > 1 ? "s were" : " was"} NOT received (no quantity entered): ${skipped
            .map((b) => b.iname)
            .join(", ")}.`,
          "warning",
        );
      }
      setRows([]);
      setMeta(emptyMeta());
      setSrch("");
      onClose?.();
    } catch (err) {
      console.error(err);
      showToast(`Error logging batch payload operations: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="📦 Receive Bulk Order Manifest" onClose={close} wide>
      <div style={{ background: C.gL, border: `1.5px solid ${C.gold}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.navy }}>
        ⭐ <strong>Inbound Accounting:</strong> FIFO indices update automatically. Each item maps a standalone discrete batch vector tracking vendor origins.
      </div>

      <div className="sw-grid-3" style={{ gap: "var(--space-4)", padding: 14, background: C.lg, borderRadius: "var(--radius-lg)", marginBottom: 16 }}>
        <Fld label="Date Received *"><Inp type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} /></Fld>
        <Fld label="PO / Order #"><Inp value={meta.po} onChange={(e) => setMeta({ ...meta, po: e.target.value })} placeholder="e.g. PO-2025-100" /></Fld>
        <Fld label="Vendor / Supplier"><Inp value={meta.vendor} onChange={(e) => setMeta({ ...meta, vendor: e.target.value })} placeholder="e.g. ABC Supply" /></Fld>
      </div>

      <div className="sw-split" style={{ gap: "var(--space-6)", marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Select Items to Receive</div>
          <Inp value={srch} onChange={(e) => setSrch(e.target.value)} placeholder="🔍 Search inventory..." style={{ marginBottom: 8 }} />
          <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
            {selectable.map((item) => (
              <div key={item.id} style={{ background: C.w, border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>{item.name}</div>
                  <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>{item.cat} · {tot(item)} {item.unit} available</div>
                </div>
                <Btn v="primary" sz="sm" onClick={() => addRow(item)}>+ Add</Btn>
              </div>
            ))}
            {selectable.length === 0 && (
              <div style={{ padding: 20, textAlign: "center", color: C.sub, fontSize: "var(--text-sm)", background: C.lg, borderRadius: "var(--radius-md)" }}>
                {rows.length > 0 ? "All items matched ✓" : "No matching inventory items found"}
              </div>
            )}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px" }}>Manifest Queue {rows.length > 0 && `(${rows.length})`}</div>
            {rows.length > 0 && <button onClick={() => setRows([])} style={{ background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)" }}>Clear All</button>}
          </div>

          {rows.length === 0 ? (
            <div style={{ height: 200, background: C.lg, borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: C.sub, gap: "var(--space-3)" }}>
              <span style={{ fontSize: 32 }}>📋</span>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)" }}>Manifest queue is empty</span>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight: 280, overflowY: "auto", marginBottom: 10 }}>
                {rows.map((b) => {
                  const sub = (parseFloat(b.qty) || 0) * (parseFloat(b.price) || 0);
                  return (
                    <div key={b.iid} style={{ background: C.w, border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                        <span style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>{b.iname}</span>
                        <button onClick={() => removeRow(b.iid)} style={{ background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: "var(--text-xl)", lineHeight: 1 }}>×</button>
                      </div>

                      <div className="sw-grid-2-auto">
                        <div>
                          <div style={{ fontSize: 9, color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase", marginBottom: 3 }}>Qty ({b.unit})</div>
                          <Inp type="number" value={b.qty} onChange={(e) => updateRow(b.iid, "qty", e.target.value)} placeholder="0" style={{ padding: "5px 8px" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase", marginBottom: 3 }}>Unit Price</div>
                          <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: C.sub, fontSize: "var(--text-xs)" }}>$</span>
                            {perms.inv_pricing_edit ? (
                              <Inp type="number" step="0.01" value={b.price} onChange={(e) => updateRow(b.iid, "price", e.target.value)} placeholder="0.00" style={{ padding: "5px 8px", paddingLeft: 16 }} />
                            ) : (
                              <Inp value={b.price} readOnly style={{ padding: "5px 8px", paddingLeft: 16, color: C.sub, background: C.lg }} />
                            )}
                          </div>
                        </div>
                        <div style={{ paddingBottom: 2, textAlign: "right" }}>
                          <div style={{ fontSize: 9, color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase", marginBottom: 3 }}>Subtotal</div>
                          <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: sub > 0 ? C.gr : C.sub }}>{fm(sub)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ background: C.shell, borderRadius: "var(--radius-md)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", textTransform: "uppercase" }}>Manifest Valuation</div>
                  <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "var(--text-xs)", marginTop: 2 }}>{validCount} valid item positions</div>
                </div>
                <div style={{ fontWeight: "var(--weight-black)", fontSize: "var(--text-3xl)", color: C.gold }}>{fm(total)}</div>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <Btn v="ghost" onClick={close} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Cancel</Btn>
        <Btn v="gold" sz="lg" onClick={commit} style={{ flex: 2, justifyContent: "center" }} disabled={saving}>
          {saving ? "⏳ Logging Operation..." : `✅ Commit Manifest (${validCount} Items)`}
        </Btn>
      </div>
    </Modal>
  );
}
