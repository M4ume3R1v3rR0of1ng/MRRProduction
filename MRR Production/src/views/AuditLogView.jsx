// src/views/AuditLogView.jsx
import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { Bdg, Sel, Inp } from "../components/UIPrimitives";

export default function AuditLogView({ perms }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [activePayload, setActivePayload] = useState(null);

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
      } catch (err) {
        console.error("Audit view failed to fetch records:", err);
      } finally {
        setLoading(false);
      }
    }
    loadLogs();
  }, [actionFilter]);

  const filteredLogs = logs.filter(
    (l) =>
      search === "" ||
      l.user_email.toLowerCase().includes(search.toLowerCase()) ||
      l.description.toLowerCase().includes(search.toLowerCase()) ||
      (l.warehouse_code || "").toLowerCase().includes(search.toLowerCase()),
  );

  // 🕒 Custom timestamp formatter to include specific hours & minutes
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
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by email, keywords, or facility..."
          style={{ flex: 1, minWidth: 240 }}
        />
        <Sel
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          style={{ width: 200 }}
        >
          <option value="all">All Action Classes</option>
          <option value="LOGIN">LOGIN</option>
          <option value="LOGOUT">LOGOUT</option>
          <option value="INVENTORY_PULL">INVENTORY_PULL</option>
          <option value="INV_MUTATION">INV_MUTATION</option>
          <option value="PERM_CHANGE">PERM_CHANGE</option>
        </Sel>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: C.sub }}>
          Streaming audit packets...
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              textAlign: "left",
            }}
          >
            <thead>
              <tr
                style={{ background: C.lg, borderBottom: `2px solid ${C.bd}` }}
              >
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
              {filteredLogs.map((l) => (
                <tr key={l.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                  {/* Updated cell rendering with full timestamp detail */}
                  <td
                    style={{
                      padding: "12px 10px",
                      whiteSpace: "nowrap",
                      color: C.sub,
                    }}
                  >
                    {formatFullTimestamp(l.created_at)}
                  </td>
                  <td
                    style={{
                      padding: "12px 10px",
                      fontWeight: 700,
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
                          : l.action_type === "INV_MUTATION"
                            ? "amber"
                            : "teal"
                      }
                    >
                      {l.action_type}
                    </Bdg>
                  </td>
                  <td style={{ padding: "12px 10px", fontWeight: 600 }}>
                    🏭 {l.warehouse_code}
                  </td>
                  <td
                    style={{
                      padding: "12px 10px",
                      color: "#334155",
                      lineHeight: 1.4,
                    }}
                  >
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
              ))}
            </tbody>
          </table>
        </div>
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
