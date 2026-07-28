// src/views/inventory/JobTemplatesModal.jsx
//
// Job material templates: the named material packages that show up in the Build
// Jobs wizard at step 2 for one-click job lists.
//
// Extracted whole from InventoryView, which was carrying this feature's five
// useState hooks and four async handlers alongside item CRUD, batch receiving,
// stock adjustment, and bulk manifests. None of that state was ever read outside
// this modal.
//
// The contract is deliberately narrow: the catalog to pick materials from, and a
// way to say "I'm done". Templates persist through utils/jobTemplates, so the
// parent never sees them and has nothing to keep in sync.
import { useEffect, useState } from "react";
import { C, uid, tot } from "../../utils/helpers";
import { fetchJobTemplates, saveJobTemplates, resolveDefaultTemplates } from "../../utils/jobTemplates";
import { Btn, Fld, Inp, Modal } from "../../components/UIPrimitives";
import { useNotify } from "../../context/NotificationContext";

// Replace in place if the id is already known, otherwise append. Pulled out as a
// pure function because it is the one piece of real logic in this file: getting
// it backwards silently duplicates a template on every save, and that is not
// something a render test would notice.
export const upsertTemplate = (list, tpl) =>
  list.some((t) => t.id === tpl.id) ? list.map((t) => (t.id === tpl.id ? tpl : t)) : [...list, tpl];

// Which materials are still offerable: matches the search and is not already on
// the template. Exported for the same reason.
export const selectableMaterials = (inv, chosen, query) =>
  inv.filter(
    (i) =>
      i &&
      (i.name || "").toLowerCase().includes((query || "").toLowerCase()) &&
      !chosen.some((t) => t.iid === i.id),
  );

