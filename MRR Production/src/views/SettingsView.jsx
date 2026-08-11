// src/views/SettingsView.jsx
import React, { useState } from "react";
import { supabase, getAccessToken } from "../utils/supabase";
import { C, compressImg } from "../utils/helpers";
import {
  PERM_DEFS,
  PERM_GROUPS,
  ROLE_COLS,
  DEFAULT_ROLE_PERMS,
} from "../database/permissions";
import { Btn, Bdg, Fld, Inp, Sel, Toggle } from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { translations } from "../utils/translations";
import { useNotify } from "../context/NotificationContext";
// ── 🆕 IMPORT ADDED ──────────────────────────────────────────────────────────
import { fetchAccuLynxJob, fetchAccuLynxDocumentFolders } from "../utils/accuLynxSync";
import { US_STATES, stateByCode } from "../utils/salesTax";
import {
  AUTOMATION_GROUPS,
  automationsForGroup,
  mergePrefs,
  serializePrefs,
} from "../utils/automations";

// ── Design tokens ────────────────────────────────────────────────────────────
const T = {
  navy:    "var(--c-barnwood)",
  blue:    "var(--c-slate)",
  blueSoft:"var(--c-slate-wash)",
  blueRing:"var(--c-slate-wash)",
  slate:   "var(--c-barnwood)",
  slateL:  "var(--c-sub)",
  border:  "var(--c-line)",
  bg:      "var(--c-subtle)",
  // Was a literal #ffffff. That made every card in this view stay white in dark
  // mode while its text inverted to cream, which is how the permissions grid
  // ended up as pale-on-white. `white` is now the surface slot, so it follows
  // the theme; the name is kept because a dozen call sites use it.
  white:   "var(--c-surface)",
  // Chrome that stays dark in both themes, for the permission group headers.
  // T.navy cannot do this job: it maps to the ink token, which inverts.
  shell:   "var(--c-shell)",
  shellInk:"var(--c-shell-ink)",
  green:   "var(--c-pasture)",
  greenBg: "var(--c-pasture-wash)",
  greenBd: "var(--c-pasture-wash)",
  amber:   "var(--c-warn)",
  amberBg: "var(--c-warn-wash)",
  amberBd: "var(--c-warn-wash)",
  red:     "var(--c-rust)",
  redBg:   "var(--c-rust-wash)",
  radius:  "10px",
  radiusLg:"16px",
  shadow:  "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:"0 4px 12px rgba(0,0,0,0.08)",
};

// ── Shared sub-components ────────────────────────────────────────────────────
const Card = ({ children, style = {} }) => (
  <div style={{
    background: T.white,
    border: `1px solid ${T.border}`,
    borderRadius: T.radiusLg,
    padding: "24px",
    boxShadow: T.shadow,
    ...style,
  }}>
    {children}
  </div>
);

const SectionTitle = ({ icon, title, subtitle }) => (
  <div style={{ marginBottom: 20 }}>
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: 4 }}>
      <span style={{ fontSize: "var(--text-xl)" }}>{icon}</span>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: "var(--weight-extrabold)", color: T.navy, letterSpacing: "-0.3px" }}>
        {title}
      </h2>
    </div>
    {subtitle && (
      <p style={{ margin: 0, fontSize: "var(--text-base)", color: T.slate, lineHeight: 1.6 }}>
        {subtitle}
      </p>
    )}
  </div>
);

const StatusPill = ({ active, labelOn = "Active", labelOff = "Offline" }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "3px 10px", borderRadius: "var(--radius-pill)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)",
    background: active ? T.greenBg : T.bg,
    color: active ? T.green : T.slateL,
    border: `1px solid ${active ? T.greenBd : T.border}`,
  }}>
    <span style={{ fontSize: 8 }}>{active ? "●" : "●"}</span>
    {active ? labelOn : labelOff}
  </span>
);

