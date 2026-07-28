// src/views/jobs/EditJobModal.jsx
//
// Edit an existing job: its PO, name, address, schedule, supervisor, notes, and
// its materials checklist.
//
// Extracted from BuildJobsView along with four useState hooks, four row handlers
// and the save routine. The form was seeded by a startEditJob() call the caller
// had to remember to make before switching modals; now the dialog derives its
// own initial state from the job it is handed, so there is no ordering to get
// wrong.
//
// The parent is not given a setter. It learns what changed through onSaved and
// updates its own list, which keeps the "who owns the jobs array" question with
// the component that actually owns it.
import { useState } from "react";
import { supabase, updateRowStrict } from "../../utils/supabase";
import { C, mkJI, mergePullTracking } from "../../utils/helpers";
import { Btn, Fld, Inp, Modal, Sel, TA } from "../../components/UIPrimitives";
import { logAction } from "../../utils/logger";
import { useNotify } from "../../context/NotificationContext";

// Job rows carry their materials under either `items` or `materials`, and their
// supervisor under either `assignedto` or `assignedTo`, depending on vintage.
// Normalising here rather than at each read is why this is a named function.
export const formFromJob = (job = {}) => ({
  po: job.po || "",
  name: job.title || job.name || "",
  addr: job.addr || "",
  notes: job.notes || "",
  scheduledDate: job.scheduledDate || "",
  assignedto: job.assignedto || job.assignedTo || "",
});

export const itemsFromJob = (job = {}) => (job.items || job.materials || []).filter(Boolean);

// Inventory still offerable: matches the search and is not already on the job.
export const addableInventory = (inv = [], chosen = [], query = "") =>
  inv.filter(
    (i) => (i?.name || "").toLowerCase().includes(query.toLowerCase()) && !chosen.find((x) => x.iid === i.id),
  );

export default function EditJobModal({ job, inv = [], fieldUsers = [], activeUser, onSaved, onClose }) {
  const [form, setForm] = useState(() => formFromJob(job));
  const [items, setItems] = useState(() => itemsFromJob(job));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();

  const addable = addableInventory(inv, items, search);

  const addItem = (item) => setItems((p) => [...p, mkJI(item.id, item.name, item.cat, item.unit, 1)]);
  const updateQty = (iid, val) =>
    setItems((p) => p.map((x) => (x.iid === iid ? { ...x, planned: Math.max(0, parseFloat(val) || 0) } : x)));

  const removeItem = (item) => {
    if (item.pulled > 0) {
      if (!window.confirm(`"${item.iname}" already has ${item.pulled} ${item.unit || ""} pulled from the warehouse. Removing it here will not return that stock. Remove it anyway?`)) {
        return;
      }
    }
    setItems((p) => p.filter((x) => x.iid !== item.iid));
  };

  const close = () => { if (!saving) onClose?.(); };

  const save = async () => {
    if (!form.po || !form.name) {
      showToast("PO and Job Name are strictly required fields.", "warning");
      return;
    }
    setSaving(true);
    try {
      // A crew may have pulled materials while this edit was open. Merge the
      // live pull-tracking onto the edited list so it cannot be erased.
      const { data: liveJob, error: liveErr } = await supabase
        .from("jobs")
        .select("items, materials")
        .eq("id", job.id)
        .single();
      if (liveErr) throw liveErr;
      const mergedItems = mergePullTracking(items, liveJob?.items || liveJob?.materials);

      const payload = {
        po: form.po,
        title: form.name,
        addr: form.addr,
        notes: form.notes,
        scheduledDate: form.scheduledDate,
        assignedto: form.assignedto,
        items: mergedItems,
        materials: mergedItems,
      };

      const { error } = await updateRowStrict("jobs", job.id, payload);
      if (error) throw error;

      await logAction(
        activeUser.id,
        activeUser.email,
        "JOB_BUILD_EDIT",
        `Edited job build details for "${form.name}" (PO: ${form.po})`,
        { job_id: job.id, material_count: items.length },
        "production",
      );

      showToast("Job build updated successfully.", "success");
      onSaved?.({ ...job, ...payload });
    } catch (err) {
      console.error("Failed to save job edits:", err);
      showToast(`Database Error: Could not save job edits. ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Edit Job — ${job.po}`} onClose={close} wide>
      <div className="sw-grid-2" style={{ gap: "var(--space-4)" }}>
        <Fld label="Job PO Number *">
          <Inp value={form.po} onChange={(e) => setForm({ ...form, po: e.target.value })} disabled={saving} />
        </Fld>
        <Fld label="Job Name *">
          <Inp value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={saving} />
        </Fld>
      </div>
      <Fld label="Job Address">
        <Inp value={form.addr} onChange={(e) => setForm({ ...form, addr: e.target.value })} disabled={saving} />
      </Fld>
      <div className="sw-grid-2" style={{ gap: "var(--space-4)" }}>
        <Fld label="Production Schedule Start Date">
          <Inp type="date" aria-label="Production Schedule Start Date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} disabled={saving} />
        </Fld>
        <Fld label="Assigned Site Supervisor">
          <Sel value={form.assignedto} onChange={(e) => setForm({ ...form, assignedto: e.target.value })} disabled={saving}>
            <option value="">— Unassigned —</option>
            {fieldUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Sel>
        </Fld>
      </div>
      <Fld label="Notes">
        <TA value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={saving} />
      </Fld>

      <h4 style={{ margin: "16px 0 8px", color: C.navy, fontSize: "var(--text-sm)", textTransform: "uppercase" }}>Materials Checklist</h4>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: 10 }}>
        {items.length === 0 ? (
          <p style={{ color: C.sub, fontSize: "var(--text-sm)", margin: 0 }}>No materials on this job.</p>
        ) : (
          items.map((item) => (
            <div key={item.iid} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", background: C.lg, borderRadius: 7, padding: "7px 10px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>{item.iname}</div>
                {item.pulled > 0 && (
                  <div style={{ fontSize: "var(--text-2xs)", color: C.am }}>⚠️ {item.pulled} {item.unit} already pulled</div>
                )}
              </div>
              <Inp
                type="number"
                min="0"
                value={item.planned}
                onChange={(e) => updateQty(item.iid, e.target.value)}
                style={{ width: 70, padding: "4px 8px" }}
                disabled={saving}
              />
              <span style={{ fontSize: "var(--text-xs)", color: C.sub, width: 50 }}>{item.unit}</span>
              <button
                onClick={() => removeItem(item)}
                disabled={saving}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: "var(--text-lg)", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <Fld label="Add Material">
        <Inp value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search inventory..." disabled={saving} />
      </Fld>
      {search.trim() && (
        <div style={{ border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", maxHeight: 160, overflowY: "auto", marginBottom: 14 }}>
          {addable.length === 0 ? (
            <div style={{ padding: 10, fontSize: "var(--text-sm)", color: C.sub, textAlign: "center" }}>No matching inventory items.</div>
          ) : (
            addable.map((item) => (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${C.lg}` }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy }}>{item.name}</span>
                <Btn v="primary" sz="sm" onClick={() => { addItem(item); setSearch(""); }}>+ Add</Btn>
              </div>
            ))
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 14 }}>
        <Btn v="ghost" onClick={close} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Cancel</Btn>
        <Btn v="primary" onClick={save} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>
          {saving ? "⏳ Saving..." : "💾 Save Changes"}
        </Btn>
      </div>
    </Modal>
  );
}
