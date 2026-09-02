// src/features/jobs/PullAddedMaterialsModal.jsx
//
// Bridges the gap CorrectReturnModal.jsx explicitly does NOT cover: a line
// added to a job AFTER its initial pull (job already active or completed —
// not closed, see supabase/36) sits forever at pulled: 0 — nothing in the
// system ever deducted or costed it, and there is no way back into the
// normal "Pull Materials" flow once a job has left `approved`. This lets
// someone FIFO-pull stock for just those added lines, without re-running the
// whole pull or touching status. Reached from inside Edit Job, alongside
// Correct Return, rather than as its own top-level button.
//
// The FIFO math is the same doFifo() PullInventoryView.confirmPull already
// uses, run against a fresh read of the item's batches taken right before
// commit — not this modal's opening snapshot — so it deducts from what's
// actually in the warehouse now. pull_added_job_materials (supabase/36) is
// the dedicated RPC: it writes the job and the touched inventory batches in
// one transaction, and refuses per-line if that line already shows pulled >
// 0 — this is for a line nothing has gone out for yet, not a general
// materials editor (same boundary CorrectReturnModal draws on `returned`).
import { useState } from "react";
import { supabase } from "@/utils/supabase";
import { C, tot, doFifo, todayLocal } from "@/utils/helpers";
import { displayNameOf } from "@/utils/people";
import { Btn, Modal, Inp } from "@/components/UIPrimitives";
import { logAction } from "@/utils/logger";
import { useNotify } from "@/context/NotificationContext";
import { sendLowStockAlerts } from "@/features/inventory/lowStockAlerts";