const Alert = ({ children, type = "warning" }) => {
  const colors = {
    warning: { bg: T.amberBg, bd: T.amberBd, text: T.amber },
    info:    { bg: T.blueSoft, bd: T.blueRing, text: T.blue },
  };
  const c = colors[type];
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.bd}`, borderRadius: T.radius,
      padding: "11px 14px", color: c.text, fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)",
      display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: 20,
    }}>
      {children}
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────────
export default function SettingsView({
  warehouses,
  setWarehouses,
  logos,
  setLogos,
  company,
  setCompany,
  jobNotifications = {},
  setJobNotifications,
  maintenanceNotifications = {},
  setMaintenanceNotifications,
  rolePerms,
  setRolePerms,
  acculynxConfig,
  setAccuLynxConfig,
  users,
  setUsers,
  curUser,
  lang = "en",
}) {
  const { showToast } = useNotify();
  const t = translations[lang] || translations.en;
  const [currentTab, setCurrentTab] = useState("Permissions");
  // Company display name + tax, stored in companies.branding via set_company_branding.
  // This is what the top bar, sidebar, and every PDF report read — so a tenant controls
  // how their name and tax line appear without touching code.
  const [brandForm, setBrandForm] = useState({
    displayName: company?.branding?.displayName || company?.name || "",
    tagline: company?.branding?.tagline || "",
    accent: company?.branding?.accent || "var(--c-amber)",
    state: company?.branding?.state || "",
    taxRate: company?.branding?.taxRate != null ? String(company.branding.taxRate * 100) : "",
    taxLabel: company?.branding?.taxLabel || "",
  });
  const [savingBrand, setSavingBrand] = useState(false);

  // Automation rules, rendered straight off the shared registry in utils/automations.
  // Each group owns one settings row and saves independently, on the same upsert path as
  // acculynx_config / job_templates. Adding an automation is an entry in the registry —
  // nothing in this file needs to change.
  const GROUP_STATE = {
    jobs: { stored: jobNotifications, apply: setJobNotifications },
    maintenance: { stored: maintenanceNotifications, apply: setMaintenanceNotifications },
  };
  const [automationForm, setAutomationForm] = useState(() =>
    Object.fromEntries(AUTOMATION_GROUPS.map((g) => [g.id, mergePrefs(g.id, GROUP_STATE[g.id]?.stored)])),
  );
  // Which group is mid-save, so one Save button spins without freezing the others.
  const [savingGroup, setSavingGroup] = useState(null);

  const toggleAutomation = (groupId, key) =>
    setAutomationForm((p) => ({ ...p, [groupId]: { ...p[groupId], [key]: !p[groupId]?.[key] } }));

  const saveAutomations = async (group) => {
    setSavingGroup(group.id);
    try {
      const value = serializePrefs(group.id, automationForm[group.id]);
      const { error } = await supabase.from("settings").upsert(
        { key: group.settingsKey, value: JSON.stringify(value), updated_at: new Date().toISOString() },
        { onConflict: "company_id,key" },
      );
      if (error) throw error;
      const apply = GROUP_STATE[group.id]?.apply;
      if (typeof apply === "function") apply(value);
      showToast(t.stNotifsSaved, "success");
    } catch (err) {
      showToast(`${t.stCouldNotSave} ${err.message}`, "error");
    } finally {
      setSavingGroup(null);
    }
  };

  // Picking a state fills in that state's base sales-tax rate (still editable below),
  // and refreshes the tax label when it's blank or a prior auto-generated state label
  // (so switching states updates "Ohio Sales Tax" but never clobbers a custom label).
  const applyState = (code) => {
    setBrandForm((f) => {
      const st = stateByCode(code);
      const next = { ...f, state: code };
      if (st) {
        next.taxRate = String(st.taxPct);
        if (!f.taxLabel.trim() || /sales tax$/i.test(f.taxLabel.trim())) {
          next.taxLabel = `${st.name} Sales Tax`;
        }
      }
      return next;
    });
  };

  const saveBranding = async () => {
    const name = brandForm.displayName.trim();
    if (!name) {
      showToast(t.stNameEmpty, "warning");
      return;
    }
    // Percent in the field, fraction in the DB. Blank = leave it to the 7% default.
    const pct = brandForm.taxRate.trim();
    let taxRate;
    if (pct !== "") {
      const n = parseFloat(pct);
      if (!Number.isFinite(n) || n < 0) {
        showToast(t.stTaxRateInvalid, "warning");
        return;
      }
      taxRate = n / 100;
    }
    const patch = { displayName: name, taxLabel: brandForm.taxLabel.trim() || null };
    if (taxRate !== undefined) patch.taxRate = taxRate;
    patch.state = brandForm.state || null;
    patch.tagline = brandForm.tagline.trim() || null;
    patch.accent = brandForm.accent || null;

    setSavingBrand(true);
    try {
      const { data, error } = await supabase.rpc("set_company_branding", { patch });
      if (error) throw error;
      // Reflect immediately everywhere that reads company.branding (top bar, PDFs).
      if (typeof setCompany === "function") {
        setCompany((prev) => (prev ? { ...prev, branding: data || { ...prev.branding, ...patch } } : prev));
      }
      showToast(t.stCompanySaved, "success");
    } catch (err) {
      showToast(`${t.stCouldNotSave} ${err.message}`, "error");
    } finally {
      setSavingBrand(false);
    }
  };
  const [whForm, setWhForm]         = useState({ name: "", location: "", code: "" });
  const [savingAx, setSavingAx]     = useState(false);

  // ── 🆕 TEST LOOKUP LOCAL STATE ADDED ─────────────────────────────────────────
  const [lookupPo, setLookupPo]         = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookingUp, setLookingUp]       = useState(false);
  const [docFolders, setDocFolders]     = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(false);

  const tabs = [
    { id: "Permissions", label: "Permissions", icon: "🔒" },
    // "Automations" rather than "Notifications": email is the first thing this panel
    // switches on, not the only thing planned, and the rows already read as rules
    // rather than as a notification inbox.
    { id: "Automations", label: "Automations", icon: "🔔" },
    // "CRM Integration" rather than "AccuLynx": AccuLynx is the first CRM we
    // connect to, not the only one planned. Naming the tab after the category
    // means adding Jobber or ServiceTitan later is a new section in this panel,
    // not a renamed tab and a broken bookmark.
    { id: "CRM",        label: "CRM Integration", icon: "🔗" },
    { id: "Branding",   label: "Branding",     icon: "🏢" },
    { id: "Warehouses", label: "Warehouses",   icon: "🏭" },
    { id: "System",     label: "System",       icon: "ℹ️"  },
  ];

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAddWarehouse = async (e) => {
    e.preventDefault();
    if (!whForm.name.trim()) return;

    const code     = whForm.code.trim().toUpperCase() || whForm.name.trim().substring(0, 3).toUpperCase();
    const newEntry = {
      id:       "w_" + Math.random().toString(36).substr(2, 9),
      name:     whForm.name.trim(),
      code,
      location: whForm.location.trim() || "N/A",
      active:   true,
    };

    try {
      const { error } = await supabase.from("warehouses").insert([newEntry]);
      if (error) throw error;
      setWarehouses((prev) => [...prev, newEntry]);
      setWhForm({ name: "", location: "", code: "" });
      showToast(t.stWarehouseAdded, "success");
    } catch (err) {
      showToast(t.stWarehouseAddFail + " " + err.message, "error");
    }
  };

  const handleTogglePerm = async (targetRole, permKey) => {
    const current = rolePerms?.[targetRole] || {};
    const next    = { ...current, [permKey]: !current[permKey] };

    try {
      // Keyed (company_id, role) — each company defines its own 'manager'.
      const { error } = await supabase.from("role_permissions").upsert(
        { role: targetRole, permissions: next, updated_at: new Date().toISOString() },
        { onConflict: "company_id,role" },
      );
      if (error) throw error;
      setRolePerms((prev) => ({ ...prev, [targetRole]: next }));
    } catch (err) {
      showToast(`${t.stPermUpdateFail} ${err.message}`, "error");
    }
  };

  const handleResetRole = async (targetRole) => {
    const defaults = DEFAULT_ROLE_PERMS?.[targetRole] || {};
    if (!window.confirm(t.stResetRoleConfirm.replace("{role}", targetRole))) return;

    try {
      const { error } = await supabase.from("role_permissions").upsert(
        { role: targetRole, permissions: defaults, updated_at: new Date().toISOString() },
        { onConflict: "company_id,role" },
      );
      if (error) throw error;
      setRolePerms((prev) => ({ ...prev, [targetRole]: defaults }));
      showToast(t.stRoleReset.replace("{role}", targetRole), "success");
    } catch (err) {
      showToast(`${t.stResetFail} ${err.message}`, "error");
    }
  };

  // BUG FIX #1 — API key moved to Authorization header, not query param
  const handleSaveAccuLynx = async (e) => {
    if (e) e.preventDefault();
    setSavingAx(true);

    try {
      // The API key is a SECRET and no longer lives in `settings` — every member of
      // the company can read that table. It goes on the company row via an RPC, into
      // a column the browser is not granted SELECT on, which is also where the
      // Netlify functions now read it from. Only the non-secret fields (proxy url,
      // etc.) stay in settings.
      const { apiKey, ...publicConfig } = acculynxConfig || {};

      if (apiKey) {
        const { error: keyError } = await supabase.rpc("set_company_integration", {
          k: "acculynxApiKey",
          v: apiKey,
        });
        if (keyError) {
          showToast(`${t.stAxKeySaveFail} ${keyError.message}`, "error");
          return;
        }
      }

      const { error } = await supabase.from("settings").upsert(
        {
          key: "acculynx_config",
          value: JSON.stringify(publicConfig),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,key" }
      );

      if (error) {
        showToast(`${t.stAxSettingsSaveFail} ${error.message}`, "error");
        return;
      }

      // 2. Perform validation ping routine using the correct POST method rules
      try {
        const proxyRoute = acculynxConfig?.proxyUrl || "/.netlify/functions/acculynx-sync";
        const accessToken = await getAccessToken();

        const response = await fetch(proxyRoute, {
          method: "POST", // 🟢 Changed from GET to POST
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "validate", // Tells your Netlify function to run the account handshake
            apiKey: acculynxConfig?.apiKey || "",
            accessToken,
          }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => `HTTP ${response.status}`);
          throw new Error(errText);
        }

        showToast(t.stAxSyncOk, "success");
      } catch (pingErr) {
        // The credentials above did save successfully — only the connection test failed.
        console.warn("Proxy handshake notification summary:", pingErr);
        showToast(`${t.stAxGatewayFail} ${pingErr.message || t.stNetworkTimeout}`, "warning");
      }
    } finally {
      setSavingAx(false);
    }
  };

  // AccuLynx requires a destination folder id on every document upload, and folder
  // ids are per-company, so this can only be filled in after the token is saved.
  const handleLoadFolders = async () => {
    setLoadingFolders(true);
    try {
      const folders = await fetchAccuLynxDocumentFolders(acculynxConfig);
      setDocFolders(folders);
      if (folders.length === 0) {
        showToast(`${t.stLoadFoldersFail} none found`, "warning");
      }
    } catch (err) {
      showToast(`${t.stLoadFoldersFail} ${err.message}`, "error");
    } finally {
      setLoadingFolders(false);
    }
  };

  // ── 🆕 LOOKUP SUBMIT HANDLER ADDED ───────────────────────────────────────────
  const handleTestLookup = async () => {
    if (!lookupPo.trim()) return;
    setLookingUp(true);
    setLookupResult(null);
    try {
      const job = await fetchAccuLynxJob({ poNumber: lookupPo.trim() }, acculynxConfig);
      setLookupResult({ ok: true, job });
    } catch (err) {
      setLookupResult({ ok: false, error: err.message });
    } finally {
      setLookingUp(false);
    }
  };

  // BUG FIX #3 — upsert instead of update so first upload doesn't silently fail
  const handleLogoFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      await compressImg(file, 400, 0.85, async (base64Data) => {
        if (!base64Data) {
          showToast(t.stCompressFail, "error");
          return;
        }
        // The logo lives on the company row now, not in `settings`. The login screen
        // has to render it BEFORE anyone authenticates, and it reads it through
        // company_branding(slug) — an anon-safe lookup that can't be used to
        // enumerate the customer list the way an open SELECT on settings could.
        const { error } = await supabase.rpc("set_company_branding", {
          patch: { logo: base64Data },
        });
        if (error) throw error;
        if (typeof setLogos === "function") setLogos(base64Data);
        showToast(t.stLogoSaved, "success");
      }, (msg) => showToast(msg, "error"));
    } catch (err) {
      showToast(`${t.stLogoUploadFail} ${err.message}`, "error");
    } finally {
      e.target.value = "";
    }
  };

  // Clear the logo back to null on the company row (same merge RPC, same admin gate).
  // Reports, the sidebar, and the login screen all fall back to the default mark.
  const handleRemoveLogo = async () => {
    if (!window.confirm(t.stRemoveLogoConfirm)) return;
    try {
      const { error } = await supabase.rpc("set_company_branding", {
        patch: { logo: null },
      });
      if (error) throw error;
      if (typeof setLogos === "function") setLogos(null);
      showToast(t.stLogoRemoved, "success");
    } catch (err) {
      showToast(`${t.stLogoRemoveFail} ${err.message}`, "error");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", maxWidth: "100%", padding: "4px 0" }}>

      {/* Tab bar */}
      <div style={{
        display: "flex", gap: "var(--space-1)", marginBottom: 20,
        borderBottom: `1px solid ${T.border}`, paddingBottom: 0, flexWrap: "wrap",
      }}>
        {tabs.map((tab) => {
          const active = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              style={{
                display: "flex", alignItems: "center", gap: "var(--space-2)",
                padding: "9px 16px",
                border: "none", borderBottom: active ? `2px solid ${T.blue}` : "2px solid transparent",
                background: "none", fontSize: "var(--text-base)", fontWeight: active ? 700 : 500,
                color: active ? T.blue : T.slate,
                cursor: "pointer", transition: "all 0.15s ease",
                marginBottom: -1,
              }}
            >
              <span style={{ fontSize: "var(--text-md)" }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── PANEL: Permissions ─────────────────────────────────────────── */}
      {currentTab === "Permissions" && (
        <Card>
          <SectionTitle icon="🔒" title={t.stRolePerms} subtitle={t.stRolePermsDesc} />
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 860 }}>

              {/* Header row */}
              <div style={{
                display: "flex", alignItems: "center",
                padding: "10px 16px",
                background: T.bg, borderRadius: T.radius,
                border: `1px solid ${T.border}`,
                marginBottom: 8,
              }}>
                <div style={{ width: "36%", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: T.slateL, textTransform: "uppercase", letterSpacing: "0.6px" }}>
                  {t.stPermission}
                </div>
                <div style={{ width: "64%", display: "flex" }}>
                  {/* BUG FIX #5 — guard on roleArray before destructuring */}
                  {ROLE_COLS?.map((roleArray) => {
                    if (!Array.isArray(roleArray)) return null;
                    const [roleKey, roleLabel] = roleArray;
                    return (
                      <div key={roleKey} style={{ width: "20%", textAlign: "center" }}>
                        <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-extrabold)", color: T.navy, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                          {roleLabel}
                        </div>
                        <button
                          onClick={() => handleResetRole(roleKey)}
                          style={{
                            background: "none", border: "none", color: T.blue,
                            fontSize: "var(--text-xs)", cursor: "pointer", marginTop: 3,
                            fontWeight: "var(--weight-semibold)", padding: 0,
                          }}
                        >
                          ↩ Reset
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Permission rows */}
              {PERM_GROUPS?.map(([groupTitle, groupKeys]) => (
                <div key={groupTitle} style={{ marginBottom: 10 }}>
                  <div style={{
                    background: T.shell, padding: "8px 16px",
                    fontWeight: "var(--weight-bold)", color: T.shellInk, fontSize: "var(--text-xs)",
                    letterSpacing: "0.7px", textTransform: "uppercase",
                    borderRadius: `${T.radius} ${T.radius} 0 0`,
                  }}>
                    {groupTitle}
                  </div>

                  <div style={{ border: `1px solid ${T.border}`, borderTop: "none", borderRadius: `0 0 ${T.radius} ${T.radius}`, overflow: "hidden" }}>
                    {Array.isArray(groupKeys) && groupKeys.map((pKey, idx) => (
                      <div
                        key={pKey}
                        style={{
                          display: "flex", alignItems: "center",
                          padding: "13px 16px",
                          borderTop: idx === 0 ? "none" : `1px solid ${T.border}`,
                          background: T.white,
                        }}
                      >
                        <div style={{ width: "36%", paddingRight: 16 }}>
                          <div style={{ fontWeight: "var(--weight-semibold)", color: T.navy, fontSize: "var(--text-base)" }}>
                            {PERM_DEFS[pKey]?.label || pKey}
                          </div>
                          <div style={{ fontSize: "var(--text-xs)", color: T.slateL, marginTop: 2 }}>
                            {PERM_DEFS[pKey]?.desc || ""}
                          </div>
                        </div>
                        <div style={{ width: "64%", display: "flex" }}>
                          {ROLE_COLS?.map((roleArray) => {
                            if (!Array.isArray(roleArray)) return null;
                            const [roleKey] = roleArray;
                            return (
                              <div key={roleKey} style={{ width: "20%", display: "flex", justifyContent: "center" }}>
                                <Toggle
                                  on={!!rolePerms?.[roleKey]?.[pKey]}
                                  onChange={() => handleTogglePerm(roleKey, pKey)}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* ── PANEL: Automations ────────────────────────────────────────── */}
      {currentTab === "Automations" && (
        <>
          {AUTOMATION_GROUPS.map((group) => (
            <Card key={group.id} style={{ marginBottom: 20 }}>
              <SectionTitle
                icon={group.icon}
                title={`${group.label} ${t.stAutomationsTitle}`}
                subtitle={group.blurb}
              />
              <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: "hidden", marginTop: 8 }}>
                {automationsForGroup(group.id).map((row, idx) => (
                  <div
                    key={row.key}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: "var(--space-4)", padding: "14px 16px",
                      borderTop: idx === 0 ? "none" : `1px solid ${T.border}`,
                      background: T.white,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: "var(--weight-bold)", color: T.navy || T.slate, fontSize: "var(--text-base)" }}>{row.label}</div>
                      <div style={{ fontSize: "var(--text-sm)", color: T.slateL }}>{row.desc}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: T.slateL, marginTop: 4 }}>
                        ✉️ {t.stAutomationSendsTo} <strong>{row.recipient}</strong>
                      </div>
                    </div>
                    <Toggle
                      on={!!automationForm[group.id]?.[row.key]}
                      onChange={() => toggleAutomation(group.id, row.key)}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <Btn v="primary" onClick={() => saveAutomations(group)} disabled={savingGroup === group.id}>
                  {savingGroup === group.id ? "Saving…" : t.stSaveAutomations}
                </Btn>
              </div>
            </Card>
          ))}
          <div style={{ fontSize: "var(--text-xs)", color: T.slateL, marginTop: 4 }}>
            {t.stAutomationsFootnote}
          </div>
        </>
      )}

      {/* ── PANEL: CRM Integration ─────────────────────────────────────── */}
      {currentTab === "CRM" && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: "var(--space-5)" }}>
            <SectionTitle
              icon="🔗"
              title={t.stAxIntegration}
              subtitle="Files the job completion report PDF in the AccuLynx job's Documents. The PDF button in Pull Inventory only opens the report for printing; uploading is Sync Upload's job."
            />
            {/* 🟢 Status pill updated to seamlessly allow headless environment configurations */}
            <StatusPill
              active={!!(acculynxConfig?.enabled && acculynxConfig?.proxyUrl)}
              labelOn={t.stConnected}
              labelOff={t.stNotConfigured}
            />
          </div>

          <Alert type="warning">
            ⚠️ API tokens are sent through your proxy server — never directly from the browser.
          </Alert>

          <form onSubmit={handleSaveAccuLynx}>
            <div className="sw-grid-2" style={{ gap: "var(--space-7)", marginBottom: 20 }}>
              <Fld label={t.stApiToken}>
                <Inp
                  type="password"
                  value={acculynxConfig?.apiKey || ""}
                  onChange={(e) => setAccuLynxConfig((p) => ({ ...p, apiKey: e.target.value }))}
                  placeholder={t.stApiTokenPlaceholder}
                />
              </Fld>
              <Fld label={t.stProxyUrl}>
                <Inp
                  type="text"
                  value={acculynxConfig?.proxyUrl || ""}
                  onChange={(e) => setAccuLynxConfig((p) => ({ ...p, proxyUrl: e.target.value }))}
                  placeholder="/.netlify/functions/acculynx-sync"
                />
              </Fld>
            </div>

            <div style={{
              display: "flex", gap: "var(--space-10)", marginBottom: 24,
              padding: "16px 20px",
              background: T.bg, borderRadius: T.radius,
              border: `1px solid ${T.border}`,
              flexWrap: "wrap",
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", cursor: "pointer" }}>
                <Toggle
                  on={!!acculynxConfig?.enabled}
                  onChange={() => setAccuLynxConfig((p) => ({ ...p, enabled: !p.enabled }))}
                />
                <div>
                  <div style={{ fontWeight: "var(--weight-bold)", color: T.navy, fontSize: "var(--text-base)" }}>{t.stEnableIntegration}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: T.slateL, marginTop: 1 }}>{t.stEnableIntegrationDesc}</div>
                </div>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", cursor: "pointer" }}>
                <Toggle
                  on={!!acculynxConfig?.autoSync}
                  onChange={() => setAccuLynxConfig((p) => ({ ...p, autoSync: !p.autoSync }))}
                />
                <div>
                  <div style={{ fontWeight: "var(--weight-bold)", color: T.navy, fontSize: "var(--text-base)" }}>{t.stAutoSync}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: T.slateL, marginTop: 1 }}>{t.stAutoSyncDesc}</div>
                </div>
              </label>
            </div>

            {acculynxConfig?.enabled && (
              <div style={{ marginBottom: 24 }}>
                <Fld label={t.stDocFolder}>
                  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
                    <Sel
                      value={acculynxConfig?.documentFolderId || ""}
                      onChange={(e) => {
                        const id = e.target.value;
                        // Store the name alongside the id purely so the picker can label
                        // the saved folder before the list has been fetched again.
                        const name = docFolders.find((f) => f.id === id)?.name || "";
                        setAccuLynxConfig((p) => ({ ...p, documentFolderId: id, documentFolderName: name }));
                      }}
                      style={{ flex: 1 }}
                    >
                      <option value="">{t.stDocFolderNone}</option>
                      {/* A previously saved folder still shows while the list is unloaded,
                          so opening Settings can't silently blank an existing choice. */}
                      {docFolders.length === 0 && acculynxConfig?.documentFolderId && (
                        <option value={acculynxConfig.documentFolderId}>
                          {acculynxConfig.documentFolderName || acculynxConfig.documentFolderId}
                        </option>
                      )}
                      {docFolders.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </Sel>
                    <Btn v="ghost" type="button" onClick={handleLoadFolders} disabled={loadingFolders}>
                      {loadingFolders ? "⏳" : `📁 ${t.stLoadFolders}`}
                    </Btn>
                  </div>
                </Fld>
                <div style={{ fontSize: "var(--text-xs)", color: T.slateL, marginTop: 6 }}>{t.stDocFolderHint}</div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              <Btn v="primary" type="submit" disabled={savingAx}>
                {savingAx ? "⏳ Saving…" : "💾 Save & Test Connection"}
              </Btn>
            </div>
          </form>

          {/* ── 🆕 TEST JOB LOOKUP SECTION ADDED ───────────────────────────────── */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
            <div style={{ fontWeight: "var(--weight-bold)", color: T.navy, fontSize: "var(--text-base)", marginBottom: 10 }}>{t.stTestLookup}</div>
            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              <Inp value={lookupPo} onChange={(e) => setLookupPo(e.target.value)} placeholder={t.stPoPlaceholder} />
              <Btn type="button" onClick={handleTestLookup} disabled={lookingUp}>
                {lookingUp ? "⏳" : "🔍 Lookup"}
              </Btn>
            </div>
            {lookupResult && (
              <Alert type={lookupResult.ok ? "info" : "warning"}>
                {lookupResult.ok
                  ? `Found job: ${lookupResult.job?.jobNumber || lookupResult.job?.id}`
                  : `Lookup failed: ${lookupResult.error}`}
              </Alert>
            )}
          </div>
        </Card>
      )}


      

      {/* ── PANEL: Branding ────────────────────────────────────────────── */}
      {currentTab === "Branding" && (
        <Card>
          <SectionTitle
            icon="🏢"
            title={t.stCompanyDetails}
            subtitle={t.stCompanyDetailsDesc}
          />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)", paddingTop: 12, marginBottom: 8 }}>
            <Fld label={t.stCompanyName} hint={t.stCompanyNameHint}>
              <Inp
                value={brandForm.displayName}
                onChange={(e) => setBrandForm({ ...brandForm, displayName: e.target.value })}
                placeholder={t.stCompanyNamePlaceholder}
                disabled={savingBrand}
              />
            </Fld>
            <Fld label={t.stTagline} hint={t.stTaglineHint}>
              <Inp
                value={brandForm.tagline}
                onChange={(e) => setBrandForm({ ...brandForm, tagline: e.target.value })}
                placeholder={t.stTaglinePlaceholder}
                disabled={savingBrand}
              />
            </Fld>
            <Fld label={t.stAccentColor} hint={t.stAccentColorHint}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="color"
                  value={brandForm.accent || "var(--c-amber)"}
                  onChange={(e) => setBrandForm({ ...brandForm, accent: e.target.value })}
                  disabled={savingBrand}
                  aria-label={t.stAccentAria}
                  style={{ width: 48, height: 38, border: `1.5px solid ${T.border}`, borderRadius: T.radius, background: "none", cursor: "pointer", padding: 2 }}
                />
                <code style={{ fontSize: "var(--text-sm)", color: T.slateL }}>{(brandForm.accent || "var(--c-amber)").toUpperCase()}</code>
                {(brandForm.accent || "").toLowerCase() !== "var(--c-amber)" && (
                  <button
                    type="button"
                    onClick={() => setBrandForm({ ...brandForm, accent: "var(--c-amber)" })}
                    disabled={savingBrand}
                    style={{ background: "none", border: "none", color: T.blue, fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", padding: 0 }}
                  >
                    {t.stReset}
                  </button>
                )}
              </div>
            </Fld>
            <Fld label={t.stState} hint={t.stStateHint}>
              <Sel value={brandForm.state} onChange={(e) => applyState(e.target.value)} disabled={savingBrand}>
                <option value="">{t.stSelectState}</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </Sel>
            </Fld>
            <Fld label={t.stTaxRate} hint="Auto-filled from your state, or set it by hand. Local county/city tax may add on top. Leave blank for 7%.">
              <Inp
                type="number"
                step="0.01"
                value={brandForm.taxRate}
                onChange={(e) => setBrandForm({ ...brandForm, taxRate: e.target.value })}
                placeholder="7"
                disabled={savingBrand}
              />
            </Fld>
            <Fld label={t.stTaxLabel} hint={t.stTaxLabelHint}>
              <Inp
                value={brandForm.taxLabel}
                onChange={(e) => setBrandForm({ ...brandForm, taxLabel: e.target.value })}
                placeholder={t.stSalesTax}
                disabled={savingBrand}
              />
            </Fld>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
            <Btn v="primary" onClick={saveBranding} disabled={savingBrand}>
              {savingBrand ? "Saving…" : "Save Company Details"}
            </Btn>
          </div>

          <SectionTitle
            icon="🖼️"
            title={t.stCompanyLogo}
            subtitle={t.stCompanyLogoDesc}
          />

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 12 }}>
            {logos && (
              <div style={{
                marginBottom: 20, padding: 12,
                background: T.bg, borderRadius: T.radius,
                border: `1px solid ${T.border}`,
              }}>
                <img
                  src={logos}
                  alt={t.stCurrentLogo}
                  style={{ maxHeight: 80, maxWidth: 240, display: "block", objectFit: "contain" }}
                />
              </div>
            )}

            <label style={{
              border: `2px dashed ${T.blueRing}`,
              borderRadius: T.radiusLg,
              padding: "48px 40px",
              textAlign: "center",
              background: T.blueSoft,
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: "var(--space-3)", cursor: "pointer",
              width: "100%", maxWidth: 360,
              transition: "background 0.15s ease",
            }}>
              <span style={{ fontSize: 28 }}>🖼️</span>
              <div style={{ fontWeight: "var(--weight-bold)", color: T.blue, fontSize: "var(--text-md)" }}>
                {logos ? "Replace logo" : "Upload logo"}
              </div>
              <div style={{ fontSize: "var(--text-sm)", color: T.slateL }}>{t.stLogoFormats}</div>
              <input type="file" accept="image/*" onChange={handleLogoFileChange} style={{ display: "none" }} />
            </label>

            {logos && (
              <Btn v="danger" sz="sm" onClick={handleRemoveLogo} style={{ marginTop: 14 }}>
                🗑️ Remove logo
              </Btn>
            )}
          </div>
        </Card>
      )}

      {/* ── PANEL: Warehouses ──────────────────────────────────────────── */}
      {currentTab === "Warehouses" && (
        <Card>
          <SectionTitle
            icon="🏭"
            title={t.stWarehouses}
            subtitle={t.stWarehousesDesc}
          />

          {/* BUG FIX #4 — added success toast in handleAddWarehouse above */}
          <form onSubmit={handleAddWarehouse} style={{
            display: "flex", gap: "var(--space-5)", alignItems: "flex-end",
            flexWrap: "wrap", marginBottom: 20,
            padding: "16px 20px",
            background: T.bg, borderRadius: T.radius,
            border: `1px solid ${T.border}`,
          }}>
            <div style={{ flex: 2, minWidth: 180 }}>
              <Fld label={t.stFacilityName}>
                <Inp
                  value={whForm.name}
                  onChange={(e) => setWhForm({ ...whForm, name: e.target.value })}
                  placeholder={t.stFacilityPlaceholder}
                  required
                />
              </Fld>
            </div>
            <div style={{ flex: 1, minWidth: 90 }}>
              <Fld label={t.stCode}>
                <Inp
                  value={whForm.code}
                  onChange={(e) => setWhForm({ ...whForm, code: e.target.value })}
                  placeholder={t.stCodePlaceholder}
                />
              </Fld>
            </div>
            <div style={{ flex: 2, minWidth: 180 }}>
              <Fld label={t.stLocation}>
                <Inp
                  value={whForm.location}
                  onChange={(e) => setWhForm({ ...whForm, location: e.target.value })}
                  placeholder={t.stLocationPlaceholder}
                />
              </Fld>
            </div>
            <div style={{ paddingBottom: 1 }}>
              <Btn v="primary" type="submit" style={{ height: 38 }}>
                ➕ Add
              </Btn>
            </div>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {warehouses?.length > 0 ? warehouses.map((w) => (
              <div key={w.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "13px 18px",
                background: T.bg, borderRadius: T.radius,
                border: `1px solid ${T.border}`,
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: 3 }}>
                    <span style={{ fontWeight: "var(--weight-bold)", color: T.navy, fontSize: "var(--text-md)" }}>{w.name}</span>
                    {w.code && (
                      <span style={{
                        fontSize: "var(--text-2xs)", fontWeight: "var(--weight-extrabold)", color: T.blue,
                        background: T.blueSoft, border: `1px solid ${T.blueRing}`,
                        padding: "1px 7px", borderRadius: "var(--radius-pill)", letterSpacing: "0.5px",
                      }}>
                        {w.code}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "var(--text-sm)", color: T.slateL }}>
                    📍 {w.location || "No address logged"}
                  </div>
                </div>
                <StatusPill active={w.active} labelOn={t.stOperational} labelOff={t.stInactive} />
              </div>
            )) : (
              <p style={{ margin: 0, fontSize: "var(--text-base)", color: T.slateL, fontStyle: "italic", textAlign: "center", padding: "32px 0" }}>
                {t.stNoWarehouses}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ── PANEL: System ──────────────────────────────────────────────── */}
      {currentTab === "System" && (
        <Card>
          <SectionTitle icon="ℹ️" title={t.stSystemInfo} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-5)" }}>
            {[
              { label: "Version",      value: "WMS v5.0" },
              { label: "Storage",      value: "Supabase (row-level security)" },
              { label: "Photos",       value: "Auto-compressed JPEG" },
              { label: "PDF Engine",   value: "Browser print → Save as PDF" },
              { label: "AccuLynx",     value: acculynxConfig?.enabled && acculynxConfig?.proxyUrl ? "Enabled" : "Not configured" },
              { label: "Permissions",  value: "Role-based with per-user overrides" },
            ].map(({ label, value }) => (
              <div key={label} style={{
                padding: "14px 16px",
                background: T.bg, borderRadius: T.radius,
                border: `1px solid ${T.border}`,
              }}>
                <div style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", color: T.slateL, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 5 }}>
                  {label}
                </div>
                <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", color: T.navy }}>{value}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}