// src/shared/layouts/Sidebar.jsx
import { useEffect, useState } from "react";
import {
  Building2,
  CreditCard,
  Users,
  ScrollText,
  Settings,
  Home,
  Calendar,
  HardHat,
  ClipboardList,
  Package,
  Truck,
  Wrench,
  BarChart3,
  GraduationCap,
  Monitor,
  Sun,
  Moon,
  ChevronRight,
  ChevronLeft,
  Palette,
  Globe,
  Glasses,
} from "lucide-react";
import { C } from "../utils/helpers";
import { ROLES } from "../database/permissions";
import { PREVIEW_ROLES } from "@/core/rolePreview";
import { Sel, roleLabel } from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { TrussMark, TAGLINE } from "../components/SteadwerkMark";
import { translations } from "../utils/translations";
import { readTheme, saveTheme, applyTheme } from "../utils/theme";
import { IS_IOS_APP } from "@/core/platform";
import { Row, Stack, Text } from "../components/LayoutPrimitives";

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
  trainingUnread,
  activeLogo,
  companyName,
  isPlatformAdmin,
  isPlatformCompany,
  perms,
  // ── ROLE PREVIEW ("view as") ──
  // canPreviewRole comes from the REAL user, not `user` above: mid-preview
  // `user.isPlatformAdmin` is false by design, and reading it here would make
  // the picker disappear the moment it was used. See core/rolePreview.js.
  canPreviewRole = false,
  previewRole = null,
  setPreviewRole,
  // ── ACCEPT LANG MATRIX CONTROL ARGS ──
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
    system: { icon: Monitor, label: t.themeSystem || "Auto" },
    light: { icon: Sun, label: t.themeLight || "Light" },
    dark: { icon: Moon, label: t.themeDark || "Dark" },
  }[theme];
  const ThemeIcon = themeMeta.icon;

  // ── TRANSLATED DYNAMIC SIDEBAR Blueprints ──
  //
  // Inside the platform operator's own tenant (supabase/32) the roofing product is
  // not the job — running the platform is. Dashboard, Schedule, Pull Inventory and
  // Help are ungated below and would otherwise survive any permission change, and
  // getEffectivePerms short-circuits role 'admin' to all-true anyway, so this is a
  // separate list rather than a filter over the operational one.
  //
  // Everything here administers Steadwerk itself: the platform, its own staff, the
  // audit trail, and its settings. Enter a CUSTOMER's company from the Owner
  // Console and the flag is false for that company, so the full portal below comes
  // back — which is what you went in there for.
  const platformNavItems = [
    // isPlatformAdmin, not "is an admin of this company". The Owner Console lists
    // every tenant on the platform and can suspend or delete one, so it belongs
    // to the person flagged profiles.is_platform_admin and to nobody else —
    // including Steadwerk's own staff, who are admins of the platform COMPANY
    // without being operators of the platform. Ungated, this row rendered for all
    // of them and the /owner route then bounced them to /dashboard: a tab that
    // looks like access and isn't. Same flag the route checks, so the nav and the
    // router now agree.
    ...(isPlatformAdmin ? [{ id: "owner", icon: Building2, label: t.ownerConsole }] : []),
    // Hidden on iOS along with the view itself. A nav row that routes to a
    // screen the App Store build does not contain is a dead tap, and one that
    // said "Billing" would invite the reviewer to go looking for a purchase.
    ...(IS_IOS_APP ? [] : [{ id: "billing", icon: CreditCard, label: t.billing }]),
    ...(perms.users_manage
      ? [
          { id: "users", icon: Users, label: t.users || "Users" },
          { id: "logs", icon: ScrollText, label: t.logs || "Audit Logs" },
        ]
      : []),
    ...(perms.settings_manage
      ? [{ id: "settings", icon: Settings, label: t.settings || "Settings" }]
      : []),
  ];

  const navItems = [
    {
      id: "dashboard",
      icon: Home,
      label: t.dashboard || "Dashboard",
      badge: chatUnread,
      badgeColor: C.rd,
    },
    // No permission gate: it only surfaces jobs and maintenance the viewer can
    // already see elsewhere, and knowing what is on the calendar is the point of
    // being on a crew.
    { id: "schedule", icon: Calendar, label: t.schedule || "Schedule" },
    ...(perms.jobs_build || perms.jobs_close
      ? [
          {
            id: "buildjobs",
            icon: HardHat,
            label: t.buildjobs || "Build Jobs",
            badge: perms.jobs_close ? jobsAwaitingClose : 0,
            badgeColor: C.tl,
          },
        ]
      : []),
    {
      id: "pull",
      icon: ClipboardList,
      label: t.pull || "Pull Inventory",
      badge: newJobsForMe,
      badgeColor: C.tl,
    },
    ...(perms.inv_view
      ? [{ id: "inventory", icon: Package, label: t.inventory || "Inventory", badge: lowStock }]
      : []),
    ...(perms.fleet_view ? [{ id: "fleet", icon: Truck, label: t.fleet || "Fleet" }] : []),
    ...(perms.maint_submit || perms.maint_manage
      ? [
          {
            id: "requests",
            icon: Wrench,
            label: t.requests || "Maintenance",
            badge: perms.maint_manage ? pendingReqs : 0,
            badgeColor: C.pu,
          },
        ]
      : []),
    ...(perms.reports_view
      ? [{ id: "reports", icon: BarChart3, label: t.reports || "Reports" }]
      : []),
    ...(perms.users_manage ? [{ id: "users", icon: Users, label: t.users || "Users" }] : []),
    ...(perms.users_manage
      ? [{ id: "logs", icon: ScrollText, label: t.logs || "Audit Logs" }]
      : []),
    ...(perms.settings_manage
      ? [{ id: "settings", icon: Settings, label: t.settings || "Settings" }]
      : []),
    // The company's own Billing/accounting tab — its admin only, and never in
    // the iOS build. See the platform list above and utils/platform.js.
    ...(!IS_IOS_APP && (user?.role === "admin" || isPlatformAdmin)
      ? [{ id: "billing", icon: CreditCard, label: t.billing }]
      : []),
    // Platform owner only — not a company permission. Visible to you across every
    // tenant; the underlying RPCs re-check is_platform_admin() server-side regardless.
    ...(isPlatformAdmin ? [{ id: "owner", icon: Building2, label: t.ownerConsole }] : []),
    // Last, and deliberately ungated: everyone can be stuck, including the roles
    // with the fewest permissions. Sits below the work items because it is a
    // place you go when something else isn't working, not part of the daily loop.
    {
      id: "training",
      icon: GraduationCap,
      label: t.training || "Training",
      badge: trainingUnread,
    },
  ];

  // Training stays in both lists: the platform operator is the person most likely
  // to be answering a customer's question about how a screen works.
  const items = isPlatformCompany
    ? [
        ...platformNavItems,
        {
          id: "training",
          icon: GraduationCap,
          label: t.training || "Training",
          badge: trainingUnread,
        },
      ]
    : navItems;

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
        "auth",
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
      {/* Sidebar Header/Logo Wrapper. A <button>, not a <div> — it used to be
          inert, the only thing in the whole chrome that looked like a home
          link but wasn't one. */}
      <button
        type="button"
        onClick={() => onNav("dashboard")}
        aria-label={t.sbGoToDashboard || "Go to dashboard"}
        style={{
          padding: collapsed ? "12px 0" : "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          justifyContent: collapsed ? "center" : "flex-start",
          minHeight: 62,
          width: "100%",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          cursor: "pointer",
          textAlign: "left",
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
            <img
              src={activeLogo}
              alt={t.sbCompanyLogo}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          ) : (
            <TrussMark size={30} />
          )}
        </div>
        {!collapsed && (
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text
              size="xs"
              weight="black"
              color={C.gold}
              font="display"
              truncate
              style={{ lineHeight: 1.15 }}
            >
              {companyName || "STEADWERK"}
            </Text>
            <Text
              font="display"
              color="rgba(237,230,218,0.55)"
              style={{ fontSize: 9, letterSpacing: "1.5px" }}
            >
              {companyName ? "STEADWERK" : TAGLINE}
            </Text>
          </Stack>
        )}
      </button>

      {/* Main Navigation Links */}
      <nav style={{ flex: 1, padding: "10px 6px" }}>
        {items.map((item) => (
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
            <item.icon size={17} strokeWidth={2} aria-hidden="true" />
            {!collapsed && (
              <Text
                as="span"
                size="base"
                weight={cur === item.id ? "bold" : "normal"}
                style={{ flex: 1, textAlign: "left" }}
              >
                {item.label}
              </Text>
            )}
            {(item.badge || 0) > 0 && !collapsed && (
              <Text
                as="span"
                size="2xs"
                weight="extrabold"
                color={C.onAccent}
                style={{
                  background: item.badgeColor || C.rd,
                  borderRadius: 20,
                  padding: "1px 6px",
                }}
              >
                {item.badge}
              </Text>
            )}
            {(item.badge || 0) > 0 && collapsed && (
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 8,
                  width: 8,
                  height: 8,
                  background: item.badgeColor || C.rd,
                  borderRadius: "50%",
                }}
              />
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
          display: "flex",
          justifyContent: "center",
        }}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      {/* ── ROLE PREVIEW ("view as") ──
          The platform operator only, and only while the rail is expanded: a
          60px-wide rail has no room for a seven-option picker, and the fixed
          banner (components/RolePreviewBanner) already carries both the warning
          and the exit for anyone working collapsed or on a phone.

          Sits above the theme and language controls because it belongs with
          them — chrome that changes how the app presents itself rather than
          anything about the company's work. */}
      {canPreviewRole && !collapsed && (
        <Stack
          gap={2}
          style={{ padding: "8px 10px 4px", borderTop: "1px solid rgba(255,255,255,0.05)" }}
        >
          <Row
            as="span"
            gap={1}
            style={{
              fontSize: "var(--text-2xs)",
              color: previewRole ? C.gold : "rgba(255,255,255,0.4)",
              fontWeight: "var(--weight-extrabold)",
            }}
          >
            <Glasses size={12} aria-hidden="true" /> {t.rolePreviewLabel || "View as"}
          </Row>
          <Sel
            value={previewRole || ""}
            onChange={(e) => setPreviewRole?.(e.target.value || null)}
            aria-label={t.rolePreviewLabel || "View as"}
            title={t.rolePreviewHint}
            // A LIGHT control on the dark rail, the same call CompanySwitcher
            // makes for the one other dropdown that sits on this chrome. Tinting
            // the closed control dark leaves the OPEN option list to the OS
            // popup, which on Windows and Android draws its own light background
            // under whatever colour the control set — unreadable in exactly the
            // moment you need to read it. The gold ring carries "a preview is
            // running" instead of the fill.
            style={{
              padding: "5px 8px",
              fontSize: "var(--text-2xs)",
              fontWeight: "var(--weight-bold)",
              color: C.navy,
              border: `${previewRole ? 2 : 1}px solid ${previewRole ? C.gold : C.bd}`,
            }}
          >
            <option value="">{t.rolePreviewOff || "My own role"}</option>
            {PREVIEW_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r, lang)}
              </option>
            ))}
          </Sel>
          {/* Text, not Muted: Muted's colour is C.sub, which is tuned for a light
              surface and all but disappears on the dark shell. */}
          {previewRole && (
            <Text size="2xs" color="rgba(255,255,255,0.45)" style={{ lineHeight: 1.35 }}>
              {t.rolePreviewHint}
            </Text>
          )}
        </Stack>
      )}

      {/* ── THEME CONTROL ──
          One button cycling auto → light → dark, rather than three buttons like
          the language drum: theme is a fiddle-once setting and does not deserve
          the same footprint as the thing the crew actually switches. */}
      <Row gap={0} justify={collapsed ? "center" : "space-between"} style={{ padding: "4px 10px" }}>
        {!collapsed && (
          <Row
            as="span"
            gap={1}
            style={{
              fontSize: "var(--text-2xs)",
              color: "rgba(255,255,255,0.4)",
              fontWeight: "var(--weight-extrabold)",
            }}
          >
            <Palette size={12} aria-hidden="true" /> {t.theme || "Theme"}:
          </Row>
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
          <ThemeIcon size={13} aria-hidden="true" />
          {!collapsed && themeMeta.label}
        </button>
      </Row>

      {/* ── TRANSLATION CONTROL SWITCH DRUM ── */}
      <Row
        gap={0}
        justify={collapsed ? "center" : "space-between"}
        style={{ padding: "4px 10px 10px", borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        {!collapsed && (
          <Row
            as="span"
            gap={1}
            style={{
              fontSize: "var(--text-2xs)",
              color: "rgba(255,255,255,0.4)",
              fontWeight: "var(--weight-extrabold)",
            }}
          >
            <Globe size={12} aria-hidden="true" /> {t.language}:
          </Row>
        )}
        <div
          style={{
            display: "flex",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 15,
            padding: 2,
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {[
            { id: "en", label: "EN" },
            { id: "es", label: "ES" },
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
                  transition: "all 0.15s",
                }}
              >
                {langObj.label}
              </button>
            );
          })}
        </div>
      </Row>

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
          title={t.sbManageProfile}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: rColor(user.role),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--text-base)",
              fontWeight: "var(--weight-black)",
              color: C.onAccent,
              flexShrink: 0,
            }}
          >
            {user.name ? user.name[0] : user.full_name ? user.full_name[0] : "U"}
          </div>
          {!collapsed && (
            <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
              <Text size="xs" weight="bold" color={C.shellInk} truncate>
                {user.name || user.full_name || "Active User"}
              </Text>
              <Text
                weight="semibold"
                color={rColor(user.role)}
                style={{ fontSize: 9, textTransform: "capitalize" }}
              >
                {ROLES[user.role]?.label || user.role || "Employee"}
              </Text>
            </Stack>
          )}
        </div>

        {!collapsed && (
          <Stack gap={1} style={{ padding: "0 4px" }}>
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
          </Stack>
        )}
      </div>
    </div>
  );
}
