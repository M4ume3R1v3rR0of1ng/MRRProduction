// src/views/OwnerConsole.jsx
//
// The platform owner's console — the "local company dashboard" from the original
// thread. Visible ONLY to a platform admin (you), and every action it takes goes
// through a SECURITY DEFINER RPC in supabase/06_platform_admin.sql that re-checks
// is_platform_admin() server-side. Hiding this view in the UI is convenience;
// the real gate is in the database, so a non-owner poking the same RPCs gets nothing.
import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { BRAND, TrussMark } from "../components/SteadwerkMark";
import { useNotify } from "../context/NotificationContext";

const STATUS_STYLE = {
  active:    { bg: "#E2EDE6", fg: BRAND.pasture, label: "Active" },
  trialing:  { bg: "#E4EAF0", fg: "#4A6178", label: "Trial" },
  past_due:  { bg: "#F7EBDA", fg: BRAND.amberDeep, label: "Past due" },
  canceled:  { bg: "#F0ECE4", fg: BRAND.plowshare, label: "Canceled" },
  suspended: { bg: "#F7E4DA", fg: BRAND.rust, label: "Suspended" },
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

export default function OwnerConsole({ user }) {
  const { showToast } = useNotify();
  const [companies, setCompanies] = useState([]);
  const [usage, setUsage] = useState({}); // company_id -> { total_bytes, object_count }
  const [padmins, setPadmins] = useState([]);
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "" });

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: usageRows }, { data: adminRows }] = await Promise.all([
      supabase.rpc("admin_list_companies"),
      supabase.rpc("admin_storage_usage"),
      supabase.rpc("admin_list_platform_admins"),
    ]);
    if (error) showToast(`Failed to load companies: ${error.message}`, "error");
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
    else { showToast(`${email} is now a platform admin.`, "success"); setAdminEmail(""); await load(); }
  };

  const revokeAdmin = async (email) => {
    if (email === user.email && !window.confirm("Remove your OWN platform-admin access? You'll lose this console until another admin restores it.")) return;
    const { error } = await supabase.rpc("admin_set_platform_admin", { target_email: email, value: false });
    if (error) showToast(error.message, "error");
    else { showToast(`${email} is no longer a platform admin.`, "success"); await load(); }
  };

  useEffect(() => { load(); }, []);

  // Belt-and-suspenders: the DB already refuses non-owners, but don't even render
  // the console to one.
  if (!user?.isPlatformAdmin) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.sub }}>
        This area is restricted to the platform owner.
      </div>
    );
  }

  const setStatus = async (company, status) => {
    const verb = status === "suspended" ? "suspend" : status === "active" ? "reactivate" : status;
    if (!window.confirm(`${verb[0].toUpperCase() + verb.slice(1)} ${company.name}? ${status === "suspended" ? "Their whole team loses access immediately." : ""}`)) return;
    setBusyId(company.id);
    const { error } = await supabase.rpc("admin_set_company_status", { target: company.id, new_status: status });
    if (error) showToast(`Failed: ${error.message}`, "error");
    else { showToast(`${company.name} is now ${status}.`, "success"); await load(); }
    setBusyId(null);
  };

  const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const createCompany = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const slug = form.slug.trim() || slugify(name);
    if (!name) return showToast("Company name is required.", "warning");
    setCreating(true);
    const { error } = await supabase.rpc("admin_create_company", { p_name: name, p_slug: slug, p_status: "trialing" });
    if (error) showToast(`Failed: ${error.message}`, "error");
    else { showToast(`Created ${name}. Add its first admin next.`, "success"); setForm({ name: "", slug: "" }); await load(); }
    setCreating(false);
  };

  const totalActive = companies.filter((c) => ["active", "trialing", "past_due"].includes(c.subscription_status)).length;
  const totalBytes = Object.values(usage).reduce((s, u) => s + (Number(u.total_bytes) || 0), 0);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <TrussMark size={26} />
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 900, color: C.navy, margin: 0 }}>
          Platform Owner Console
        </h1>
      </div>
      <p style={{ color: C.sub, fontSize: 14, marginBottom: 24 }}>
        {companies.length} companies · {totalActive} paying · {fmtBytes(totalBytes)} stored across the platform · signed in as {user.email}
      </p>

      {/* Create company */}
      <form onSubmit={createCompany} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", background: C.w, border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <div style={{ flex: "1 1 220px" }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>New company</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: f.slug || slugify(e.target.value) }))}
            placeholder="e.g. Steadwerk Exteriors"
            style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
          />
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>Slug</label>
          <input
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="steadwerk-exteriors"
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
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: C.sub }}>Loading…</td></tr>
              ) : companies.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: C.sub }}>No companies yet.</td></tr>
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
                      {suspended ? (
                        <button onClick={() => setStatus(co, "active")} disabled={busyId === co.id}
                          style={{ padding: "6px 12px", background: BRAND.pasture, color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                          Reactivate
                        </button>
                      ) : (
                        <button onClick={() => setStatus(co, "suspended")} disabled={busyId === co.id}
                          style={{ padding: "6px 12px", background: "transparent", color: BRAND.rust, border: `1.5px solid ${BRAND.rust}`, borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                          Suspend
                        </button>
                      )}
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
          Platform administrators
        </div>
        <div style={{ fontSize: 12, color: C.sub, marginBottom: 14 }}>
          People who can see this console and manage every company. Grant sparingly.
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
                Revoke
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={grantAdmin} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="email of an existing user to promote"
            style={{ flex: "1 1 240px", padding: "10px 12px", border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
          />
          <button type="submit" style={{ padding: "10px 18px", background: C.navy, color: "#EDE6DA", border: "none", borderRadius: 8, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
            Grant admin
          </button>
        </form>
        <div style={{ fontSize: 11, color: C.sub, marginTop: 8 }}>
          The person must already have a Steadwerk login. Granting doesn't add them to any company — it's platform-wide oversight only.
        </div>
      </div>
    </div>
  );
}
