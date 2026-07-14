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
import { Btn, Bdg, Fld, Inp, Toggle } from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { useNotify } from "../context/NotificationContext";
// ── 🆕 IMPORT ADDED ──────────────────────────────────────────────────────────
import { fetchAccuLynxJob } from "../utils/accuLynxSync";

// ── Design tokens ────────────────────────────────────────────────────────────
const T = {
  navy:    "#0f172a",
  blue:    "#1d4ed8",
  blueSoft:"#eff6ff",
  blueRing:"#bfdbfe",
  slate:   "#475569",
  slateL:  "#94a3b8",
  border:  "#e2e8f0",
  bg:      "#f8fafc",
  white:   "#ffffff",
  green:   "#16a34a",
  greenBg: "#f0fdf4",
  greenBd: "#bbf7d0",
  amber:   "#b45309",
  amberBg: "#fffbeb",
  amberBd: "#fef3c7",
  red:     "#dc2626",
  redBg:   "#fef2f2",
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
  rolePerms,
  setRolePerms,
  acculynxConfig,
  setAccuLynxConfig,
  users,
  setUsers,
  curUser,
}) {
  const { showToast } = useNotify();
  const [currentTab, setCurrentTab] = useState("Permissions");
  const [whForm, setWhForm]         = useState({ name: "", location: "", code: "" });
  const [savingAx, setSavingAx]     = useState(false);

  // ── 🆕 TEST LOOKUP LOCAL STATE ADDED ─────────────────────────────────────────
  const [lookupPo, setLookupPo]         = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookingUp, setLookingUp]       = useState(false);

  const tabs = [
    { id: "Permissions", label: "Permissions", icon: "🔒" },
    { id: "AccuLynx",   label: "AccuLynx",    icon: "🔗" },
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
      showToast("Warehouse added.", "success");
    } catch (err) {
      showToast("Failed to add warehouse: " + err.message, "error");
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
      showToast(`Permission update failed: ${err.message}`, "error");
    }
  };

  const handleResetRole = async (targetRole) => {
    const defaults = DEFAULT_ROLE_PERMS?.[targetRole] || {};
    if (!window.confirm(`Reset all permissions for "${targetRole}" to defaults?`)) return;

    try {
      const { error } = await supabase.from("role_permissions").upsert(
        { role: targetRole, permissions: defaults, updated_at: new Date().toISOString() },
        { onConflict: "company_id,role" },
      );
      if (error) throw error;
      setRolePerms((prev) => ({ ...prev, [targetRole]: defaults }));
      showToast(`${targetRole} permissions reset.`, "success");
    } catch (err) {
      showToast(`Reset failed: ${err.message}`, "error");
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
          showToast(`Failed to save AccuLynx key: ${keyError.message}`, "error");
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
        showToast(`Failed to save AccuLynx settings: ${error.message}`, "error");
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

        showToast("AccuLynx Gateway synchronization confirmed and running successfully! 🔄", "success");
      } catch (pingErr) {
        // The credentials above did save successfully — only the connection test failed.
        console.warn("Proxy handshake notification summary:", pingErr);
        showToast(`Credentials saved, but the gateway test failed: ${pingErr.message || "Network Timeout"}`, "warning");
      }
    } finally {
      setSavingAx(false);
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
          showToast("Image compression failed.", "error");
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
        showToast("Logo saved.", "success");
      }, (msg) => showToast(msg, "error"));
    } catch (err) {
      showToast(`Logo upload failed: ${err.message}`, "error");
    } finally {
      e.target.value = "";
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
          <SectionTitle icon="🔒" title="Role Permissions" subtitle="Control what each role can see and do across the system." />
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
                  Permission
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
                    background: T.navy, padding: "8px 16px",
                    fontWeight: "var(--weight-bold)", color: T.white, fontSize: "var(--text-xs)",
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

      {/* ── PANEL: AccuLynx ────────────────────────────────────────────── */}
      {currentTab === "AccuLynx" && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: "var(--space-5)" }}>
            <SectionTitle
              icon="🔗"
              title="AccuLynx Integration"
              subtitle="When a job is marked Complete, the dashboard uploads the material cost PDF and adds a payment line item to AccuLynx automatically."
            />
            {/* 🟢 Status pill updated to seamlessly allow headless environment configurations */}
            <StatusPill
              active={!!(acculynxConfig?.enabled && acculynxConfig?.proxyUrl)}
              labelOn="Connected"
              labelOff="Not configured"
            />
          </div>

          <Alert type="warning">
            ⚠️ API tokens are sent through your proxy server — never directly from the browser.
          </Alert>

          <form onSubmit={handleSaveAccuLynx}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-7)", marginBottom: 20 }}>
              <Fld label="API Access Token">
                <Inp
                  type="password"
                  value={acculynxConfig?.apiKey || ""}
                  onChange={(e) => setAccuLynxConfig((p) => ({ ...p, apiKey: e.target.value }))}
                  placeholder="Enter your AccuLynx API key"
                />
              </Fld>
              <Fld label="Proxy Gateway URL">
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
                  <div style={{ fontWeight: "var(--weight-bold)", color: T.navy, fontSize: "var(--text-base)" }}>Enable integration</div>
                  <div style={{ fontSize: "var(--text-xs)", color: T.slateL, marginTop: 1 }}>Allow the dashboard to contact AccuLynx</div>
                </div>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", cursor: "pointer" }}>
                <Toggle
                  on={!!acculynxConfig?.autoSync}
                  onChange={() => setAccuLynxConfig((p) => ({ ...p, autoSync: !p.autoSync }))}
                />
                <div>
                  <div style={{ fontWeight: "var(--weight-bold)", color: T.navy, fontSize: "var(--text-base)" }}>Auto-sync on completion</div>
                  <div style={{ fontSize: "var(--text-xs)", color: T.slateL, marginTop: 1 }}>Fire automatically when a job is marked complete</div>
                </div>
              </label>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              <Btn v="primary" type="submit" disabled={savingAx}>
                {savingAx ? "⏳ Saving…" : "💾 Save & Test Connection"}
              </Btn>
            </div>
          </form>

          {/* ── 🆕 TEST JOB LOOKUP SECTION ADDED ───────────────────────────────── */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
            <div style={{ fontWeight: "var(--weight-bold)", color: T.navy, fontSize: "var(--text-base)", marginBottom: 10 }}>Test job lookup</div>
            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              <Inp value={lookupPo} onChange={(e) => setLookupPo(e.target.value)} placeholder="Enter PO number" />
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
            title="Company Branding"
            subtitle="Your logo appears in the sidebar, login screen, and all PDF reports."
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
                  alt="Current company logo"
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
              <div style={{ fontSize: "var(--text-sm)", color: T.slateL }}>PNG, JPG, or SVG — compressed automatically</div>
              <input type="file" accept="image/*" onChange={handleLogoFileChange} style={{ display: "none" }} />
            </label>
          </div>
        </Card>
      )}

      {/* ── PANEL: Warehouses ──────────────────────────────────────────── */}
      {currentTab === "Warehouses" && (
        <Card>
          <SectionTitle
            icon="🏭"
            title="Warehouse Facilities"
            subtitle="Manage physical branches connected to material balance feeds."
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
              <Fld label="Facility Name">
                <Inp
                  value={whForm.name}
                  onChange={(e) => setWhForm({ ...whForm, name: e.target.value })}
                  placeholder="e.g. Saint Joe Road"
                  required
                />
              </Fld>
            </div>
            <div style={{ flex: 1, minWidth: 90 }}>
              <Fld label="Code">
                <Inp
                  value={whForm.code}
                  onChange={(e) => setWhForm({ ...whForm, code: e.target.value })}
                  placeholder="e.g. SJR"
                />
              </Fld>
            </div>
            <div style={{ flex: 2, minWidth: 180 }}>
              <Fld label="Location">
                <Inp
                  value={whForm.location}
                  onChange={(e) => setWhForm({ ...whForm, location: e.target.value })}
                  placeholder="e.g. Fort Wayne, IN"
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
                <StatusPill active={w.active} labelOn="Operational" labelOff="Inactive" />
              </div>
            )) : (
              <p style={{ margin: 0, fontSize: "var(--text-base)", color: T.slateL, fontStyle: "italic", textAlign: "center", padding: "32px 0" }}>
                No warehouses registered yet. Add one above.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ── PANEL: System ──────────────────────────────────────────────── */}
      {currentTab === "System" && (
        <Card>
          <SectionTitle icon="ℹ️" title="System Information" />

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