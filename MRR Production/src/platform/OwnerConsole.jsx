// src/platform/OwnerConsole.jsx
//
// The platform owner's console — the "local company dashboard" from the original
// thread. Visible ONLY to a platform admin (you), and every action it takes goes
// through a SECURITY DEFINER RPC in supabase/06_platform_admin.sql that re-checks
// is_platform_admin() server-side. Hiding this view in the UI is convenience;
// the real gate is in the database, so a non-owner poking the same RPCs gets nothing.
import { useEffect, useState } from "react";
import { supabase, getAccessToken } from "@/shared/utils/supabase";
import { C, tot } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import { BRAND, TrussMark } from "@/shared/components/SteadwerkMark";
import { useNotify } from "@/shared/context/NotificationContext";
import { logAction } from "@/shared/utils/logger";
import { BASE_SEATS } from "@/features/billing/seatPacks";

// Same duplication note as the pricing block atop LandingPage.jsx and the pricing
// constants in supabase/30_platform_revenue.sql: these dollar figures must match
// the real Stripe Prices this endpoint charges (STRIPE_BASE_PRICE_ID /
// STRIPE_ANNUAL_PRICE_ID). Nothing reconciles the three copies automatically —
// change what Stripe charges, change all three, or the modal quotes a number
// checkout doesn't honor.
const BASE_PRICE_MONTHLY = 99;
const BASE_PRICE_ANNUAL = 990;

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

