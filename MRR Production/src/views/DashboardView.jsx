// src/views/DashboardView.jsx
import { useState, useEffect, useId } from "react";
import { C, displayName } from "../utils/helpers";
import { Bdg, Btn, Modal } from "../components/UIPrimitives"; 
import TeamChatBox from "../components/TeamChatBox";
import WeatherCard from "../components/WeatherCard";
import ScheduleCard from "../components/ScheduleCard";
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

// Twelve-week trend line for a KPI card. Axis-free on purpose: the number above it
// is the value, and this only answers "which way is it going" — plus, on hover,
// "what was it that week".
//
// The baseline is zero rather than the series minimum. A min-anchored sparkline
// exaggerates flat data — three weeks of 4, 5, 4 jobs would render as a dramatic
// mountain range. Anchoring at zero keeps the slope honest.
function Sparkline({ data, labels = [], color, format = (v) => String(v), h = 44 }) {
  // The point the tooltip is reading. null means "not hovering", which is not the
  // same as index 0, so it cannot be folded into a number.
  const [hover, setHover] = useState(null);
  // Three of these render at once and each needs its own gradient. A shared id
  // would paint every card in the first card's colour. Colons are legal in an id
  // but awkward in a selector, so they come out.
  const gradId = `sparkfill-${useId().replace(/:/g, "")}`;
  if (!Array.isArray(data) || data.length < 2) return null;

  const max = Math.max(...data, 1);
  const step = 100 / (data.length - 1);
  // Headroom top and bottom for the end marker and its ring. 7 is not arbitrary:
  // the marker is 9px across with a 2px ring, so it needs 6.5px of clearance from
  // its centre or it hangs over the edge of the box at a peak or at zero.
  const PAD = 7;
  const xOf = (i) => i * step;
  const yOf = (v) => h - PAD - (Math.max(0, v) / max) * (h - PAD * 2);
  const line = data.map((v, i) => `${xOf(i).toFixed(2)},${yOf(v).toFixed(2)}`).join(" ");
  const lastIdx = data.length - 1;
  // With nothing hovered the marker sits on the latest week, which is the point
  // the card's own number refers to.
  const active = hover ?? lastIdx;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    setHover(Math.min(lastIdx, Math.max(0, Math.round(ratio * lastIdx))));
  };

  return (
    <div
      style={{ position: "relative", marginTop: 10 }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 100 ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Trend over the last ${data.length} weeks, latest ${format(data[lastIdx])}`}
        style={{ width: "100%", height: h, display: "block", overflow: "visible" }}
      >
        <defs>
          {/* A wash that fades downwards rather than a flat block. The fill is
              there to give the line a body, not to be read as an area value. */}
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* The zero line, one step off the surface and hairline, so a flat run
            reads as sitting on zero instead of floating. */}
        <line x1="0" y1={h - PAD} x2="100" y2={h - PAD} stroke={C.bd} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <polygon points={`${line} 100,${h - PAD} 0,${h - PAD}`} fill={`url(#${gradId})`} />
        {/* preserveAspectRatio="none" stretches the box to the card width, which
            would also stretch the stroke into a wedge. non-scaling-stroke keeps it
            an even 2px at any card size. */}
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {hover !== null && (
          <line x1={xOf(hover)} y1="0" x2={xOf(hover)} y2={h - PAD} stroke={color} strokeWidth="1" strokeOpacity="0.4" vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      {/* The marker is a div, not an svg <circle>. The box is drawn with
          preserveAspectRatio="none" so it can fill a card of any width, and that
          stretches the x axis — a circle in that box comes out an ellipse, which
          is what the old 2.6px dot quietly was. A div stays round, and its ring is
          a box-shadow in the surface colour rather than ink around the mark. */}
      <span
        style={{
          position: "absolute",
          left: `${xOf(active)}%`,
          top: yOf(data[active]),
          width: 9,
          height: 9,
          marginLeft: -4.5,
          marginTop: -4.5,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 0 2px ${C.w}`,
          pointerEvents: "none",
        }}
      />

      {hover !== null && (
        <div
          style={{
            position: "absolute",
            left: `${xOf(hover)}%`,
            bottom: h + 6,
            // Nudged to a corner at the two ends so the chip never hangs off the
            // side of the card.
            transform: `translateX(${hover <= 1 ? "0" : hover >= lastIdx - 1 ? "-100%" : "-50%"})`,
            background: C.navy,
            color: C.w,
            borderRadius: "var(--radius-sm)",
            padding: "3px 7px",
            fontSize: "var(--text-2xs)",
            fontWeight: "var(--weight-bold)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          {format(data[hover])}
          {labels[hover] && <span style={{ opacity: 0.7, marginLeft: 5 }}>{labels[hover]}</span>}
        </div>
      )}
    </div>
  );
}

// A labelled horizontal bar, for "compare these magnitudes" panels.
//
// Every row is the same hue on purpose. The bar's length already carries the
// magnitude, so shading each bar darker-where-bigger would encode the same fact
// twice and burn the only free channel on nothing.
//
// The value sits in a fixed gutter past the bar end rather than floating at the
// tip: at full length a tip label has nowhere to go but inside the bar, where it
// gets clipped. In a gutter the numbers also line up, which is what tabular
// figures are for.
function BarRow({ label, value, max, color, display, tone }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value) / max) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: 7 }}>
      {/* title, because a long category name truncates here and the full string
          is otherwise nowhere on the card. */}
      <div title={label} style={{ width: 92, flexShrink: 0, fontSize: "var(--text-2xs)", color: C.sub, fontWeight: "var(--weight-bold)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 40, height: 10, background: tone || C.lg, borderRadius: 2 }}>
        {/* Rounded at the data end, square at the baseline it grows from. A zero
            row keeps a 3px stub so the track never reads as a missing row. */}
        <div
          style={{
            width: `${(pct * 100).toFixed(1)}%`,
            minWidth: value > 0 ? 3 : 0,
            height: "100%",
            background: color,
            borderRadius: "2px 4px 4px 2px",
          }}
        />
      </div>
      {/* minWidth, not width: a seven-figure spend has to be allowed to widen the
          gutter and take the room off the bar, rather than spill out of it. */}
      <div style={{ minWidth: 58, flexShrink: 0, textAlign: "right", whiteSpace: "nowrap", fontSize: "var(--text-2xs)", fontWeight: "var(--weight-extrabold)", color: C.navy, fontVariantNumeric: "tabular-nums" }}>
        {display ?? value}
      </div>
    </div>
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

  // ── Twelve-week trend series for the KPI sparklines ──
  // Bucketed by whole weeks back from now, oldest first, so the line reads left
  // to right. Jobs with no completion timestamp are skipped rather than dumped
  // into the current week, which would fake a spike.
  //
  // Twelve rather than eight: the line is twice as tall as it was and the tiles
  // are wide, so eight points left it sparse. A quarter is also the window people
  // actually compare against.
  const TREND_WEEKS = 12;
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
  // The week each bucket starts, for the sparkline tooltip. Derived from the same
  // arithmetic weeklySeries uses, so a label cannot end up pointing at the wrong
  // point. Locale follows the viewer's language, like the clock does.
  const trendLabels = Array.from({ length: TREND_WEEKS }, (_, i) =>
    new Date(nowMs - (TREND_WEEKS - 1 - i) * WEEK_MS).toLocaleDateString(
      lang === "es" ? "es-ES" : "en-US",
      { month: "short", day: "numeric" },
    ),
  );
  const money = (v) => `$${Math.round(v).toLocaleString()}`;

  const myJobs = jobs.filter((j) => (j.assignedto === user.id || j.assignedTo === user.id) && j.status !== "completed");
  const newJobs = myJobs.filter((j) => j.newforassigned);

  // Which of the three dashboards this user gets. Resolved here rather than in the
  // router at the bottom, because the KPI strip at the top of the page is built
  // from the same answer: each role's status cards now share that one row instead
  // of opening a second row of their own further down, below the banners, the
  // quick actions and the weather.
  const dashboardKind =
    perms.settings_manage || user.role === "manager" || user.role === "admin" || user.role === "coordinator"
      ? "manager"
      : perms.inv_view && (user.role === "warehouse" || user.role === "inventory")
        ? "warehouse"
        : "field";

  // The figures behind those status cards. Hoisted out of the three render
  // functions below so the cards can be assembled at the top of the page; the
  // lists a few of them feed are still used down there.
  const myVehicle = vehs.find((v) => v.assigned_to_id === user.id || v.assigned_to === user.name);
  const myOpenTickets = reqs.filter((r) => r.submitted_by === user.name && r.status === "pending");
  const pendingPulls = jobs.filter((j) => j.status === "approved" || j.status === "draft");
  const activeJobsList = jobs.filter((j) => j.status === "active");
  const deadlinedTrucks = vehs.filter((v) => v.status === "maintenance" || v.status === "down");
  const totalInventoryCost = inv.reduce((sum, item) => sum + tot(item) * (item.cost || 0), 0);

  // ── Pipeline by stage ──
  // Where the work is sitting, as five magnitudes rather than five badges. Read
  // in pipeline order, not sorted by size: the shape of the queue is the point,
  // and re-ordering it every render would make it unreadable at a glance.
  const PIPELINE_STAGES = ["draft", "approved", "active", "completed", "closed"];
  const stageCounts = PIPELINE_STAGES.map((key) => ({
    key,
    label: jSC[key]?.l || key,
    count: jobs.filter((j) => j.status === key).length,
  }));
  const stageMax = Math.max(...stageCounts.map((s) => s.count), 1);

  // ── Material spend by category, this month ──
  // Same filter and same per-line arithmetic as materialCostThisMonth above, so
  // the bars and the KPI tile can never tell different stories. Only the top five
  // are shown, so the bars deliberately do NOT sum to that tile — the heading
  // says "top 5" for exactly that reason.
  const costByCategory = (() => {
    const byCat = new Map();
    jobs
      .filter((j) => isDoneJob(j) && doneAtMs(j) >= monthStartMs)
      .forEach((j) => {
        (j.items || j.materials || []).forEach((i) => {
          if (!i) return;
          const used = Math.max(0, (i.pulled || 0) - (i.returned || 0));
          const spend = used * (i.priceAtPull || 0);
          if (spend <= 0) return;
          const cat = i.icat || i.cat || "Uncategorized";
          byCat.set(cat, (byCat.get(cat) || 0) + spend);
        });
      });
    return [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  })();
  const costByCategoryMax = Math.max(...costByCategory.map(([, v]) => v), 1);

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
  //
  // The icon used to sit in its own 38px block ABOVE the number, which cost every
  // card roughly fifty vertical pixels to say nothing the label did not. It now
  // sits beside the figure, so a row of these is about a third shorter and two
  // rows of them fit where one used to.
  const SC = ({ label, value, color, icon, onClick, sub, series, seriesLabels, format }) => (
    <div
      onClick={onClick}
      className={onClick ? "mrr-card mrr-card-click" : "mrr-card"}
      style={{
        background: C.w,
        borderRadius: "var(--radius-xl)",
        padding: 14,
        border: `1px solid ${C.bd}`,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
        <div style={{ width: 34, height: 34, borderRadius: "var(--radius-lg)", background: `color-mix(in srgb, ${color} 8%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-lg)", flexShrink: 0 }}>
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          {/* nowrap + ellipsis: the valuation card carries "$1,284,003" and these
              columns are narrower now. A number that wraps mid-figure is worse
              than one that is cut off. */}
          <div style={{ fontSize: "var(--text-2xl)", fontWeight: "var(--weight-extrabold)", color, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {value}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 2, fontWeight: "var(--weight-semibold)" }}>{label}</div>
        </div>
      </div>
      {sub && (
        <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 4 }}>{sub}</div>
      )}
      {series && <Sparkline data={series} labels={seriesLabels} color={color} format={format} />}
    </div>
  );

  // Reusable Quick Action Card Primitive
  const QuickActionCard = ({ title, subtitle, icon, color, onClick }) => (
    <div
      onClick={onClick}
      className="mrr-card mrr-card-click"
      style={{
        background: C.w,
        borderRadius: "var(--radius-xl)",
        padding: "12px 14px",
        border: `1px solid ${C.bd}`,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        minWidth: 0,
      }}
    >
      <div style={{
        width: 38,
        height: 38,
        borderRadius: "var(--radius-lg)",
        background: `color-mix(in srgb, ${color} 9%, transparent)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "var(--text-xl)",
        flexShrink: 0
      }}>
        {icon}
      </div>
      {/* minWidth 0 on both, or the subtitle refuses to shrink and pushes the
          tile wider than its grid column. */}
      <div style={{ textAlign: "left", minWidth: 0 }}>
        <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ color: C.sub, fontSize: "var(--text-2xs)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div>
      </div>
    </div>
  );

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t.goodMorning : hour < 17 ? t.goodAfternoon : t.goodEvening;

  // ── 🔨 LAYOUT 1: FIELD WORKER PORTAL ──
  const renderFieldDashboard = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        {/* The three status cards that used to head this section now sit in the
            KPI strip at the top of the page. */}
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
          <TeamChatBox user={user} users={users} limit={30} onMarkRead={onMarkChatRead} lang={lang} />
        </div>
      </div>
    );
  };

  // ── 🏭 LAYOUT 2: WAREHOUSE FULFILLMENT HUB ──
  const renderWarehouseDashboard = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        {/* Status cards for this role live in the KPI strip at the top now. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 16, border: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>🚨 {t.lowStockWatch}</h3>
              {low.length === 0 ? (
                <p style={{ color: C.gr, fontSize: "var(--text-sm)", margin: 0 }}>✅ {t.allStockSafe}</p>
              ) : (
                /* A meter each, on-hand against that item's own alert level, rather
                   than a number you have to hold the threshold in your head to
                   read. Fill carries severity and the track is a wash of the same
                   colour, so the state reads across the whole bar. The word "Out"
                   or "Low" rides along, because severity must never be colour
                   alone. */
                low.slice(0, 5).map((item) => {
                  const onHand = tot(item);
                  const limit = item.alrt || 0;
                  const pct = limit > 0 ? Math.min(1, Math.max(0, onHand) / limit) : 0;
                  const out = onHand <= 0;
                  const tone = out || pct <= 0.5 ? C.rd : C.am;
                  const track = out || pct <= 0.5 ? C.rB : C.aB;
                  return (
                    <div key={item.id} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-3)", marginBottom: 4, fontSize: "var(--text-sm)" }}>
                        <span style={{ fontWeight: "var(--weight-bold)", color: C.navy, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                        <span style={{ color: tone, fontWeight: "var(--weight-extrabold)", whiteSpace: "nowrap", fontSize: "var(--text-xs)" }}>
                          {out ? "Out" : "Low"} · {onHand} / {limit} {item.unit}
                        </span>
                      </div>
                      <div style={{ height: 8, background: track, borderRadius: 2 }}>
                        <div style={{ width: `${(pct * 100).toFixed(1)}%`, minWidth: onHand > 0 ? 3 : 0, height: "100%", background: tone, borderRadius: "2px 4px 4px 2px" }} />
                      </div>
                    </div>
                  );
                })
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
          <TeamChatBox user={user} users={users} limit={30} onMarkRead={onMarkChatRead} lang={lang} />
        </div>
      </div>
    );
  };

  // ── 📊 LAYOUT 3: MANAGEMENT COMMAND CENTRE ──
  const renderManagerDashboard = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        {/* Status cards for this role live in the KPI strip at the top now. */}
        <ScheduleCard jobs={jobs} reqs={reqs} jobTrailers={jobTrailers} vehs={vehs} users={users} onNav={onNav} lang={lang} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 16, border: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>📋 {t.masterPipeline}</h3>

              {/* The whole queue as five bars, above the four-job sample that used
                  to be the only thing here. A list of four rows out of sixty said
                  nothing about where the work is piling up. One hue for all five:
                  these are magnitudes, and the length is already the answer. */}
              <div style={{ marginBottom: 12 }}>
                {stageCounts.map((s) => (
                  <BarRow key={s.key} label={s.label} value={s.count} max={stageMax} color={C.gold} />
                ))}
              </div>
              <div style={{ borderTop: `1px solid ${C.lg}`, paddingTop: 10 }} />

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

            {/* Where the month's material money actually went. The KPI tile gives
                the total and the trend; this says which five categories it is,
                which is the question the total prompts and nothing answered. */}
            {perms.inv_pricing_view && (
              <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 16, border: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)" }}>
                <h3 style={{ margin: "0 0 4px", fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>💰 {t.materialThisMonth}</h3>
                <p style={{ margin: "0 0 12px", fontSize: "var(--text-2xs)", color: C.sub }}>Top 5 categories by spend</p>
                {costByCategory.length === 0 ? (
                  <p style={{ color: C.sub, fontSize: "var(--text-sm)", margin: 0 }}>No material consumed yet this month.</p>
                ) : (
                  costByCategory.map(([cat, spend]) => (
                    <BarRow key={cat} label={cat} value={spend} max={costByCategoryMax} color={C.am} display={money(spend)} />
                  ))
                )}
              </div>
            )}
          </div>
          <TeamChatBox user={user} users={users} limit={30} onMarkRead={onMarkChatRead} lang={lang} />
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

      {/* One KPI strip: this role's current-status cards, then the recent-output
          ones. These were two separate rows of three, stretched to a third of the
          screen each and sitting a page apart — a lot of vertical space for six
          numbers. Five or six narrower tiles fill one row on a desktop and reflow
          to two or three rows on a phone.

          The two kinds still read as different questions, because the labels ask
          different questions: "Active Projects" now, "Completed This Week" lately. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-3)", marginBottom: 16 }}>
        {dashboardKind === "manager" && (
          <>
            <SC label={t.activeProjects} value={activeJobsList.length} color={C.am} icon="🔄" onClick={() => onNav("pull")} />
            <SC label={t.fleetDisruptions} value={deadlinedTrucks.length} color={deadlinedTrucks.length > 0 ? C.rd : C.gr} icon="🚛" onClick={() => onNav("fleet")} />
            <SC label={t.holdingValuation} value={`$${Math.round(totalInventoryCost).toLocaleString()}`} color={C.blue} icon="💰" onClick={() => onNav("reports")} />
          </>
        )}
        {dashboardKind === "warehouse" && (
          <>
            <SC label={t.lowStockWatch} value={low.length} color={low.length > 0 ? C.rd : C.gr} icon="🚨" onClick={() => onNav("inventory")} />
            <SC label={t.stagedOrders} value={pendingPulls.length} color={C.blue} icon="📦" onClick={() => onNav("pull")} />
            <SC label={t.myOpenTickets} value={pendingReqs.length} color={C.pu} icon="🔧" onClick={() => onNav("requests")} />
          </>
        )}
        {dashboardKind === "field" && (
          <>
            <SC label={t.myAssignedJobs} value={myJobs.length} color={C.tl} icon="📋" onClick={() => onNav("pull")} />
            <SC label={t.activeBuilds} value={myJobs.filter((j) => j.status === "active").length} color={C.am} icon="🔄" onClick={() => onNav("pull")} />
            <SC label={t.myOpenTickets} value={myOpenTickets.length} color={C.pu} icon="🔧" onClick={() => onNav("requests")} />
          </>
        )}
        <SC label={t.completedThisWeek} value={completedThisWeek} color={C.gr} icon="✅" series={completedSeries} seriesLabels={trendLabels} onClick={perms.reports_view ? () => onNav("reports") : undefined} />
        <SC label={t.completedThisMonth} value={completedThisMonth} color={C.blue} icon="🏁" series={completedSeries} seriesLabels={trendLabels} onClick={perms.reports_view ? () => onNav("reports") : undefined} />
        {perms.inv_pricing_view && (
          <SC label={t.materialThisMonth} value={money(materialCostThisMonth)} color={C.am} icon="💰" series={materialCostSeries} seriesLabels={trendLabels} format={money} onClick={perms.reports_view ? () => onNav("reports") : undefined} />
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

      {/* Quick actions and the weather share a row. The weather card is about 150px
          of content and was being stretched across the whole screen on its own; the
          action tiles are a 2×2 block of roughly the same height beside it. Both
          halves fall back to full width below 320px of column. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-4)", alignItems: "start", marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-3)" }}>
          <QuickActionCard
            title={t.pull}
            subtitle={t.dashQaStage}
            icon="📦"
            color="var(--c-slate)"
            onClick={() => onNav("pull")}
          />
          <QuickActionCard
            title={t.requests}
            subtitle={t.dashQaMaint}
            icon="🔧"
            color="var(--c-plum)"
            onClick={() => onNav("requests")}
          />
          <QuickActionCard
            title={t.myAssignedJobs}
            subtitle={t.dashQaCheck}
            icon="📋"
            color="var(--c-teal)"
            onClick={() => onNav("pull")}
          />
          <QuickActionCard
            title={t.fleet}
            subtitle={t.dashQaFlag}
            icon="⚠️"
            color="var(--c-rust)"
            onClick={() => onNav("fleet")}
          />
        </div>

        {/* Warehouse weather — relevant to scheduling roof work; shown for all roles */}
        <WeatherCard lang={lang} />
      </div>

      {/* Core Evaluation Router Branch — dashboardKind is resolved at the top of
          the component, because the KPI strip needs the same answer. */}
      {dashboardKind === "manager"
        ? renderManagerDashboard()
        : dashboardKind === "warehouse"
          ? renderWarehouseDashboard()
          : renderFieldDashboard()}
      
      {/* Live Assignment Modal Overlay */}
      {newJobAlert && (
        <Modal title={`🚨 ${t.newAssignments}`} onClose={() => acknowledgeJob(false)}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>🏗️</div>
            <h3 style={{ margin: "0 0 6px 0", color: C.navy, fontWeight: "var(--weight-black)", fontSize: "var(--text-lg)" }}>
              {newJobAlert.title || newJobAlert.name || t.dashUntitledContract}
            </h3>
            <p style={{ margin: "0 0 14px 0", color: C.sub, fontSize: "var(--text-base)" }}>
              {t.dashPoTracker} <strong>{newJobAlert.po || "—"}</strong>
            </p>
            
            <div style={{ background: "var(--c-subtle)", padding: 12, borderRadius: "var(--radius-md)", textAlign: "left", fontSize: "var(--text-sm)", border: `1px solid ${C.bd}`, marginBottom: 16 }}>
              <strong>📍 {t.dashDispatchAddress}:</strong> {newJobAlert.addr || newJobAlert.address || t.dashNoLocation}
              {newJobAlert.notes && (
                <div style={{ marginTop: 8, borderTop: `1px dashed ${C.bd}`, paddingTop: 8 }}>
                  <strong>📝 {t.dashCrewInstructions}:</strong> {newJobAlert.notes}
                </div>
              )}
            </div>

            {alertTrailerNames.length > 0 && (
              <div style={{ background: "var(--c-warn-wash)", padding: 12, borderRadius: "var(--radius-md)", textAlign: "left", fontSize: "var(--text-sm)", border: `1.5px solid ${C.am}`, marginBottom: 16, fontWeight: "var(--weight-bold)", color: C.am }}>
                🚚 {t.dashBringTrailers}: {alertTrailerNames.join(", ")}
              </div>
            )}

            <Btn v="teal" onClick={() => acknowledgeJob(true)} style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
              {t.dashGotItMaterials}
            </Btn>
          </div>
        </Modal>
      )}

      {/* New Maintenance Request Alert Overlay — only one blocking modal at a time; job alerts take priority */}
      {!newJobAlert && maintAlert && (
        <Modal title={t.dashNewMaintReq} onClose={() => acknowledgeMaint(false)}>
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
              {t.dashGotItMaint}
            </Btn>
          </div>
        </Modal>
      )}

      {/* Maintenance Status Update Alert Overlay — tells the requester their ticket moved (scheduled/completed) */}
      {!newJobAlert && !maintAlert && statusAlert && (
        <Modal title={t.dashMaintUpdate} onClose={() => acknowledgeStatusUpdate(false)}>
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
              {t.dashGotItMyReq}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}