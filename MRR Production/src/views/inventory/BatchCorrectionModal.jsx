// src/views/inventory/BatchCorrectionModal.jsx
//
// Correct a single batch's price, PO and vendor after the fact.
//
// The receive form is otherwise the only place those three are ever set, so
// getting one wrong used to be permanent. Editing an item silently rewrote the
// NEWEST batch's price, meaning corrections landed on the wrong batch, and
// nothing reached PO or vendor at all.
//
// A price correction restates finished jobs, so it never happens without showing
// the damage first. The classification below decides which jobs can be restated
// and which cannot; it is exported pure because it is the most consequential
// logic in the inventory module and was unreachable from a test before this split.
import { useState } from "react";
import { updateRowStrict } from "../../utils/supabase";
import { C, fd, fm, recostLine } from "../../utils/helpers";
import { Btn, Fld, Inp, Modal } from "../../components/UIPrimitives";
import { logAction } from "../../utils/logger";
import { useNotify } from "../../context/NotificationContext";

export const lineFor = (job, itemId) => (job.items || job.materials || []).find((i) => i && i.iid === itemId);

export const usedOf = (job, itemId) => {
  const l = lineFor(job, itemId);
  return Math.max(0, (parseFloat(l?.pulled) || 0) - (parseFloat(l?.returned) || 0));
};

export const hasSplit = (line) => Array.isArray(line?.consumed) && line.consumed.length > 0;

// Which jobs actually took material from this batch.
//
//   with a split  — exact. The job names the batch id, so there is nothing to
//                   infer, and a multi-batch pull can be repriced correctly.
//   without one   — legacy rows predate `consumed`. The only signal left is the
//                   blended priceAtPull matching this batch's price, which holds
//                   only if the pull came from this batch alone. Anything else is
//                   a blend of prices that can no longer be taken apart, so it is
//                   surfaced to the user and left untouched.
export const jobsUsingBatch = (jobs, itemId, batchId, oldPrice) => {
  const exact = [];
  const blended = [];
  for (const j of jobs || []) {
    const line = lineFor(j, itemId);
    if (!line || (parseFloat(line.pulled) || 0) <= 0) continue;
    if (hasSplit(line)) {
      // Named a split that does not include this batch: genuinely unaffected.
      if (line.consumed.some((c) => c.bid === batchId)) exact.push(j);
      continue;
    }
    if ((parseFloat(line.priceAtPull) || 0) === oldPrice) exact.push(j);
    else blended.push(j);
  }
  return { exact, blended };
};

