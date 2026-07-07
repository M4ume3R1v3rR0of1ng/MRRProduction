// src/components/OmniSearch.jsx
import { useState, useRef, useEffect, useMemo } from "react";
import { C } from "../utils/helpers";

// Case-insensitive match across any of the given string fields
const match = (txt, ...fields) =>
  fields.some((f) => typeof f === "string" && f.toLowerCase().includes(txt));

export default function OmniSearch({
  jobs = [],
  users = [],
  vehs = [],
  reqs = [],
  inv = [],
  perms = {},
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

  const handleSelection = (targetView) => {
    onNavigate(targetView);
    setQuery("");
    setIsOpen(false);
  };

  const userName = (id) => {
    const u = users.find((x) => x.id === id);
    return u?.full_name || u?.name || "";
  };

  const txt = query.trim().toLowerCase();

  // ── 🔍 THE SEARCH FILTER MATRIX ──
  // Every category is gated by the same permission that controls its page in
  // the Sidebar, so users only ever see results they are allowed to open.
  const results = useMemo(() => {
    if (!txt) return null;

    // Pages, mirroring the Sidebar's visibility rules
    const pages = [
      { id: "dashboard", icon: "🏠", label: "Dashboard", keywords: "home overview team chat", show: true },
      { id: "buildjobs", icon: "🏗️", label: "Build Jobs", keywords: "create job wizard acculynx close po", show: !!(perms.jobs_build || perms.jobs_close) },
      { id: "pull", icon: "📋", label: "Pull Inventory", keywords: "jobs pull materials return complete", show: true },
      { id: "inventory", icon: "📦", label: "Inventory", keywords: "stock materials receive batches sku", show: !!perms.inv_view },
      { id: "fleet", icon: "🚛", label: "Fleet", keywords: "trucks trailers vehicles mileage plates", show: !!perms.fleet_view },
      { id: "requests", icon: "🔧", label: "Maintenance", keywords: "requests tickets repair service oil", show: !!(perms.maint_submit || perms.maint_manage) },
      { id: "reports", icon: "📊", label: "Reports", keywords: "analytics costs charts export", show: !!perms.reports_view },
      { id: "users", icon: "👥", label: "Users", keywords: "staff team accounts profiles roles", show: !!perms.users_manage },
      { id: "logs", icon: "📜", label: "Audit Logs", keywords: "history activity audit trail", show: !!perms.users_manage },
      { id: "settings", icon: "⚙️", label: "Settings", keywords: "acculynx permissions api logo config", show: !!perms.settings_manage },
    ];

    return {
      // 🧭 0. Direct page navigation
      pages: pages
        .filter((p) => p.show && match(txt, p.label, p.keywords))
        .slice(0, 4),

      // 🏗️ 1. Jobs — rows may carry legacy (name/items) or current
      // (title/materials) column names, so check both. Material lines are
      // searchable too, so a job can be found by what's loaded on it.
      jobs: !perms.jobs_view
        ? []
        : jobs
            .filter((j) => {
              const lines = j.materials || j.items;
              return (
                match(txt, j.title, j.name, j.po, j.addr, j.notes, j.status, j.customer_name) ||
                (Array.isArray(lines) && lines.some((m) => match(txt, m.iname, m.icat)))
              );
            })
            .slice(0, 4),

      // 👥 2. Team members — only for user management
      users: !perms.users_manage
        ? []
        : users
            .filter((u) => match(txt, u.full_name, u.name, u.email, u.role, u.phone_number))
            .slice(0, 4),

      // 🚛 3. Fleet — only for fleet viewers
      vehicles: !perms.fleet_view
        ? []
        : vehs
            .filter((v) =>
              match(
                txt,
                v.name,
                v.plate,
                v.make,
                v.model,
                String(v.year || v.yr || ""),
                v.driver,
                userName(v.assignedTo),
                v.fuel_card,
                v.vehicle_class,
                v.type,
              ),
            )
            .slice(0, 4),

      // 🔧 4. Maintenance tickets — only for submit/manage
      requests: !(perms.maint_submit || perms.maint_manage)
        ? []
        : reqs
            .filter((r) => match(txt, r.type, r.vname, r.notes, r.urgency, r.status, r.uname))
            .slice(0, 4),

      // 📦 5. Inventory — only for inventory viewers
      inventory: !perms.inv_view
        ? []
        : inv
            .filter((i) => match(txt, i.name, i.cat, i.sku, i.unit))
            .slice(0, 4),
    };
  }, [txt, jobs, users, vehs, reqs, inv, perms]);

  const hasResults =
    results && Object.values(results).some((arr) => arr.length > 0);

  // ── 🗂️ CATEGORY RENDER CONFIG ──
  const sections = results
    ? [
        {
          key: "pages",
          header: "🧭 Go To",
          items: results.pages,
          title: (p) => `${p.icon} ${p.label}`,
          sub: () => "Open page",
          onClick: (p) => handleSelection(p.id),
        },
        {
          key: "jobs",
          header: "🏗️ Jobs",
          items: results.jobs,
          title: (j) => j.title || j.name || "Untitled Job",
          sub: (j) =>
            `PO: ${j.po || "N/A"} · ${j.addr || "No address"}${j.status ? ` · ${j.status}` : ""}`,
          onClick: () =>
            handleSelection(perms.jobs_build || perms.jobs_close ? "buildjobs" : "pull"),
        },
        {
          key: "users",
          header: "👥 Staff & Profiles",
          items: results.users,
          title: (u) => u.full_name || u.name || u.email,
          sub: (u) => `${u.email || "No email"} · ${u.role || "No role"}`,
          onClick: () => handleSelection("users"),
        },
        {
          key: "vehicles",
          header: "🚛 Fleet Vehicles",
          items: results.vehicles,
          title: (v) => v.name || `${v.make || ""} ${v.model || ""}`.trim() || "Vehicle",
          sub: (v) =>
            `Plate: ${v.plate || "—"} · Driver: ${v.driver || userName(v.assignedTo) || "Unassigned"}`,
          onClick: () => handleSelection("fleet"),
        },
        {
          key: "requests",
          header: "🔧 Maintenance Tickets",
          items: results.requests,
          title: (r) => `${r.type || "Request"}${r.vname ? ` — ${r.vname}` : ""}`,
          sub: (r) => `Status: ${(r.status || "?").toUpperCase()} · Urgency: ${r.urgency || "normal"}`,
          onClick: () => handleSelection("requests"),
        },
        {
          key: "inventory",
          header: "📦 Materials & Inventory",
          items: results.inventory,
          title: (i) => i.name,
          sub: (i) => `Category: ${i.cat || "General"} · Unit: ${i.unit || "—"}`,
          onClick: (i) => {
            onNavigate("inventory");
            if (typeof onInventorySearch === "function") {
              onInventorySearch(i.name);
            }
            setQuery("");
            setIsOpen(false);
          },
        },
      ]
    : [];

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
        placeholder="Search jobs, staff, trucks, tickets, materials, pages..."
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

      {/* ── 🗺️ RESULT PANEL ── */}
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
            sections.map(
              (s) =>
                s.items.length > 0 && (
                  <div key={s.key}>
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
                      {s.header}
                    </div>
                    {s.items.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        onClick={() => s.onClick(item)}
                        style={{
                          padding: "10px 14px",
                          cursor: "pointer",
                          fontSize: "13px",
                          color: "#0f172a",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "#f1f5f9")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        <div style={{ fontWeight: "var(--weight-semibold)" }}>
                          {s.title(item)}
                        </div>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>
                          {s.sub(item)}
                        </div>
                      </div>
                    ))}
                  </div>
                ),
            )
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
