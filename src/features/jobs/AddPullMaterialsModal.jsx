// src/features/jobs/AddPullMaterialsModal.jsx
//
// "We got to the site and we need more coil than the job was planned for."
//
// Until this existed that was a dead end, and the workaround on record was to
// build a SECOND job for the same roof — splitting one job's material, labour
// and margin across two records nothing joins back together. The pieces were all
// here; they were just behind a screen the warehouse cannot open. See
// supabase/52 for the full account of why.
//
// This dialog does all three halves of the job in one write:
//
//   * pulls stock for an ORPHAN line — one already on the job at pulled = 0,
//     either added through the Pull screen's Edit Job (which can append a line
//     and offers no way to pull it) or left at 0 during the original pull;
//   * TOPS UP a line that has already been pulled and needs more — "I pulled 6
//     osb but now I need 9 more", the case that had no route at all until
//     supabase/57 (see topUpLines in ./addPullMaterials for the circle it was
//     caught in);
//   * ADDS a line that was never on the job and pulls it in the same breath.
//
// It lives on the Pull Inventory screen, on the job card and in the job detail
// drawer, gated on `jobs_pull` alone — deliberately NOT inside Edit Job, which
// is where Pull Added Materials ended up and is exactly why that button was
// unreachable for `warehouse` and `field`, the two roles that pull material.
//
// The FIFO math is doFifo(), the same function the initial pull uses, run
// against a fresh read of each item's batches taken right before the commit
// rather than this dialog's opening snapshot — so it deducts from what is in the
// warehouse now, not what was there when the screen loaded.
//
// add_and_pull_job_materials (supabase/52, extended by 57) is the RPC. It writes
// the job and every touched inventory row in one transaction, builds each new
// line from the inventory row rather than from this payload, and ADDS each
// quantity to whatever the line already has. So every quantity sent is "pull
// this much now", never "the new total should be this" — which is also what the
// boxes below mean, and why the top-up boxes start empty rather than prefilled
// with what is already out.
//
// Reducing a pull is still correct_job_pull's job (51) — this dialog only ever
// sends material out.
import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Search, Truck } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { C, tot, doFifo, todayLocal } from "@/shared/utils/helpers";
import { displayNameOf } from "@/shared/utils/people";
import {
  Bdg,
  Btn,
  Callout,
  Card,
  Fld,
  Inp,
  Modal,
  Muted,
  Row,
  Stack,
  TA,
  Table,
  Text,
  TextBtn,
} from "@/shared/components/UIPrimitives";
import { logAction } from "@/shared/utils/logger";
import { useNotify } from "@/shared/context/NotificationContext";
import { sendLowStockAlerts } from "@/features/inventory/lowStockAlerts";
import { addableForPull, orphanLines, overPullRows, topUpLines } from "./addPullMaterials";

const num = (v) => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

