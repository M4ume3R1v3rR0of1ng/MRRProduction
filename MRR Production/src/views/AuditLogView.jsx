// src/views/AuditLogView.jsx
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { Bdg, Sel, Inp, Btn } from "../components/UIPrimitives";

export default function AuditLogView({ perms }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [activePayload, setActivePayload] = useState(null);

  // ── 🆕 PAGINATION STATE ───────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  useEffect(() => {
    async function loadLogs() {
      setLoading(true);
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
      } finally {
        setLoading(false);
      }
    }
    loadLogs();
  }, [actionFilter]);

  const filteredLogs = useMemo(() => {
    return logs.filter(
      (l) =>
        search === "" ||
        l.user_email.toLowerCase().includes(search.toLowerCase()) ||
        l.description.toLowerCase().includes(search.toLowerCase()) ||
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
        borderRadius: 12,
        padding: 24,
        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: C.navy }}>
          🏭 Audit Logs
        </h2>
        <p style={{ margin: "3px 0 16px", color: C.sub, fontSize: 12 }}>
          System-wide compliance event tracking. Administrative view only.
        </p>
      </div>

      <div
        style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}
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

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: C.sub }}>
          Streaming audit packets...
        </div>
      ) : (
        <>
          {/* ── 🆕 COMPACT INNER SCROLLBAR CONTAINER ────────────────────────── */}
          <div style={{ 
            overflowX: "auto", 
            maxHeight: "600px", 
            overflowY: "auto", 
            border: `1px solid ${C.lg}`,
            borderRadius: "8px",
            marginBottom: "16px"
          }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
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
                        fontWeight: 700,
                        fontSize: 11,
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
                    <tr key={l.id} style={{ borderBottom: `1px solid ${C.lg}`, background: C.w }}>
                      <td style={{ padding: "12px 10px", whiteSpace: "nowrap", color: C.sub }}>
                        {formatFullTimestamp(l.created_at)}
                      </td>
                      <td style={{ padding: "12px 10px", fontWeight: 700, color: C.navy }}>
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
                      <td style={{ padding: "12px 10px", fontWeight: 600 }}>
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
                              fontWeight: 700,
                              cursor: "pointer",
                              fontSize: 12,
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
            <div style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>
              Showing {filteredLogs.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}–
              {Math.min(currentPage * ITEMS_PER_PAGE, filteredLogs.length)} of {filteredLogs.length} events
            </div>
            
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <Btn 
                v="ghost" 
                sz="sm" 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                ◀ Prev
              </Btn>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.navy, padding: "0 8px" }}>
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
              borderRadius: 12,
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
                borderRadius: 8,
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
                  fontSize: 11,
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
                borderRadius: 6,
                fontWeight: 700,
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