// src/layouts/Sidebar.jsx
import { useState } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { ROLES } from "../database/permissions";
import { logAction } from "../utils/logger";
import mrrpic from "../assets/mrrpic.jpg";
import { translations } from "../utils/translations"; // 🟢 Imported Dictionary

export default function Sidebar({
  cur,
  onNav,
  user,
  onLogout,
  collapsed,
  setCollapsed,
  pendingReqs,
  lowStock,
  newJobsForMe,
  jobsAwaitingClose,
  chatUnread,
  activeLogo,
  perms,
  // ── 🟢 NEW: ACCEPT LANG MATRIX CONTROL ARGS ──
  lang = "en",
  setLang,
}) {
  const t = translations[lang];

  // ── 🟢 TRANSLATED DYNAMIC SIDEBAR Blueprints ──
 const navItems = [
    { id: "dashboard", icon: "🏠", label: t.dashboard || "Dashboard", badge: chatUnread, badgeColor: C.rd },
    ...(perms.jobs_build || perms.jobs_close
      ? [{
          id: "buildjobs",
          icon: "🏗️",
          label: t.buildjobs || "Build Jobs",
          badge: perms.jobs_close ? jobsAwaitingClose : 0,
          badgeColor: C.tl,
        }]
      : []),
    {
      id: "pull",
      icon: "📋",
      label: t.pull || "Pull Inventory",
      badge: newJobsForMe,
      badgeColor: C.tl,
    },
    ...(perms.inv_view
      ? [{ id: "inventory", icon: "📦", label: t.inventory || "Inventory", badge: lowStock }]
      : []),
    ...(perms.fleet_view ? [{ id: "fleet", icon: "🚛", label: t.fleet || "Fleet" }] : []),
    ...(perms.maint_submit || perms.maint_manage
      ? [
          {
            id: "requests",
            icon: "🔧",
            label: t.requests || "Maintenance",
            badge: perms.maint_manage ? pendingReqs : 0,
            badgeColor: C.pu,
          },
        ]
      : []),
    ...(perms.reports_view
      ? [{ id: "reports", icon: "📊", label: t.reports || "Reports" }]
      : []),
    ...(perms.users_manage
      ? [{ id: "users", icon: "👥", label: t.users || "Users" }]
      : []),
    ...(perms.users_manage
      ? [{ id: "logs", icon: "📜", label: t.logs || "Audit Logs" }]
      : []),
    ...(perms.settings_manage
      ? [{ id: "settings", icon: "⚙️", label: t.settings || "Settings" }]
      : []),
  ];
  
  const rColor = (r) =>
    r === "warehouse"
      ? C.pu
      : r === "coordinator"
        ? C.tl
        : r === "field"
          ? C.gr
          : r === "employee"
            ? C.sub
            : C.gold;

  const handleSignOut = async () => {
    try {
      await logAction(
        user.id,
        user.email,
        "LOGOUT",
        "User terminated active workspace session and logged out securely via sidebar gateway.",
        {},
        "auth"
      );
    } catch (err) {
      console.error("Secure logout trace interrupted:", err);
    }
    // onLogout (from App.jsx) actually terminates the Supabase session — this
    // button previously only cleared local UI state, leaving the auth token valid.
    onLogout();
  };

  return (
    <div
      style={{
        width: collapsed ? 60 : 215,
        background: C.navy,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s",
        flexShrink: 0,
      }}
    >
      {/* Sidebar Header/Logo Wrapper */}
      <div
        style={{
          padding: collapsed ? "12px 0" : "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          justifyContent: collapsed ? "center" : "flex-start",
          minHeight: 62,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            background: activeLogo ? "transparent" : C.gold,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          {activeLogo ? (
            <img src={activeLogo} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          ) : (
            <img src={mrrpic} alt="Maumee River Roofing Mascot" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          )}
        </div>
        {!collapsed && (
          <div>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-black)", color: C.gold, lineHeight: 1.1 }}>MAUMEE RIVER</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", letterSpacing: "0.5px" }}>ROOFING</div>
          </div>
        )}
      </div>

      {/* Main Navigation Links */}
      <nav style={{ flex: 1, padding: "10px 6px" }}>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNav(item.id)}
            className={cur === item.id ? "mrr-nav-btn active" : "mrr-nav-btn"}
            style={{
              width: "100%",
              padding: collapsed ? "11px" : "9px 10px",
              border: "none",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              marginBottom: 2,
              justifyContent: collapsed ? "center" : "flex-start",
              position: "relative",
            }}
          >
            <span style={{ fontSize: 17 }}>{item.icon}</span>
            {!collapsed && (
              <span style={{ fontSize: "var(--text-base)", fontWeight: cur === item.id ? 700 : 500, flex: 1, textAlign: "left" }}>
                {item.label}
              </span>
            )}
            {(item.badge || 0) > 0 && !collapsed && (
              <span style={{ background: item.badgeColor || C.rd, color: C.w, borderRadius: 20, fontSize: "var(--text-2xs)", padding: "1px 6px", fontWeight: "var(--weight-extrabold)" }}>
                {item.badge}
              </span>
            )}
            {(item.badge || 0) > 0 && collapsed && (
              <span style={{ position: "absolute", top: 6, right: 8, width: 8, height: 8, background: item.badgeColor || C.rd, borderRadius: "50%" }} />
            )}
          </button>
        ))}
      </nav>

      {/* Sidebar Collapse Toggle Button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: 10,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "rgba(255,255,255,0.4)",
          fontSize: "var(--text-lg)",
          textAlign: "center",
        }}
      >
        {collapsed ? "▶" : "◀"}
      </button>

      {/* ── 🟢 NEW: TRANSLATION CONTROL SWITCH DRUM ── */}
      <div style={{
        padding: "4px 10px 10px",
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "space-between",
        borderTop: "1px solid rgba(255,255,255,0.05)"
      }}>
        {!collapsed && <span style={{ fontSize: "var(--text-2xs)", color: "rgba(255,255,255,0.4)", fontWeight: "var(--weight-extrabold)" }}>🌐 {t.language}:</span>}
        <div style={{ display: "flex", background: "rgba(0,0,0,0.2)", borderRadius: 15, padding: 2, border: "1px solid rgba(255,255,255,0.1)" }}>
          {[
            { id: "en", label: "EN" },
            { id: "es", label: "ES" }
          ].map((langObj) => {
            const active = lang === langObj.id;
            return (
              <button
                key={langObj.id}
                onClick={() => setLang(langObj.id)}
                style={{
                  background: active ? C.gold : "transparent",
                  color: active ? C.navy : "rgba(255,255,255,0.6)",
                  border: "none",
                  borderRadius: "var(--radius-xl)",
                  padding: collapsed ? "4px 6px" : "3px 8px",
                  fontSize: "var(--text-2xs)",
                  fontWeight: "var(--weight-black)",
                  cursor: "pointer",
                  transition: "all 0.15s"
                }}
              >
                {langObj.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer Profile Segment */}
      <div style={{ padding: "10px 6px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <div
          onClick={() => onNav("profile")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: 8,
            borderRadius: 7,
            background: cur === "profile" ? "rgba(245,168,0,0.15)" : "rgba(255,255,255,0.06)",
            border: cur === "profile" ? `1px solid ${C.gold}` : "1px solid transparent",
            marginBottom: 6,
            cursor: "pointer",
            transition: "background 0.2s",
          }}
          title="Click to manage profile settings"
        >
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: rColor(user.role), display: "flex", alignItems: "center", justifyGroup: "center", justifyContent: "center", fontSize: "var(--text-base)", fontWeight: "var(--weight-black)", color: C.w, flexShrink: 0 }}>
            {user.name ? user.name[0] : user.full_name ? user.full_name[0] : "U"}
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.w, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user.name || user.full_name || "Active User"}
              </div>
              <div style={{ fontSize: 9, color: rColor(user.role), textTransform: "capitalize", fontWeight: "var(--weight-semibold)" }}>
                {ROLES[user.role]?.label || user.role || "Employee"}
              </div>
            </div>
          )}
        </div>

        {!collapsed && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", padding: "0 4px" }}>
            <button
              onClick={handleSignOut}
              className="mrr-signout"
              style={{
                width: "100%",
                padding: 6,
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-semibold)",
              }}
            >
              {t.signout}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}