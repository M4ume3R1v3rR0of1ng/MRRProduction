// src/features/jobs/EditJobModal.jsx
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
import { RefreshCw, AlertTriangle, Search, Save, Loader2 } from "lucide-react";
import { supabase, updateRowStrict } from "@/shared/utils/supabase";
import { C, mkJI, mergePullTracking } from "@/shared/utils/helpers";
import {
  Btn,
  Fld,
  Inp,
  Modal,
  Sel,
  TA,
  Row,
  Stack,
  Text,
  Muted,
  Grid,
  TextBtn,
  Card,
} from "@/shared/components/UIPrimitives";
import { translations } from "@/shared/utils/translations";
import { logAction } from "@/shared/utils/logger";
import { useNotify } from "@/shared/context/NotificationContext";

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
  // Blank, not 0, when unset. "" round-trips to null on save, which is what keeps
  // an unfilled job out of the margin calculation instead of reading as a total
  // loss. See features/reports/jobCosting.
  contractValue: job.contract_value == null ? "" : String(job.contract_value),
});

export const itemsFromJob = (job = {}) => (job.items || job.materials || []).filter(Boolean);

// Inventory still offerable: matches the search and is not already on the job.
export const addableInventory = (inv = [], chosen = [], query = "") =>
  inv.filter(
    (i) =>
      (i?.name || "").toLowerCase().includes(query.toLowerCase()) &&
      !chosen.find((x) => x.iid === i.id),
  );