export default function AddPullMaterialsModal({
  job,
  inv = [],
  users = [],
  activeUser,
  t,
  onSaved,
  onClose,
}) {
  // Against the job as handed in, which on this screen is the live row — the
  // Pull screen keeps `sel` in step with every commit it makes.
  const orphans = useMemo(() => orphanLines(job), [job]);
  const topUps = useMemo(() => topUpLines(job), [job]);

  // Quantities for the lines already on the job. Prefilled with what was
  // planned, since the common case for an orphan line is pulling exactly it.
  const [orphanQtys, setOrphanQtys] = useState(() =>
    Object.fromEntries(orphans.map((l) => [l.iid, String(l.planned || l.qty || 0)])),
  );
  // Extra quantities for lines that have already been pulled. Deliberately
  // EMPTY, not prefilled: a number in this box means "send this much more", and
  // every line on the job has one, so anything prefilled here would be material
  // leaving the warehouse because a dialog was opened.
  const [topUpQtys, setTopUpQtys] = useState({});
  // Items being added to the job by this dialog: { id, name, cat, unit, qty }.
  const [added, setAdded] = useState([]);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // Held confirmations, each one passed explicitly rather than by a positional
  // flag — same shape confirmPull settled on next door, for the same reason.
  const [planWarn, setPlanWarn] = useState(null);
  const [shortWarn, setShortWarn] = useState(null);
  const { showToast } = useNotify();

  const addable = useMemo(
    () => (search.trim() ? addableForPull(inv, job, search) : []),
    [inv, job, search],
  );

  const addedIds = new Set(added.map((a) => a.id));
  const offerable = addable.filter((i) => !addedIds.has(i.id));

  const availOf = (iid) => tot((inv || []).find((i) => i.id === iid) || { batches: [] });

  const addItem = (item) => {
    setAdded((p) => [
      ...p,
      { id: item.id, name: item.name, cat: item.cat, unit: item.unit, qty: "1" },
    ]);
    setSearch("");
  };
  const setAddedQty = (id, qty) => setAdded((p) => p.map((a) => (a.id === id ? { ...a, qty } : a)));
  const dropAdded = (id) => setAdded((p) => p.filter((a) => a.id !== id));

  const close = () => {
    if (!saving) onClose?.();
  };

  // Everything this dialog is being asked to pull, in one list. `qty` is always
  // "pull this much now" — for a top-up that is the amount to ADD, which is what
  // the RPC does with it too. The two flags are the only distinctions the commit
  // cares about: whether the line has to be created, and whether it already has
  // a pull the plan check should leave alone.
  const requests = () => [
    ...orphans
      .map((line) => ({
        line,
        iid: line.iid,
        qty: num(orphanQtys[line.iid]),
        isNew: false,
        isTopUp: false,
      }))
      .filter((r) => r.qty > 0),
    ...topUps
      .map((line) => ({
        line,
        iid: line.iid,
        qty: num(topUpQtys[line.iid]),
        isNew: false,
        isTopUp: true,
      }))
      .filter((r) => r.qty > 0),
    ...added
      .map((a) => ({
        line: { iid: a.id, iname: a.name, unit: a.unit },
        iid: a.id,
        qty: num(a.qty),
        isNew: true,
        isTopUp: false,
      }))
      .filter((r) => r.qty > 0),
  ];

  const commit = async ({ planAcked = false, shortAcked = false } = {}) => {
    const reqs = requests();
    if (reqs.length === 0) {
      showToast(t.pullAddMatNoChange, "warning");
      return;
    }

    // Does what was typed disagree with what was approved? Checked first, on the
    // orphan lines only — a line being added now has no plan to disagree with
    // (supabase/52 sets its `planned` to the quantity pulled), and a top-up
    // revises the plan on purpose (57 raises it, see overPullRows). Reads only
    // what is on screen, so a typo is caught before the warehouse is even read.
    if (!planAcked) {
      const rows = overPullRows(
        reqs.filter((r) => !r.isNew && !r.isTopUp).map((r) => r.line),
        (line) => num(orphanQtys[line.iid]),
      );
      if (rows.length > 0) {
        setPlanWarn(rows);
        return;
      }
    }

    setSaving(true);
    try {
      // Fresh read, not this dialog's opening snapshot — another device may have
      // received or pulled stock for these items since it loaded.
      const ids = reqs.map((r) => r.iid);
      const { data: freshRows, error: freshErr } = await supabase
        .from("inventory")
        .select("id,batches")
        .in("id", ids);
      if (freshErr) throw freshErr;
      const freshById = new Map((freshRows || []).map((r) => [r.id, r.batches || []]));

      const missing = reqs.filter((r) => !freshById.has(r.iid));
      if (missing.length > 0) {
        // Silently skipping these is how a crew ends up believing material went
        // out that never did. The RPC would refuse them too, one at a time; say
        // so here instead, before anything is written.
        throw new Error(
          t.pullAddMatGone.replace(
            "{items}",
            missing.map((r) => r.line.iname || r.line.name || r.iid).join(", "),
          ),
        );
      }

      // Stamped onto the synthetic negative batch so an item found at -1 six
      // months from now still names the job that took it — audit_logs cannot
      // answer that, it is purged at 30 days.
      const jobRef = `${job.po ? `PO ${job.po}` : "No PO"} · ${job.title || job.name || "Untitled job"}`;
      const pulledAt = todayLocal();
      const lines = {};
      const changedBatches = {};
      const shortRows = [];

      for (const r of reqs) {
        const res = doFifo({ batches: freshById.get(r.iid) }, r.qty, {
          by: activeUser.id,
          byName: displayNameOf(activeUser),
          jobId: job.id,
          ref: jobRef,
        });
        if (res.shortfall > 0) {
          shortRows.push({
            iid: r.iid,
            name: r.line.iname || r.line.name,
            unit: r.line.unit || "",
            requested: r.qty,
            available: r.qty - res.shortfall,
            short: res.shortfall,
          });
        }
        changedBatches[r.iid] = res.batches;
        lines[r.iid] = {
          pulled: r.qty,
          pulledAt,
          priceAtPull: r.qty > 0 ? res.cost / r.qty : 0,
          pullCost: res.cost,
          consumed: res.consumed,
          // Only read for a line being created. An orphan line keeps the
          // `planned` it was approved with, so pulling past it still reports as
          // over-plan (supabase/52); a topped-up line has its `planned` raised
          // to the new total by the RPC rather than by anything sent from here
          // (supabase/57), so the client never gets to decide what a job is
          // approved for.
          ...(r.isNew ? { planned: r.qty } : {}),
        };
      }

      // Pulling past on-hand is allowed — the roof still needs doing and the
      // count is sometimes just stale. But it has to be a decision, not a side
      // effect discovered afterwards in a toast. Checked on the FRESH batches.
      if (shortRows.length > 0 && !shortAcked) {
        setShortWarn(shortRows);
        setSaving(false);
        return;
      }

      const { data, error } = await supabase.rpc("add_and_pull_job_materials", {
        p_job_id: job.id,
        p_lines: lines,
        p_batches: changedBatches,
        p_by_name: displayNameOf(activeUser),
        p_reason: reason.trim() || null,
      });
      if (error) throw error;

      // The RPC is the authority on what the lines now look like — it builds each
      // new line from the inventory row, not from what was sent — so the added
      // ones are taken from its reply rather than rebuilt here.
      //
      // The stamp is rebuilt in the server's SHAPE, not as a bare flag: anything
      // reading it expects an object (`addedAfterPull.at`, `.byName`), and a
      // `true` here would be a different type until the next page load replaced
      // it. The timestamp is this device's rather than the transaction's, which
      // is close enough for a list that is about to be re-read anyway.
      const stamp = {
        by: activeUser.id,
        byName: displayNameOf(activeUser),
        reason: reason.trim() || null,
        at: new Date().toISOString(),
      };
      const pulledByIid = new Map((data?.pulls || []).map((p) => [p.iid, p]));
      // Taken from the reply, NOT from `lines`. What was sent is a delta — "pull
      // 9 more" — so spreading it over the line would show 9 pulled where 15
      // went out, and would do it only until the next read, which is the kind of
      // wrong number somebody acts on. Every quantity below is the server's.
      const existing = (job.items || job.materials || []).map((i) => {
        const p = i && pulledByIid.get(i.iid);
        if (!p) return i;
        const topUp = Boolean(p.topUp);
        // Falls back to what was sent for the window where this app is deployed
        // and supabase/57 has not been applied yet: 52's reply carries only
        // { iid, pulled }, so reading `planned` off it would blank the line's
        // approved quantity on screen. `prevPulled` is the field that tells the
        // two replies apart, and under 52 a top-up cannot reach here at all —
        // the RPC refuses it — so the fallback only ever covers the orphan path,
        // where what was sent IS the new total.
        const sent = lines[i.iid] || {};
        const authoritative = p.prevPulled !== undefined;
        return {
          ...i,
          pulled: authoritative ? p.pulled : sent.pulled,
          planned: p.planned ?? i.planned,
          pulledAt: p.pulledAt ?? sent.pulledAt,
          priceAtPull: p.priceAtPull ?? sent.priceAtPull,
          pullCost: p.pullCost ?? sent.pullCost,
          consumed: p.consumed ?? sent.consumed,
          // A top-up leaves `addedAfterPull` as it was — the line joined the job
          // whenever it joined it — and records itself in `toppedUp` instead, in
          // the array shape 57 writes so a second one appends rather than
          // erasing the first.
          ...(topUp
            ? {
                toppedUp: [
                  ...(Array.isArray(i.toppedUp) ? i.toppedUp : []),
                  {
                    ...stamp,
                    qty: p.qty,
                    prevPulled: p.prevPulled,
                    newPulled: p.pulled,
                    prevPlanned: p.prevPlanned,
                  },
                ],
              }
            : { addedAfterPull: stamp }),
        };
      });
      const fresh = (data?.added || []).map((a) => ({
        ...a,
        returned: 0,
        pulledAt,
        priceAtPull: lines[a.iid]?.priceAtPull ?? 0,
        pullCost: lines[a.iid]?.pullCost ?? 0,
        consumed: lines[a.iid]?.consumed ?? [],
        addedAfterPull: stamp,
      }));
      const updatedItems = [...existing, ...fresh];
      const updatedJob = { ...job, items: updatedItems, materials: updatedItems };

      const addedCount = (data?.added || []).length;
      const topUpCount = reqs.filter((r) => r.isTopUp).length;
      await logAction(
        activeUser.id,
        activeUser.email,
        "INVENTORY_PULL",
        `Added and pulled ${reqs.length} material line${reqs.length === 1 ? "" : "s"} for PO ${job.po || "n/a"} (${job.title || job.name || "Untitled job"}) after the job was already pulled${addedCount > 0 ? `, ${addedCount} of them new to the job` : ""}${topUpCount > 0 ? `, ${topUpCount} added on top of a line that had already been pulled` : ""}.${
          shortRows.length
            ? ` Went short on ${shortRows.map((r) => `${r.name} (${r.short} ${r.unit})`.trim()).join(", ")}. Stock is now negative, check the count.`
            : ""
        }`,
        {
          job_id: job.id,
          po: job.po || null,
          reason: reason.trim() || null,
          lines: reqs.map((r) => ({
            item: r.line.iname || r.line.name,
            qty: r.qty,
            unit: r.line.unit || "",
            new_to_job: r.isNew,
            // What "qty" means for this row: added to a line that already had a
            // pull, rather than being the whole of it.
            top_up: r.isTopUp,
            ...(r.isTopUp ? { previously_pulled: r.line.pulled || 0 } : {}),
          })),
          short: shortRows.map((r) => ({ item: r.name, qty: r.short, unit: r.unit })),
        },
        "production",
      );

      // Pulls are the main way stock drops below threshold — alert the opted-in
      // managers when this one crosses an item's alert line.
      sendLowStockAlerts(
        Object.entries(changedBatches)
          .map(([iid, batches]) => {
            const item = (inv || []).find((i) => i.id === iid);
            return item
              ? {
                  item,
                  prevTotal: tot({ batches: freshById.get(iid) || [] }),
                  newTotal: tot({ batches }),
                }
              : null;
          })
          .filter(Boolean),
        users,
        showToast,
      );

      if (shortRows.length > 0) {
        showToast(
          t.pullShortStock.replace(
            "{items}",
            shortRows.map((r) => `${r.name} (${r.short} ${r.unit})`.trim()).join(", "),
          ),
          "warning",
        );
      } else {
        showToast(t.pullAddMatSaved, "success");
      }
      setPlanWarn(null);
      setShortWarn(null);
      onSaved?.(updatedJob, changedBatches);
    } catch (err) {
      console.error("Failed to add and pull job materials:", err);
      showToast(`${t.pullAddMatFail} ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const nothingToDo = orphans.length === 0 && topUps.length === 0 && added.length === 0;

  // ── The two held confirmations ──────────────────────────────────────────────
  // Rendered instead of the dialog rather than on top of it: both are a question
  // about what is in the form behind them, and stacking two modals on a phone in
  // a truck leaves no room to read either.
  if (planWarn) {
    return (
      <Modal
        title={t.pullPlanTitle}
        onClose={() => {
          if (!saving) setPlanWarn(null);
        }}
      >
        <Callout tone="warn" bordered pad="12px 14px" style={{ marginBottom: 14 }}>
          <Row
            gap={2}
            style={{
              fontWeight: "var(--weight-bold)",
              color: C.gold,
              marginBottom: 4,
              fontSize: "var(--text-base)",
            }}
          >
            <AlertTriangle size={14} aria-hidden="true" /> {t.pullPlanHeading}
          </Row>
          <Text size="sm" color={C.navy} style={{ lineHeight: 1.45 }}>
            {t.pullPlanBody}
          </Text>
        </Callout>

        <div className="sw-table-scroll">
          <Table pad="md" size="base" tableStyle={{ marginBottom: 14 }}>
            <thead>
              <tr>
                {[t.colItem, t.colPlanned, t.colActualPull, t.pullPlanColIssue].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {planWarn.map((r) => (
                <tr key={r.iid}>
                  <Text as="td" weight="bold" color={C.navy}>
                    {r.name}
                  </Text>
                  <td>
                    {r.planned} {r.unit}
                  </td>
                  <td>
                    {r.actual} {r.unit}
                  </td>
                  <td>
                    <Bdg color={r.kind === "over" ? "amber" : "red"}>
                      {r.kind === "off_plan" ? t.pullPlanOffPlan : t.pullPlanOver}
                    </Bdg>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <Muted style={{ marginBottom: 14, lineHeight: 1.45 }}>{t.pullPlanFootnote}</Muted>

        <Row gap={4} align="stretch">
          <Btn
            v="ghost"
            onClick={() => setPlanWarn(null)}
            disabled={saving}
            style={{ flex: 1, justifyContent: "center" }}
          >
            {t.pullPlanCancel}
          </Btn>
          <Btn
            v="gold"
            onClick={() => {
              setPlanWarn(null);
              commit({ planAcked: true });
            }}
            disabled={saving}
            style={{ flex: 1, justifyContent: "center" }}
          >
            {t.pullPlanProceed}
          </Btn>
        </Row>
      </Modal>
    );
  }

  // Deliberately the same dialog, wording and threshold the initial pull uses —
  // the same keys, not a second set of strings saying the same thing. Going
  // negative means the same thing whichever button started the pull, and two
  // descriptions of it would drift.
  if (shortWarn) {
    return (
      <Modal
        title={t.pullShortTitle}
        onClose={() => {
          if (!saving) setShortWarn(null);
        }}
      >
        <Callout tone="danger" bordered pad="12px 14px" style={{ marginBottom: 14 }}>
          <Row
            gap={2}
            style={{
              fontWeight: "var(--weight-bold)",
              color: C.rd,
              marginBottom: 4,
              fontSize: "var(--text-base)",
            }}
          >
            <AlertTriangle size={14} aria-hidden="true" /> {t.pullShortHeading}
          </Row>
          <Text size="sm" color={C.navy} style={{ lineHeight: 1.45 }}>
            {t.pullShortBody}
          </Text>
        </Callout>

        <div className="sw-table-scroll">
          <Table pad="md" size="base" tableStyle={{ marginBottom: 14 }}>
            <thead>
              <tr>
                {[t.colItem, t.colOnHand, t.colActualPull, t.colShortBy].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shortWarn.map((r) => (
                <tr key={r.iid}>
                  <Text as="td" weight="bold" color={C.navy}>
                    {r.name}
                  </Text>
                  <td>
                    {r.available} {r.unit}
                  </td>
                  <td>
                    {r.requested} {r.unit}
                  </td>
                  <Text as="td" weight="black" color={C.rd}>
                    −{r.short} {r.unit}
                  </Text>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <Muted style={{ marginBottom: 14, lineHeight: 1.45 }}>{t.pullShortFootnote}</Muted>

        <Row gap={4} align="stretch">
          <Btn
            v="ghost"
            onClick={() => setShortWarn(null)}
            disabled={saving}
            style={{ flex: 1, justifyContent: "center" }}
          >
            {t.pullShortCancel}
          </Btn>
          {/* planAcked carries forward: the plan dialog was already passed to get
              here, and dropping it would re-raise it behind this one. */}
          <Btn
            v="gold"
            onClick={() => {
              setShortWarn(null);
              commit({ planAcked: true, shortAcked: true });
            }}
            disabled={saving}
            style={{ flex: 1, justifyContent: "center" }}
          >
            {saving ? t.pullInProgress : t.pullShortProceed}
          </Btn>
        </Row>
      </Modal>
    );
  }

  return (
    <Modal
      title={`${t.pullAddMatTitle} — ${job.po || "No PO"}`}
      onClose={close}
      wide
      footer={
        <>
          <Btn
            v="ghost"
            onClick={close}
            style={{ flex: 1, justifyContent: "center" }}
            disabled={saving}
          >
            {t.cancel}
          </Btn>
          <Btn
            v="teal"
            sz="lg"
            onClick={() => commit()}
            style={{ flex: 2, justifyContent: "center" }}
            disabled={saving || nothingToDo}
          >
            <Truck size={14} aria-hidden="true" />{" "}
            {saving ? t.pullAddMatSaving : t.pullAddMatConfirm}
          </Btn>
        </>
      }
    >
      <Text as="p" size="sm" color={C.sub} style={{ marginTop: 0, lineHeight: 1.45 }}>
        {t.pullAddMatInfo}
      </Text>

      {/* ── Lines already on the job that nothing has gone out for ───────────
          Listed first because they are the cheaper fix: the line is already
          approved, so pulling it needs no judgement about the plan. */}
      {orphans.length > 0 && (
        <>
          <Text
            as="h4"
            size="sm"
            weight="extrabold"
            color={C.navy}
            style={{ margin: "16px 0 8px", textTransform: "uppercase" }}
          >
            {t.pullAddMatOnJob}
          </Text>
          <div className="sw-table-scroll">
            <Table pad="md">
              <thead>
                <tr>
                  {[t.colItem, t.colPlanned, t.colAvailable, t.colActualPull].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orphans.map((line) => {
                  const avail = availOf(line.iid);
                  const short = num(orphanQtys[line.iid]) > avail;
                  return (
                    <tr key={line.iid} style={{ background: short ? C.rB : "transparent" }}>
                      <Text as="td" weight="bold" color={C.navy}>
                        {line.iname || line.name}
                      </Text>
                      <td>
                        {line.planned || line.qty || 0} {line.unit || ""}
                      </td>
                      <Text as="td" weight="bold" color={short ? C.rd : C.gr}>
                        {avail} {line.unit || ""}
                        {short && (
                          <AlertTriangle
                            size={11}
                            style={{ marginLeft: 4, verticalAlign: -1 }}
                            aria-hidden="true"
                          />
                        )}
                      </Text>
                      <td>
                        <Inp
                          type="number"
                          min="0"
                          aria-label={`${t.colActualPull} — ${line.iname || line.name}`}
                          value={orphanQtys[line.iid] ?? ""}
                          onChange={(e) =>
                            setOrphanQtys((p) => ({ ...p, [line.iid]: e.target.value }))
                          }
                          disabled={saving}
                          style={{ width: 80, padding: "4px 8px" }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}

      {/* ── Lines already pulled, which the roof needs more of ───────────────
          The reported case, and until supabase/57 the one this dialog had no
          row for at all. The box is the amount to ADD, left empty so opening
          the dialog cannot send anything out, and the row shows what is already
          pulled beside it so "9 more" never has to be worked out as "15 total"
          in someone's head — which is the arithmetic the old two-step
          workaround made them do, standing on a roof. */}
      {topUps.length > 0 && (
        <>
          <Text
            as="h4"
            size="sm"
            weight="extrabold"
            color={C.navy}
            style={{ margin: "18px 0 8px", textTransform: "uppercase" }}
          >
            {t.pullAddMatPulled}
          </Text>
          <Muted as="p" size="sm" style={{ margin: "0 0 8px", lineHeight: 1.45 }}>
            {t.pullAddMatPulledInfo}
          </Muted>
          <div className="sw-table-scroll">
            <Table pad="md">
              <thead>
                <tr>
                  {[
                    t.colItem,
                    t.pullAddMatAlreadyPulled,
                    t.colAvailable,
                    t.pullAddMatAddMore,
                    t.pullAddMatNewTotal,
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topUps.map((line) => {
                  const avail = availOf(line.iid);
                  const extra = num(topUpQtys[line.iid]);
                  const short = extra > avail;
                  return (
                    <tr key={line.iid} style={{ background: short ? C.rB : "transparent" }}>
                      <Text as="td" weight="bold" color={C.navy}>
                        {line.iname || line.name}
                      </Text>
                      <td>
                        {line.pulled || 0} {line.unit || ""}
                      </td>
                      <Text as="td" weight="bold" color={short ? C.rd : C.gr}>
                        {avail} {line.unit || ""}
                        {short && (
                          <AlertTriangle
                            size={11}
                            style={{ marginLeft: 4, verticalAlign: -1 }}
                            aria-hidden="true"
                          />
                        )}
                      </Text>
                      <td>
                        <Inp
                          type="number"
                          min="0"
                          placeholder="0"
                          aria-label={`${t.pullAddMatAddMore} — ${line.iname || line.name}`}
                          value={topUpQtys[line.iid] ?? ""}
                          onChange={(e) =>
                            setTopUpQtys((p) => ({ ...p, [line.iid]: e.target.value }))
                          }
                          disabled={saving}
                          style={{ width: 80, padding: "4px 8px" }}
                        />
                      </td>
                      {/* Shown only once something is typed: a "new total" that
                          equals what is already pulled reads as a quantity this
                          dialog is about to send out again. */}
                      <Text as="td" weight={extra > 0 ? "bold" : "normal"} color={C.sub}>
                        {extra > 0 ? `${(line.pulled || 0) + extra} ${line.unit || ""}` : "—"}
                      </Text>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}

      {/* ── Material not on the job at all ──────────────────────────────────── */}
      <Text
        as="h4"
        size="sm"
        weight="extrabold"
        color={C.navy}
        style={{ margin: "18px 0 8px", textTransform: "uppercase" }}
      >
        {t.pullAddMatNew}
      </Text>

      <Stack gap={2} style={{ marginBottom: 10 }}>
        {added.length === 0 ? (
          <Muted as="p" size="sm" style={{ margin: 0 }}>
            {t.pullAddMatNoneAdded}
          </Muted>
        ) : (
          added.map((a) => {
            const avail = availOf(a.id);
            const short = num(a.qty) > avail;
            return (
              <Row
                key={a.id}
                style={{
                  background: short ? C.rB : C.lg,
                  borderRadius: 7,
                  padding: "7px 10px",
                }}
              >
                <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" weight="bold" color={C.navy}>
                    {a.name}
                  </Text>
                  <Row gap={1} style={{ fontSize: "var(--text-2xs)", color: short ? C.rd : C.sub }}>
                    {short && <AlertTriangle size={10} aria-hidden="true" />}
                    {t.colAvailable}: {avail} {a.unit || ""}
                  </Row>
                </Stack>
                <Inp
                  type="number"
                  min="0"
                  aria-label={`${t.colActualPull} — ${a.name}`}
                  value={a.qty}
                  onChange={(e) => setAddedQty(a.id, e.target.value)}
                  disabled={saving}
                  style={{ width: 70, padding: "4px 8px" }}
                />
                <Muted as="span" style={{ width: 50 }}>
                  {a.unit}
                </Muted>
                <TextBtn
                  onClick={() => dropAdded(a.id)}
                  disabled={saving}
                  color={C.rd}
                  weight="normal"
                  size="lg"
                  style={{ lineHeight: 1, padding: "1px 6px" }}
                  aria-label={`${t.cancel} ${a.name}`}
                >
                  ×
                </TextBtn>
              </Row>
            );
          })
        )}
      </Stack>

      <Fld label={t.pullAddMaterial}>
        <Inp
          prefix={<Search size={13} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.pullSearchInv}
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
          {offerable.length === 0 ? (
            <Muted size="sm" style={{ padding: 10, textAlign: "center" }}>
              {t.pullNoMatchingInv}
            </Muted>
          ) : (
            offerable.map((item) => (
              <Row
                key={item.id}
                gap={0}
                justify="space-between"
                style={{ padding: "8px 10px", borderBottom: `1px solid ${C.lg}` }}
              >
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <Text as="span" size="sm" weight="bold" color={C.navy}>
                    {item.name}
                  </Text>
                  <Muted size="xs">
                    {t.colAvailable}: {tot(item)} {item.unit || ""}
                  </Muted>
                </Stack>
                <Btn v="primary" sz="sm" onClick={() => addItem(item)} disabled={saving}>
                  <Plus size={12} aria-hidden="true" /> {t.pullAddMatAdd}
                </Btn>
              </Row>
            ))
          )}
        </Card>
      )}

      {/* Optional, and stored on every line this call touches (supabase/52's
          `addedAfterPull` stamp) rather than only in audit_logs, which is purged
          at 30 days. It is the answer to "why did this job need more material",
          asked months later by somebody reconciling the margin. */}
      <Fld label={t.pullAddMatReason} hint={t.pullAddMatReasonHint}>
        <TA value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving} rows={2} />
      </Fld>

      {nothingToDo && (
        <Muted as="p" size="sm" style={{ margin: "4px 0 0", lineHeight: 1.45 }}>
          {t.pullAddMatNothing}
        </Muted>
      )}
    </Modal>
  );
}
