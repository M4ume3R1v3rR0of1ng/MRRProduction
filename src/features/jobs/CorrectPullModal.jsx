// src/features/jobs/CorrectPullModal.jsx
//
// "The crew pulled the wrong thing" — or, far more often, "this line needs one
// more tube and the Add Materials box will not offer it."
//
// Those are the same dead end seen from two sides. add_and_pull_job_materials
// (52) refuses any line already showing pulled > 0 and tells the user to use
// Correct Pulled Materials; correct_job_pull (51) refuses an INCREASE and tells
// them to zero the line and use Add Materials. Both messages were right and
// neither was reachable, because 51 had no UI — it has been installed and
// granted since phase 51 with nothing in the app calling it. This dialog is
// that missing half, and the loop closes here: correcting a line to 0 is
// exactly the state Need More Materials accepts, so the two-step route the RPC
// prescribes can now be walked without touching the database.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// Only the un-pull side of 51 is wired up. The RPC's optional `p_pull` side can
// swap in a replacement item in the same transaction, which is the clean answer
// to a genuine wrong-item pull — but it needs client-side doFifo against a
// fresh batch read, and the overlap guard (51:76) makes the two sides mutually
// exclusive per item anyway. Correct the wrong line to 0 here, then pull the
// right item through Need More Materials; that is two writes instead of one,
// and both are already audited.
//
// Reached from the job card and the detail drawer under `jobs_pull` alone,
// NOT from inside Edit Job. 51's header is explicit about why: Edit Job is
// gated on `jobs_edit_pull`, which `warehouse` — the role that pulls, and so
// the role that mis-pulls — does not hold. Putting it there would leave the RPC
// callable by exactly the people who cannot open the only door to it.
import { useMemo, useState } from "react";
import { AlertTriangle, Save } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import { displayNameOf } from "@/shared/utils/people";
import {
  Btn,
  Callout,
  Fld,
  Inp,
  Modal,
  Muted,
  Row,
  Stack,
  TA,
  Table,
  Text,
} from "@/shared/components/UIPrimitives";
import { logAction } from "@/shared/utils/logger";
import { useNotify } from "@/shared/context/NotificationContext";
import {
  blockedReason,
  correctableLines,
  correctionsFrom,
  floorFor,
  invalidRows,
} from "./correctPull";