export default function PullAddedMaterialsModal({ job, inv, users, activeUser, t, onSaved, onClose }) {
  // Only a line nothing has been pulled for yet belongs here — a line already
  // pulled (even partially) goes through Correct Return, not this.
  const items = (job.items || job.materials || []).filter((i) => i && (i.pulled || 0) === 0);

  const [qtys, setQtys] = useState(() =>
    Object.fromEntries(items.map((i) => [i.iid, String(i.planned || i.qty || 0)])),
  );
  const [saving, setSaving] = useState(false);
  const { showToast, confirm } = useNotify();

  const setQty = (iid, val) => setQtys((p) => ({ ...p, [iid]: val }));

  const close = () => { if (!saving) onClose?.(); };

  const save = async () => {
    const requests = items
      .map((item) => ({ item, qty: Math.max(0, parseFloat(qtys[item.iid]) || 0) }))
      .filter((r) => r.qty > 0);

    if (requests.length === 0) {
      showToast(t.bjPullAddedNoChange, "warning");
      return;
    }

    setSaving(true);
    try {
      // Fresh read, not this modal's opening snapshot — another device may
      // have received or pulled stock for these items since it loaded.
      const ids = requests.map((r) => r.item.iid);
      const { data: freshRows, error: freshErr } = await supabase
        .from("inventory")
        .select("id,batches")
        .in("id", ids);
      if (freshErr) throw freshErr;
      const freshById = new Map((freshRows || []).map((r) => [r.id, r.batches || []]));

      const jobRef = `${job.po ? `PO ${job.po}` : "No PO"} · ${job.title || job.name || "Untitled job"}`;
      const pulledAt = todayLocal();
      const shortRows = [];
      const patches = {};
      const changedBatches = {};

      for (const { item, qty } of requests) {
        if (!freshById.has(item.iid)) continue;
        const res = doFifo({ batches: freshById.get(item.iid) }, qty, {
          by: activeUser.id,
          byName: displayNameOf(activeUser),
          jobId: job.id,
          ref: jobRef,
        });
        if (res.shortfall > 0) {
          shortRows.push({ name: item.iname || item.name, unit: item.unit || "", short: res.shortfall });
        }
        changedBatches[item.iid] = res.batches;
        patches[item.iid] = {
          pulled: qty,
          pulledAt,
          priceAtPull: qty > 0 ? res.cost / qty : 0,
          pullCost: res.cost,
          consumed: res.consumed,
        };
      }

      if (shortRows.length > 0) {
        const go = await confirm({
          title: t.bjPullAddedShortTitle,
          message: t.bjPullAddedShortAsk.replace(
            "{items}",
            shortRows.map((r) => `${r.name} (${r.short} ${r.unit})`.trim()).join(", "),
          ),
          confirmLabel: t.bjPullAddedShortConfirm,
          cancelLabel: t.cancel,
          tone: "danger",
        });
        if (!go) { setSaving(false); return; }
      }

      const { data, error } = await supabase.rpc("pull_added_job_materials", {
        p_job_id: job.id,
        p_items: patches,
        p_batches: changedBatches,
      });
      if (error) throw error;

      const pulledByIid = new Map((data?.pulls || []).map((p) => [p.iid, p]));
      const updatedItems = (job.items || job.materials || []).map((i) => {
        if (!i || !pulledByIid.has(i.iid) || !patches[i.iid]) return i;
        return { ...i, ...patches[i.iid] };
      });
      const updatedJob = { ...job, items: updatedItems, materials: updatedItems };

      await logAction(
        activeUser.id,
        activeUser.email,
        "INVENTORY_PULL",
        `Pulled ${requests.length} added material line${requests.length === 1 ? "" : "s"} for PO ${job.po || "n/a"} (${job.title || job.name || "Untitled job"}), added after the original pull.`,
        {
          job_id: job.id,
          po: job.po || null,
          lines: requests.map((r) => ({ item: r.item.iname || r.item.name, qty: r.qty, unit: r.item.unit || "" })),
          short: shortRows,
        },
        "production",
      );

      sendLowStockAlerts(
        Object.entries(changedBatches).map(([iid, batches]) => {
          const invItem = (inv || []).find((i) => i.id === iid);
          return invItem
            ? { item: invItem, prevTotal: tot({ batches: freshById.get(iid) || [] }), newTotal: tot({ batches }) }
            : null;
        }).filter(Boolean),
        users || [],
        showToast,
      );

      showToast(t.bjPullAddedSaved, "success");
      onSaved?.(updatedJob, changedBatches);
    } catch (err) {
      console.error("Failed to pull added job materials:", err);
      showToast(`${t.bjPullAddedFail} ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`${t.bjPullAddedTitle} — ${job.po}`} onClose={close} wide>
      <p style={{ fontSize: "var(--text-sm)", color: C.sub, marginTop: 0 }}>
        {t.bjPullAddedInfo}
      </p>

      {items.length === 0 ? (
        <p style={{ fontSize: "var(--text-sm)" }}>—</p>
      ) : (
        <div className="sw-table-scroll">
          <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {[t.colItem, t.colPlanned, t.colAvailable, t.colActualPull].map((h) => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const avail = tot((inv || []).find((i) => i.id === item.iid) || { batches: [] });
                const qty = parseFloat(qtys[item.iid]) || 0;
                const short = qty > avail;
                return (
                  <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}`, background: short ? C.rB : "transparent" }}>
                    <td style={{ padding: "8px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>{item.iname || item.name}</td>
                    <td style={{ padding: "8px 10px" }}>{item.planned || item.qty || 0} {item.unit || ""}</td>
                    <td style={{ padding: "8px 10px", color: short ? C.rd : C.gr, fontWeight: "var(--weight-bold)" }}>
                      {avail} {item.unit || ""}{short && " ⚠️"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <Inp
                        type="number"
                        min="0"
                        value={qtys[item.iid]}
                        onChange={(e) => setQty(item.iid, e.target.value)}
                        disabled={saving}
                        style={{ width: 80, padding: "4px 8px" }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 14 }}>
        <Btn v="ghost" onClick={close} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>{t.cancel}</Btn>
        <Btn v="teal" onClick={save} style={{ flex: 1, justifyContent: "center" }} disabled={saving || items.length === 0}>
          {saving ? t.bjPullAddedSaving : t.bjPullAdded}
        </Btn>
      </div>
    </Modal>
  );
}