export default function EditJobModal({
  job,
  inv = [],
  fieldUsers = [],
  activeUser,
  perms = {},
  lang = "en",
  onSaved,
  onClose,
  onCorrectReturn,
}) {
  const [form, setForm] = useState(() => formFromJob(job));
  const [items, setItems] = useState(() => itemsFromJob(job));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();
  const t = translations[lang] || translations.en;

  const addable = addableInventory(inv, items, search);

  const canCorrectReturn = !!onCorrectReturn && perms.jobs_close && job.status === "completed";

  // "Pull Added Materials" used to live here, and that was the bug: reaching it
  // meant holding `jobs_build`, which `warehouse` and `field` — the two roles
  // that actually pull material — do not have, so the people who discover a job
  // needs more material could not ask for it. It is now one dialog on the job
  // card and detail drawer under `jobs_pull` alone (AddPullMaterialsModal), on
  // this screen and on Pull Inventory. Adding a line here still works; pulling
  // it is that button's job.

  const addItem = (item) =>
    setItems((p) => [...p, mkJI(item.id, item.name, item.cat, item.unit, 1)]);
  const updateQty = (iid, val) =>
    setItems((p) =>
      p.map((x) => (x.iid === iid ? { ...x, planned: Math.max(0, parseFloat(val) || 0) } : x)),
    );

  const removeItem = (item) => {
    if (item.pulled > 0) {
      if (
        !window.confirm(
          `"${item.iname}" already has ${item.pulled} ${item.unit || ""} pulled from the warehouse. Removing it here will not return that stock. Remove it anyway?`,
        )
      ) {
        return;
      }
    }
    setItems((p) => p.filter((x) => x.iid !== item.iid));
  };

  const close = () => {
    if (!saving) onClose?.();
  };

  const save = async () => {
    if (!form.po || !form.name) {
      showToast(t.ejRequiredErr, "warning");
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
        // Only written by someone allowed to set it, so opening this dialog
        // without jobs_revenue cannot blank a value already on the job.
        ...(perms.jobs_revenue
          ? { contract_value: form.contractValue === "" ? null : parseFloat(form.contractValue) }
          : {}),
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

      showToast(t.ejSavedOk, "success");
      onSaved?.({ ...job, ...payload });
    } catch (err) {
      console.error("Failed to save job edits:", err);
      showToast(`${t.ejSaveFail} ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t.ejTitle.replace("{po}", job.po)} onClose={close} wide>
      <Grid gap={4}>
        <Fld label={t.ejPoLabel}>
          <Inp
            value={form.po}
            onChange={(e) => setForm({ ...form, po: e.target.value })}
            disabled={saving}
          />
        </Fld>
        <Fld label={t.ejNameLabel}>
          <Inp
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={saving}
          />
        </Fld>
      </Grid>
      <Fld label={t.ejAddressLabel}>
        <Inp
          value={form.addr}
          onChange={(e) => setForm({ ...form, addr: e.target.value })}
          disabled={saving}
        />
      </Fld>
      <Grid gap={4}>
        <Fld label={t.ejStartDateLabel}>
          <Inp
            type="date"
            aria-label={t.ejStartDateLabel}
            value={form.scheduledDate}
            onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
            disabled={saving}
          />
        </Fld>
        <Fld label={t.ejSupervisorLabel}>
          <Sel
            value={form.assignedto}
            onChange={(e) => setForm({ ...form, assignedto: e.target.value })}
            disabled={saving}
          >
            <option value="">{t.ejUnassigned}</option>
            {fieldUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Sel>
        </Fld>
      </Grid>
      {perms.jobs_revenue && (
        <Fld label={t.ejContractValue} hint={t.ejContractValueHint}>
          <Inp
            prefix="$"
            type="number"
            step="0.01"
            min="0"
            value={form.contractValue}
            onChange={(e) => setForm({ ...form, contractValue: e.target.value })}
            placeholder={t.ejContractValuePlaceholder}
            disabled={saving}
          />
        </Fld>
      )}

      <Fld label={t.ejNotesLabel}>
        <TA
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          disabled={saving}
        />
      </Fld>

      <Row gap={2} justify="space-between" wrap style={{ margin: "16px 0 8px" }}>
        <Text as="h4" size="sm" color={C.navy} style={{ margin: 0, textTransform: "uppercase" }}>
          {t.ejMaterialsChecklist}
        </Text>
        {canCorrectReturn && (
          <Row gap={2} align="stretch" wrap>
            <Btn v="outline" sz="sm" onClick={() => onCorrectReturn()} disabled={saving}>
              <RefreshCw size={13} aria-hidden="true" /> {t.ejCorrectReturn}
            </Btn>
          </Row>
        )}
      </Row>

      <Stack gap={2} style={{ marginBottom: 10 }}>
        {items.length === 0 ? (
          <Muted as="p" size="sm" style={{ margin: 0 }}>
            {t.ejNoMaterials}
          </Muted>
        ) : (
          items.map((item) => (
            <Row key={item.iid} style={{ background: C.lg, borderRadius: 7, padding: "7px 10px" }}>
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" weight="bold" color={C.navy}>
                  {item.iname}
                </Text>
                {item.pulled > 0 && (
                  <Row gap={1} style={{ fontSize: "var(--text-2xs)", color: C.am }}>
                    <AlertTriangle size={10} aria-hidden="true" /> {item.pulled} {item.unit} already
                    pulled
                  </Row>
                )}
              </Stack>
              <Inp
                type="number"
                min="0"
                value={item.planned}
                onChange={(e) => updateQty(item.iid, e.target.value)}
                style={{ width: 70, padding: "4px 8px" }}
                disabled={saving}
              />
              <Muted as="span" style={{ width: 50 }}>
                {item.unit}
              </Muted>
              <TextBtn
                onClick={() => removeItem(item)}
                disabled={saving}
                color={C.rd}
                weight="normal"
                size="lg"
                style={{ lineHeight: 1, padding: "1px 6px" }}
              >
                ×
              </TextBtn>
            </Row>
          ))
        )}
      </Stack>

      <Fld label={t.ejAddMaterial}>
        <Inp
          prefix={<Search size={13} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.ejSearchInventory}
          disabled={saving}
        />
      </Fld>
      {search.trim() && (
        <Card
          variant="flat"
          pad="none"
          style={{
            borderWidth: 1.5,
            borderRadius: "var(--radius-md)",
            maxHeight: 160,
            overflowY: "auto",
            marginBottom: 14,
          }}
        >
          {addable.length === 0 ? (
            <Muted size="sm" style={{ padding: 10, textAlign: "center" }}>
              {t.ejNoMatches}
            </Muted>
          ) : (
            addable.map((item) => (
              <Row
                key={item.id}
                gap={0}
                justify="space-between"
                style={{ padding: "8px 10px", borderBottom: `1px solid ${C.lg}` }}
              >
                <Text as="span" size="sm" weight="bold" color={C.navy}>
                  {item.name}
                </Text>
                <Btn
                  v="primary"
                  sz="sm"
                  onClick={() => {
                    addItem(item);
                    setSearch("");
                  }}
                >
                  + Add
                </Btn>
              </Row>
            ))
          )}
        </Card>
      )}

      <Row gap={4} align="stretch" style={{ marginTop: 14 }}>
        <Btn
          v="ghost"
          onClick={close}
          style={{ flex: 1, justifyContent: "center" }}
          disabled={saving}
        >
          {t.cancel}
        </Btn>
        <Btn
          v="primary"
          onClick={save}
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
              {t.avSaving}
            </>
          ) : (
            <>
              <Save size={14} aria-hidden="true" /> {t.ejSaveChanges}
            </>
          )}
        </Btn>
      </Row>
    </Modal>
  );
}