export default function CorrectPullModal({ job, activeUser, t, onSaved, onClose }) {
  const lines = useMemo(() => correctableLines(job), [job]);

  // Seeded with what is on the line now, so an untouched row sends nothing —
  // correctionsFrom drops anything equal to its current `pulled`.
  const [qtys, setQtys] = useState(() =>
    Object.fromEntries(lines.map((l) => [l.iid, String(l.pulled || 0)])),
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useNotify();

  const setQty = (iid, val) => setQtys((p) => ({ ...p, [iid]: val }));

  const bad = useMemo(() => invalidRows(lines, (iid) => qtys[iid]), [lines, qtys]);
  const badByIid = new Map(bad.map((r) => [r.iid, r]));
  const corrections = useMemo(() => correctionsFrom(lines, (iid) => qtys[iid]), [lines, qtys]);
  const changedCount = Object.keys(corrections).length;

  const close = () => {
    if (!saving) onClose?.();
  };

  const save = async () => {
    if (bad.length > 0) {
      showToast(t.bjCorrectPullInvalid, "warning");
      return;
    }
    if (changedCount === 0) {
      showToast(t.bjCorrectPullNoChange, "warning");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("correct_job_pull", {
        p_job_id: job.id,
        p_unpull: corrections,
        p_by_name: displayNameOf(activeUser),
        p_reason: reason.trim() || null,
      });
      if (error) throw error;

      // 51 recomputes pullCost and priceAtPull from the surviving `consumed`
      // split rather than blending an average, and hands all of it back. Taking
      // the server's numbers rather than recomputing them here keeps this
      // dialog from becoming a second implementation of that arithmetic.
      const byIid = new Map((data?.corrections || []).map((c) => [c.iid, c]));
      const updatedItems = (job.items || job.materials || []).map((i) => {
        const c = i && byIid.get(i.iid);
        if (!c) return i;
        return {
          ...i,
          pulled: c.new_pulled,
          consumed: c.consumed,
          pullCost: c.pullCost,
          priceAtPull: c.priceAtPull,
        };
      });
      const updatedJob = { ...job, items: updatedItems, materials: updatedItems };

      // The credits landed on the inventory rows server-side, batch by batch in
      // reverse FIFO — there is no client-computed array to echo back, so the
      // touched rows are re-read rather than patched from this dialog's
      // snapshot. Same reason the pull dialogs read fresh before writing.
      const touched = Object.keys(corrections);
      let freshInv = null;
      const { data: rows, error: invErr } = await supabase
        .from("inventory")
        .select("id,batches")
        .in("id", touched);
      // A failed re-read is not a failed correction: the write is committed and
      // rolling the UI back would be a lie. Leave stock to the next load and
      // say nothing — the job numbers above are already right.
      if (!invErr && rows) freshInv = Object.fromEntries(rows.map((r) => [r.id, r.batches || []]));

      await logAction(
        activeUser.id,
        activeUser.email,
        "JOB_MATERIAL_CORRECTION",
        `Corrected pulled materials on "${job.title || job.name}" (PO: ${job.po})`,
        { job_id: job.id, corrections: data?.corrections || [], reason: reason.trim() || null },
        "production",
      );

      showToast(t.bjCorrectPullSaved, "success");
      onSaved?.(updatedJob, freshInv);
    } catch (err) {
      console.error("Failed to correct job pull:", err);
      showToast(`${t.bjCorrectPullFail} ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const rowNote = (line) => {
    const blocked = blockedReason(line);
    if (blocked === "noHistory") return t.bjCorrectPullNoHistory;
    if (blocked === "allReturned") return t.bjCorrectPullAllReturned;
    const b = badByIid.get(line.iid);
    if (!b) return null;
    if (b.kind === "increase") return t.bjCorrectPullCannotRaise;
    if (b.kind === "belowReturned")
      return t.bjCorrectPullBelowReturned.replace("{n}", String(b.floor));
    if (b.kind === "negative") return t.bjCorrectPullNegative;
    return t.bjCorrectPullBlank;
  };

  return (
    <Modal title={`${t.bjCorrectPullTitle} — ${job.po || "No PO"}`} onClose={close} wide>
      <Text as="p" size="sm" color={C.sub} style={{ marginTop: 0 }}>
        {t.bjCorrectPullInfo}
      </Text>

      <Callout tone="warn" bordered pad="12px 14px" style={{ marginBottom: 14 }}>
        <Text size="sm" weight="bold" color={C.navy} style={{ margin: 0 }}>
          {t.bjCorrectPullRaiseHintTitle}
        </Text>
        <Muted as="p" size="sm" style={{ margin: "4px 0 0" }}>
          {t.bjCorrectPullRaiseHint}
        </Muted>
      </Callout>

      {lines.length === 0 ? (
        <Muted as="p" size="sm">
          {t.bjCorrectPullNothing}
        </Muted>
      ) : (
        <div className="sw-table-scroll">
          <Table pad="md">
            <thead>
              <tr>
                {[
                  t.colItem,
                  t.colPulled,
                  t.colReturned,
                  t.bjCorrectPullNewTotal,
                  t.bjCorrectPullBackToStock,
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const blocked = blockedReason(line);
                const note = rowNote(line);
                const parsed = parseFloat(String(qtys[line.iid]));
                const credit =
                  !blocked && !badByIid.has(line.iid) && Number.isFinite(parsed)
                    ? (line.pulled || 0) - parsed
                    : null;
                return (
                  <tr key={line.iid}>
                    <td>
                      <Stack gap={0}>
                        <Text weight="bold" color={C.navy}>
                          {line.iname}
                        </Text>
                        {note && (
                          <Row gap={1} style={{ fontSize: "var(--text-2xs)", color: C.rd }}>
                            <AlertTriangle size={10} aria-hidden="true" />
                            {note}
                          </Row>
                        )}
                      </Stack>
                    </td>
                    <td>
                      {line.pulled || 0} {line.unit || ""}
                    </td>
                    <td>
                      {line.returned || 0} {line.unit || ""}
                    </td>
                    <td>
                      <Inp
                        type="number"
                        min={floorFor(line)}
                        max={line.pulled || 0}
                        aria-label={`${t.bjCorrectPullNewTotal} — ${line.iname}`}
                        value={blocked ? String(line.pulled || 0) : (qtys[line.iid] ?? "")}
                        onChange={(e) => setQty(line.iid, e.target.value)}
                        disabled={saving || Boolean(blocked)}
                        style={{ width: 80, padding: "4px 8px" }}
                      />
                    </td>
                    <td>
                      {credit && credit > 0 ? (
                        <Text weight="bold" color={C.gr}>
                          +{credit} {line.unit || ""}
                        </Text>
                      ) : (
                        <Muted as="span">—</Muted>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      <Fld label={t.bjCorrectPullReason} hint={t.bjCorrectPullReasonHint}>
        <TA value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving} rows={2} />
      </Fld>

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
          disabled={saving || lines.length === 0 || changedCount === 0 || bad.length > 0}
        >
          {saving ? (
            t.bjCorrectPullSaving
          ) : (
            <>
              <Save size={14} aria-hidden="true" /> {t.bjCorrectPullConfirm}
            </>
          )}
        </Btn>
      </Row>
    </Modal>
  );
}
