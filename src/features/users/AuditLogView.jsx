// src/features/users/AuditLogView.jsx
import { useState, useEffect, useMemo } from "react";
import { ScrollText, Package, AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { C, batchKind } from "@/shared/utils/helpers";
import {
  Bdg,
  Sel,
  Inp,
  Btn,
  SkeletonTable,
  Row,
  Text,
  Muted,
} from "@/shared/components/UIPrimitives";

import { translations } from "@/shared/utils/translations";
import { ACTION_TYPES } from "@/shared/utils/logger";
import { makePersonResolver, personLabel } from "@/shared/utils/people";

export default function AuditLogView({ perms, inv = [], users = [], companyId, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed fetch must not render as "no history" — that reads as innocence.
  const [loadError, setLoadError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [activePayload, setActivePayload] = useState(null);

  // Two different records, deliberately kept apart:
  //
  //   "logs"    — audit_logs. Every action, but a ROLLING 30-DAY WINDOW: 03_functions
  //               hard-deletes anything older. It cannot answer questions about last
  //               quarter's delivery, because the answer has been erased.
  //   "batches" — inventory.batches. Who received what, when, at what price, under
  //               which PO. Lives on the row itself, so it outlives the purge and is
  //               the only durable provenance the app has.
  const [mode, setMode] = useState("logs");
  const [ledgerWho, setLedgerWho] = useState("all");

  // Resolving a person id to a name. See utils/people for why "Unknown" was
  // covering three different faults, including a pre-Auth id that still belongs
  // to someone who works here.
  const resolve = useMemo(() => makePersonResolver(users), [users]);
  const personOf = (id, stampedName) => {
    const p = resolve(id, stampedName);
    const label = personLabel(p, t);
    const known = p.kind === "member" || p.kind === "legacy" || p.kind === "stamped";
    return {
      label,
      tone: known ? C.navy : p.kind === "unknown" ? C.am : C.sub,
      muted: !known,
      // The raw id on hover, so an unresolved row can be chased rather than shrugged at.
      title: known ? undefined : p.id || undefined,
    };
  };
  const nameOf = (id) => personOf(id).label;

  const ledger = useMemo(() => {
    const rows = [];
    for (const item of inv || []) {
      for (const b of item.batches || []) {
        rows.push({
          key: `${item.id}__${b.id}`,
          itemId: item.id,
          itemName: item.name,
          unit: item.unit,
          rcvd: b.rcvd,
          qty: parseFloat(b.qty) || 0,
          rem: parseFloat(b.rem) || 0,
          price: parseFloat(b.price) || 0,
          by: b.by,
          // The name recorded on the row itself, for rows written since
          // batches started carrying it. Survives the person being deleted.
          byName: b.byName || null,
          ref: b.ref || "",
          vendor: b.vendor || "",
          jobId: b.jobId || null,
          // Shared with the monthly reconciliation (features/inventory/inventoryCounts) so both
          // read the batch list the same way. It also fixes the adjustment test,
          // which used to compare `ref` for exact equality and therefore missed
          // every correction that had a reason typed into it.
          kind: batchKind(b),
        });
      }
    }
    return rows.sort((a, b) => new Date(b.rcvd) - new Date(a.rcvd));
  }, [inv]);

  const ledgerPeople = useMemo(
    () => [...new Set(ledger.map((r) => r.by).filter(Boolean))],
    [ledger],
  );

  const filteredLedger = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledger.filter((r) => {
      if (ledgerWho !== "all" && r.by !== ledgerWho) return false;
      if (!q) return true;
      return [r.itemName, r.ref, r.vendor, personOf(r.by, r.byName).label].some((v) =>
        (v || "").toLowerCase().includes(q),
      );
    });
  }, [ledger, search, ledgerWho, users]);

  // ── PAGINATION STATE ───────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  useEffect(() => {
    async function loadLogs() {
      setLoading(true);
      setLoadError(null);
      try {
        let query = supabase
          .from("audit_logs")
          .select("*")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(200);
        if (actionFilter !== "all") query = query.eq("action_type", actionFilter);

        const { data, error } = await query;
        if (error) throw error;
        setLogs(data || []);
        setCurrentPage(1); // Reset to page 1 on filter changes
      } catch (err) {
        console.error("Audit view failed to fetch records:", err);
        setLoadError(err.message || "Request failed");
        setLogs([]);
      } finally {
        setLoading(false);
      }
    }
    loadLogs();
    // companyId belongs here. The query filters on it, so without it a switch
    // between companies (or a companyId that resolves after first paint) left the
    // previous tenant's log on screen with no refetch.
  }, [actionFilter, retryTick, companyId]);

  // Where an action was taken. logger.js records this as metadata.active_view.
  //
  // This column used to read `l.warehouse_code`, a column NOTHING writes, and fell
  // back to a hardcoded "SJR" — so every row on every tenant's screen claimed to
  // have happened in one particular Maumee River warehouse. It was not merely
  // uninformative, it was wrong, and it leaked one company's warehouse code to all
  // the others. Replaced with the screen the action came from, which is real data
  // and answers the question people were actually asking of that column.
  const VIEW_LABELS = {
    pull: "Pull Inventory",
    inventory: "Inventory",
    production: "Build Jobs",
    login: "Sign in",
    system_core: "—",
  };
  const whereOf = (l) => {
    const v = l?.metadata?.active_view;
    if (!v) return "—";
    return VIEW_LABELS[v] || v.replace(/_/g, " ");
  };

  const filteredLogs = useMemo(() => {
    // user_email/description can be null on system-generated entries — an
    // unguarded .toLowerCase() here crashed the whole view on search.
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l) =>
      [
        l.user_email,
        l.description,
        l.action_type,
        whereOf(l),
        // The job a pull belongs to lives in the metadata, and searching by PO is
        // the first thing anyone tries when tracing where material went.
        l.metadata?.po,
        l.metadata?.job_name,
      ].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [logs, search]);

  // ── COMPUTE PAGINATED DATA SET ─────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / ITEMS_PER_PAGE));

  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredLogs.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredLogs, currentPage]);

  const formatFullTimestamp = (rawDateString) => {
    if (!rawDateString) return "—";
    const date = new Date(rawDateString);

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  return (
    <div
      style={{
        background: C.w,
        borderRadius: "var(--radius-xl)",
        padding: 24,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div>
        <Text as="h2" size="xl" weight="black" color={C.navy} style={{ margin: 0 }}>
          {t.alHeading}
        </Text>
        <Muted as="p" size="sm" style={{ margin: "10px 0 16px" }}>
          {t.alSubtitle}
        </Muted>
      </div>

      <Row gap={2} align="stretch" style={{ marginBottom: 16, borderBottom: `2px solid ${C.bd}` }}>
        {[
          ["logs", ScrollText, "Activity Log", "Every action — last 30 days only"],
          ["batches", Package, "Batch Ledger", "Every inventory receipt, permanently"],
        ].map(([k, Icon, label, hint]) => (
          <button
            key={k}
            onClick={() => {
              setMode(k);
              setSearch("");
              setCurrentPage(1);
            }}
            title={hint}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "8px 14px",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-extrabold)",
              color: mode === k ? C.navy : C.sub,
              borderBottom: mode === k ? `3px solid ${C.gold}` : "3px solid transparent",
              marginBottom: -2,
            }}
          >
            <Icon size={14} aria-hidden="true" /> {label}
          </button>
        ))}
      </Row>

      {mode === "logs" && (
        <Row gap={5} align="stretch" wrap style={{ marginBottom: 16 }}>
          <Inp
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1); // Snap back to page 1 during keyword mutation searches
            }}
            placeholder={t.alFilterPlaceholder}
            style={{ flex: 1, minWidth: 240 }}
          />
          <Sel
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{ width: 220 }}
          >
            <option value="all">{t.alAllActionClasses}</option>
            {/* Exactly the action types logAction is actually called with, taken
                from the call sites. The old list offered INVENTORY_ADJUST, which
                no code path has ever written (Adjust Stock logs INV_MUTATION), so
                selecting it returned an empty table forever and read as "nobody
                has ever adjusted stock". It also omitted six types that ARE
                written, including every JOB_BUILD_* event. */}
            {ACTION_TYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Sel>
        </Row>
      )}

      {mode === "batches" ? (
        <div>
          <Row gap={5} align="stretch" wrap style={{ marginBottom: 16 }}>
            <Inp
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.alReceiptSearchPlaceholder}
              style={{ flex: 1, minWidth: 240 }}
            />
            <Sel
              value={ledgerWho}
              onChange={(e) => setLedgerWho(e.target.value)}
              style={{ width: 220 }}
            >
              <option value="all">{t.alAnyone}</option>
              {ledgerPeople.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id)}
                </option>
              ))}
            </Sel>
          </Row>

          <Muted as="p" style={{ margin: "0 0 8px" }}>
            {filteredLedger.length} of {ledger.length} rows · sourced from the batches themselves,
            so this survives the 30-day log purge.
          </Muted>

          {/* The ledger is not a list of deliveries, which is what most people
              assume from the column headers. Five different kinds of row live in
              it and they mean opposite things — a "shortfall" is material leaving
              on a job, sitting in the same table as material arriving from a
              supplier. Saying so up front is cheaper than the support call. */}
          <div
            style={{
              background: C.lg,
              borderRadius: "var(--radius-md)",
              padding: "10px 14px",
              marginBottom: 14,
              fontSize: "var(--text-xs)",
              color: C.sub,
              lineHeight: 1.6,
            }}
          >
            <Text as="strong" color={C.navy}>
              {t.alLegendTitle}
            </Text>
            <div style={{ marginTop: 4 }}>
              <Text as="span" weight="bold" color={C.navy}>
                {t.alLegendReceiptName}
              </Text>{" "}
              {t.alLegendReceipt}
              <br />
              <Text as="span" weight="bold" color={C.am}>
                {t.alTagReturn}
              </Text>{" "}
              {t.alLegendReturn}
              <br />
              <Text as="span" weight="bold" color={C.am}>
                {t.alTagAdjust}
              </Text>{" "}
              {t.alLegendAdjust}
              <br />
              <Text as="span" weight="bold" color={C.sub}>
                {t.alTagPrice}
              </Text>{" "}
              {t.alLegendPrice}
              <br />
              <Text as="span" weight="bold" color={C.rd}>
                {t.alTagShort}
              </Text>{" "}
              {t.alLegendShort}
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)" }}
            >
              <thead>
                <tr style={{ textAlign: "left", color: C.sub, textTransform: "uppercase" }}>
                  {[
                    "Date",
                    "Item",
                    "Qty",
                    "Remaining",
                    ...(perms?.inv_pricing_view ? ["Unit Price", "Value"] : []),
                    t.alColWho,
                    t.alColRef,
                    "Supplier",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 10px",
                        fontSize: "var(--text-2xs)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLedger.map((r) => {
                  const unpriced = r.price === 0 && r.rem > 0;
                  const isReceipt = r.kind === "receipt";
                  const isShort = r.kind === "shortfall";
                  const tag = {
                    shortfall: [t.alTagShort, C.rd],
                    adjustment: [t.alTagAdjust, C.am],
                    return: [t.alTagReturn, C.am],
                    "price-only": [t.alTagPrice, C.sub],
                  }[r.kind];
                  // A shortfall row is not a delivery, so the person on it is
                  // whoever PULLED past the shelf, not whoever received stock.
                  const person = personOf(r.by, r.byName);
                  return (
                    <tr
                      key={r.key}
                      style={{
                        borderTop: `1px solid ${C.lg}`,
                        background: isShort ? C.rB : "transparent",
                      }}
                    >
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: C.sub }}>
                        {r.rcvd}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          fontWeight: "var(--weight-bold)",
                          color: C.navy,
                        }}
                      >
                        {r.itemName}
                        {tag && (
                          <Text as="span" weight="normal" color={tag[1]}>
                            {" "}
                            · {tag[0]}
                          </Text>
                        )}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        {r.qty} {r.unit}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          color: r.rem === 0 ? C.sub : r.rem < 0 ? C.rd : C.gr,
                          fontWeight: "var(--weight-bold)",
                        }}
                      >
                        {r.rem}
                      </td>
                      {perms?.inv_pricing_view && (
                        <>
                          <td
                            style={{
                              padding: "8px 10px",
                              color: unpriced ? C.rd : C.blue,
                              fontWeight: "var(--weight-bold)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            ${r.price.toFixed(2)}
                            {unpriced && (
                              <AlertTriangle
                                size={10}
                                style={{ marginLeft: 4, verticalAlign: -1 }}
                                aria-hidden="true"
                              />
                            )}
                          </td>
                          <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                            ${(r.rem * r.price).toFixed(2)}
                          </td>
                        </>
                      )}
                      <td
                        style={{
                          padding: "8px 10px",
                          whiteSpace: "nowrap",
                          color: person.tone,
                          fontStyle: person.muted ? "italic" : "normal",
                        }}
                        title={person.title || undefined}
                      >
                        {isShort ? `${t.alPulledBy} ${person.label}` : person.label}
                      </td>
                      {/* Only a real delivery owes a PO/vendor — everything else has none by nature.
                          A shortfall now carries the job it was pulled for, which is
                          the whole point: the audit_logs entry naming that job is
                          deleted at 30 days, and this row is not. */}
                      <td
                        style={{
                          padding: "8px 10px",
                          fontFamily: "monospace",
                          color: r.ref ? (isShort ? C.rd : C.navy) : isReceipt ? C.rd : C.sub,
                        }}
                      >
                        {r.ref || (isReceipt ? t.alMissing : isShort ? t.alJobNotRecorded : "—")}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          color: r.vendor ? C.navy : isReceipt ? C.rd : C.sub,
                        }}
                      >
                        {r.vendor || (isReceipt ? t.alMissing : "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredLedger.length === 0 && (
              <p style={{ color: C.sub, fontSize: "var(--text-sm)", padding: "16px 0" }}>
                {t.alNoReceipts}
              </p>
            )}
          </div>
        </div>
      ) : loading ? (
        <SkeletonTable
          rows={8}
          cols={["24%", "20%", "16%", "16%", "24%"]}
          label={t.alLoadingHistory}
        />
      ) : loadError ? (
        <div
          style={{
            background: "var(--c-rust-wash)",
            border: "1.5px solid var(--c-rust)",
            borderRadius: "var(--radius-lg)",
            padding: "24px",
            textAlign: "center",
            color: "var(--c-rust)",
          }}
        >
          <Row
            gap="7px"
            justify="center"
            style={{
              fontSize: "var(--text-md)",
              fontWeight: "var(--weight-bold)",
              marginBottom: 6,
            }}
          >
            <AlertTriangle size={16} aria-hidden="true" /> Couldn't load the audit history
          </Row>
          <Text size="sm" style={{ marginBottom: 14 }}>
            The log below is NOT empty — it just couldn't be fetched. ({loadError})
          </Text>
          <Btn v="primary" sz="sm" onClick={() => setRetryTick((t) => t + 1)}>
            <RefreshCw size={13} aria-hidden="true" /> Retry
          </Btn>
        </div>
      ) : (
        <>
          {/* ── COMPACT INNER SCROLLBAR CONTAINER ────────────────────────── */}
          <div
            style={{
              overflowX: "auto",
              maxHeight: "850px",
              overflowY: "auto",
              border: `1px solid ${C.lg}`,
              borderRadius: "8px",
              marginBottom: "16px",
            }}
          >
            <table
              className="mrr-table"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "var(--text-base)",
                textAlign: "left",
              }}
            >
              <thead className="mrr-thead-sticky">
                <tr style={{ borderBottom: `2px solid ${C.bd}` }}>
                  {[
                    "Timestamp",
                    "Operator",
                    "Action Type",
                    t.alColWhere,
                    "Activity Log narrative",
                    "Inspect",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedLogs.length > 0 ? (
                  paginatedLogs.map((l) => (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                      <td style={{ padding: "12px 10px", whiteSpace: "nowrap", color: C.sub }}>
                        {formatFullTimestamp(l.created_at)}
                      </td>
                      <td
                        style={{
                          padding: "12px 10px",
                          fontWeight: "var(--weight-bold)",
                          color: C.navy,
                        }}
                      >
                        {l.user_email}
                      </td>
                      <td style={{ padding: "12px 10px" }}>
                        <Bdg
                          color={
                            l.action_type === "PERM_CHANGE"
                              ? "purple"
                              : l.action_type === "INV_MUTATION" ||
                                  l.action_type === "INVENTORY_ADJUST"
                                ? "amber"
                                : l.action_type === "JOB_BUILD_CREATE"
                                  ? "blue"
                                  : l.action_type === "FLEET_STATUS_CHANGE" ||
                                      l.action_type === "MAINTENANCE_REQUEST_CREATE"
                                    ? "rose"
                                    : "teal"
                          }
                        >
                          {l.action_type}
                        </Bdg>
                      </td>
                      <td
                        style={{
                          padding: "12px 10px",
                          fontWeight: "var(--weight-semibold)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {whereOf(l)}
                      </td>
                      <td
                        style={{
                          padding: "12px 10px",
                          color: "var(--c-barnwood)",
                          lineHeight: 1.4,
                        }}
                      >
                        {l.description}
                      </td>
                      <td style={{ padding: "12px 10px" }}>
                        {/* `metadata`, not `payload`. logger.js has always written
                            this column as metadata; this button read `payload`,
                            which nothing writes, so it rendered "—" on every row
                            ever logged and the detail behind each action — the
                            item list, the quantities, the job — was recorded and
                            then permanently invisible. */}
                        {l.metadata && Object.keys(l.metadata).length > 0 ? (
                          <button
                            onClick={() => setActivePayload(l.metadata)}
                            style={{
                              background: "none",
                              border: "none",
                              color: C.blue,
                              fontWeight: "var(--weight-bold)",
                              cursor: "pointer",
                              fontSize: "var(--text-sm)",
                              textDecoration: "underline",
                            }}
                          >
                            {t.alViewDetail}
                          </button>
                        ) : (
                          <Text as="span" color={C.sub}>
                            —
                          </Text>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        textAlign: "center",
                        padding: "32px 0",
                        color: C.sub,
                        fontStyle: "italic",
                      }}
                    >
                      {t.alNoLogs}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── PAGINATION CONTROLS BOTTOM BAR ─────────────────────────── */}
          <Row gap={5} justify="space-between" wrap style={{ paddingTop: 8 }}>
            <Text size="sm" weight="semibold" color={C.sub}>
              Showing {filteredLogs.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}–
              {Math.min(currentPage * ITEMS_PER_PAGE, filteredLogs.length)} of {filteredLogs.length}{" "}
              events
            </Text>

            <Row gap={2}>
              <Btn
                v="ghost"
                sz="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                {t.alPrev}
              </Btn>
              <span
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-bold)",
                  color: C.navy,
                  padding: "0 8px",
                }}
              >
                Page {currentPage} of {totalPages}
              </span>
              <Btn
                v="ghost"
                sz="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                {t.alNext}
              </Btn>
            </Row>
          </Row>
        </>
      )}

      {/* JSON Payload Inspector Modal */}
      {activePayload && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 41, 74, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              background: "var(--c-surface)",
              borderRadius: "var(--radius-xl)",
              padding: 24,
              maxWidth: 500,
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
            }}
          >
            <Text as="h4" color={C.navy} style={{ margin: "0 0 12px 0", fontSize: 15 }}>
              {t.alInspectorTitle}
            </Text>

            {/* A raw JSON dump is the right escape hatch and the wrong default.
                For a pull, the questions are "what went out" and "did anything go
                short", so answer those in plain rows and keep the JSON below for
                anything this does not know how to render. */}
            {activePayload.job_name && (
              <div
                style={{
                  background: C.lg,
                  borderRadius: "var(--radius-md)",
                  padding: "10px 12px",
                  marginBottom: 12,
                  fontSize: "var(--text-sm)",
                }}
              >
                <Text weight="bold" color={C.navy}>
                  {activePayload.po ? `PO ${activePayload.po} · ` : ""}
                  {activePayload.job_name}
                </Text>
              </div>
            )}

            {Array.isArray(activePayload.lines) && activePayload.lines.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text
                  size="2xs"
                  weight="bold"
                  color={C.sub}
                  style={{ textTransform: "uppercase", marginBottom: 4 }}
                >
                  {t.alDetailMaterials}
                </Text>
                <div style={{ maxHeight: 160, overflowY: "auto" }}>
                  {activePayload.lines.map((ln, i) => (
                    <Row
                      key={i}
                      gap={5}
                      align="stretch"
                      justify="space-between"
                      style={{
                        padding: "4px 0",
                        borderBottom: `1px solid ${C.lg}`,
                        fontSize: "var(--text-sm)",
                      }}
                    >
                      <Text as="span" weight="semibold" color={C.navy}>
                        {ln.item}
                      </Text>
                      <Text as="span" color={C.sub} style={{ whiteSpace: "nowrap" }}>
                        {ln.qty} {ln.unit}
                        {ln.planned != null && ln.planned !== ln.qty
                          ? ` (${t.alPlannedWas} ${ln.planned})`
                          : ""}
                      </Text>
                    </Row>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(activePayload.short) && activePayload.short.length > 0 && (
              <div
                style={{
                  background: C.rB,
                  border: `1.5px solid ${C.rd}`,
                  borderRadius: "var(--radius-md)",
                  padding: "10px 12px",
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontWeight: "var(--weight-bold)",
                    color: C.rd,
                    fontSize: "var(--text-sm)",
                    marginBottom: 4,
                  }}
                >
                  <AlertTriangle size={13} aria-hidden="true" /> {t.alDetailShort}
                </div>
                {activePayload.short.map((s, i) => (
                  <Text key={i} size="sm" color={C.navy}>
                    {s.item}: {t.alDetailShortBy} {s.short} {s.unit}
                  </Text>
                ))}
              </div>
            )}

            <div
              style={{
                background: "var(--c-shell)",
                padding: 14,
                borderRadius: "var(--radius-md)",
                maxHeight: 300,
                overflowY: "auto",
                marginBottom: 16,
              }}
            >
              <pre
                style={{
                  margin: 0,
                  color: "var(--c-teal)",
                  fontFamily: "monospace",
                  fontSize: "var(--text-xs)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {JSON.stringify(activePayload, null, 2)}
              </pre>
            </div>
            <button
              onClick={() => setActivePayload(null)}
              style={{
                width: "100%",
                padding: "10px",
                background: C.shell,
                color: "var(--c-shell-ink)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                fontWeight: "var(--weight-bold)",
                cursor: "pointer",
              }}
            >
              {t.alCloseInspector}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
