// src/layouts/Sidebar.jsx
import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { ROLES } from "../database/permissions";
import { logAction } from "../utils/logger";
import { TrussMark, TAGLINE } from "../components/SteadwerkMark";
import { translations } from "../utils/translations"; // 🟢 Imported Dictionary
import { readTheme, saveTheme, applyTheme } from "../utils/theme";

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
  companyName,
  isPlatformAdmin,
  perms,
  // ── 🟢 NEW: ACCEPT LANG MATRIX CONTROL ARGS ──
  lang = "en",
  setLang,
}) {
  const t = translations[lang];

  // ── Theme control ──
  // Three states, not two: "system" follows the OS and keeps following it when it
  // flips at sunset, which is different from having explicitly chosen light.
  const [theme, setTheme] = useState(readTheme);

  const cycleTheme = () => {
    const order = ["system", "light", "dark"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    saveTheme(next);
    setTheme(next);
  };

  // While on "system", a change to the OS setting has to re-resolve. Without this
  // the app keeps whatever was true at load until the next refresh.
  useEffect(() => {
    if (theme !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const themeMeta = {
    system: { icon: "◐", label: t.themeSystem || "Auto" },
    light: { icon: "☀", label: t.themeLight || "Light" },
    dark: { icon: "☾", label: t.themeDark || "Dark" },
  }[theme];

  // ── 🟢 TRANSLATED DYNAMIC SIDEBAR Blueprints ──
 const navItems = [
    { id: "dashboard", icon: "🏠", label: t.dashboard || "Dashboard", badge: chatUnread, badgeColor: C.rd },
    // No permission gate: it only surfaces jobs and maintenance the viewer can
    // already see elsewhere, and knowing what is on the calendar is the point of
    // being on a crew.
    { id: "schedule", icon: "🗓️", label: t.schedule || "Schedule" },
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
    // The company's own Billing/accounting tab — its admin only.
    ...((user?.role === "admin" || isPlatformAdmin)
      ? [{ id: "billing", icon: "💳", label: "Billing" }]
      : []),
    // Platform owner only — not a company permission. Visible to you across every
    // tenant; the underlying RPCs re-check is_platform_admin() server-side regardless.
    ...(isPlatformAdmin
      ? [{ id: "owner", icon: "🏛️", label: "Owner Console" }]
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
        background: C.shell,
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
        {/* The TENANT's logo if they've uploaded one; the Steadwerk truss otherwise.
            The old fallback was the Maumee River mascot with "MAUMEE RIVER / ROOFING"
            hardcoded beneath it — which every other company on the platform would
            have seen in their own sidebar. */}
        <div
          style={{
            width: 36,
            height: 36,
            background: "transparent",
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          {activeLogo ? (
            <img src={activeLogo} alt="Company logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          ) : (
            <TrussMark size={30} />
          )}
        </div>
        {!collapsed && (
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-black)",
                color: C.gold,
                lineHeight: 1.15,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {companyName || "STEADWERK"}
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 9, color: "rgba(237,230,218,0.55)", letterSpacing: "1.5px" }}>
              {companyName ? "STEADWERK" : TAGLINE}
            </div>
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
              <span style={{ background: item.badgeColor || C.rd, color: C.onAccent, borderRadius: 20, fontSize: "var(--text-2xs)", padding: "1px 6px", fontWeight: "var(--weight-extrabold)" }}>
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

      {/* ── THEME CONTROL ──
          One button cycling auto → light → dark, rather than three buttons like
          the language drum: theme is a fiddle-once setting and does not deserve
          the same footprint as the thing the crew actually switches. */}
      <div style={{
        padding: "4px 10px",
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "space-between",
      }}>
        {!collapsed && (
          <span style={{ fontSize: "var(--text-2xs)", color: "rgba(255,255,255,0.4)", fontWeight: "var(--weight-extrabold)" }}>
            🎨 {t.theme || "Theme"}:
          </span>
        )}
        <button
          onClick={cycleTheme}
          title={`${t.theme || "Theme"}: ${themeMeta.label}`}
          aria-label={`${t.theme || "Theme"}: ${themeMeta.label}. Click to change.`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            background: "rgba(0,0,0,0.2)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 15,
            padding: collapsed ? "4px 7px" : "3px 9px",
            color: "rgba(255,255,255,0.75)",
            fontSize: "var(--text-2xs)",
            fontWeight: "var(--weight-black)",
            cursor: "pointer",
            lineHeight: 1.6,
          }}
        >
          <span aria-hidden="true">{themeMeta.icon}</span>
          {!collapsed && themeMeta.label}
        </button>
      </div>

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
                  color: active ? C.shell : "rgba(255,255,255,0.6)",
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
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: rColor(user.role), display: "flex", alignItems: "center", justifyGroup: "center", justifyContent: "center", fontSize: "var(--text-base)", fontWeight: "var(--weight-black)", color: C.onAccent, flexShrink: 0 }}>
            {user.name ? user.name[0] : user.full_name ? user.full_name[0] : "U"}
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.shellInk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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