export default function JobTemplatesModal({ inv = [], onClose }) {
  const [tpls, setTpls] = useState([]);
  const [editing, setEditing] = useState(null); // the template being edited
  const [srch, setSrch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();

  // Load on mount rather than in the caller's click handler. Previously opening
  // this modal meant remembering to call openTemplates() instead of just setting
  // the modal state, which is the kind of coupling that only breaks later.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const saved = await fetchJobTemplates();
        if (live) setTpls(saved || resolveDefaultTemplates(inv));
      } catch (err) {
        if (!live) return;
        showToast(`Could not load templates: ${err.message}`, "error");
        setTpls(resolveDefaultTemplates(inv));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
    // Intentionally mount-only: re-fetching because the catalog array changed
    // identity would throw away unsaved edits mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (next) => {
    setSaving(true);
    try {
      await saveJobTemplates(next);
      setTpls(next);
      return true;
    } catch (err) {
      showToast(`Database Error: Could not save templates. ${err.message}`, "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editing.name.trim()) {
      showToast("Template name is required.", "warning");
      return;
    }
    if (editing.items.length === 0) {
      showToast("Add at least one material to the template.", "warning");
      return;
    }
    const cleaned = { ...editing, name: editing.name.trim() };
    if (await persist(upsertTemplate(tpls, cleaned))) {
      showToast(`Template "${cleaned.name}" saved.`, "success");
      setEditing(null);
    }
  };

  const deleteTpl = async (tpl) => {
    if (!window.confirm(`Delete the "${tpl.name}" template? Jobs already built with it are not affected.`)) return;
    if (await persist(tpls.filter((t) => t.id !== tpl.id))) {
      showToast(`Template "${tpl.name}" deleted.`, "success");
    }
  };

  // A save in flight must not be abandoned by closing the dialog. The guard lives
  // here rather than in the caller, so no caller can forget it.
  const requestClose = () => { if (!saving) { setEditing(null); onClose?.(); } };

  return (
    <Modal title="🧰 Job Material Templates" onClose={requestClose} wide>
      {loading ? (
        <p style={{ color: C.sub, textAlign: "center", padding: "20px 0" }}>Loading templates...</p>
      ) : editing ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "var(--space-3)" }}>
            <Fld label="Icon">
              <Inp value={editing.icon || ""} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} placeholder="🏠" disabled={saving} />
            </Fld>
            <Fld label="Template Name *">
              <Inp value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Economy Roof" disabled={saving} />
            </Fld>
          </div>
          <div className="sw-grid-2" style={{ gap: "var(--space-5)" }}>
            <div>
              <h4 style={{ margin: "0 0 8px", color: C.navy, fontSize: "var(--text-sm)" }}>📦 Materials ({editing.items.length})</h4>
              {editing.items.length === 0 ? (
                <p style={{ color: C.sub, fontSize: "var(--text-sm)" }}>Add materials from the catalog on the right.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight: 260, overflowY: "auto" }}>
                  {editing.items.map((t, idx) => {
                    const inCatalog = t.iid && inv.find((i) => i && i.id === t.iid);
                    return (
                      <div key={t.iid || `x_${idx}`} style={{ background: C.lg, borderRadius: 7, padding: "7px 9px" }}>
                        <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-xs)", marginBottom: 4 }}>
                          {t.iname} {!inCatalog && <span style={{ color: C.am }}>⚠ not in catalog</span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <Inp
                            type="number"
                            value={t.qty}
                            min="1"
                            onChange={(e) => {
                              const qty = Math.max(1, parseInt(e.target.value) || 1);
                              setEditing((p) => ({ ...p, items: p.items.map((x, i2) => (i2 === idx ? { ...x, qty } : x)) }));
                            }}
                            style={{ width: 55, padding: "3px 6px" }}
                            disabled={saving}
                          />
                          <span style={{ fontSize: "var(--text-2xs)", color: C.sub }}>default qty</span>
                          <button
                            onClick={() => setEditing((p) => ({ ...p, items: p.items.filter((_, i2) => i2 !== idx) }))}
                            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: "var(--text-lg)", lineHeight: 1 }}
                            disabled={saving}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div>
              <Inp value={srch} onChange={(e) => setSrch(e.target.value)} placeholder="🔍 Search catalog..." style={{ marginBottom: 8 }} disabled={saving} />
              <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                {selectableMaterials(inv, editing.items, srch)
                  .slice(0, 40)
                  .map((item) => (
                    <div key={item.id} style={{ background: C.w, borderRadius: "var(--radius-md)", padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "var(--shadow-xs)" }}>
                      <div>
                        <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-xs)" }}>{item.name}</div>
                        <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>{tot(item)} {item.unit} available</div>
                      </div>
                      <Btn
                        v="primary"
                        sz="sm"
                        onClick={() => setEditing((p) => ({ ...p, items: [...p.items, { iid: item.id, iname: item.name, qty: 1 }] }))}
                        disabled={saving}
                      >
                        + Add
                      </Btn>
                    </div>
                  ))}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 14 }}>
            <Btn v="ghost" onClick={() => setEditing(null)} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>← Back</Btn>
            <Btn v="primary" onClick={saveEdit} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>
              {saving ? "⏳ Saving..." : "💾 Save Template"}
            </Btn>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: "0 0 12px", fontSize: "var(--text-sm)", color: C.sub }}>
            These material packages appear in the Build Jobs wizard (Step 2) for one-click job lists.
          </p>
          {tpls.length === 0 && (
            <p style={{ color: C.sub, fontSize: "var(--text-sm)", textAlign: "center", padding: "16px 0" }}>No templates yet — create your first one below.</p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxHeight: 320, overflowY: "auto" }}>
            {tpls.map((tpl) => (
              <div key={tpl.id} style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, fontSize: "var(--text-sm)" }}>{tpl.icon} {tpl.name}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn v="outline" sz="sm" onClick={() => { setSrch(""); setEditing({ ...tpl, items: [...(tpl.items || [])] }); }} disabled={saving}>✏️ Edit</Btn>
                    <Btn v="danger" sz="sm" onClick={() => deleteTpl(tpl)} disabled={saving}>🗑️</Btn>
                  </div>
                </div>
                <div style={{ fontSize: "var(--text-2xs)", color: C.sub, lineHeight: 1.7 }}>
                  {(tpl.items || []).map((t) => t.iname + (t.qty > 1 ? ` ×${t.qty}` : "")).join(" · ") || "No materials"}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 14 }}>
            <Btn v="ghost" onClick={requestClose} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Close</Btn>
            <Btn
              v="primary"
              onClick={() => { setSrch(""); setEditing({ id: "tpl_" + uid(), name: "", icon: "🧰", items: [] }); }}
              style={{ flex: 1, justifyContent: "center" }}
              disabled={saving}
            >
              + New Template
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}
