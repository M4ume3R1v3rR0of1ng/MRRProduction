// src/features/inventory/JobTemplatesModal.jsx
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
// way to say "I'm done". Templates persist through features/jobs/jobTemplates, so the
// parent never sees them and has nothing to keep in sync.
import { useEffect, useState } from "react";
import {
  LayoutTemplate,
  Package,
  Search,
  Pencil,
  Trash2,
  Save,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { C, uid, tot } from "@/shared/utils/helpers";
// jobTemplates.js is a jobs-domain data model; JobTemplatesModal itself stays
// in inventory since Inventory is its only real UI entry point.
import {
  fetchJobTemplates,
  saveJobTemplates,
  resolveDefaultTemplates,
} from "@/features/jobs/jobTemplates";
import {
  Btn,
  Fld,
  Inp,
  Modal,
  Row,
  Stack,
  Text,
  Muted,
  Callout,
  Grid,
  LoadingState,
  TextBtn,
  Card,
} from "@/shared/components/UIPrimitives";
import { useNotify } from "@/shared/context/NotificationContext";

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
    return () => {
      live = false;
    };
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
    if (
      !window.confirm(
        `Delete the "${tpl.name}" template? Jobs already built with it are not affected.`,
      )
    )
      return;
    if (await persist(tpls.filter((t) => t.id !== tpl.id))) {
      showToast(`Template "${tpl.name}" deleted.`, "success");
    }
  };

  // A save in flight must not be abandoned by closing the dialog. The guard lives
  // here rather than in the caller, so no caller can forget it.
  const requestClose = () => {
    if (!saving) {
      setEditing(null);
      onClose?.();
    }
  };

  return (
    <Modal
      title={
        <Row as="span">
          <LayoutTemplate size={17} aria-hidden="true" /> Job Material Templates
        </Row>
      }
      onClose={requestClose}
      wide
    >
      {loading ? (
        <LoadingState label="Loading templates..." />
      ) : editing ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "var(--space-3)" }}>
            <Fld label="Icon">
              <Inp
                value={editing.icon || ""}
                onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
                placeholder="🏠"
                disabled={saving}
              />
            </Fld>
            <Fld label="Template Name *">
              <Inp
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Economy Roof"
                disabled={saving}
              />
            </Fld>
          </div>
          <Grid gap={5}>
            <div>
              <Row
                as="h4"
                gap={2}
                style={{ margin: "0 0 8px", color: C.navy, fontSize: "var(--text-sm)" }}
              >
                <Package size={13} aria-hidden="true" /> Materials ({editing.items.length})
              </Row>
              {editing.items.length === 0 ? (
                <Text as="p" size="sm" color={C.sub}>
                  Add materials from the catalog on the right.
                </Text>
              ) : (
                <Stack gap={2} style={{ maxHeight: 260, overflowY: "auto" }}>
                  {editing.items.map((t, idx) => {
                    const inCatalog = t.iid && inv.find((i) => i && i.id === t.iid);
                    return (
                      <Callout key={t.iid || `x_${idx}`} pad="7px 9px" style={{ borderRadius: 7 }}>
                        <Text size="xs" weight="bold" color={C.navy} style={{ marginBottom: 4 }}>
                          {t.iname}{" "}
                          {!inCatalog && (
                            <Row inline as="span" gap="3px" style={{ color: C.am }}>
                              <AlertTriangle size={10} aria-hidden="true" /> not in catalog
                            </Row>
                          )}
                        </Text>
                        <Row gap="5px">
                          <Inp
                            type="number"
                            value={t.qty}
                            min="1"
                            onChange={(e) => {
                              const qty = Math.max(1, parseInt(e.target.value) || 1);
                              setEditing((p) => ({
                                ...p,
                                items: p.items.map((x, i2) => (i2 === idx ? { ...x, qty } : x)),
                              }));
                            }}
                            style={{ width: 55, padding: "3px 6px" }}
                            disabled={saving}
                          />
                          <Muted as="span" size="2xs">
                            default qty
                          </Muted>
                          <TextBtn
                            onClick={() =>
                              setEditing((p) => ({
                                ...p,
                                items: p.items.filter((_, i2) => i2 !== idx),
                              }))
                            }
                            color={C.rd}
                            weight="normal"
                            size="lg"
                            aria-label="Remove"
                            style={{ marginLeft: "auto", lineHeight: 1, padding: "1px 6px" }}
                            disabled={saving}
                          >
                            ×
                          </TextBtn>
                        </Row>
                      </Callout>
                    );
                  })}
                </Stack>
              )}
            </div>
            <div>
              <Inp
                prefix={<Search size={13} />}
                value={srch}
                onChange={(e) => setSrch(e.target.value)}
                placeholder="Search catalog..."
                style={{ marginBottom: 8 }}
                disabled={saving}
              />
              <Stack gap="5px" style={{ maxHeight: 260, overflowY: "auto" }}>
                {selectableMaterials(inv, editing.items, srch)
                  .slice(0, 40)
                  .map((item) => (
                    <Card
                      key={item.id}
                      variant="raised"
                      pad="8px 10px"
                      style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xs)" }}
                    >
                      <Row gap={0} justify="space-between">
                        <div>
                          <Text size="xs" weight="bold" color={C.navy}>
                            {item.name}
                          </Text>
                          <Muted size="2xs">
                            {tot(item)} {item.unit} available
                          </Muted>
                        </div>
                        <Btn
                          v="primary"
                          sz="sm"
                          onClick={() =>
                            setEditing((p) => ({
                              ...p,
                              items: [...p.items, { iid: item.id, iname: item.name, qty: 1 }],
                            }))
                          }
                          disabled={saving}
                        >
                          + Add
                        </Btn>
                      </Row>
                    </Card>
                  ))}
              </Stack>
            </div>
          </Grid>
          <Row gap={4} align="stretch" style={{ marginTop: 14 }}>
            <Btn
              v="ghost"
              onClick={() => setEditing(null)}
              style={{ flex: 1, justifyContent: "center" }}
              disabled={saving}
            >
              ← Back
            </Btn>
            <Btn
              v="primary"
              onClick={saveEdit}
              style={{ flex: 1, justifyContent: "center" }}
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2
                    size={14}
                    style={{ animation: "mrr-spin 0.7s linear infinite" }}
                    aria-hidden="true"
                  />{" "}
                  Saving...
                </>
              ) : (
                <>
                  <Save size={14} aria-hidden="true" /> Save Template
                </>
              )}
            </Btn>
          </Row>
        </>
      ) : (
        <>
          <Muted as="p" size="sm" style={{ margin: "0 0 12px" }}>
            These material packages appear in the Build Jobs wizard (Step 2) for one-click job
            lists.
          </Muted>
          {tpls.length === 0 && (
            <Muted as="p" size="sm" style={{ textAlign: "center", padding: "16px 0" }}>
              No templates yet — create your first one below.
            </Muted>
          )}
          <Stack gap={3} style={{ maxHeight: 320, overflowY: "auto" }}>
            {tpls.map((tpl) => (
              <Callout key={tpl.id} pad="10px 12px">
                <Row gap={2} justify="space-between" style={{ marginBottom: 4 }}>
                  <Text size="sm" weight="extrabold" color={C.navy}>
                    {tpl.icon} {tpl.name}
                  </Text>
                  <Row gap={2} align="stretch">
                    <Btn
                      v="outline"
                      sz="sm"
                      onClick={() => {
                        setSrch("");
                        setEditing({ ...tpl, items: [...(tpl.items || [])] });
                      }}
                      disabled={saving}
                    >
                      <Pencil size={12} aria-hidden="true" /> Edit
                    </Btn>
                    <Btn v="danger" sz="sm" onClick={() => deleteTpl(tpl)} disabled={saving}>
                      <Trash2 size={12} aria-hidden="true" />
                    </Btn>
                  </Row>
                </Row>
                <Muted size="2xs" style={{ lineHeight: 1.7 }}>
                  {(tpl.items || [])
                    .map((t) => t.iname + (t.qty > 1 ? ` ×${t.qty}` : ""))
                    .join(" · ") || "No materials"}
                </Muted>
              </Callout>
            ))}
          </Stack>
          <Row gap={4} align="stretch" style={{ marginTop: 14 }}>
            <Btn
              v="ghost"
              onClick={requestClose}
              style={{ flex: 1, justifyContent: "center" }}
              disabled={saving}
            >
              Close
            </Btn>
            <Btn
              v="primary"
              onClick={() => {
                setSrch("");
                setEditing({ id: "tpl_" + uid(), name: "", icon: "🧰", items: [] });
              }}
              style={{ flex: 1, justifyContent: "center" }}
              disabled={saving}
            >
              + New Template
            </Btn>
          </Row>
        </>
      )}
    </Modal>
  );
}
