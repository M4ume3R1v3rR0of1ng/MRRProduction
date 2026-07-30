// src/components/OmniSearch.jsx
import { useState, useRef, useEffect, useMemo } from "react";
import { C } from "../utils/helpers";
import { translations } from "../utils/translations";

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
  lang = "en",
  onNavigate,
  onOpenItem,
  onInventorySearch,
}) {
  const t = translations[lang] || translations.en;
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

  // Navigate to the tab — and when a specific record was clicked, tell the
  // destination view to open that record's card too.
  const handleSelection = (targetView, itemId = null) => {
    if (itemId != null && typeof onOpenItem === "function") {
      onOpenItem(targetView, itemId);
    } else {
      onNavigate(targetView);
    }
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
      { id: "dashboard", icon: "🏠", label: t.dashboard, keywords: "home overview team chat", show: true },
      { id: "buildjobs", icon: "🏗️", label: t.buildjobs, keywords: "create job wizard acculynx close po", show: !!(perms.jobs_build || perms.jobs_close) },
      { id: "pull", icon: "📋", label: t.pull, keywords: "jobs pull materials return complete", show: true },
      { id: "inventory", icon: "📦", label: t.inventory, keywords: "stock materials receive batches sku", show: !!perms.inv_view },
      { id: "fleet", icon: "🚛", label: t.fleet, keywords: "trucks trailers vehicles mileage plates", show: !!perms.fleet_view },
      { id: "requests", icon: "🔧", label: t.requests, keywords: "requests tickets repair service oil", show: !!(perms.maint_submit || perms.maint_manage) },
      { id: "reports", icon: "📊", label: t.reports, keywords: "analytics costs charts export", show: !!perms.reports_view },
      { id: "users", icon: "👥", label: t.users, keywords: "staff team accounts profiles roles", show: !!perms.users_manage },
      { id: "logs", icon: "📜", label: t.logs, keywords: "history activity audit trail", show: !!perms.users_manage },
      { id: "settings", icon: "⚙️", label: t.settings, keywords: "acculynx permissions api logo config", show: !!perms.settings_manage },
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
    // `t` belongs here: the page labels above are read from it, so switching
    // language has to rebuild this list or the nav results stay in the old one.
  }, [txt, jobs, users, vehs, reqs, inv, perms, t]);

  const hasResults =
    results && Object.values(results).some((arr) => arr.length > 0);

  // ── 🗂️ CATEGORY RENDER CONFIG ──
  const sections = results
    ? [
        {
          key: "pages",
          header: t.osSecGoTo,
          items: results.pages,
          title: (p) => `${p.icon} ${p.label}`,
          sub: () => t.osOpenPage,
          onClick: (p) => handleSelection(p.id),
        },
        {
          key: "jobs",
          header: t.osSecJobs,
          items: results.jobs,
          title: (j) => j.title || j.name || t.osUntitledJob,
          sub: (j) =>
            `PO: ${j.po || t.osNA} · ${j.addr || t.osNoAddress}${j.status ? ` · ${j.status}` : ""}`,
          onClick: (j) =>
            handleSelection(perms.jobs_build || perms.jobs_close ? "buildjobs" : "pull", j.id),
        },
        {
          key: "users",
          header: t.osSecStaff,
          items: results.users,
          title: (u) => u.full_name || u.name || u.email,
          sub: (u) => `${u.email || t.osNoEmail} · ${u.role || t.osNoRole}`,
          onClick: (u) => handleSelection("users", u.id),
        },
        {
          key: "vehicles",
          header: t.osSecVehicles,
          items: results.vehicles,
          title: (v) => v.name || `${v.make || ""} ${v.model || ""}`.trim() || t.osVehicle,
          sub: (v) =>
            `${t.osPlate}: ${v.plate || "—"} · ${t.osDriver}: ${v.driver || userName(v.assignedTo) || t.flUnassigned}`,
          onClick: (v) => handleSelection("fleet", v.id),
        },
        {
          key: "requests",
          header: t.osSecTickets,
          items: results.requests,
          title: (r) => `${r.type || t.osRequest}${r.vname ? ` — ${r.vname}` : ""}`,
          sub: (r) => `${t.osStatus}: ${(r.status || "?").toUpperCase()} · ${t.osUrgency}: ${r.urgency || t.osNormal}`,
          onClick: (r) => handleSelection("requests", r.id),
        },
        {
          key: "inventory",
          header: t.osSecInventory,
          items: results.inventory,
          title: (i) => i.name,
          sub: (i) => `${t.osCategory}: ${i.cat || t.osGeneral} · ${t.osUnit}: ${i.unit || "—"}`,
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
        placeholder={t.chromeSearchPlaceholder}
        style={{
          width: "100%",
          padding: "10px 14px 10px 12px",
          borderRadius: "8px",
          border: `1px solid ${C.bd || "var(--c-line)"}`,
          background: "var(--c-subtle)",
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
            background: "var(--c-surface)",
            borderRadius: "12px",
            boxShadow: "0 12px 32px rgba(15, 23, 42, 0.15)",
            border: "1px solid var(--c-line)",
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
                        color: "var(--c-sub)",
                        textTransform: "uppercase",
                        background: "var(--c-subtle)",
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
                          color: "var(--c-barnwood)",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "var(--c-subtle)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        <div style={{ fontWeight: "var(--weight-semibold)" }}>
                          {s.title(item)}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--c-sub)" }}>
                          {s.sub(item)}
                        </div>
                      </div>
                    ))}
                  </div>
                ),
            )
          ) : (
            <div
              style={{ padding: "20px", textAlign: "center", color: "var(--c-sub)" }}
            >
              {t.osNoResults} "<strong>{query}</strong>"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
