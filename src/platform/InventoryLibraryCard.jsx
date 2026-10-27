// src/platform/InventoryLibraryCard.jsx
//
// Curating the shared inventory library from the Owner Console — the whole reason
// supabase/61 put it in a table rather than shipping it in the build: Steadwerk
// edits the positions every new company is offered without a deploy.
//
// Extracted rather than added to OwnerConsole, which is already carrying company
// creation, billing, storage totals and the platform-admin roster in one file.
// Nothing here is read by any of that.
//
// EDITING THIS IS SAFE, WHICH IS WHY THERE IS NO CONFIRM ON SAVE
//
// A company's import COPIES these rows (see features/inventory/inventoryCatalog),
// so renaming a position here does not rename anybody's stock, and retiring one
// does not delete anybody's. That is the opposite of the training library, where
// one row is shared live by every tenant and an edit lands everywhere — compare
// the warnings TrainingView has to show. The only thing at stake here is what a
// FUTURE import offers.
//
// Deleting is offered as well as retiring, and it does ask, because a delete loses
// the wording. `active = false` keeps the line and hides it from every picker.
import { useEffect, useMemo, useState } from "react";
import { Library, Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import { logAction } from "@/shared/utils/logger";
import { useNotify } from "@/shared/context/NotificationContext";
import { CATEGORIES, UNITS } from "@/features/inventory/ItemFormModal";
import { fetchInventoryCatalogAll, groupByCategory } from "@/features/inventory/inventoryCatalog";
import {
  Btn,
  Card,
  Fld,
  Inp,
  Sel,
  Row,
  Stack,
  Text,
  Muted,
  Bdg,
  Eyebrow,
  Toggle,
  TextBtn,
  LoadingState,
} from "@/shared/components/UIPrimitives";

const blankDraft = () => ({ name: "", cat: CATEGORIES[0], unit: UNITS[0], alrt: "10" });

export default function InventoryLibraryCard({ user, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const { showToast } = useNotify();

  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  // null = not adding. An object = the new position being typed.
  const [draft, setDraft] = useState(null);
  // The id being edited, and the fields for it. One at a time, so there is no
  // chance of a stale field from a previous row riding along into a save — the
  // bug ItemFormModal's header describes from the days of one shared form bag.
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(blankDraft());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setRows(await fetchInventoryCatalogAll());
      setErr(null);
    } catch (e) {
      // A missing table (61 not run) says so rather than rendering an empty
      // library, which would read as "there is nothing in it".
      setErr(e?.message || String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => groupByCategory(rows || []), [rows]);
  const activeCount = (rows || []).filter((r) => r.active).length;

  const add = async () => {
    const name = draft.name.trim();
    if (!name) return showToast(t.ocLibNameRequired, "warning");
    setBusy(true);
    try {
      const { error } = await supabase.from("inventory_catalog").insert([
        {
          name,
          cat: draft.cat,
          unit: draft.unit,
          alrt: parseInt(draft.alrt, 10) || 10,
        },
      ]);
      // 23505 is the case-insensitive name index in 61 doing its job. Worth saying
      // plainly, because "duplicate key value violates unique constraint" tells an
      // operator nothing about which line already exists.
      if (error) throw new Error(error.code === "23505" ? t.ocLibDuplicate : error.message);
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "PLATFORM_MUTATION",
        `Added "${name}" to the shared inventory library`,
        { name, cat: draft.cat, unit: draft.unit },
        "platform",
      );
      setDraft(null);
      await load();
      showToast(t.ocLibAdded, "success");
    } catch (e) {
      showToast(`${t.ocLibFailed} ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r) => {
    setEditId(r.id);
    setEditForm({
      name: r.name || "",
      cat: r.cat || CATEGORIES[0],
      unit: r.unit || UNITS[0],
      alrt: String(r.alrt ?? 10),
    });
  };

  const saveEdit = async () => {
    const name = editForm.name.trim();
    if (!name) return showToast(t.ocLibNameRequired, "warning");
    setBusy(true);
    try {
      const { error } = await supabase
        .from("inventory_catalog")
        .update({
          name,
          cat: editForm.cat,
          unit: editForm.unit,
          alrt: parseInt(editForm.alrt, 10) || 10,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editId);
      if (error) throw new Error(error.code === "23505" ? t.ocLibDuplicate : error.message);
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "PLATFORM_MUTATION",
        `Edited "${name}" in the shared inventory library`,
        { id: editId, name, cat: editForm.cat, unit: editForm.unit },
        "platform",
      );
      setEditId(null);
      await load();
      showToast(t.ocLibSaved, "success");
    } catch (e) {
      showToast(`${t.ocLibFailed} ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  // Retire / restore. No confirm: it changes nothing anybody already imported, and
  // it is one click to undo.
  const setActive = async (r, next) => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("inventory_catalog")
        .update({ active: next, updated_at: new Date().toISOString() })
        .eq("id", r.id);
      if (error) throw error;
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "PLATFORM_MUTATION",
        `${next ? "Restored" : "Retired"} "${r.name}" in the shared inventory library`,
        { id: r.id, name: r.name, active: next },
        "platform",
      );
      await load();
    } catch (e) {
      showToast(`${t.ocLibFailed} ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(t.ocLibDeleteConfirm.replace("{name}", r.name))) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("inventory_catalog").delete().eq("id", r.id);
      if (error) throw error;
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "PLATFORM_MUTATION",
        `Deleted "${r.name}" from the shared inventory library`,
        { id: r.id, name: r.name },
        "platform",
      );
      await load();
      showToast(t.ocLibDeleted, "success");
    } catch (e) {
      showToast(`${t.ocLibFailed} ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad="var(--space-8)" style={{ marginTop: 24 }}>
      <Row gap={4} justify="space-between" wrap style={{ marginBottom: 4 }}>
        <Eyebrow>
          <Row gap="7px">
            <Library size={13} aria-hidden="true" /> {t.ocLibTitle}
          </Row>
        </Eyebrow>
        {rows && (
          <Muted size="sm">
            {t.ocLibCount
              .replace("{active}", String(activeCount))
              .replace("{total}", String(rows.length))}
          </Muted>
        )}
      </Row>
      <Muted size="sm" style={{ marginBottom: 14, maxWidth: "80ch" }}>
        {t.ocLibDesc}
      </Muted>

      {err ? (
        <Text color={C.rustInk} size="sm">
          {t.ocLibLoadFail} {err}
        </Text>
      ) : rows === null ? (
        <LoadingState label={t.ocLibLoading} />
      ) : (
        <Stack gap={5}>
          {draft ? (
            <Card pad={4}>
              <Stack gap={3}>
                <Row gap={3} wrap>
                  <Fld label={t.ocLibName} style={{ flex: 2, minWidth: 200 }}>
                    <Inp
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      disabled={busy}
                      placeholder={t.ocLibNamePlaceholder}
                    />
                  </Fld>
                  <Fld label={t.ocLibCat} style={{ flex: 1, minWidth: 150 }}>
                    <Sel
                      value={draft.cat}
                      onChange={(e) => setDraft({ ...draft, cat: e.target.value })}
                      disabled={busy}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Sel>
                  </Fld>
                  <Fld label={t.ocLibUnit} style={{ flex: 1, minWidth: 110 }}>
                    <Sel
                      value={draft.unit}
                      onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                      disabled={busy}
                    >
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </Sel>
                  </Fld>
                  <Fld label={t.ocLibAlrt} style={{ width: 110 }} hint={t.ocLibAlrtHint}>
                    <Inp
                      type="number"
                      min="0"
                      value={draft.alrt}
                      onChange={(e) => setDraft({ ...draft, alrt: e.target.value })}
                      disabled={busy}
                    />
                  </Fld>
                </Row>
                <Row gap={2} justify="flex-end">
                  <Btn v="ghost" sz="sm" onClick={() => setDraft(null)} disabled={busy}>
                    {t.trCancel}
                  </Btn>
                  <Btn v="primary" sz="sm" onClick={add} disabled={busy}>
                    <Save size={13} aria-hidden="true" /> {t.ocLibAdd}
                  </Btn>
                </Row>
              </Stack>
            </Card>
          ) : (
            <Row>
              <Btn v="outline" sz="sm" onClick={() => setDraft(blankDraft())} disabled={busy}>
                <Plus size={13} aria-hidden="true" /> {t.ocLibAddPosition}
              </Btn>
            </Row>
          )}

          {rows.length === 0 ? (
            <Muted size="sm">{t.ocLibEmpty}</Muted>
          ) : (
            [...grouped.entries()].map(([category, items]) => (
              <Stack key={category} gap={2}>
                <Row gap="7px">
                  <Text weight="extrabold" color={C.navy} size="sm">
                    {category}
                  </Text>
                  <Bdg color="blue">{items.length}</Bdg>
                </Row>
                {items.map((r) =>
                  editId === r.id ? (
                    <Card key={r.id} pad={3}>
                      <Stack gap={3}>
                        <Row gap={3} wrap>
                          <Fld label={t.ocLibName} style={{ flex: 2, minWidth: 180 }}>
                            <Inp
                              value={editForm.name}
                              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                              disabled={busy}
                            />
                          </Fld>
                          <Fld label={t.ocLibCat} style={{ flex: 1, minWidth: 150 }}>
                            <Sel
                              value={editForm.cat}
                              onChange={(e) => setEditForm({ ...editForm, cat: e.target.value })}
                              disabled={busy}
                            >
                              {CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </Sel>
                          </Fld>
                          <Fld label={t.ocLibUnit} style={{ flex: 1, minWidth: 110 }}>
                            <Sel
                              value={editForm.unit}
                              onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                              disabled={busy}
                            >
                              {UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </Sel>
                          </Fld>
                          <Fld label={t.ocLibAlrt} style={{ width: 110 }}>
                            <Inp
                              type="number"
                              min="0"
                              value={editForm.alrt}
                              onChange={(e) => setEditForm({ ...editForm, alrt: e.target.value })}
                              disabled={busy}
                            />
                          </Fld>
                        </Row>
                        <Row gap={2} justify="flex-end">
                          <Btn v="ghost" sz="sm" onClick={() => setEditId(null)} disabled={busy}>
                            <X size={13} aria-hidden="true" /> {t.trCancel}
                          </Btn>
                          <Btn v="primary" sz="sm" onClick={saveEdit} disabled={busy}>
                            <Save size={13} aria-hidden="true" /> {t.ocLibSave}
                          </Btn>
                        </Row>
                      </Stack>
                    </Card>
                  ) : (
                    <Row
                      key={r.id}
                      gap={3}
                      justify="space-between"
                      wrap
                      style={{
                        padding: "8px 10px",
                        borderRadius: "var(--radius-md)",
                        border: `1px solid ${C.bd}`,
                        // A retired line stays legible but obviously out of play,
                        // rather than being hidden from the one screen that curates it.
                        opacity: r.active ? 1 : 0.55,
                      }}
                    >
                      <Row gap={3} style={{ minWidth: 0 }}>
                        <Text style={{ minWidth: 0 }}>{r.name}</Text>
                        <Muted size="sm">
                          {r.unit} · {t.invLibAlertAt.replace("{n}", String(r.alrt))}
                        </Muted>
                        {!r.active && <Bdg color="amber">{t.ocLibRetired}</Bdg>}
                      </Row>
                      <Row gap={3} align="center" style={{ flexShrink: 0 }}>
                        <Row gap={2} align="center" title={t.ocLibActiveHint}>
                          <Muted size="sm">{t.ocLibOffered}</Muted>
                          <Toggle
                            on={!!r.active}
                            onChange={() => setActive(r, !r.active)}
                            disabled={busy}
                          />
                        </Row>
                        <TextBtn onClick={() => startEdit(r)} disabled={busy}>
                          <Pencil size={13} aria-hidden="true" /> {t.trEdit}
                        </TextBtn>
                        <TextBtn onClick={() => remove(r)} disabled={busy} color={C.rustInk}>
                          <Trash2 size={13} aria-hidden="true" /> {t.trRemove}
                        </TextBtn>
                      </Row>
                    </Row>
                  ),
                )}
              </Stack>
            ))
          )}
        </Stack>
      )}
    </Card>
  );
}