export default function BatchCorrectionModal({
  item, batch, jobs = [], users = [], user, perms = {},
  fetchLiveBatches, onCorrected, onJobRecosted, onClose,
}) {
  const [form, setForm] = useState({
    price: batch.price ?? "",
    ref: batch.ref ?? "",
    vendor: batch.vendor ?? "",
  });
  const [recalc, setRecalc] = useState(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();

  const close = () => { if (!saving) onClose?.(); };

  const save = async () => {
    const canPrice = perms.inv_pricing_edit;
    const oldPrice = parseFloat(batch.price) || 0;
    const newPrice = canPrice ? parseFloat(form.price) : oldPrice;
    if (canPrice && !Number.isFinite(newPrice)) {
      showToast("Unit price must be a valid number.", "warning");
      return;
    }
    const newRef = (form.ref || "").trim();
    const newVendor = (form.vendor || "").trim();
    const priceChanged = canPrice && newPrice !== oldPrice;

    // PO and vendor do not touch cost and save straight through. A price change
    // pauses on the preview screen first.
    const hits = priceChanged ? jobsUsingBatch(jobs, item.id, batch.id, oldPrice) : { exact: [], blended: [] };
    if (priceChanged && hits.exact.length > 0 && !recalc) {
      setRecalc({ oldPrice, newPrice, ...hits });
      return;
    }

    setSaving(true);
    try {
      const live = await fetchLiveBatches(item.id);
      const idx = live.findIndex((b) => b.id === batch.id);
      if (idx === -1) throw new Error("This batch no longer exists — someone may have changed it. Refresh and try again.");
      const updated = live.map((b, i) => (i === idx ? { ...b, price: newPrice, ref: newRef, vendor: newVendor } : b));

      const { error } = await updateRowStrict("inventory", item.id, { batches: updated });
      if (error) throw error;
      onCorrected?.(item.id, updated);

      let recalced = 0;
      if (priceChanged && hits.exact.length > 0) {
        const fix = (arr) =>
          (arr || []).map((i) => {
            if (!i || i.iid !== item.id) return i;
            if ((parseFloat(i.pulled) || 0) <= 0) return i;
            return { ...i, ...recostLine(i, batch.id, newPrice) };
          });
        for (const j of hits.exact) {
          const next = { items: fix(j.items), materials: fix(j.materials) };
          const res = await updateRowStrict("jobs", j.id, next);
          if (res.error) throw res.error;
          onJobRecosted?.(j.id, next);
          recalced++;
        }
      }

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Corrected batch on "${item.name}"${priceChanged ? ` (price ${fm(oldPrice)} → ${fm(newPrice)})` : ""}${recalced ? ` — recalculated ${recalced} job(s)` : ""}`,
        {
          item_id: item.id,
          batch_id: batch.id,
          batch_rcvd: batch.rcvd,
          ...(priceChanged ? { price: { from: oldPrice, to: newPrice } } : {}),
          purchase_order: { from: batch.ref || "", to: newRef },
          vendor: { from: batch.vendor || "", to: newVendor },
          jobs_recalculated: recalced,
        },
        "inventory",
      );

      showToast(
        recalced > 0 ? `Batch corrected — ${recalced} job${recalced > 1 ? "s" : ""} recalculated.` : "Batch corrected.",
        "success",
      );
      setRecalc(null);
      onClose?.();
    } catch (err) {
      console.error(err);
      showToast(`Database Error correcting batch: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Correct Batch — ${fd(batch.rcvd)}`} onClose={close}>
      <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: "var(--space-4)", fontSize: "var(--text-xs)", color: C.sub }}>
        Received {fd(batch.rcvd)} · {batch.qty} {item.unit} · {batch.rem} remaining · by{" "}
        {users.find((u) => u.id === batch.by)?.name || "Unknown"}
        <div style={{ marginTop: 4 }}>Quantities aren't editable here — use 🔧 Adjust Stock for those.</div>
      </div>

      {recalc ? (
        <div>
          <div style={{ background: "color-mix(in srgb, var(--c-warn) 12%, transparent)", border: `1.5px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "12px 14px", marginBottom: "var(--space-4)" }}>
            <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, marginBottom: 6 }}>
              This changes {recalc.exact.length} finished job{recalc.exact.length > 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginBottom: 10 }}>
              These jobs recorded {item.name} at {fm(recalc.oldPrice)} — the price you're correcting. Their cost
              will be re-derived at {fm(recalc.newPrice)}. Nothing is typed in by hand.
            </div>
            {recalc.exact.map((j) => {
              const line = lineFor(j, item.id);
              const used = usedOf(j, item.id);
              // The report shows used × priceAtPull, so preview that. Re-derived
              // per job, since a multi-batch pull only moves partway.
              const before = used * (parseFloat(line.priceAtPull) || 0);
              const after = used * (recostLine(line, batch.id, recalc.newPrice).priceAtPull || 0);
              return (
                <div key={j.id} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", fontSize: "var(--text-xs)", padding: "4px 0", borderTop: `1px solid ${C.bd}` }}>
                  <span style={{ color: C.navy, fontWeight: "var(--weight-bold)" }}>
                    {j.title || j.name || j.id} <span style={{ color: C.sub, fontWeight: "normal" }}>({j.status})</span>
                    {hasSplit(line) && line.consumed.length > 1 && (
                      <span style={{ color: C.sub, fontWeight: "normal" }}> · {line.consumed.length} batches</span>
                    )}
                  </span>
                  <span style={{ whiteSpace: "nowrap" }}>
                    {used} × · {fm(before)} → <strong style={{ color: C.gr }}>{fm(after)}</strong>
                  </span>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)", fontWeight: "var(--weight-extrabold)", color: C.navy, paddingTop: 8, marginTop: 4, borderTop: `2px solid ${C.bd}` }}>
              <span>Total change</span>
              <span>
                {fm(recalc.exact.reduce((s, j) => s + usedOf(j, item.id) * (parseFloat(lineFor(j, item.id)?.priceAtPull) || 0), 0))} →{" "}
                {fm(recalc.exact.reduce((s, j) => s + usedOf(j, item.id) * (recostLine(lineFor(j, item.id), batch.id, recalc.newPrice).priceAtPull || 0), 0))}
              </span>
            </div>
          </div>

          {recalc.blended.length > 0 && (
            <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: "var(--space-4)", fontSize: "var(--text-xs)", color: C.sub }}>
              <strong style={{ color: C.navy }}>{recalc.blended.length} other job{recalc.blended.length > 1 ? "s" : ""} won't be touched.</strong>{" "}
              They pulled {item.name} across several batches, so their cost is a blend this correction can't
              safely re-derive: {recalc.blended.map((j) => j.title || j.name || j.id).join(", ")}.
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <Btn v="ghost" onClick={() => setRecalc(null)} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Back</Btn>
            <Btn v="primary" onClick={save} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>
              {saving ? "⏳ Applying..." : `✅ Correct & recalculate ${recalc.exact.length}`}
            </Btn>
          </div>
        </div>
      ) : (
        <div>
          {perms.inv_pricing_edit && (
            <Fld label="Unit Price *">
              <Inp type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" disabled={saving} />
            </Fld>
          )}
          <Fld label="Invoice / PO Number">
            <Inp value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} placeholder="e.g. 2011850932-001" disabled={saving} />
          </Fld>
          <Fld label="Supplier / Vendor">
            <Inp value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. ABC Supply" disabled={saving} />
          </Fld>
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-5)" }}>
            <Btn v="ghost" onClick={close} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Cancel</Btn>
            <Btn v="primary" onClick={save} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>{saving ? "⏳ Saving..." : "💾 Save Batch"}</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
