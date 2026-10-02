// src/features/jobs/CorrectReturnModal.jsx
//
// Fixes a wrong RETURNED quantity on a job that is already completed.
//
// "Return Unused & Complete Job" (PullInventoryView.confirmReturn) is a one-shot
// action: it records what came back and marks the job completed together, and
// once a job is completed it drops out of Pull Inventory for good. Until this
// modal, there was no way back in to fix a returned quantity someone got wrong.
//
// This deliberately does NOT reuse confirmReturn. That flow's inventory write
// (applyReturnBatch) is guarded to be safe against RETRIES — if the same
// deterministic batch id already exists, it is left untouched — which is
// exactly wrong for a CORRECTION, where the point is changing that value.
// correct_job_return (supabase/35) is a dedicated RPC that adjusts the
// existing batch by the delta instead, and only touches `returned` — `pulled`
// is not editable here, this is not a general job-materials editor.
//
// Reached from inside Edit Job (EditJobModal), alongside Pull Added
// Materials, rather than as its own top-level button on the job detail view.
import { useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import { displayNameOf } from "@/shared/utils/people";
import { Btn, Modal, Row, Text, Table, Inp } from "@/shared/components/UIPrimitives";
import { logAction } from "@/shared/utils/logger";
import { useNotify } from "@/shared/context/NotificationContext";

export default function CorrectReturnModal({ job, activeUser, t, onSaved, onClose }) {
  // Only items something was actually pulled for are correctable — nothing
  // came back on a line nothing went out on.
  const items = (job.items || job.materials || []).filter((i) => i && (i.pulled || 0) > 0);

  const [qtys, setQtys] = useState(() =>
    Object.fromEntries(items.map((i) => [i.iid, String(i.returned || 0)])),
  );
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();

  const setQty = (iid, val) => setQtys((p) => ({ ...p, [iid]: val }));

  const close = () => {
    if (!saving) onClose?.();
  };

  const save = async () => {
    const corrections = {};
    for (const item of items) {
      const raw = qtys[item.iid];
      const parsed = Math.max(0, Math.min(item.pulled || 0, parseFloat(raw) || 0));
      const current = item.returned || 0;
      if (parsed !== current) corrections[item.iid] = parsed;
    }

    if (Object.keys(corrections).length === 0) {
      showToast(t.bjCorrectReturnNoChange, "warning");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("correct_job_return", {
        p_job_id: job.id,
        p_corrections: corrections,
        p_by_name: displayNameOf(activeUser),
      });
      if (error) throw error;

      const changedById = new Map((data?.corrections || []).map((c) => [c.iid, c]));
      const updatedItems = (job.items || job.materials || []).map((i) => {
        if (!i || !changedById.has(i.iid)) return i;
        return { ...i, returned: changedById.get(i.iid).new_returned };
      });
      const updatedJob = { ...job, items: updatedItems, materials: updatedItems };

      await logAction(
        activeUser.id,
        activeUser.email,
        "JOB_MATERIAL_CORRECTION",
        `Corrected returned materials on "${job.title || job.name}" (PO: ${job.po})`,
        { job_id: job.id, corrections: data?.corrections || [] },
        "production",
      );

      showToast(t.bjCorrectReturnSaved, "success");
      onSaved?.(updatedJob);
    } catch (err) {
      console.error("Failed to correct job return:", err);
      showToast(`${t.bjCorrectReturnFail} ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`${t.bjCorrectReturnTitle} — ${job.po}`} onClose={close} wide>
      <Text as="p" size="sm" color={C.sub} style={{ marginTop: 0 }}>
        {t.bjCorrectReturnInfo}
      </Text>

      {items.length === 0 ? (
        <Text as="p" size="sm">
          —
        </Text>
      ) : (
        <div className="sw-table-scroll">
          <Table pad="md">
            <thead>
              <tr>
                {[t.colItem, t.colPulled, t.colCurrentlyReturned, t.colCorrectedReturned].map(
                  (h) => (
                    <th key={h}>{h}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.iid}>
                  <Text as="td" weight="bold" color={C.navy}>
                    {item.iname}
                  </Text>
                  <td>
                    {item.pulled || 0} {item.unit || ""}
                  </td>
                  <td>
                    {item.returned || 0} {item.unit || ""}
                  </td>
                  <td>
                    <Inp
                      type="number"
                      min="0"
                      max={item.pulled || 0}
                      value={qtys[item.iid]}
                      onChange={(e) => setQty(item.iid, e.target.value)}
                      disabled={saving}
                      style={{ width: 80, padding: "4px 8px" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <Row gap={4} align="stretch" style={{ marginTop: 14 }}>
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
          onClick={save}
          style={{ flex: 1, justifyContent: "center" }}
          disabled={saving || items.length === 0}
        >
          {saving ? (
            t.bjCorrectReturnSaving
          ) : (
            <>
              <Save size={14} aria-hidden="true" /> Save Correction
            </>
          )}
        </Btn>
      </Row>
    </Modal>
  );
}
