// src/views/AuditLogView.jsx
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../utils/supabase";
import { C, batchKind } from "../utils/helpers";
import { Bdg, Sel, Inp, Btn, SkeletonTable } from "../components/UIPrimitives";

import { translations } from "../utils/translations";
import { ACTION_TYPES } from "../utils/logger";
import { makePersonResolver, personLabel } from "../utils/people";

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
          // Shared with the monthly reconciliation (utils/inventoryCounts) so both
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

  // ── 🆕 PAGINATION STATE ───────────────────────────────────────────────────
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
        if (actionFilter !== "all")
          query = query.eq("action_type", actionFilter);

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
      ].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [logs, search]);

  // ── 🆕 COMPUTE PAGINATED DATA SET ─────────────────────────────────────────
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
        <h2 style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: "var(--weight-black)", color: C.navy }}>
          {t.alHeading}
        </h2>
        <p style={{ margin: "10px 0 16px", color: C.sub, fontSize: "var(--text-sm)" }}>
          {t.alSubtitle}
        </p>
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: 16, borderBottom: `2px solid ${C.bd}` }}>
        {[
          ["logs", "📜 Activity Log", "Every action — last 30 days only"],
          ["batches", "📦 Batch Ledger", "Every inventory receipt, permanently"],
        ].map(([k, label, hint]) => (
          <button
            key={k}
            onClick={() => { setMode(k); setSearch(""); setCurrentPage(1); }}
            title={hint}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "8px 14px",
              fontSize: "var(--text-sm)", fontWeight: "var(--weight-extrabold)",
              color: mode === k ? C.navy : C.sub,
              borderBottom: mode === k ? `3px solid ${C.gold}` : "3px solid transparent",
              marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "logs" && (
        <div
          style={{ display: "flex", gap: "var(--space-5)", marginBottom: 16, flexWrap: "wrap" }}
        >
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
              <option key={a} value={a}>{a}</option>
            ))}
          </Sel>
        </div>
      )}

      {mode === "batches" ? (
        <div>
          <div style={{ display: "flex", gap: "var(--space-5)", marginBottom: 16, flexWrap: "wrap" }}>
            <Inp
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.alReceiptSearchPlaceholder}
              style={{ flex: 1, minWidth: 240 }}
            />
            <Sel value={ledgerWho} onChange={(e) => setLedgerWho(e.target.value)} style={{ width: 220 }}>
              <option value="all">{t.alAnyone}</option>
              {ledgerPeople.map((id) => (
                <option key={id} value={id}>{nameOf(id)}</option>
              ))}
            </Sel>
          </div>

          <p style={{ margin: "0 0 8px", color: C.sub, fontSize: "var(--text-xs)" }}>
            {filteredLedger.length} of {ledger.length} rows · sourced from the batches themselves, so
            this survives the 30-day log purge.
          </p>

          {/* The ledger is not a list of deliveries, which is what most people
              assume from the column headers. Five different kinds of row live in
              it and they mean opposite things — a "shortfall" is material leaving
              on a job, sitting in the same table as material arriving from a
              supplier. Saying so up front is cheaper than the support call. */}
          <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-xs)", color: C.sub, lineHeight: 1.6 }}>
            <strong style={{ color: C.navy }}>{t.alLegendTitle}</strong>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: C.navy, fontWeight: "var(--weight-bold)" }}>{t.alLegendReceiptName}</span> {t.alLegendReceipt}<br />
              <span style={{ color: C.am, fontWeight: "var(--weight-bold)" }}>{t.alTagReturn}</span> {t.alLegendReturn}<br />
              <span style={{ color: C.am, fontWeight: "var(--weight-bold)" }}>{t.alTagAdjust}</span> {t.alLegendAdjust}<br />
              <span style={{ color: C.sub, fontWeight: "var(--weight-bold)" }}>{t.alTagPrice}</span> {t.alLegendPrice}<br />
              <span style={{ color: C.rd, fontWeight: "var(--weight-bold)" }}>{t.alTagShort}</span> {t.alLegendShort}
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)" }}>
              <thead>
                <tr style={{ textAlign: "left", color: C.sub, textTransform: "uppercase" }}>
                  {["Date", "Item", "Qty", "Remaining", ...(perms?.inv_pricing_view ? ["Unit Price", "Value"] : []), t.alColWho, t.alColRef, "Supplier"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", fontSize: "var(--text-2xs)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLedger.map((r) => {
                  const unpriced = r.price === 0 && r.rem > 0;
                  const isReceipt = r.kind === "receipt";
                  const isShort = r.kind === "shortfall";
                  const tag = { shortfall: [t.alTagShort, C.rd], adjustment: [t.alTagAdjust, C.am], return: [t.alTagReturn, C.am], "price-only": [t.alTagPrice, C.sub] }[r.kind];
                  // A shortfall row is not a delivery, so the person on it is
                  // whoever PULLED past the shelf, not whoever received stock.
                  const person = personOf(r.by, r.byName);
                  return (
                    <tr key={r.key} style={{ borderTop: `1px solid ${C.lg}`, background: isShort ? C.rB : "transparent" }}>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: C.sub }}>{r.rcvd}</td>
                      <td style={{ padding: "8px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>
                        {r.itemName}
                        {tag && <span style={{ color: tag[1], fontWeight: "normal" }}> · {tag[0]}</span>}
                      </td>
                      <td style={{ padding: "8px 10px" }}>{r.qty} {r.unit}</td>
                      <td style={{ padding: "8px 10px", color: r.rem === 0 ? C.sub : r.rem < 0 ? C.rd : C.gr, fontWeight: "var(--weight-bold)" }}>{r.rem}</td>
                      {perms?.inv_pricing_view && (
                        <>
                          <td style={{ padding: "8px 10px", color: unpriced ? C.rd : C.blue, fontWeight: "var(--weight-bold)", whiteSpace: "nowrap" }}>
                            ${r.price.toFixed(2)}{unpriced && " ⚠️"}
                          </td>
                          <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>${(r.rem * r.price).toFixed(2)}</td>
                        </>
                      )}
                      <td
                        style={{ padding: "8px 10px", whiteSpace: "nowrap", color: person.tone, fontStyle: person.muted ? "italic" : "normal" }}
                        title={person.title || undefined}
                      >
                        {isShort ? `${t.alPulledBy} ${person.label}` : person.label}
                      </td>
                      {/* Only a real delivery owes a PO/vendor — everything else has none by nature.
                          A shortfall now carries the job it was pulled for, which is
                          the whole point: the audit_logs entry naming that job is
                          deleted at 30 days, and this row is not. */}
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", color: r.ref ? (isShort ? C.rd : C.navy) : isReceipt ? C.rd : C.sub }}>
                        {r.ref || (isReceipt ? t.alMissing : isShort ? t.alJobNotRecorded : "—")}
                      </td>
                      <td style={{ padding: "8px 10px", color: r.vendor ? C.navy : isReceipt ? C.rd : C.sub }}>
                        {r.vendor || (isReceipt ? t.alMissing : "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredLedger.length === 0 && (
              <p style={{ color: C.sub, fontSize: "var(--text-sm)", padding: "16px 0" }}>{t.alNoReceipts}</p>
            )}
          </div>
        </div>
      ) : loading ? (
        <SkeletonTable rows={8} cols={["24%", "20%", "16%", "16%", "24%"]} label={t.alLoadingHistory} />
      ) : loadError ? (
        <div style={{ background: "var(--c-rust-wash)", border: "1.5px solid var(--c-rust)", borderRadius: "var(--radius-lg)", padding: "24px", textAlign: "center", color: "var(--c-rust)" }}>
          <div style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-bold)", marginBottom: 6 }}>
            ⚠️ Couldn't load the audit history
          </div>
          <div style={{ fontSize: "var(--text-sm)", marginBottom: 14 }}>
            The log below is NOT empty — it just couldn't be fetched. ({loadError})
          </div>
          <Btn v="primary" sz="sm" onClick={() => setRetryTick((t) => t + 1)}>🔄 Retry</Btn>
        </div>
      ) : (
        <>
          {/* ── 🆕 COMPACT INNER SCROLLBAR CONTAINER ────────────────────────── */}
          <div style={{ 
            overflowX: "auto", 
            maxHeight: "850px", 
            overflowY: "auto", 
            border: `1px solid ${C.lg}`,
            borderRadius: "8px",
            marginBottom: "16px"
          }}>
            <table
              className="mrr-table"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "var(--text-base)",
                textAlign: "left",
              }}
            >
              <thead style={{ position: "sticky", top: 0, zIndex: 1, background: C.lg }}>
                <tr style={{ borderBottom: `2px solid ${C.bd}` }}>
                  {[
                    "Timestamp",
                    "Operator",
                    "Action Type",
                    t.alColWhere,
                    "Activity Log narrative",
                    "Inspect",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "12px 10px",
                        color: C.sub,
                        fontWeight: "var(--weight-bold)",
                        fontSize: "var(--text-xs)",
                        textTransform: "uppercase",
                      }}
                    >
                      {h}
                    </th>
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
                      <td style={{ padding: "12px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>
                        {l.user_email}
                      </td>
                      <td style={{ padding: "12px 10px" }}>
                        <Bdg
                          color={
                            l.action_type === "PERM_CHANGE"
                              ? "purple"
                              : l.action_type === "INV_MUTATION" || l.action_type === "INVENTORY_ADJUST"
                                ? "amber"
                                : l.action_type === "JOB_BUILD_CREATE"
                                  ? "blue"
                                  : l.action_type === "FLEET_STATUS_CHANGE" || l.action_type === "MAINTENANCE_REQUEST_CREATE"
                                    ? "rose"
                                    : "teal"
                          }
                        >
                          {l.action_type}
                        </Bdg>
                      </td>
                      <td style={{ padding: "12px 10px", fontWeight: "var(--weight-semibold)", whiteSpace: "nowrap" }}>
                        {whereOf(l)}
                      </td>
                      <td style={{ padding: "12px 10px", color: "var(--c-barnwood)", lineHeight: 1.4 }}>
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
                          <span style={{ color: C.sub }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "32px 0", color: C.sub, fontStyle: "italic" }}>
                      {t.alNoLogs}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── 🆕 PAGINATION CONTROLS BOTTOM BAR ─────────────────────────── */}
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center", 
            paddingTop: 8,
            flexWrap: "wrap",
            gap: 12
          }}>
            <div style={{ fontSize: "var(--text-sm)", color: C.sub, fontWeight: "var(--weight-semibold)" }}>
              Showing {filteredLogs.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}–
              {Math.min(currentPage * ITEMS_PER_PAGE, filteredLogs.length)} of {filteredLogs.length} events
            </div>
            
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <Btn 
                v="ghost" 
                sz="sm" 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                {t.alPrev}
              </Btn>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy, padding: "0 8px" }}>
                Page {currentPage} of {totalPages}
              </span>
              <Btn 
                v="ghost" 
                sz="sm" 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                {t.alNext}
              </Btn>
            </div>
          </div>
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
            <h4 style={{ margin: "0 0 12px 0", color: C.navy, fontSize: 15 }}>
              {t.alInspectorTitle}
            </h4>

            {/* A raw JSON dump is the right escape hatch and the wrong default.
                For a pull, the questions are "what went out" and "did anything go
                short", so answer those in plain rows and keep the JSON below for
                anything this does not know how to render. */}
            {activePayload.job_name && (
              <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: 12, fontSize: "var(--text-sm)" }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>
                  {activePayload.po ? `PO ${activePayload.po} · ` : ""}{activePayload.job_name}
                </div>
              </div>
            )}

            {Array.isArray(activePayload.lines) && activePayload.lines.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", color: C.sub, fontWeight: "var(--weight-bold)", marginBottom: 4 }}>
                  {t.alDetailMaterials}
                </div>
                <div style={{ maxHeight: 160, overflowY: "auto" }}>
                  {activePayload.lines.map((ln, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", borderBottom: `1px solid ${C.lg}`, fontSize: "var(--text-sm)" }}>
                      <span style={{ color: C.navy, fontWeight: "var(--weight-semibold)" }}>{ln.item}</span>
                      <span style={{ color: C.sub, whiteSpace: "nowrap" }}>
                        {ln.qty} {ln.unit}
                        {ln.planned != null && ln.planned !== ln.qty ? ` (${t.alPlannedWas} ${ln.planned})` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(activePayload.short) && activePayload.short.length > 0 && (
              <div style={{ background: C.rB, border: `1.5px solid ${C.rd}`, borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.rd, fontSize: "var(--text-sm)", marginBottom: 4 }}>
                  ⚠️ {t.alDetailShort}
                </div>
                {activePayload.short.map((s, i) => (
                  <div key={i} style={{ fontSize: "var(--text-sm)", color: C.navy }}>
                    {s.item}: {t.alDetailShortBy} {s.short} {s.unit}
                  </div>
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