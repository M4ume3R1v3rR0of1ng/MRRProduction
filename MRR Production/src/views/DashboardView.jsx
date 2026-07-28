// src/views/DashboardView.jsx
import { useState, useEffect } from "react"; 
import { C, displayName } from "../utils/helpers";
import { Bdg, Btn, Modal } from "../components/UIPrimitives"; 
import TeamChatBox from "../components/TeamChatBox";
import WeatherCard from "../components/WeatherCard";
import { supabase } from "../utils/supabase"; 
import { translations } from "../utils/translations";

// Live wall-clock for the dashboard header. Ticks each second; tabular-nums keeps the
// digits from shifting width, and the locale follows the viewer's language.
function LiveClock({ lang }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const locale = lang === "es" ? "es-ES" : "en-US";
  return (
    <div style={{ textAlign: "right", flexShrink: 0 }}>
      <div style={{ fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
        {now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "capitalize" }}>
        {now.toLocaleDateString(locale, { weekday: "long" })}
      </div>
    </div>
  );
}

// Eight-week trend line for a KPI card. Deliberately axis-free and label-free:
// the number above it is the value, this only answers "which way is it going".
//
// The baseline is zero rather than the series minimum. A min-anchored sparkline
// exaggerates flat data — three weeks of 4, 5, 4 jobs would render as a dramatic
// mountain range. Anchoring at zero keeps the slope honest.
function Sparkline({ data, color, h = 26 }) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const step = 100 / (data.length - 1);
  const pts = data.map((v, i) => [i * step, h - (Math.max(0, v) / max) * (h - 3) - 1.5]);
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const [lastX, lastY] = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 100 ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Trend over the last ${data.length} weeks`}
      style={{ width: "100%", height: h, display: "block", marginTop: 10, overflow: "visible" }}
    >
      <polygon points={`${line} 100,${h} 0,${h}`} fill={color} opacity="0.13" />
      {/* preserveAspectRatio="none" stretches the box to the card width, which
          would also stretch the stroke into a wedge. non-scaling-stroke keeps it
          an even hairline at any card size. */}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="2.6" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function DashboardView({
  inv,
  vehs,
  reqs,
  jobs,
  jobTrailers = [],
  users,
  user,
  perms,
  onNav,
  tot,
  jSC,
  setJobs,
  setReqs,
  lang = "en",
  onMarkChatRead,
  company = null,
  activeLogo = null,
}) {
  const t = translations[lang] || translations.en;
  const low = inv.filter((i) => tot(i) <= i.alrt);
  const pendingReqs = reqs.filter((r) => r.status === "pending");

  // ── Recent-output KPIs (distinct from the current-status cards below) ──
  const nowMs = Date.now();
  const weekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  const monthStartMs = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const isDoneJob = (j) => j.status === "completed" || j.status === "closed";
  const doneAtMs = (j) => new Date(j.completedAt || j.completed || 0).getTime();
  const completedThisWeek = jobs.filter((j) => isDoneJob(j) && doneAtMs(j) >= weekAgoMs).length;
  const completedThisMonth = jobs.filter((j) => isDoneJob(j) && doneAtMs(j) >= monthStartMs).length;
  // Materials consumed on a job, priced at what was actually pulled. Returns are
  // netted off. Extracted so the month total and the trend line below cannot
  // drift apart.
  const jobMaterialCost = (j) => (j.items || j.materials || []).reduce(
    (a, i) => a + (i ? Math.max(0, (i.pulled || 0) - (i.returned || 0)) * (i.priceAtPull || 0) : 0), 0);
  const materialCostThisMonth = jobs
    .filter((j) => isDoneJob(j) && doneAtMs(j) >= monthStartMs)
    .reduce((s, j) => s + jobMaterialCost(j), 0);

  // ── Eight-week trend series for the KPI sparklines ──
  // Bucketed by whole weeks back from now, oldest first, so the line reads left
  // to right. Jobs with no completion timestamp are skipped rather than dumped
  // into the current week, which would fake a spike.
  const TREND_WEEKS = 8;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const weeklySeries = (valueOf) => {
    const buckets = new Array(TREND_WEEKS).fill(0);
    jobs.forEach((j) => {
      if (!isDoneJob(j)) return;
      const ms = doneAtMs(j);
      if (!ms) return;
      const weeksAgo = Math.floor((nowMs - ms) / WEEK_MS);
      if (weeksAgo < 0 || weeksAgo >= TREND_WEEKS) return;
      buckets[TREND_WEEKS - 1 - weeksAgo] += valueOf(j);
    });
    return buckets;
  };
  const completedSeries = weeklySeries(() => 1);
  const materialCostSeries = weeklySeries(jobMaterialCost);

  const myJobs = jobs.filter((j) => (j.assignedto === user.id || j.assignedTo === user.id) && j.status !== "completed");
  const newJobs = myJobs.filter((j) => j.newforassigned);

  const [newJobAlert, setNewJobAlert] = useState(null);

  const alertTrailerNames = newJobAlert
    ? jobTrailers
        .filter((jt) => jt.job_id === newJobAlert.id)
        .map((jt) => vehs.find((v) => v.id === jt.trailer_id)?.name)
        .filter(Boolean)
    : [];

  useEffect(() => {
    if (newJobs.length > 0 && !newJobAlert) {
      setNewJobAlert(newJobs[0]);
    }
  }, [jobs, newJobs, newJobAlert]);

  // openChecklist: the teal button acknowledges AND jumps to Pull Inventory;
  // the × acknowledges but stays on the dashboard. Both must clear the DB flag,
  // otherwise the alert effect immediately re-opens the modal.
  const acknowledgeJob = async (openChecklist) => {
    if (!newJobAlert) return;
    try {
      const { error } = await supabase
        .from("jobs")
        .update({ newforassigned: false })
        .eq("id", newJobAlert.id);

      if (error) throw error;

      if (setJobs) {
        setJobs((p) =>
          p.map((j) => (j.id === newJobAlert.id ? { ...j, newforassigned: false } : j))
        );
      }
      setNewJobAlert(null);
      if (openChecklist) onNav("pull");
    } catch (err) {
      console.error("Failed to dismiss supervisor project warning banner:", err);
    }
  };

  // ── 🔔 NEW MAINTENANCE REQUEST ALERT (pops for anyone with maint_manage, same pattern as new-job alert) ──
  // Requires a `acked_by` jsonb column on maintenance_requests (array of user ids who've dismissed it),
  // since — unlike jobs, which have one assignedto supervisor — a request can be relevant to several managers.
  const newMaintForMe = perms.maint_manage
    ? reqs.filter((r) => r.status === "pending" && !(Array.isArray(r.acked_by) && r.acked_by.includes(user.id)))
    : [];

  const [maintAlert, setMaintAlert] = useState(null);

  useEffect(() => {
    if (newMaintForMe.length > 0 && !maintAlert) {
      setMaintAlert(newMaintForMe[0]);
    }
  }, [reqs, newMaintForMe, maintAlert]);

  const acknowledgeMaint = async (openRequests) => {
    if (!maintAlert) return;
    try {
      const nextAcked = Array.isArray(maintAlert.acked_by) ? [...maintAlert.acked_by, user.id] : [user.id];
      const { error } = await supabase
        .from("maintenance_requests")
        .update({ acked_by: nextAcked })
        .eq("id", maintAlert.id);

      if (error) throw error;

      if (setReqs) {
        setReqs((p) => p.map((r) => (r.id === maintAlert.id ? { ...r, acked_by: nextAcked } : r)));
      }
      setMaintAlert(null);
      if (openRequests) onNav("requests");
    } catch (err) {
      console.error("Failed to dismiss maintenance request alert:", err);
    }
  };

  // ── 🛠️ MAINTENANCE STATUS UPDATE ALERT (pops for the requester when a manager moves their ticket,
  // same pattern as the supervisor new-job alert). Requires a `newforrequester` boolean column on
  // maintenance_requests, set by updateStatus in MaintenanceRequestsView and cleared here on acknowledge.
  const myStatusUpdates = reqs.filter(
    (r) => (r.newforrequester || r.newForRequester) && String(r.uid) === String(user.id)
  );

  const [statusAlert, setStatusAlert] = useState(null);

  useEffect(() => {
    if (myStatusUpdates.length > 0 && !statusAlert) {
      setStatusAlert(myStatusUpdates[0]);
    }
  }, [reqs, myStatusUpdates, statusAlert]);

  const acknowledgeStatusUpdate = async (openRequests) => {
    if (!statusAlert) return;
    try {
      const { error } = await supabase
        .from("maintenance_requests")
        .update({ newforrequester: false })
        .eq("id", statusAlert.id);

      if (error) throw error;

      if (setReqs) {
        setReqs((p) =>
          p.map((r) => (r.id === statusAlert.id ? { ...r, newforrequester: false, newForRequester: false } : r))
        );
      }
      setStatusAlert(null);
      if (openRequests) onNav("requests");
    } catch (err) {
      console.error("Failed to dismiss maintenance status update alert:", err);
    }
  };

  // Reusable Metric Card Primitive
  const SC = ({ label, value, color, icon, onClick, sub, series }) => (
    <div
      onClick={onClick}
      className={onClick ? "mrr-card mrr-card-click" : "mrr-card"}
      style={{
        background: C.w,
        borderRadius: "var(--radius-xl)",
        padding: 16,
        border: `1px solid ${C.bd}`,
        flex: 1,
        minWidth: 140,
      }}
    >
      <div style={{ width: 38, height: 38, borderRadius: "var(--radius-lg)", background: `color-mix(in srgb, ${color} 8%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-xl)", marginBottom: 10 }}>
        {icon}
      </div>
      <div style={{ fontSize: "var(--text-3xl)", fontWeight: "var(--weight-extrabold)", color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 6, fontWeight: "var(--weight-semibold)" }}>{label}</div>
      {sub && (
        <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 2 }}>{sub}</div>
      )}
      {series && <Sparkline data={series} color={color} />}
    </div>
  );

  // Reusable Large Quick Action Card Primitive
  const QuickActionCard = ({ title, subtitle, icon, color, onClick }) => (
    <div
      onClick={onClick}
      className="mrr-card mrr-card-click"
      style={{
        background: C.w,
        borderRadius: "var(--radius-xl)",
        padding: "16px 20px",
        border: `1px solid ${C.bd}`,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-7)",
        flex: "1 1 220px",
      }}
    >
      <div style={{
        width: 44,
        height: 44,
        borderRadius: "var(--radius-lg)",
        background: `color-mix(in srgb, ${color} 9%, transparent)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "var(--text-3xl)",
        flexShrink: 0
      }}>
        {icon}
      </div>
      <div style={{ textAlign: "left" }}>
        <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-md)" }}>{title}</div>
        <div style={{ color: C.sub, fontSize: "var(--text-xs)", marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t.goodMorning : hour < 17 ? t.goodAfternoon : t.goodEvening;

  // ── 🔨 LAYOUT 1: FIELD WORKER PORTAL ──
  const renderFieldDashboard = () => {
    const myVehicle = vehs.find((v) => v.assigned_to_id === user.id || v.assigned_to === user.name);
    const myOpenTickets = reqs.filter((r) => r.submitted_by === user.name && r.status === "pending");

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <SC label={t.myAssignedJobs} value={myJobs.length} color={C.tl} icon="📋" onClick={() => onNav("pull")} />
          <SC label={t.activeBuilds} value={myJobs.filter((j) => j.status === "active").length} color={C.am} icon="🔄" onClick={() => onNav("pull")} />
          <SC label={t.myOpenTickets} value={myOpenTickets.length} color={C.pu} icon="🔧" onClick={() => onNav("requests")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 16, border: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>📅 {t.activeAgenda}</h3>
              {myJobs.length === 0 ? (
                <p style={{ color: C.sub, fontSize: "var(--text-sm)", margin: 0 }}>{t.noJobs}</p>
              ) : (
                myJobs.map((j) => (
                  <div key={j.id} style={{ padding: "10px", background: C.lg, borderRadius: "var(--radius-md)", marginBottom: 6, fontSize: "var(--text-sm)", borderLeft: `3px solid ${C.tl}` }}>
                    <div style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{j.title || j.name}</div>
                    <div style={{ color: C.sub, fontSize: "var(--text-2xs)", marginTop: 2 }}>📍 {j.addr || j.address}</div>
                  </div>
                ))
              )}
            </div>

            <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 16, border: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>🚛 {t.assignedTruck}</h3>
              {myVehicle ? (
                <div style={{ background: C.lg, padding: 16, borderRadius: "var(--radius-lg)" }}>
                  <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.sub, textTransform: "uppercase", marginBottom: 4 }}>
                    {t.assignedTruck}
                  </div>
                  <div style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>
                    {myVehicle.name} — {myVehicle.make} {myVehicle.model}
                  </div>
                  <div style={{ fontSize: "var(--text-base)", color: C.blue, fontWeight: "var(--weight-bold)", marginTop: 2 }}>
                    Plate ID: {myVehicle.plate || "No Plate Registered"}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "var(--text-base)", color: C.sub, fontStyle: "italic", padding: "12px 0" }}>
                  {t.noTruck}
                </div>
              )}
            </div>
          </div>
          <TeamChatBox user={user} users={users} limit={30} onMarkRead={onMarkChatRead} />
        </div>
      </div>
    );
  };

  // ── 🏭 LAYOUT 2: WAREHOUSE FULFILLMENT HUB ──
  const renderWarehouseDashboard = () => {
    const pendingPulls = jobs.filter((j) => j.status === "approved" || j.status === "draft");

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <SC label={t.lowStockWatch} value={low.length} color={low.length > 0 ? C.rd : C.gr} icon="🚨" onClick={() => onNav("inventory")} />
          <SC label={t.stagedOrders} value={pendingPulls.length} color={C.blue} icon="📦" onClick={() => onNav("pull")} />
          <SC label={t.myOpenTickets} value={pendingReqs.length} color={C.pu} icon="🔧" onClick={() => onNav("requests")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 16, border: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>🚨 {t.lowStockWatch}</h3>
              {low.length === 0 ? (
                <p style={{ color: C.gr, fontSize: "var(--text-sm)", margin: 0 }}>✅ {t.allStockSafe}</p>
              ) : (
                low.slice(0, 4).map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(242, 119, 119, 0.15)", borderRadius: "var(--radius-md)", marginBottom: 6, fontSize: "var(--text-sm)" }}>
                    <span style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{item.name}</span>
                    <span style={{ color: C.rd, fontWeight: "var(--weight-extrabold)" }}>{tot(item)} {item.unit}</span>
                  </div>
                ))
              )}
            </div>

            <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 16, border: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>📦 {t.stagedOrders}</h3>
              {pendingPulls.slice(0, 4).map((p) => (
                <div key={p.id} onClick={() => onNav("pull")} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: C.lg, borderRadius: 7, marginBottom: 6, fontSize: "var(--text-sm)", cursor: "pointer" }}>
                  <span style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{p.title || p.name}</span>
                  <Bdg color={p.status === "approved" ? "blue" : "gray"}>{p.status.toUpperCase()}</Bdg>
                </div>
              ))}
            </div>
          </div>
          <TeamChatBox user={user} users={users} limit={30} onMarkRead={onMarkChatRead} />
        </div>
      </div>
    );
  };

  // ── 📊 LAYOUT 3: MANAGEMENT COMMAND CENTRE ──
  const renderManagerDashboard = () => {
    const activeJobsList = jobs.filter((j) => j.status === "active");
    const deadlinedTrucks = vehs.filter((v) => v.status === "maintenance" || v.status === "down");
    const totalInventoryCost = inv.reduce((sum, item) => sum + tot(item) * (item.cost || 0), 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <SC label={t.activeProjects} value={activeJobsList.length} color={C.am} icon="🔄" onClick={() => onNav("pull")} />
          <SC label={t.fleetDisruptions} value={deadlinedTrucks.length} color={deadlinedTrucks.length > 0 ? C.rd : C.gr} icon="🚛" onClick={() => onNav("fleet")} />
          <SC label={t.holdingValuation} value={`$${Math.round(totalInventoryCost).toLocaleString()}`} color={C.blue} icon="💰" onClick={() => onNav("reports")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 16, border: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>📋 {t.masterPipeline}</h3>
              {jobs.filter((j) => j.status !== "completed").slice(0, 4).map((j) => {
                const sup = users.find((u) => u.id === j.assignedto || u.id === j.assignedTo);
                const st = jSC[j.status] || { c: "gray", l: j.status };
                return (
                  <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: C.lg, borderRadius: 7, marginBottom: 6, fontSize: "var(--text-sm)" }}>
                    <div>
                      <div style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{j.title || j.name}</div>
                      <div style={{ color: C.sub, fontSize: "var(--text-2xs)" }}>{j.po || t.noPO}{sup ? ` · ${sup.full_name || sup.name}` : ""}</div>
                    </div>
                    <Bdg color={st.c}>{st.l}</Bdg>
                  </div>
                );
              })}
            </div>
          </div>
          <TeamChatBox user={user} users={users} limit={30} onMarkRead={onMarkChatRead} />
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Upper Welcome Context Row — company-branded + live clock. The accent stripe
          picks up each company's brand color; the subtitle is the company's own name
          + tagline (was a hardcoded "Saint Joe Road Warehouse" shown for every tenant). */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, borderLeft: "4px solid var(--brand-accent, var(--c-amber))", paddingLeft: 14, flexWrap: "wrap" }}>
        {activeLogo && (
          <img src={activeLogo} alt="" style={{ height: 44, maxWidth: 130, objectFit: "contain", flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy }}>
            {greeting}, {displayName(user)}! 👋
          </h1>
          <p style={{ margin: "3px 0 0", color: C.sub, fontSize: "var(--text-sm)" }}>
            {company?.branding?.displayName || company?.name || "Steadwerk"}
            {company?.branding?.tagline ? ` · ${company.branding.tagline}` : ""}
            {" · "}
            {new Date().toLocaleDateString(lang === "es" ? "es-ES" : "en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <LiveClock lang={lang} />
      </div>

      {/* Quick actions — start the common daily tasks in one click. Each is gated by
          the permission that makes it meaningful; the row hides if none apply. */}
      {(perms.jobs_build || perms.jobs_pull || perms.maint_submit || perms.maint_manage) && (
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: 16 }}>
          {perms.jobs_build && (
            <Btn v="gold" onClick={() => onNav("buildjobs")}>➕ {t.quickNewJob}</Btn>
          )}
          {perms.jobs_pull && (
            <Btn v="teal" onClick={() => onNav("pull")}>🚛 {t.pull}</Btn>
          )}
          {(perms.maint_submit || perms.maint_manage) && (
            <Btn v="outline" onClick={() => onNav("requests")}>🔧 {t.quickMaint}</Btn>
          )}
        </div>
      )}

      {/* Recent-output KPIs — this week / this month, distinct from the status cards. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-4)", marginBottom: 16 }}>
        <SC label={t.completedThisWeek} value={completedThisWeek} color={C.gr} icon="✅" series={completedSeries} onClick={perms.reports_view ? () => onNav("reports") : undefined} />
        <SC label={t.completedThisMonth} value={completedThisMonth} color={C.blue} icon="🏁" series={completedSeries} onClick={perms.reports_view ? () => onNav("reports") : undefined} />
        {perms.inv_pricing_view && (
          <SC label={t.materialThisMonth} value={`$${Math.round(materialCostThisMonth).toLocaleString()}`} color={C.am} icon="💰" series={materialCostSeries} onClick={perms.reports_view ? () => onNav("reports") : undefined} />
        )}
      </div>

      {/* Dynamic Security & Alert Banners */}
      {user.role === "field" && newJobs.length > 0 && (
        <div
          onClick={() => onNav("pull")}
          style={{ background: C.tB, border: `2px solid ${C.tl}`, borderRadius: "var(--radius-lg)", padding: "12px 16px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        >
          <div style={{ fontWeight: "var(--weight-bold)", color: C.tl, fontSize: "var(--text-base)" }}>
            🎉 {newJobs.length} {t.newAssignments}
          </div>
          <Btn v="teal" sz="sm">{t.view} →</Btn>
        </div>
      )}
      {perms.maint_manage && pendingReqs.length > 0 && (
        <div
          onClick={() => onNav("requests")}
          style={{ background: C.pB, border: `2px solid ${C.pu}`, borderRadius: "var(--radius-lg)", padding: "12px 16px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        >
          <div style={{ fontWeight: "var(--weight-bold)", color: C.pu, fontSize: "var(--text-base)" }}>
            🔔 {pendingReqs.length} {t.pendingMaint}
          </div>
          <Btn v="purple" sz="sm">{t.view} →</Btn>
        </div>
      )}
      {low.length > 0 && (
        <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: "var(--radius-lg)", padding: "10px 14px", marginBottom: 12, fontSize: "var(--text-sm)", color: C.am, fontWeight: "var(--weight-semibold)" }}>
          ⚠️ {low.length} {t.lowStockAlert}
        </div>
      )}

      {/* Quick Action Grid Panel */}
      <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap", marginBottom: 20, width: "100%" }}>
        <QuickActionCard 
          title={t.pull} 
          subtitle={lang === "es" ? "Preparar materiales para cargar" : "Stage materials for loading"} 
          icon="📦" 
          color="var(--c-slate)" 
          onClick={() => onNav("pull")} 
        />
        <QuickActionCard 
          title={t.requests} 
          subtitle={lang === "es" ? "Enviar registro de mantenimiento" : "Submit vehicle maintenance"} 
          icon="🔧" 
          color="var(--c-plum)" 
          onClick={() => onNav("requests")} 
        />
        <QuickActionCard 
          title={t.myAssignedJobs} 
          subtitle={lang === "es" ? "Ver lista de trabajos asignados" : "Check assigned work lists"} 
          icon="📋" 
          color="var(--c-teal)" 
          onClick={() => onNav("pull")} 
        />
        <QuickActionCard 
          title={t.fleet} 
          subtitle={lang === "es" ? "Reportar herramientas o vehículos dañados" : "Flag down tools or fleet assets"} 
          icon="⚠️" 
          color="var(--c-rust)" 
          onClick={() => onNav("fleet")} 
        />
      </div>

      {/* Warehouse weather — relevant to scheduling roof work; shown for all roles */}
      <div style={{ marginBottom: 20 }}>
        <WeatherCard />
      </div>

      {/* Core Evaluation Router Branch */}
      {(() => {
        if (perms.settings_manage || user.role === "manager" || user.role === "admin" || user.role === "coordinator") {
          return renderManagerDashboard();
        }
        if (perms.inv_view && (user.role === "warehouse" || user.role === "inventory")) {
          return renderWarehouseDashboard();
        }
        return renderFieldDashboard();
      })()}
      
      {/* Live Assignment Modal Overlay */}
      {newJobAlert && (
        <Modal title={`🚨 ${t.newAssignments}`} onClose={() => acknowledgeJob(false)}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>🏗️</div>
            <h3 style={{ margin: "0 0 6px 0", color: C.navy, fontWeight: "var(--weight-black)", fontSize: "var(--text-lg)" }}>
              {newJobAlert.title || newJobAlert.name || "Untitled Production Contract"}
            </h3>
            <p style={{ margin: "0 0 14px 0", color: C.sub, fontSize: "var(--text-base)" }}>
              PO Tracker Number: <strong>{newJobAlert.po || "—"}</strong>
            </p>
            
            <div style={{ background: "var(--c-subtle)", padding: 12, borderRadius: "var(--radius-md)", textAlign: "left", fontSize: "var(--text-sm)", border: `1px solid ${C.bd}`, marginBottom: 16 }}>
              <strong>📍 {lang === "es" ? "Dirección de Despacho" : "Dispatch Address"}:</strong> {newJobAlert.addr || newJobAlert.address || "No Location Specified"}
              {newJobAlert.notes && (
                <div style={{ marginTop: 8, borderTop: `1px dashed ${C.bd}`, paddingTop: 8 }}>
                  <strong>📝 {lang === "es" ? "Instrucciones para la Cuadrilla" : "Crew Instructions"}:</strong> {newJobAlert.notes}
                </div>
              )}
            </div>

            {alertTrailerNames.length > 0 && (
              <div style={{ background: "var(--c-warn-wash)", padding: 12, borderRadius: "var(--radius-md)", textAlign: "left", fontSize: "var(--text-sm)", border: `1.5px solid ${C.am}`, marginBottom: 16, fontWeight: "var(--weight-bold)", color: C.am }}>
                🚚 {lang === "es" ? "Debe llevar remolque(s)" : "Bring trailer(s)"}: {alertTrailerNames.join(", ")}
              </div>
            )}

            <Btn v="teal" onClick={() => acknowledgeJob(true)} style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
              {lang === "es" ? "Entendido, Abrir Lista de Materiales →" : "Got It, Open Job Materials Checklist →"}
            </Btn>
          </div>
        </Modal>
      )}

      {/* New Maintenance Request Alert Overlay — only one blocking modal at a time; job alerts take priority */}
      {!newJobAlert && maintAlert && (
        <Modal title="🔔 New Maintenance Request" onClose={() => acknowledgeMaint(false)}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>🔧</div>
            <h3 style={{ margin: "0 0 6px 0", color: C.navy, fontWeight: "var(--weight-black)", fontSize: "var(--text-lg)" }}>
              {maintAlert.vname || "Unknown Vehicle"}
            </h3>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 12, flexWrap: "wrap" }}>
              {maintAlert.urgency === "urgent" && <Bdg color="red">🚨 URGENT</Bdg>}
              <Bdg color="gray">{maintAlert.type}</Bdg>
            </div>

            <div style={{ background: "var(--c-subtle)", padding: 12, borderRadius: "var(--radius-md)", textAlign: "left", fontSize: "var(--text-sm)", border: `1px solid ${C.bd}`, marginBottom: 16 }}>
              <strong>📝 Reported Issue:</strong> {maintAlert.notes || "No description provided"}
              <div style={{ marginTop: 8, borderTop: `1px dashed ${C.bd}`, paddingTop: 8 }}>
                <strong>👤 Submitted By:</strong> {maintAlert.uname || "Unknown"}
              </div>
            </div>

            <Btn v="purple" onClick={() => acknowledgeMaint(true)} style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
              Got It, Open Maintenance Requests →
            </Btn>
          </div>
        </Modal>
      )}

      {/* Maintenance Status Update Alert Overlay — tells the requester their ticket moved (scheduled/completed) */}
      {!newJobAlert && !maintAlert && statusAlert && (
        <Modal title="🔔 Maintenance Update" onClose={() => acknowledgeStatusUpdate(false)}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>{statusAlert.status === "completed" ? "✅" : "🗓️"}</div>
            <h3 style={{ margin: "0 0 6px 0", color: C.navy, fontWeight: "var(--weight-black)", fontSize: "var(--text-lg)" }}>
              {statusAlert.vname || "Unknown Vehicle"}
            </h3>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <Bdg color={statusAlert.status === "pending" ? "amber" : statusAlert.status === "scheduled" ? "blue" : "green"}>
                {(statusAlert.status || "updated").toUpperCase()}
              </Bdg>
              <Bdg color="gray">{statusAlert.type}</Bdg>
            </div>

            <div style={{ background: "var(--c-subtle)", padding: 12, borderRadius: "var(--radius-md)", textAlign: "left", fontSize: "var(--text-sm)", border: `1px solid ${C.bd}`, marginBottom: 16 }}>
              <strong>🔧 Your maintenance request is now {statusAlert.status}.</strong>
              {statusAlert.status === "scheduled" && statusAlert.scheduled_date && (
                <div style={{ marginTop: 8, borderTop: `1px dashed ${C.bd}`, paddingTop: 8 }}>
                  <strong>🗓️ Scheduled for:</strong> {new Date(statusAlert.scheduled_date).toLocaleDateString()}
                </div>
              )}
              {statusAlert.status === "completed" && statusAlert.completed_at && (
                <div style={{ marginTop: 8, borderTop: `1px dashed ${C.bd}`, paddingTop: 8 }}>
                  <strong>🏁 Completed on:</strong> {new Date(statusAlert.completed_at).toLocaleDateString()}
                </div>
              )}
              {statusAlert.wh_notes && (
                <div style={{ marginTop: 8, borderTop: `1px dashed ${C.bd}`, paddingTop: 8 }}>
                  <strong>📝 Shop Notes:</strong> {statusAlert.wh_notes}
                </div>
              )}
            </div>

            <Btn v="teal" onClick={() => acknowledgeStatusUpdate(true)} style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
              Got It, View My Requests →
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}