// Whole dollars. Every amount here is a monthly subscription total, so the cents
// are always .00 or .50 and showing them just adds noise to a scanned column.
function fmtMoney(n) {
  return `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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
  const [revenue, setRevenue] = useState({}); // company_id -> admin_revenue_summary row
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
  // Start-billing modal: the comped company being converted to a real Stripe
  // subscription, plus the two fields Checkout needs that admin_create_company
  // never collected (there was no card yet to attach an email or cadence to).
  const [billingTarget, setBillingTarget] = useState(null);
  const [billingEmail, setBillingEmail] = useState("");
  const [billingInterval, setBillingInterval] = useState("monthly");
  const [startingBilling, setStartingBilling] = useState(false);
  // Read-only cross-company drill-in: the company being inspected + its fetched data.
  const [viewCompany, setViewCompany] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewBilling, setViewBilling] = useState(null); // admin-billing payload, or { error }

  // Load a target company's operational data READ-ONLY. This works because a platform
  // admin's RLS already permits reading any company's rows; we just query with an
  // explicit company filter. Nothing here writes — it's oversight, not impersonation.
  const openCompanyView = async (company) => {
    setViewCompany(company);
    setViewData(null);
    setViewBilling(null);
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

      // Billing comes from Stripe, so it is fetched separately and allowed to fail
      // on its own. A Stripe outage should cost you the invoice list, not the whole
      // drill-in.
      try {
        const accessToken = await getAccessToken();
        const res = await fetch("/.netlify/functions/admin-billing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken, companyId: company.id }),
        });
        const bill = await res.json().catch(() => ({}));
        setViewBilling(res.ok && bill.ok ? bill : { error: bill.error || `HTTP ${res.status}` });
      } catch (err) {
        setViewBilling({ error: err.message });
      }
    } catch (err) {
      showToast(`${t.ocLoadCompanyFail.replace("{name}", company.name)} ${err.message}`, "error");
      setViewData({ jobs: [], inventory: [], members: [] });
    } finally {
      setViewLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: usageRows }, { data: adminRows }, { data: revRows }] = await Promise.all([
      supabase.rpc("admin_list_companies"),
      supabase.rpc("admin_storage_usage"),
      supabase.rpc("admin_list_platform_admins"),
      supabase.rpc("admin_revenue_summary"),
    ]);
    if (error) showToast(`${t.ocLoadCompaniesFail} ${error.message}`, "error");
    else setCompanies(data || []);
    setUsage(Object.fromEntries((usageRows || []).map((u) => [u.company_id, u])));
    setPadmins(adminRows || []);
    // Keyed by company id so the table can look a row's revenue up without a second
    // pass. An empty map (migration 30 not run yet) leaves the column showing "—"
    // rather than breaking the console.
    setRevenue(Object.fromEntries((revRows || []).map((r) => [r.id, r])));
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

  // Opens a real Stripe Checkout Session for a comped company via
  // start-company-billing.js, then hands the platform admin off to it in a new tab
  // to enter a card. The company itself only flips to billed once stripe-webhook.js
  // sees that session complete — this call just starts that process, same as
  // clicking "Start your company" on the public signup does for a new one.
  const startBilling = async () => {
    const email = billingEmail.trim().toLowerCase();
    if (!billingTarget || !email || startingBilling) return;
    setStartingBilling(true);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/start-company-billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, companyId: billingTarget.id, billingEmail: email, billingInterval }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || `HTTP ${res.status}`);

      window.open(data.url, "_blank", "noopener");
      showToast(t.ocCheckoutOpened.replace("{name}", billingTarget.name), "success");
      setBillingTarget(null);
      setBillingEmail("");
      setBillingInterval("monthly");
    } catch (err) {
      showToast(`${t.ocStartBillingFailed} ${err.message}`, "error");
    } finally {
      setStartingBilling(false);
    }
  };

  // Step into a tenant and work as its admin. Distinct from the read-only drill-in
  // above: that is for looking, this is for fixing.
  //
  // The audit entry is written BEFORE the switch, so it lands in the owner's own
  // company log where it is attributable to them rather than appearing inside the
  // customer's history as though one of their staff did it. The reload is the same
  // reasoning as CompanySwitcher: every list and permission in memory belongs to
  // the previous company and none of it may survive the move.
  const enterCompany = async (company) => {
    if (!window.confirm(t.ocEnterConfirm.replace("{name}", company.name))) return;
    setBusyId(company.id);
    try {
      await logAction(
        user.id,
        user.email,
        "PLATFORM_ENTER_COMPANY",
        `Platform owner entered "${company.name}" (${company.slug}) as admin.`,
        { company_id: company.id },
        "production",
      );
      const { error } = await supabase.rpc("set_active_company", { target: company.id });
      if (error) throw error;
      window.location.reload();
    } catch (err) {
      showToast(`${t.ocFailed} ${err.message}`, "error");
      setBusyId(null);
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

  // Platform MRR. Only companies the RPC marked is_billed contribute, so comped
  // tenants and trials count as zero — see the header of supabase/30 for why.
  const revRows = Object.values(revenue);
  const totalMrr = revRows.reduce((s, r) => s + (Number(r.mrr) || 0), 0);
  const payingCount = revRows.filter((r) => r.is_billed).length;
  const trialCount = revRows.filter((r) => r.subscription_status === "trialing").length;

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <TrussMark size={26} />
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 900, color: C.navy, margin: 0 }}>
          {t.ocTitle}
        </h1>
      </div>
      <p style={{ color: C.sub, fontSize: 14, marginBottom: 18 }}>
        {companies.length} companies · {totalActive} active · {fmtBytes(totalBytes)} stored across the platform · signed in as {user.email}
      </p>

      {/* ── The business, in one line ──
          MRR leads because it is the number that decides everything else. ARR is
          just MRR × 12 and is shown because it is the figure people quote, not
          because it is separately measured. Trials sit beside them rather than
          inside them: nothing has been charged yet, so folding them into revenue
          would report money that does not exist. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {[
          { label: "Monthly recurring", value: fmtMoney(totalMrr), tone: BRAND.pasture, big: true },
          { label: "Annual run rate", value: fmtMoney(totalMrr * 12), tone: C.navy },
          { label: "Paying companies", value: String(payingCount), tone: C.navy },
          { label: "In trial", value: String(trialCount), tone: trialCount > 0 ? BRAND.amberDeep : C.sub },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: C.w,
              border: `1px solid ${C.bd}`,
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: s.big ? 28 : 22, fontWeight: 900, color: s.tone, lineHeight: 1.1 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

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
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 820 }}>
            <thead>
              <tr style={{ background: C.lg, textAlign: "left" }}>
                {["Company", "Status", "MRR", "Users", "Storage", "Created", "Last activity", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "12px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: C.sub, fontWeight: 800 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: C.sub }}>{t.ocLoading}</td></tr>
              ) : companies.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: C.sub }}>{t.ocNoCompanies}</td></tr>
              ) : companies.map((co) => {
                const st = STATUS_STYLE[co.subscription_status] || { bg: C.lg, fg: C.sub, label: co.subscription_status };
                const suspended = co.subscription_status === "suspended";
                const rev = revenue[co.id];
                return (
                  <tr key={co.id} style={{ borderTop: `1px solid ${C.bd}` }}>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ fontWeight: 700, color: C.navy }}>{co.name}</div>
                      <div style={{ fontSize: 11, color: C.sub, fontFamily: "var(--font-mono)" }}>{co.slug}</div>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ background: st.bg, color: st.fg, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 800 }}>{st.label}</span>
                    </td>
                    {/* Comped and trialing companies show a dash, not $0. Zero reads
                        as "this customer pays nothing", which is a problem; a dash
                        reads as "not billed", which is the actual situation. */}
                    <td style={{ padding: "12px 14px" }}>
                      {!rev ? (
                        <span style={{ color: C.sub }}>—</span>
                      ) : rev.is_billed ? (
                        <>
                          <span style={{ fontWeight: 800, color: BRAND.pasture }}>{fmtMoney(rev.mrr)}</span>
                          {rev.billing_interval === "annual" && (
                            <span style={{ fontSize: 11, color: C.sub, marginLeft: 5 }} title="Billed annually, shown as its monthly equivalent">
                              annual
                            </span>
                          )}
                          {rev.recurring_packs > 0 && (
                            <div style={{ fontSize: 11, color: C.sub }}>
                              base + {rev.recurring_packs} pack{rev.recurring_packs === 1 ? "" : "s"}
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: C.sub }} title={co.subscription_status === "trialing" ? "In trial — nothing charged yet" : "No Stripe subscription (comped)"}>
                          {co.subscription_status === "trialing" ? "trial" : "comped"}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "12px 14px", color: C.navy }}>
                      {co.active_user_count}{co.user_count !== co.active_user_count ? <span style={{ color: C.sub }}> / {co.user_count}</span> : null}
                      {rev?.grandfathered_packs > 0 && (
                        <div style={{ fontSize: 11, color: C.sub }} title="Seat packs bought under the old one-time pricing. They grant capacity but are never billed again.">
                          +{rev.grandfathered_packs} grandfathered
                        </div>
                      )}
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
                        {/* Not offered for the company you are already in — there is
                            nowhere to go, and the button would look like a no-op. */}
                        {co.id !== user.companyId && (
                          <button onClick={() => enterCompany(co)} disabled={busyId === co.id}
                            style={{ padding: "6px 12px", background: "transparent", color: C.plum, border: `1.5px solid ${C.plum}`, borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                            {t.ocEnter}
                          </button>
                        )}
                        {/* Only offered where BillingView would otherwise show "comped":
                            not already billed, not mid-trial (Stripe already owns that
                            clock), not suspended, and never on Steadwerk's own tenant —
                            the platform operator has no reason to bill itself. slug is
                            what supabase/32 keys is_platform_company off of; that flag
                            itself isn't in admin_list_companies()'s column list, so the
                            slug is the cheapest correct check without widening it. */}
                        {rev && !rev.is_billed && co.subscription_status !== "trialing" && co.slug !== "steadwerk" && !suspended && (
                          <button onClick={() => { setBillingTarget(co); setBillingEmail(""); setBillingInterval("monthly"); }} disabled={busyId === co.id}
                            style={{ padding: "6px 12px", background: BRAND.pasture, color: "var(--c-on-accent)", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                            {t.ocStartBilling}
                          </button>
                        )}
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

      {/* ── Start-billing confirmation ──
          Collects the two things Checkout needs that a comped company never had a
          reason to have on file: who to bill, and which cadence. Everything else
          (price ids, trial-free subscription_data) is decided server-side in
          start-company-billing.js, same as create-checkout.js decides them for a
          brand-new signup. */}
      {billingTarget && (
        <div
          onClick={() => !startingBilling && setBillingTarget(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(23,27,31,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.w, borderRadius: 14, padding: 28, maxWidth: 440, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}
          >
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 900, color: BRAND.pasture, marginBottom: 8 }}>
              {t.ocStartBillingTitle.replace("{name}", billingTarget.name)}
            </div>
            <p style={{ fontSize: 13, color: C.navy, lineHeight: 1.6, margin: "0 0 16px" }}>
              {t.ocStartBillingDesc.replace(
                "{price}",
                billingInterval === "annual" ? t.ocAnnualRate.replace("{price}", `$${BASE_PRICE_ANNUAL}`) : t.ocMonthlyRate.replace("{price}", `$${BASE_PRICE_MONTHLY}`),
              ).replace("{seats}", BASE_SEATS)}
            </p>
            <label style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {t.ocBillingEmail}
            </label>
            <input
              autoFocus
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startBilling()}
              placeholder={t.ocBillingEmailPlaceholder}
              disabled={startingBilling}
              style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box", marginTop: 6, marginBottom: 16 }}
            />
            <label style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {t.ocBillingCadence}
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {["monthly", "annual"].map((iv) => (
                <button
                  key={iv}
                  type="button"
                  onClick={() => setBillingInterval(iv)}
                  disabled={startingBilling}
                  style={{
                    flex: 1, padding: "9px 12px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: startingBilling ? "not-allowed" : "pointer",
                    border: `1.5px solid ${billingInterval === iv ? BRAND.pasture : C.bd}`,
                    background: billingInterval === iv ? "var(--c-pasture-wash)" : "transparent",
                    color: billingInterval === iv ? BRAND.pasture : C.navy,
                  }}
                >
                  {iv === "monthly" ? t.ocMonthly : t.ocAnnual}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <button
                onClick={() => setBillingTarget(null)}
                disabled={startingBilling}
                style={{ padding: "9px 16px", background: "transparent", color: C.sub, border: `1.5px solid ${C.bd}`, borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: startingBilling ? "not-allowed" : "pointer" }}
              >
                {t.ocCancel}
              </button>
              <button
                onClick={startBilling}
                disabled={startingBilling || !billingEmail.trim()}
                style={{ padding: "9px 18px", background: billingEmail.trim() ? BRAND.pasture : C.bd, color: C.onAccent, border: "none", borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: startingBilling || !billingEmail.trim() ? "not-allowed" : "pointer" }}
              >
                {startingBilling ? t.ocOpeningCheckout : t.ocOpenCheckout}
              </button>
            </div>
          </div>
        </div>
      )}

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
                {/* Billing — Stripe's own numbers, not the modelled MRR from
                    supabase/30. When these two disagree, the price constants in
                    that migration are the thing that is wrong. */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                    Billing
                  </div>
                  {!viewBilling ? (
                    <div style={{ fontSize: 13, color: C.sub }}>{t.ocLoading}</div>
                  ) : viewBilling.error ? (
                    <div style={{ fontSize: 13, color: BRAND.rust }}>{viewBilling.error}</div>
                  ) : !viewBilling.billed ? (
                    <div style={{ fontSize: 13, color: C.sub }}>{t.ocNotBilled}</div>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
                        <div>
                          <div style={{ color: C.sub, fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>Charging</div>
                          <div style={{ fontWeight: 800, color: C.navy }}>
                            {fmtMoney(viewBilling.subscription?.total)}
                            <span style={{ color: C.sub, fontWeight: 600 }}>
                              {viewBilling.subscription?.items?.[0]?.interval === "year" ? " / year" : " / month"}
                            </span>
                          </div>
                        </div>
                        <div>
                          <div style={{ color: C.sub, fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>Renews</div>
                          <div style={{ color: C.navy }}>{fmtDate(viewBilling.subscription?.currentPeriodEnd)}</div>
                        </div>
                        <div>
                          <div style={{ color: C.sub, fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>Card</div>
                          <div style={{ color: C.navy }}>
                            {viewBilling.card ? `${viewBilling.card.brand} ···· ${viewBilling.card.last4}` : "—"}
                          </div>
                        </div>
                        {viewBilling.subscription?.cancelAtPeriodEnd && (
                          <div style={{ color: BRAND.rust, fontWeight: 800, alignSelf: "center" }}>
                            {t.ocCancelsAtPeriodEnd}
                          </div>
                        )}
                      </div>

                      {viewBilling.invoices.length === 0 ? (
                        <div style={{ fontSize: 13, color: C.sub }}>{t.ocNoInvoices}</div>
                      ) : (
                        <div style={{ overflowX: "auto", border: `1px solid ${C.bd}`, borderRadius: 8 }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 460 }}>
                            <thead><tr style={{ background: C.lg, textAlign: "left" }}>
                              {["Invoice", "Date", "Amount", "Status", ""].map((h) => (
                                <th key={h} style={{ padding: "8px 10px", fontSize: 11, textTransform: "uppercase", color: C.sub, fontWeight: 800 }}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {viewBilling.invoices.map((inv) => (
                                <tr key={inv.id} style={{ borderTop: `1px solid ${C.bd}` }}>
                                  <td style={{ padding: "7px 10px", fontFamily: "var(--font-mono)", fontSize: 12, color: C.sub }}>{inv.number || inv.id}</td>
                                  <td style={{ padding: "7px 10px", color: C.sub }}>{fmtDate(inv.created)}</td>
                                  <td style={{ padding: "7px 10px", fontWeight: 700, color: C.navy }}>{fmtMoney(inv.amountDue)}</td>
                                  <td style={{ padding: "7px 10px" }}>
                                    <span style={{ color: inv.status === "paid" ? BRAND.pasture : inv.status === "open" ? BRAND.amberDeep : C.sub, fontWeight: 700, textTransform: "capitalize" }}>
                                      {inv.status}
                                    </span>
                                  </td>
                                  <td style={{ padding: "7px 10px" }}>
                                    {inv.hostedUrl && (
                                      <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, fontWeight: 700, fontSize: 12 }}>
                                        View
                                      </a>
                                    )}
                                    {inv.pdfUrl && (
                                      <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, fontWeight: 700, fontSize: 12, marginLeft: 10 }}>
                                        PDF
                                      </a>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>

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
