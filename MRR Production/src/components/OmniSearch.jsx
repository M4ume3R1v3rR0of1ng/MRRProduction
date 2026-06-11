// src/components/OmniSearch.jsx
import { useState, useMemo, useRef, useEffect } from "react";
import { C, tot, fm } from "../utils/helpers";

export default function OmniSearch({ jobs = [], inv = [], vehs = [], onNavigate }) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Close dropdown cleanly if clicking completely outside the element wrapper
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // High-performance search cross-referencing across multiple distinct state vectors simultaneously
  const results = useMemo(() => {
    const txt = query.toLowerCase().trim();
    if (txt.length < 2) return { jobs: [], inventory: [], vehicles: [] };

    return {
      jobs: jobs.filter(j => 
        (j?.name || "").toLowerCase().includes(txt) || 
        (j?.po || "").toLowerCase().includes(txt) || 
        (j?.addr || "").toLowerCase().includes(txt)
      ).slice(0, 4), // Limit results so the dropdown stays clean and compact

      inventory: inv.filter(i => 
        (i?.name || "").toLowerCase().includes(txt) || 
        (i?.cat || "").toLowerCase().includes(txt)
      ).slice(0, 4),

      vehicles: vehs.filter(v => 
        (v?.name || "").toLowerCase().includes(txt) || 
        (v?.plate || "").toLowerCase().includes(txt) || 
        (v?.make || "").toLowerCase().includes(txt)
      ).slice(0, 4)
    };
  }, [query, jobs, inv, vehs]);

  const hasResults = results.jobs.length > 0 || results.inventory.length > 0 || results.vehicles.length > 0;

  const handleSelect = (targetView) => {
    onNavigate(targetView);
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%", maxWidth: "420px" }}>
      {/* Universal Search Input */}
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
        onFocus={() => setIsOpen(true)}
        placeholder="🔍 Search jobs, materials, trucks ..."
        style={{
          width: "100%",
          padding: "10px 14px 10px 36px",
          borderRadius: "8px",
          border: `1px solid ${C.bd || "#cbd5e1"}`,
          background: "#f8fafc",
          fontSize: "12px",
          fontWeight: 600,
          color: C.navy,
          outline: "none",
          transition: "all 0.2s"
        }}
      />

      {/* Floating Global Results Dashboard Overlay Menu */}
      {isOpen && query.trim().length >= 2 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          background: C.w || "#ffffff",
          borderRadius: "10px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
          border: "1px solid rgba(0,0,0,0.08)",
          marginTop: "6px",
          maxHeight: "420px",
          overflowY: "auto",
          zIndex: 9999,
          padding: "8px 0"
        }}>
          {!hasResults ? (
            <div style={{ padding: "16px", textAlign: "center", color: C.sub, fontSize: "12px" }}>
              ❌ No records matched "<strong>{query}</strong>"
            </div>
          ) : (
            <>
              {/* CATEGORY TIER 1: ACTIVE PIPELINE PROJECTS */}
              {results.jobs.length > 0 && (
                <div>
                  <div style={{ background: C.lg || "#f1f5f9", padding: "4px 12px", fontSize: "10px", fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>🏗️ Active Roofing Projects</div>
                  {results.jobs.map(j => (
                    <div key={j.id} onClick={() => handleSelect("buildjobs")} style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }} className="search-row-hover">
                      <div style={{ fontWeight: 700, color: C.navy, fontSize: "12px" }}>{j.name}</div>
                      <div style={{ fontSize: "10px", color: C.sub }}>PO: {j.po} · <span style={{color: C.am}}>{j.status}</span></div>
                    </div>
                  ))}
                </div>
              )}

              {/* CATEGORY TIER 2: WAREHOUSE MATERIALS STOCK */}
              {results.inventory.length > 0 && (
                <div style={{ marginTop: "6px" }}>
                  <div style={{ background: C.lg || "#f1f5f9", padding: "4px 12px", fontSize: "10px", fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>📦 Warehouse Inventory Catalog</div>
                  {results.inventory.map(i => (
                    <div key={i.id} onClick={() => handleSelect("inventory")} style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }} className="search-row-hover">
                      <div style={{ fontWeight: 700, color: C.navy, fontSize: "12px" }}>{i.name}</div>
                      <div style={{ fontSize: "10px", color: C.sub }}>Stock: <strong style={{color: tot(i) <= i.alrt ? C.rd : C.gr}}>{tot(i)} {i.unit}</strong> · {i.cat}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* CATEGORY TIER 3: COMPANY VEHICLES & TRAILERS */}
              {results.vehicles.length > 0 && (
                <div style={{ marginTop: "6px" }}>
                  <div style={{ background: C.lg || "#f1f5f9", padding: "4px 12px", fontSize: "10px", fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>🚛 Fleet Tracker Assets</div>
                  {results.vehicles.map(v => (
                    <div key={v.id} onClick={() => handleSelect("fleet")} style={{ padding: "8px 12px", cursor: "pointer" }} className="search-row-hover">
                      <div style={{ fontWeight: 700, color: C.navy, fontSize: "12px" }}>{v.name} <span style={{fontWeight: 400, color: C.sub}}>({v.yr} {v.make})</span></div>
                      <div style={{ fontSize: "10px", color: C.sub }}>Plate: #{v.plate} · Tagged: {v.type}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Basic CSS Inject for Smooth Row Hover Highlight Effects */}
      <style>{`
        .search-row-hover:hover { background: #f8fafc !important; }
      `}</style>
    </div>
  );
}