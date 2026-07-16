// src/views/AuditLogView.jsx
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { Bdg, Sel, Inp, Btn, LoadingState } from "../components/UIPrimitives";

export default function AuditLogView({ perms, inv = [], users = [] }) {
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

  const nameOf = (id) => users.find((u) => u.id === id)?.name || "Unknown";

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
          ref: b.ref || "",
          vendor: b.vendor || "",
          // Five different things live in `batches`, and only one of them is a supplier
          // delivery. Flagging a missing PO on a return or a shortfall would bury the
          // receipts that genuinely lack one, so classify before judging:
          //   shortfall  — doFifo's synthetic negative row when a pull exceeds stock
          //   adjustment — Adjust Stock's correction row
          //   return     — pull screen re-entry (bare uid(), priced at the job's blend)
          //   price-only — Edit Materials' qty:0 row, created to hold a price
          //   receipt    — an actual delivery; the only kind that owes a PO/vendor
          kind: b.short || b.by === "system"
            ? "shortfall"
            : b.ref === "Manual Adjustment"
              ? "adjustment"
              : !String(b.id || "").startsWith("b_")
                ? "return"
                : (parseFloat(b.qty) || 0) === 0
                  ? "price-only"
                  : "receipt",
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
      return [r.itemName, r.ref, r.vendor, nameOf(r.by)].some((v) =>
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
  }, [actionFilter, retryTick]);

  const filteredLogs = useMemo(() => {
    // user_email/description can be null on system-generated entries — an
    // unguarded .toLowerCase() here crashed the whole view on search.
    return logs.filter(
      (l) =>
        search === "" ||
        (l.user_email || "").toLowerCase().includes(search.toLowerCase()) ||
        (l.description || "").toLowerCase().includes(search.toLowerCase()) ||
        (l.warehouse_code || "").toLowerCase().includes(search.toLowerCase()),
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
          🏭 Audit Logs
        </h2>
        <p style={{ margin: "10px 0 16px", color: C.sub, fontSize: "var(--text-sm)" }}>
          System-wide compliance event tracking. Administrative view only.
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
            placeholder="Filter by email, keywords, or facility..."
            style={{ flex: 1, minWidth: 240 }}
          />
          <Sel
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{ width: 220 }}
          >
            <option value="all">All Action Classes</option>
            <option value="LOGIN">LOGIN</option>
            <option value="LOGOUT">LOGOUT</option>
            <option value="INVENTORY_PULL">INVENTORY_PULL</option>
            <option value="INV_MUTATION">INV_MUTATION</option>
            <option value="PERM_CHANGE">PERM_CHANGE</option>
            <option value="INVENTORY_ADJUST">INVENTORY_ADJUST</option>
            <option value="FLEET_STATUS_CHANGE">FLEET_STATUS_CHANGE</option>
            <option value="MAINTENANCE_REQUEST_CREATE">MAINTENANCE_REQUEST_CREATE</option>
            <option value="JOB_BUILD_CREATE">JOB_BUILD_CREATE</option>
          </Sel>
        </div>
      )}

      {mode === "batches" ? (
        <div>
          <div style={{ display: "flex", gap: "var(--space-5)", marginBottom: 16, flexWrap: "wrap" }}>
            <Inp
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search item, PO/invoice, supplier, or who received it..."
              style={{ flex: 1, minWidth: 240 }}
            />
            <Sel value={ledgerWho} onChange={(e) => setLedgerWho(e.target.value)} style={{ width: 220 }}>
              <option value="all">Anyone</option>
              {ledgerPeople.map((id) => (
                <option key={id} value={id}>{nameOf(id)}</option>
              ))}
            </Sel>
          </div>

          <p style={{ margin: "0 0 12px", color: C.sub, fontSize: "var(--text-xs)" }}>
            {filteredLedger.length} of {ledger.length} receipts · sourced from the batches themselves, so
            this survives the 30-day log purge.
          </p>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)" }}>
              <thead>
                <tr style={{ textAlign: "left", color: C.sub, textTransform: "uppercase" }}>
                  {["Date", "Item", "Qty", "Remaining", ...(perms?.inv_pricing_view ? ["Unit Price", "Value"] : []), "Received By", "Invoice / PO", "Supplier"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", fontSize: "var(--text-2xs)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLedger.map((r) => {
                  const unpriced = r.price === 0 && r.rem > 0;
                  const isReceipt = r.kind === "receipt";
                  const tag = { shortfall: ["pulled short", C.rd], adjustment: ["stock adjustment", C.am], return: ["returned", C.am], "price-only": ["price entry", C.sub] }[r.kind];
                  return (
                    <tr key={r.key} style={{ borderTop: `1px solid ${C.lg}` }}>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: C.sub }}>{r.rcvd}</td>
                      <td style={{ padding: "8px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>
                        {r.itemName}
                        {tag && <span style={{ color: tag[1], fontWeight: "normal" }}> · {tag[0]}</span>}
                      </td>
                      <td style={{ padding: "8px 10px" }}>{r.qty} {r.unit}</td>
                      <td style={{ padding: "8px 10px", color: r.rem === 0 ? C.sub : C.gr, fontWeight: "var(--weight-bold)" }}>{r.rem}</td>
                      {perms?.inv_pricing_view && (
                        <>
                          <td style={{ padding: "8px 10px", color: unpriced ? C.rd : C.blue, fontWeight: "var(--weight-bold)", whiteSpace: "nowrap" }}>
                            ${r.price.toFixed(2)}{unpriced && " ⚠️"}
                          </td>
                          <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>${(r.rem * r.price).toFixed(2)}</td>
                        </>
                      )}
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: r.kind === "shortfall" ? C.sub : C.navy }}>
                        {r.kind === "shortfall" ? "system" : nameOf(r.by)}
                      </td>
                      {/* Only a real delivery owes a PO/vendor — everything else has none by nature. */}
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", color: r.ref ? C.navy : isReceipt ? C.rd : C.sub }}>
                        {r.ref || (isReceipt ? "missing" : "—")}
                      </td>
                      <td style={{ padding: "8px 10px", color: r.vendor ? C.navy : isReceipt ? C.rd : C.sub }}>
                        {r.vendor || (isReceipt ? "missing" : "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredLedger.length === 0 && (
              <p style={{ color: C.sub, fontSize: "var(--text-sm)", padding: "16px 0" }}>No receipts match.</p>
            )}
          </div>
        </div>
      ) : loading ? (
        <LoadingState label="Streaming audit packets..." />
      ) : loadError ? (
        <div style={{ background: "#fee2e2", border: "1.5px solid #ef4444", borderRadius: "var(--radius-lg)", padding: "24px", textAlign: "center", color: "#991b1b" }}>
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
                    "Warehouse",
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
                      <td style={{ padding: "12px 10px", fontWeight: "var(--weight-semibold)" }}>
                        🏭 {l.warehouse_code || "SJR"}
                      </td>
                      <td style={{ padding: "12px 10px", color: "#334155", lineHeight: 1.4 }}>
                        {l.description}
                      </td>
                      <td style={{ padding: "12px 10px" }}>
                        {l.payload && Object.keys(l.payload).length > 0 ? (
                          <button
                            onClick={() => setActivePayload(l.payload)}
                            style={{
                              background: "none",
                              border: "none",
                              color: C.blue,
                              fontWeight: "var(--weight-bold)",
                              cursor: "pointer",
                              fontSize: "var(--text-sm)",
                            }}
                          >
                            [{Object.keys(l.payload).length} keys]
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
                      No matching historical logs found matching specified query conditions.
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
                ◀ Prev
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
                Next ▶
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
              background: "#ffffff",
              borderRadius: "var(--radius-xl)",
              padding: 24,
              maxWidth: 500,
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
            }}
          >
            <h4 style={{ margin: "0 0 12px 0", color: C.navy, fontSize: 15 }}>
              Structural Payload Trace Inspector
            </h4>
            <div
              style={{
                background: "#1e293b",
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
                  color: "#38bdf8",
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
                background: C.navy,
                color: "#fff",
                border: "none",
                borderRadius: "var(--radius-sm)",
                fontWeight: "var(--weight-bold)",
                cursor: "pointer",
              }}
            >
              Close Inspector
            </button>
          </div>
        </div>
      )}
    </div>
  );
}