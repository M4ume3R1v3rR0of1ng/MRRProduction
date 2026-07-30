// src/views/OwnerConsole.jsx
//
// The platform owner's console — the "local company dashboard" from the original
// thread. Visible ONLY to a platform admin (you), and every action it takes goes
// through a SECURITY DEFINER RPC in supabase/06_platform_admin.sql that re-checks
// is_platform_admin() server-side. Hiding this view in the UI is convenience;
// the real gate is in the database, so a non-owner poking the same RPCs gets nothing.
import { useEffect, useState } from "react";
import { supabase, getAccessToken } from "../utils/supabase";
import { C, tot } from "../utils/helpers";
import { translations } from "../utils/translations";
import { BRAND, TrussMark } from "../components/SteadwerkMark";
import { useNotify } from "../context/NotificationContext";

const STATUS_STYLE = {
  active:    { bg: "var(--c-pasture-wash)", fg: BRAND.pasture, label: "Active" },
  trialing:  { bg: "var(--c-slate-wash)", fg: "var(--c-slate)", label: "Trial" },
  past_due:  { bg: "var(--c-warn-wash)", fg: BRAND.amberDeep, label: "Past due" },
  canceled:  { bg: "var(--c-subtle)", fg: BRAND.plowshare, label: "Canceled" },
  suspended: { bg: "var(--c-rust-wash)", fg: BRAND.rust, label: "Suspended" },
};

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtBytes(b) {
  const n = Number(b) || 0;
  if (n === 0) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function OwnerConsole({ user, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const { showToast } = useNotify();
  const [companies, setCompanies] = useState([]);
  const [usage, setUsage] = useState({}); // company_id -> { total_bytes, object_count }
  const [padmins, setPadmins] = useState([]);
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "" });
  // Hard-delete confirmation: the company pending deletion + the name the owner
  // must retype to arm the button. Null when the modal is closed.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Read-only cross-company drill-in: the company being inspected + its fetched data.
  const [viewCompany, setViewCompany] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);

  // Load a target company's operational data READ-ONLY. This works because a platform
  // admin's RLS already permits reading any company's rows; we just query with an
  // explicit company filter. Nothing here writes — it's oversight, not impersonation.
  const openCompanyView = async (company) => {
    setViewCompany(company);
    setViewData(null);
    setViewLoading(true);
    try {
      const [jobsRes, invRes, memsRes] = await Promise.all([
        supabase.from("jobs").select("*").eq("company_id", company.id),
        supabase.from("inventory").select("*").eq("company_id", company.id),
        supabase.from("memberships").select("user_id, role, active").eq("company_id", company.id),
      ]);
      const mems = memsRes.data || [];
      const memberIds = mems.map((m) => m.user_id);
      const { data: profs } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name, name, email").in("id", memberIds)
        : { data: [] };
      const roleByUser = Object.fromEntries(mems.map((m) => [m.user_id, m]));
      const members = (profs || []).map((p) => ({ ...p, role: roleByUser[p.id]?.role, active: roleByUser[p.id]?.active }));
      setViewData({ jobs: jobsRes.data || [], inventory: invRes.data || [], members });
    } catch (err) {
      showToast(`${t.ocLoadCompanyFail.replace("{name}", company.name)} ${err.message}`, "error");
      setViewData({ jobs: [], inventory: [], members: [] });
    } finally {
      setViewLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: usageRows }, { data: adminRows }] = await Promise.all([
      supabase.rpc("admin_list_companies"),
      supabase.rpc("admin_storage_usage"),
      supabase.rpc("admin_list_platform_admins"),
    ]);
    if (error) showToast(`${t.ocLoadCompaniesFail} ${error.message}`, "error");
    else setCompanies(data || []);
    setUsage(Object.fromEntries((usageRows || []).map((u) => [u.company_id, u])));
    setPadmins(adminRows || []);
    setLoading(false);
  };

  const grantAdmin = async (e) => {
    e.preventDefault();
    const email = adminEmail.trim().toLowerCase();
    if (!email) return;
    const { error } = await supabase.rpc("admin_set_platform_admin", { target_email: email, value: true });
    if (error) showToast(error.message, "error");
    else { showToast(t.ocNowPlatformAdmin.replace("{email}", email), "success"); setAdminEmail(""); await load(); }
  };

  const revokeAdmin = async (email) => {
    if (email === user.email && !window.confirm(t.ocRevokeOwnConfirm)) return;
    const { error } = await supabase.rpc("admin_set_platform_admin", { target_email: email, value: false });
    if (error) showToast(error.message, "error");
    else { showToast(t.ocNoLongerAdmin.replace("{email}", email), "success"); await load(); }
  };

  useEffect(() => { load(); }, []);

  // Belt-and-suspenders: the DB already refuses non-owners, but don't even render
  // the console to one.
  if (!user?.isPlatformAdmin) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.sub }}>
        {t.ocRestricted}
      </div>
    );
  }

  const setStatus = async (company, status) => {
    const verb = status === "suspended" ? t.ocVerbSuspend : status === "active" ? t.ocVerbReactivate : status;
    const warning = status === "suspended" ? ` ${t.ocSuspendWarning}` : "";
    if (!window.confirm(`${t.ocStatusConfirm.replace("{verb}", verb).replace("{name}", company.name)}${warning}`)) return;
    setBusyId(company.id);
    const { error } = await supabase.rpc("admin_set_company_status", { target: company.id, new_status: status });
    if (error) showToast(`${t.ocFailed} ${error.message}`, "error");
    else { showToast(t.ocStatusChanged.replace("{name}", company.name).replace("{status}", status), "success"); await load(); }
    setBusyId(null);
  };

  // Hard delete — irreversible. Routes through the delete-company function, which
  // re-checks platform-admin, that the company is suspended, and the typed name.
  // It also cancels Stripe, purges storage, and reaps orphaned logins server-side.
  const deleteCompany = async () => {
    if (!deleteTarget || confirmText.trim() !== deleteTarget.name || deleting) return;
    setDeleting(true);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/delete-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, companyId: deleteTarget.id, confirmName: confirmText.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const warn = Array.isArray(data.warnings) && data.warnings.length
        ? ` ${t.ocCleanupWarn} ${data.warnings.join("; ")}`
        : "";
      showToast(`${t.ocDeleted.replace("{name}", deleteTarget.name)}${warn}`, warn ? "warning" : "success");
      setDeleteTarget(null);
      setConfirmText("");
      await load();
    } catch (err) {
      showToast(`${t.ocDeleteFailed} ${err.message}`, "error");
    } finally {
      setDeleting(false);
    }
  };

  const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const createCompany = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const slug = form.slug.trim() || slugify(name);
    if (!name) return showToast(t.ocNameRequired, "warning");
    setCreating(true);
    const { error } = await supabase.rpc("admin_create_company", { p_name: name, p_slug: slug, p_status: "trialing" });
    if (error) showToast(`${t.ocFailed} ${error.message}`, "error");
    else { showToast(t.ocCreated.replace("{name}", name), "success"); setForm({ name: "", slug: "" }); await load(); }
    setCreating(false);
  };

  const totalActive = companies.filter((c) => ["active", "trialing", "past_due"].includes(c.subscription_status)).length;
  const totalBytes = Object.values(usage).reduce((s, u) => s + (Number(u.total_bytes) || 0), 0);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <TrussMark size={26} />
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 900, color: C.navy, margin: 0 }}>
          {t.ocTitle}
        </h1>
      </div>
      <p style={{ color: C.sub, fontSize: 14, marginBottom: 24 }}>
        {companies.length} companies · {totalActive} paying · {fmtBytes(totalBytes)} stored across the platform · signed in as {user.email}
      </p>

      {/* Create company */}
      <form onSubmit={createCompany} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", background: C.w, border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <div style={{ flex: "1 1 220px" }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>{t.ocNewCompany}</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: f.slug || slugify(e.target.value) }))}
            placeholder={t.ocNamePlaceholder}
            style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
          />
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>{t.ocSlug}</label>
          <input
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder={t.ocSlugPlaceholder}
            style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, fontFamily: "var(--font-mono)", boxSizing: "border-box" }}
          />
        </div>
        <button type="submit" disabled={creating} style={{ padding: "10px 20px", background: C.gold, color: C.navy, border: "none", borderRadius: 8, fontWeight: 800, fontSize: 14, cursor: creating ? "wait" : "pointer" }}>
          {creating ? "Creating…" : "Create company"}
        </button>
      </form>

      {/* Company table */}
      <div style={{ background: C.w, border: `1px solid ${C.bd}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 720 }}>
            <thead>
              <tr style={{ background: C.lg, textAlign: "left" }}>
                {["Company", "Status", "Users", "Storage", "Created", "Last activity", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "12px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: C.sub, fontWeight: 800 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: C.sub }}>{t.ocLoading}</td></tr>
              ) : companies.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: C.sub }}>{t.ocNoCompanies}</td></tr>
              ) : companies.map((co) => {
                const st = STATUS_STYLE[co.subscription_status] || { bg: C.lg, fg: C.sub, label: co.subscription_status };
                const suspended = co.subscription_status === "suspended";
                return (
                  <tr key={co.id} style={{ borderTop: `1px solid ${C.bd}` }}>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ fontWeight: 700, color: C.navy }}>{co.name}</div>
                      <div style={{ fontSize: 11, color: C.sub, fontFamily: "var(--font-mono)" }}>{co.slug}</div>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ background: st.bg, color: st.fg, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 800 }}>{st.label}</span>
                    </td>
                    <td style={{ padding: "12px 14px", color: C.navy }}>
                      {co.active_user_count}{co.user_count !== co.active_user_count ? <span style={{ color: C.sub }}> / {co.user_count}</span> : null}
                    </td>
                    <td style={{ padding: "12px 14px", color: C.sub }} title={`${usage[co.id]?.object_count || 0} files`}>
                      {fmtBytes(usage[co.id]?.total_bytes)}
                    </td>
                    <td style={{ padding: "12px 14px", color: C.sub }}>{fmtDate(co.created_at)}</td>
                    <td style={{ padding: "12px 14px", color: C.sub }}>{fmtDate(co.last_activity)}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => openCompanyView(co)} disabled={busyId === co.id}
                          style={{ padding: "6px 12px", background: "transparent", color: C.blue, border: `1.5px solid ${C.blue}`, borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                          {t.ocView}
                        </button>
                        {suspended ? (
                          <>
                            <button onClick={() => setStatus(co, "active")} disabled={busyId === co.id}
                              style={{ padding: "6px 12px", background: BRAND.pasture, color: "var(--c-on-accent)", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                              {t.ocReactivate}
                            </button>
                            {/* Delete is offered ONLY on suspended rows — suspend-then-delete is the
                                deliberate two-step that keeps a live company one click from safety. */}
                            <button onClick={() => { setDeleteTarget(co); setConfirmText(""); }} disabled={busyId === co.id}
                              style={{ padding: "6px 12px", background: BRAND.rust, color: "var(--c-on-accent)", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                              {t.ocDelete}
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setStatus(co, "suspended")} disabled={busyId === co.id}
                            style={{ padding: "6px 12px", background: "transparent", color: BRAND.rust, border: `1.5px solid ${BRAND.rust}`, borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                            {t.ocSuspend}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Platform administrators ──
          Only a platform admin can grant/revoke this role (enforced by the RPC),
          and the last one can never be removed. This is how the capability spreads —
          by an existing owner's hand, never self-assigned. */}
      <div style={{ background: C.w, border: `1px solid ${C.bd}`, borderRadius: 12, padding: 20, marginTop: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
          {t.ocPlatformAdmins}
        </div>
        <div style={{ fontSize: 12, color: C.sub, marginBottom: 14 }}>
          {t.ocPlatformAdminsDesc}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {padmins.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", background: C.lg, borderRadius: 8 }}>
              <div>
                <span style={{ fontWeight: 700, color: C.navy }}>{a.full_name || a.email}</span>
                <span style={{ color: C.sub, fontSize: 12, marginLeft: 8 }}>{a.email}</span>
                {a.email === user.email && <span style={{ color: BRAND.pasture, fontSize: 11, fontWeight: 800, marginLeft: 8 }}>you</span>}
              </div>
              <button
                onClick={() => revokeAdmin(a.email)}
                disabled={padmins.length === 1}
                title={padmins.length === 1 ? "Can't remove the last platform admin" : "Revoke"}
                style={{ padding: "4px 10px", background: "transparent", color: padmins.length === 1 ? C.sub : BRAND.rust, border: `1.5px solid ${padmins.length === 1 ? C.bd : BRAND.rust}`, borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: padmins.length === 1 ? "not-allowed" : "pointer" }}
              >
                {t.ocRevoke}
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={grantAdmin} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder={t.ocPromotePlaceholder}
            style={{ flex: "1 1 240px", padding: "10px 12px", border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
          />
          <button type="submit" style={{ padding: "10px 18px", background: C.shell, color: "var(--c-shell-ink)", border: "none", borderRadius: 8, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
            {t.ocGrantAdmin}
          </button>
        </form>
        <div style={{ fontSize: 11, color: C.sub, marginTop: 8 }}>
          The person must already have a Steadwerk login. Granting doesn't add them to any company — it's platform-wide oversight only.
        </div>
      </div>

      {/* ── Hard-delete confirmation ──
          Irreversible, so it demands the exact company name typed back before the
          button arms. The server re-checks every guard; this is the human gate. */}
      {deleteTarget && (
        <div
          onClick={() => !deleting && setDeleteTarget(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(23,27,31,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.w, borderRadius: 14, padding: 28, maxWidth: 460, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}
          >
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 900, color: BRAND.rust, marginBottom: 8 }}>
              {t.ocDeleteTitle.replace("{name}", deleteTarget.name)}
            </div>
            <p style={{ fontSize: 13, color: C.navy, lineHeight: 1.6, margin: "0 0 14px" }}>
              {t.ocDeleteWarning} <strong>{t.ocDeleteWarningBold}</strong> {t.ocDeleteWarningRest}
            </p>
            <label style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {t.ocTypeToConfirm} <span style={{ fontFamily: "var(--font-mono)", color: C.navy }}>{deleteTarget.name}</span> {t.ocToConfirm}
            </label>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && deleteCompany()}
              placeholder={deleteTarget.name}
              disabled={deleting}
              style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box", marginTop: 6 }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                style={{ padding: "9px 16px", background: "transparent", color: C.sub, border: `1.5px solid ${C.bd}`, borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: deleting ? "not-allowed" : "pointer" }}
              >
                {t.ocCancel}
              </button>
              <button
                onClick={deleteCompany}
                disabled={deleting || confirmText.trim() !== deleteTarget.name}
                style={{ padding: "9px 18px", background: confirmText.trim() === deleteTarget.name ? BRAND.rust : C.bd, color: C.onAccent, border: "none", borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: deleting || confirmText.trim() !== deleteTarget.name ? "not-allowed" : "pointer" }}
              >
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Read-only company drill-in ──
          Platform-admin oversight: inspect a tenant's live jobs, inventory, and team
          without leaving your own company. Read-only — nothing here writes. */}
      {viewCompany && (
        <div
          onClick={() => setViewCompany(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(23,27,31,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 1000, overflowY: "auto" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.w, borderRadius: 14, padding: 24, maxWidth: 880, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.4)", margin: "20px 0" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 900, color: C.navy }}>{viewCompany.name}</div>
              <button onClick={() => setViewCompany(null)} style={{ background: "none", border: "none", fontSize: 22, color: C.sub, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: C.sub, fontWeight: 700, marginBottom: 16 }}>{t.ocReadOnly}</div>

            {viewLoading || !viewData ? (
              <div style={{ padding: 32, textAlign: "center", color: C.sub }}>{t.ocLoading}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                {/* Jobs */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Jobs ({viewData.jobs.length})</div>
                  {viewData.jobs.length === 0 ? (
                    <div style={{ fontSize: 13, color: C.sub }}>{t.ocNoJobs}</div>
                  ) : (
                    <div style={{ overflowX: "auto", border: `1px solid ${C.bd}`, borderRadius: 8 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
                        <thead><tr style={{ background: C.lg, textAlign: "left" }}>
                          {["Status", "PO", "Name", "Assigned", "Created"].map((h) => (
                            <th key={h} style={{ padding: "8px 10px", fontSize: 11, textTransform: "uppercase", color: C.sub, fontWeight: 800 }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {viewData.jobs.slice(0, 100).map((j) => {
                            const sup = viewData.members.find((m) => m.id === (j.assignedto || j.assignedTo));
                            return (
                              <tr key={j.id} style={{ borderTop: `1px solid ${C.bd}` }}>
                                <td style={{ padding: "7px 10px", textTransform: "capitalize" }}>{j.status || "—"}</td>
                                <td style={{ padding: "7px 10px", color: C.sub }}>{j.po || "—"}</td>
                                <td style={{ padding: "7px 10px", fontWeight: 600, color: C.navy }}>{j.title || j.name || "—"}</td>
                                <td style={{ padding: "7px 10px", color: C.sub }}>{sup?.full_name || sup?.name || "—"}</td>
                                <td style={{ padding: "7px 10px", color: C.sub }}>{fmtDate(j.created || j.createdAt)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Inventory */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Inventory ({viewData.inventory.length})</div>
                  {viewData.inventory.length === 0 ? (
                    <div style={{ fontSize: 13, color: C.sub }}>{t.ocNoInventory}</div>
                  ) : (
                    <div style={{ overflowX: "auto", border: `1px solid ${C.bd}`, borderRadius: 8 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
                        <thead><tr style={{ background: C.lg, textAlign: "left" }}>
                          {["Item", "Category", "On hand", "Status"].map((h) => (
                            <th key={h} style={{ padding: "8px 10px", fontSize: 11, textTransform: "uppercase", color: C.sub, fontWeight: 800 }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {viewData.inventory.slice(0, 100).map((i) => {
                            const onHand = tot(i);
                            const low = onHand <= (i.alrt || 0);
                            return (
                              <tr key={i.id} style={{ borderTop: `1px solid ${C.bd}` }}>
                                <td style={{ padding: "7px 10px", fontWeight: 600, color: C.navy }}>{i.name}</td>
                                <td style={{ padding: "7px 10px", color: C.sub }}>{i.cat || "—"}</td>
                                <td style={{ padding: "7px 10px" }}>{onHand} {i.unit || ""}</td>
                                <td style={{ padding: "7px 10px" }}>
                                  <span style={{ color: low ? BRAND.rust : BRAND.pasture, fontWeight: 700 }}>{low ? "Low" : "OK"}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Team */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Team ({viewData.members.length})</div>
                  {viewData.members.length === 0 ? (
                    <div style={{ fontSize: 13, color: C.sub }}>{t.ocNoMembers}</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {viewData.members.map((m) => (
                        <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 10px", background: C.lg, borderRadius: 8, fontSize: 13 }}>
                          <span><span style={{ fontWeight: 700, color: C.navy }}>{m.full_name || m.name || m.email}</span> <span style={{ color: C.sub, marginLeft: 6 }}>{m.email}</span></span>
                          <span style={{ color: C.sub, fontWeight: 700, textTransform: "capitalize" }}>{m.role || "—"}{m.active === false ? " (inactive)" : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={() => setViewCompany(null)} style={{ padding: "9px 18px", background: C.shell, color: "var(--c-shell-ink)", border: "none", borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>{t.ocClose}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
