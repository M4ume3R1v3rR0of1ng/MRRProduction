// src/components/OmniSearch.jsx
import { useState, useRef, useEffect } from "react";
import { C } from "../utils/helpers";

export default function OmniSearch({
  jobs = [],
  users = [],
  vehs = [],
  reqs = [],
  inv = [],
  onNavigate,
  onInventorySearch,
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close the drop-down naturally if an operator clicks away
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── 🔍 THE SEARCH FILTER MATRIX ──
  const getFilteredResults = () => {
    const txt = query.trim().toLowerCase();
    if (!txt) return null;

    return {
      // 🏗️ 1. Pipeline Contracts
      jobs: jobs
        .filter(
          (j) =>
            j.name?.toLowerCase().includes(txt) ||
            j.poNumber?.toLowerCase().includes(txt) ||
            j.address?.toLowerCase().includes(txt),
        )
        .slice(0, 3),

      // 👥 2. Corporate Team Members
      users: users
        .filter(
          (u) =>
            u.full_name?.toLowerCase().includes(txt) ||
            u.email?.toLowerCase().includes(txt) ||
            u.role?.toLowerCase().includes(txt),
        )
        .slice(0, 3),

      // 🚛 3. Fleet Operations Registry
      vehicles: vehs
        .filter(
          (v) =>
            v.make?.toLowerCase().includes(txt) ||
            v.model?.toLowerCase().includes(txt) ||
            v.plates?.toLowerCase().includes(txt) ||
            v.assigned_to?.toLowerCase().includes(txt),
        )
        .slice(0, 3),

      // 🔧 4. Maintenance Work Orders
      requests: reqs
        .filter(
          (r) =>
            r.issue?.toLowerCase().includes(txt) ||
            r.status?.toLowerCase().includes(txt) ||
            r.priority?.toLowerCase().includes(txt),
        )
        .slice(0, 3),

      // 📦 5. Warehouse Inventory Metrics
      inventory: inv
        .filter(
          (i) =>
            i.name?.toLowerCase().includes(txt) ||
            i.sku?.toLowerCase().includes(txt) ||
            i.cat?.toLowerCase().includes(txt),
        )
        .slice(0, 3),
    };
  };

  const results = getFilteredResults();
  const hasResults =
    results && Object.values(results).some((arr) => arr.length > 0);

  const handleSelection = (targetView) => {
    onNavigate(targetView);
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      {/* Search Input field */}
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Search jobs, staff, trucks, tickets, materials..."
        style={{
          width: "100%",
          padding: "10px 14px 10px 12px",
          borderRadius: "8px",
          border: `1px solid ${C.bd || "#cbd5e1"}`,
          background: "#f8fafc",
          fontSize: "13px",
          fontWeight: "var(--weight-semibold)",
          color: C.navy,
          outline: "none",
          transition: "all 0.2s",
        }}
      />

      {/* ── 🗺️ RECONSTRUCTED INTERACTION RESULT PANEL ── */}
      {isOpen && results && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "#ffffff",
            borderRadius: "12px",
            boxShadow: "0 12px 32px rgba(15, 23, 42, 0.15)",
            border: "1px solid #e2e8f0",
            maxHeight: "420px",
            overflowY: "auto",
            zIndex: 1100,
            padding: "8px 0",
          }}
        >
          {hasResults ? (
            <>
              {/* 🏗️ Category Block: Jobs Pipeline */}
              {results.jobs.length > 0 && (
                <div>
                  <div
                    style={{
                      padding: "6px 14px",
                      fontSize: "11px",
                      fontWeight: "var(--weight-bold)",
                      color: "#64748b",
                      textTransform: "uppercase",
                      background: "#f8fafc",
                    }}
                  >
                    🏗️ Pipeline Contracts
                  </div>
                  {results.jobs.map((j) => (
                    <div
                      key={j.id}
                      onClick={() => handleSelection("pull")}
                      style={{
                        padding: "10px 14px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "#0f172a",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.target.style.background = "#f1f5f9")
                      }
                      onMouseLeave={(e) =>
                        (e.target.style.background = "transparent")
                      }
                    >
                      <div style={{ fontWeight: "var(--weight-semibold)" }}>{j.name}</div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        PO: {j.poNumber || "N/A"} · {j.address}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 👥 Category Block: Users / Staff */}
              {results.users.length > 0 && (
                <div>
                  <div
                    style={{
                      padding: "6px 14px",
                      fontSize: "11px",
                      fontWeight: "var(--weight-bold)",
                      color: "#64748b",
                      textTransform: "uppercase",
                      background: "#f8fafc",
                    }}
                  >
                    👥 Staff & Profiles
                  </div>
                  {results.users.map((u) => (
                    <div
                      key={u.id}
                      onClick={() => handleSelection("users")}
                      style={{
                        padding: "10px 14px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "#0f172a",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.target.style.background = "#f1f5f9")
                      }
                      onMouseLeave={(e) =>
                        (e.target.style.background = "transparent")
                      }
                    >
                      <div style={{ fontWeight: "var(--weight-semibold)" }}>{u.full_name}</div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        {u.email} ·{" "}
                        <span style={{ textTransform: "capitalize" }}>
                          {u.role}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 🚛 Category Block: Vehicles */}
              {results.vehicles.length > 0 && (
                <div>
                  <div
                    style={{
                      padding: "6px 14px",
                      fontSize: "11px",
                      fontWeight: "var(--weight-bold)",
                      color: "#64748b",
                      textTransform: "uppercase",
                      background: "#f8fafc",
                    }}
                  >
                    🚛 Fleet Vehicles
                  </div>
                  {results.vehicles.map((v) => (
                    <div
                      key={v.id}
                      onClick={() => handleSelection("fleet")}
                      style={{
                        padding: "10px 14px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "#0f172a",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.target.style.background = "#f1f5f9")
                      }
                      onMouseLeave={(e) =>
                        (e.target.style.background = "transparent")
                      }
                    >
                      <div style={{ fontWeight: "var(--weight-semibold)" }}>
                        {v.make} {v.model}
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        Plates: {v.plates || "No Plate Info"} · Driver:{" "}
                        {v.assigned_to || "Unassigned"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 🔧 Category Block: Maintenance Tickets */}
              {results.requests.length > 0 && (
                <div>
                  <div
                    style={{
                      padding: "6px 14px",
                      fontSize: "11px",
                      fontWeight: "var(--weight-bold)",
                      color: "#64748b",
                      textTransform: "uppercase",
                      background: "#f8fafc",
                    }}
                  >
                    🔧 Maintenance Tickets
                  </div>
                  {results.requests.map((r) => (
                    <div
                      key={r.id}
                      onClick={() => handleSelection("requests")}
                      style={{
                        padding: "10px 14px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "#0f172a",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.target.style.background = "#f1f5f9")
                      }
                      onMouseLeave={(e) =>
                        (e.target.style.background = "transparent")
                      }
                    >
                      <div style={{ fontWeight: "var(--weight-semibold)" }}>{r.issue}</div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        Status:{" "}
                        <span
                          style={{
                            textTransform: "uppercase",
                            fontWeight: "var(--weight-bold)",
                          }}
                        >
                          {r.status}
                        </span>{" "}
                        · Priority: {r.priority}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 📦 Category Block: Inventory Stock */}
              {results.inventory.length > 0 && (
                <div>
                  <div
                    style={{
                      padding: "6px 14px",
                      fontSize: "11px",
                      fontWeight: "var(--weight-bold)",
                      color: "#64748b",
                      textTransform: "uppercase",
                      background: "#f8fafc",
                    }}
                  >
                    📦 Materials & Inventory
                  </div>
                  {results.inventory.map((i) => (
                    <div
                      key={i.id}
                      onClick={() => {
                        // 1. Force the layout navigator tab to switch over to Inventory
                        onNavigate("inventory");
                        // 2. Push the item name up into the global search state
                        if (typeof onInventorySearch === "function") {
                          onInventorySearch(i.name);
                        }
                        setQuery("");
                        setIsOpen(false);
                      }}
                      style={{
                        padding: "10px 14px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "#0f172a",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.target.style.background = "#f1f5f9")
                      }
                      onMouseLeave={(e) =>
                        (e.target.style.background = "transparent")
                      }
                    >
                      <div style={{ fontWeight: "var(--weight-semibold)" }}>{i.name}</div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        Category: {i.cat || "General"} · SKU: {i.sku || "N/A"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div
              style={{ padding: "20px", textAlign: "center", color: "#94a3b8" }}
            >
              No results found for "<strong>{query}</strong>"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
