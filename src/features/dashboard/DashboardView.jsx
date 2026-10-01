// src/features/dashboard/DashboardView.jsx
import { useState, useEffect, useId } from "react";
import {
  Calendar,
  Truck,
  DollarSign,
  AlertTriangle,
  AlertOctagon,
  Package,
  Wrench,
  ClipboardList,
  CheckCircle2,
  Flag,
  Plus,
  PartyPopper,
  Bell,
  MapPin,
  FileText,
  User,
  HardHat,
  RefreshCw,
} from "lucide-react";
import { C, displayName } from "@/shared/utils/helpers";
import {
  Bdg,
  Btn,
  Modal,
  CardGrid,
  Row,
  Stack,
  Text,
  Muted,
  Callout,
  SectionTitle,
  StatTile,
  IconSwatch,
  Meter,
  Divider,
  Card,
} from "@/shared/components/UIPrimitives";
import TeamChatBox from "./TeamChatBox";
import WeatherCard from "./WeatherCard";
import ScheduleCard from "./ScheduleCard";
import { supabase } from "@/shared/utils/supabase";
import { translations } from "@/shared/utils/translations";

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
    <Stack gap={0} style={{ textAlign: "right", flexShrink: 0 }}>
      <Text
        size="2xl"
        weight="black"
        color={C.navy}
        style={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}
      >
        {now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </Text>
      <Text size="xs" weight="bold" color={C.sub} style={{ textTransform: "capitalize" }}>
        {now.toLocaleDateString(locale, { weekday: "long" })}
      </Text>
    </Stack>
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
        <line
          x1="0"
          y1={h - PAD}
          x2="100"
          y2={h - PAD}
          stroke={C.bd}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
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
          <line
            x1={xOf(hover)}
            y1="0"
            x2={xOf(hover)}
            y2={h - PAD}
            stroke={color}
            strokeWidth="1"
            strokeOpacity="0.4"
            vectorEffect="non-scaling-stroke"
          />
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
    <Row style={{ marginBottom: 7 }}>
      {/* title, because a long category name truncates here and the full string
          is otherwise nowhere on the card. */}
      <Text
        title={label}
        size="2xs"
        weight="bold"
        color={C.sub}
        truncate
        style={{ width: 92, flexShrink: 0 }}
      >
        {label}
      </Text>
      <Meter value={pct} color={color} track={tone} height={10} style={{ flex: 1, minWidth: 40 }} />
      {/* minWidth, not width: a seven-figure spend has to be allowed to widen the
          gutter and take the room off the bar, rather than spill out of it. */}
      <Text
        size="2xs"
        weight="extrabold"
        color={C.navy}
        style={{
          minWidth: 58,
          flexShrink: 0,
          textAlign: "right",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {display ?? value}
      </Text>
    </Row>
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
  const jobMaterialCost = (j) =>
    (j.items || j.materials || []).reduce(
      (a, i) =>
        a + (i ? Math.max(0, (i.pulled || 0) - (i.returned || 0)) * (i.priceAtPull || 0) : 0),
      0,
    );
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

  const myJobs = jobs.filter(
    (j) => (j.assignedto === user.id || j.assignedTo === user.id) && j.status !== "completed",
  );
  const newJobs = myJobs.filter((j) => j.newforassigned);

  // Which of the three dashboards this user gets. Resolved here rather than in the
  // router at the bottom, because the KPI strip at the top of the page is built
  // from the same answer: each role's status cards now share that one row instead
  // of opening a second row of their own further down, below the banners, the
  // quick actions and the weather.
  const dashboardKind =
    perms.settings_manage ||
    user.role === "manager" ||
    user.role === "admin" ||
    user.role === "coordinator"
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
  // Inventory items don't carry a top-level cost; value lives per-batch as
  // (remaining qty × received price). Mirrors warehouseAssetCapital in
  // ReportsView so the dashboard tile and the report it links to agree.
  const totalInventoryCost = inv.reduce(
    (sum, item) =>
      sum +
      (item.batches?.reduce(
        (s, b) => s + (parseFloat(b.rem) || 0) * (parseFloat(b.price) || 0),
        0,
      ) || 0),
    0,
  );

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
          p.map((j) => (j.id === newJobAlert.id ? { ...j, newforassigned: false } : j)),
        );
      }
      setNewJobAlert(null);
      if (openChecklist) onNav("pull");
    } catch (err) {
      console.error("Failed to dismiss supervisor project warning banner:", err);
    }
  };

  // ── NEW MAINTENANCE REQUEST ALERT (pops for anyone with maint_manage, same pattern as new-job alert) ──
  // Requires a `acked_by` jsonb column on maintenance_requests (array of user ids who've dismissed it),
  // since — unlike jobs, which have one assignedto supervisor — a request can be relevant to several managers.
  const newMaintForMe = perms.maint_manage
    ? reqs.filter(
        (r) =>
          r.status === "pending" && !(Array.isArray(r.acked_by) && r.acked_by.includes(user.id)),
      )
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
      const nextAcked = Array.isArray(maintAlert.acked_by)
        ? [...maintAlert.acked_by, user.id]
        : [user.id];
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

  // ── MAINTENANCE STATUS UPDATE ALERT (pops for the requester when a manager moves their ticket,
  // same pattern as the supervisor new-job alert). Requires a `newforrequester` boolean column on
  // maintenance_requests, set by updateStatus in MaintenanceRequestsView and cleared here on acknowledge.
  const myStatusUpdates = reqs.filter(
    (r) => (r.newforrequester || r.newForRequester) && String(r.uid) === String(user.id),
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
          p.map((r) =>
            r.id === statusAlert.id ? { ...r, newforrequester: false, newForRequester: false } : r,
          ),
        );
      }
      setStatusAlert(null);
      if (openRequests) onNav("requests");
    } catch (err) {
      console.error("Failed to dismiss maintenance status update alert:", err);
    }
  };

  // A KPI tile with its twelve-week sparkline underneath.
  const SC = ({ series, seriesLabels, format, ...tile }) => (
    <StatTile {...tile}>
      {series && (
        <Sparkline data={series} labels={seriesLabels} color={tile.color} format={format} />
      )}
    </StatTile>
  );

  const QuickActionCard = ({ title, subtitle, icon, color, onClick }) => (
    <Card onClick={onClick} pad="var(--space-5) var(--space-6)">
      <Row gap={4} style={{ minWidth: 0 }}>
        <IconSwatch icon={icon} color={color} size={38} iconSize={19} tint={9} />
        {/* minWidth 0 on both, or the subtitle refuses to shrink and pushes the
            tile wider than its grid column. */}
        <Stack gap={0} style={{ textAlign: "left", minWidth: 0 }}>
          <Text size="sm" weight="bold" color={C.navy} truncate>
            {title}
          </Text>
          <Text size="2xs" color={C.sub} truncate style={{ marginTop: 1 }}>
            {subtitle}
          </Text>
        </Stack>
      </Row>
    </Card>
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t.goodMorning : hour < 17 ? t.goodAfternoon : t.goodEvening;

  // ── LAYOUT 1: FIELD WORKER PORTAL ──
  const renderFieldDashboard = () => {
    return (
      <Stack gap={6}>
        {/* The three status cards that used to head this section now sit in the
            KPI strip at the top of the page. */}
        <CardGrid minWidth={320} fit gap="var(--space-6)" style={{ alignItems: "start" }}>
          <Stack gap={6}>
            <Card>
              <SectionTitle as="h3" icon={Calendar} style={{ marginBottom: 12 }}>
                {t.activeAgenda}
              </SectionTitle>
              {myJobs.length === 0 ? (
                <Muted as="p" size="sm" style={{ margin: 0 }}>
                  {t.noJobs}
                </Muted>
              ) : (
                myJobs.map((j) => (
                  <Callout
                    key={j.id}
                    pad={4}
                    size="sm"
                    style={{ marginBottom: 6, borderLeft: `3px solid ${C.tl}` }}
                  >
                    <Text weight="bold" color={C.navy}>
                      {j.title || j.name}
                    </Text>
                    <Row
                      gap={1}
                      style={{ color: C.sub, fontSize: "var(--text-2xs)", marginTop: 2 }}
                    >
                      <MapPin size={11} aria-hidden="true" /> {j.addr || j.address}
                    </Row>
                  </Callout>
                ))
              )}
            </Card>

            <Card>
              <SectionTitle as="h3" icon={Truck} style={{ marginBottom: 12 }}>
                {t.assignedTruck}
              </SectionTitle>
              {myVehicle ? (
                <Callout pad={7} style={{ borderRadius: "var(--radius-lg)" }}>
                  <Text
                    size="xs"
                    weight="bold"
                    color={C.sub}
                    style={{ textTransform: "uppercase", marginBottom: 4 }}
                  >
                    {t.assignedTruck}
                  </Text>
                  <Text size="lg" weight="extrabold" color={C.navy}>
                    {myVehicle.name} — {myVehicle.make} {myVehicle.model}
                  </Text>
                  <Text size="base" weight="bold" color={C.blue} style={{ marginTop: 2 }}>
                    Plate ID: {myVehicle.plate || "No Plate Registered"}
                  </Text>
                </Callout>
              ) : (
                <Text size="base" color={C.sub} style={{ fontStyle: "italic", padding: "12px 0" }}>
                  {t.noTruck}
                </Text>
              )}
            </Card>
          </Stack>
          <TeamChatBox
            user={user}
            users={users}
            limit={30}
            onMarkRead={onMarkChatRead}
            lang={lang}
          />
        </CardGrid>
      </Stack>
    );
  };

  // ── LAYOUT 2: WAREHOUSE FULFILLMENT HUB ──
  const renderWarehouseDashboard = () => {
    return (
      <Stack gap={6}>
        {/* Status cards for this role live in the KPI strip at the top now. */}
        <CardGrid minWidth={320} fit gap="var(--space-6)" style={{ alignItems: "start" }}>
          <Stack gap={6}>
            <Card>
              <SectionTitle as="h3" icon={AlertOctagon} style={{ marginBottom: 12 }}>
                {t.lowStockWatch}
              </SectionTitle>
              {low.length === 0 ? (
                <Row as="p" gap={2} style={{ color: C.gr, fontSize: "var(--text-sm)", margin: 0 }}>
                  <CheckCircle2 size={14} aria-hidden="true" /> {t.allStockSafe}
                </Row>
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
                    <Stack key={item.id} gap={0} style={{ marginBottom: 10 }}>
                      <Row
                        align="baseline"
                        justify="space-between"
                        style={{ marginBottom: 4, fontSize: "var(--text-sm)" }}
                      >
                        <Text
                          as="span"
                          weight="bold"
                          color={C.navy}
                          truncate
                          style={{ minWidth: 0 }}
                        >
                          {item.name}
                        </Text>
                        <Text
                          as="span"
                          size="xs"
                          weight="extrabold"
                          color={tone}
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {out ? "Out" : "Low"} · {onHand} / {limit} {item.unit}
                        </Text>
                      </Row>
                      <Meter
                        value={onHand > 0 ? Math.max(pct, 0.001) : 0}
                        color={tone}
                        track={track}
                        height={8}
                      />
                    </Stack>
                  );
                })
              )}
            </Card>

            <Card>
              <SectionTitle as="h3" icon={Package} style={{ marginBottom: 12 }}>
                {t.stagedOrders}
              </SectionTitle>
              {pendingPulls.slice(0, 4).map((p) => (
                <Callout
                  key={p.id}
                  onClick={() => onNav("pull")}
                  pad="var(--space-3) var(--space-4)"
                  size="sm"
                  style={{ marginBottom: 6 }}
                >
                  <Row justify="space-between">
                    <Text as="span" weight="bold" color={C.navy}>
                      {p.title || p.name}
                    </Text>
                    <Bdg color={p.status === "approved" ? "blue" : "gray"}>
                      {p.status.toUpperCase()}
                    </Bdg>
                  </Row>
                </Callout>
              ))}
            </Card>
          </Stack>
          <TeamChatBox
            user={user}
            users={users}
            limit={30}
            onMarkRead={onMarkChatRead}
            lang={lang}
          />
        </CardGrid>
      </Stack>
    );
  };

  // ── LAYOUT 3: MANAGEMENT COMMAND CENTRE ──
  const renderManagerDashboard = () => {
    return (
      <Stack gap={6}>
        {/* Status cards for this role live in the KPI strip at the top now. */}
        <ScheduleCard
          jobs={jobs}
          reqs={reqs}
          jobTrailers={jobTrailers}
          vehs={vehs}
          users={users}
          onNav={onNav}
          lang={lang}
        />

        <CardGrid minWidth={320} fit gap="var(--space-6)" style={{ alignItems: "start" }}>
          <Stack gap={6}>
            <Card>
              <SectionTitle as="h3" icon={ClipboardList} style={{ marginBottom: 12 }}>
                {t.masterPipeline}
              </SectionTitle>

              {/* The whole queue as five bars, above the four-job sample that used
                  to be the only thing here. A list of four rows out of sixty said
                  nothing about where the work is piling up. One hue for all five:
                  these are magnitudes, and the length is already the answer. */}
              <Stack gap={0} style={{ marginBottom: 12 }}>
                {stageCounts.map((s) => (
                  <BarRow
                    key={s.key}
                    label={s.label}
                    value={s.count}
                    max={stageMax}
                    color={C.gold}
                  />
                ))}
              </Stack>
              <Divider style={{ margin: "0 0 10px" }} />

              {jobs
                .filter((j) => j.status !== "completed")
                .slice(0, 4)
                .map((j) => {
                  const sup = users.find((u) => u.id === j.assignedto || u.id === j.assignedTo);
                  const st = jSC[j.status] || { c: "gray", l: j.status };
                  return (
                    <Callout
                      key={j.id}
                      pad="var(--space-3) var(--space-4)"
                      size="sm"
                      style={{ marginBottom: 6 }}
                    >
                      <Row justify="space-between">
                        <div>
                          <Text weight="bold" color={C.navy}>
                            {j.title || j.name}
                          </Text>
                          <Muted size="2xs">
                            {j.po || t.noPO}
                            {sup ? ` · ${sup.full_name || sup.name}` : ""}
                          </Muted>
                        </div>
                        <Bdg color={st.c}>{st.l}</Bdg>
                      </Row>
                    </Callout>
                  );
                })}
            </Card>

            {/* Where the month's material money actually went. The KPI tile gives
                the total and the trend; this says which five categories it is,
                which is the question the total prompts and nothing answered. */}
            {perms.inv_pricing_view && (
              <Card>
                <SectionTitle as="h3" icon={DollarSign} style={{ marginBottom: 4 }}>
                  {t.materialThisMonth}
                </SectionTitle>
                <Muted as="p" size="2xs" style={{ margin: "0 0 12px" }}>
                  Top 5 categories by spend
                </Muted>
                {costByCategory.length === 0 ? (
                  <Muted as="p" size="sm" style={{ margin: 0 }}>
                    No material consumed yet this month.
                  </Muted>
                ) : (
                  costByCategory.map(([cat, spend]) => (
                    <BarRow
                      key={cat}
                      label={cat}
                      value={spend}
                      max={costByCategoryMax}
                      color={C.am}
                      display={money(spend)}
                    />
                  ))
                )}
              </Card>
            )}
          </Stack>
          <TeamChatBox
            user={user}
            users={users}
            limit={30}
            onMarkRead={onMarkChatRead}
            lang={lang}
          />
        </CardGrid>
      </Stack>
    );
  };

  return (
    <div>
      {/* Upper Welcome Context Row — company-branded + live clock. The accent stripe
          picks up each company's brand color; the subtitle is the company's own name
          + tagline (was a hardcoded "Saint Joe Road Warehouse" shown for every tenant). */}
      <Row
        gap={6}
        wrap
        style={{
          marginBottom: 14,
          borderLeft: "4px solid var(--brand-accent, var(--c-amber))",
          paddingLeft: 14,
        }}
      >
        {activeLogo && (
          <img
            src={activeLogo}
            alt=""
            style={{ height: 44, maxWidth: 130, objectFit: "contain", flexShrink: 0 }}
          />
        )}
        <Stack gap={0} style={{ minWidth: 0, flex: "1 1 220px" }}>
          <Text as="h1" size="2xl" weight="black" color={C.navy} style={{ margin: 0 }}>
            {greeting}, {displayName(user)}
          </Text>
          <Muted as="p" size="sm" style={{ margin: "3px 0 0" }}>
            {company?.branding?.displayName || company?.name || "Steadwerk"}
            {company?.branding?.tagline ? ` · ${company.branding.tagline}` : ""}
            {" · "}
            {new Date().toLocaleDateString(lang === "es" ? "es-ES" : "en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </Muted>
        </Stack>
        <LiveClock lang={lang} />
      </Row>

      {/* Quick actions — start the common daily tasks in one click. Each is gated by
          the permission that makes it meaningful; the row hides if none apply. */}
      {(perms.jobs_build || perms.jobs_pull || perms.maint_submit || perms.maint_manage) && (
        <Row align="stretch" wrap style={{ marginBottom: 16 }}>
          {perms.jobs_build && (
            <Btn v="gold" onClick={() => onNav("buildjobs")}>
              <Plus size={14} aria-hidden="true" /> {t.quickNewJob}
            </Btn>
          )}
          {perms.jobs_pull && (
            <Btn v="teal" onClick={() => onNav("pull")}>
              <Truck size={14} aria-hidden="true" /> {t.pull}
            </Btn>
          )}
          {(perms.maint_submit || perms.maint_manage) && (
            <Btn v="outline" onClick={() => onNav("requests")}>
              <Wrench size={14} aria-hidden="true" /> {t.quickMaint}
            </Btn>
          )}
        </Row>
      )}

      {/* One KPI strip: this role's current-status cards, then the recent-output
          ones. These were two separate rows of three, stretched to a third of the
          screen each and sitting a page apart — a lot of vertical space for six
          numbers. Five or six narrower tiles fill one row on a desktop and reflow
          to two or three rows on a phone.

          The two kinds still read as different questions, because the labels ask
          different questions: "Active Projects" now, "Completed This Week" lately. */}
      <CardGrid minWidth={200} fit gap="var(--space-3)" style={{ marginBottom: 16 }}>
        {dashboardKind === "manager" && (
          <>
            <SC
              label={t.activeProjects}
              value={activeJobsList.length}
              color={C.am}
              icon={RefreshCw}
              onClick={() => onNav("pull")}
            />
            <SC
              label={t.fleetDisruptions}
              value={deadlinedTrucks.length}
              color={deadlinedTrucks.length > 0 ? C.rd : C.gr}
              icon={Truck}
              onClick={() => onNav("fleet")}
            />
            <SC
              label={t.holdingValuation}
              value={`$${Math.round(totalInventoryCost).toLocaleString()}`}
              color={C.blue}
              icon={DollarSign}
              onClick={() => onNav("reports")}
            />
          </>
        )}
        {dashboardKind === "warehouse" && (
          <>
            <SC
              label={t.lowStockWatch}
              value={low.length}
              color={low.length > 0 ? C.rd : C.gr}
              icon={AlertOctagon}
              onClick={() => onNav("inventory")}
            />
            <SC
              label={t.stagedOrders}
              value={pendingPulls.length}
              color={C.blue}
              icon={Package}
              onClick={() => onNav("pull")}
            />
            <SC
              label={t.myOpenTickets}
              value={pendingReqs.length}
              color={C.pu}
              icon={Wrench}
              onClick={() => onNav("requests")}
            />
          </>
        )}
        {dashboardKind === "field" && (
          <>
            <SC
              label={t.myAssignedJobs}
              value={myJobs.length}
              color={C.tl}
              icon={ClipboardList}
              onClick={() => onNav("pull")}
            />
            <SC
              label={t.activeBuilds}
              value={myJobs.filter((j) => j.status === "active").length}
              color={C.am}
              icon={RefreshCw}
              onClick={() => onNav("pull")}
            />
            <SC
              label={t.myOpenTickets}
              value={myOpenTickets.length}
              color={C.pu}
              icon={Wrench}
              onClick={() => onNav("requests")}
            />
          </>
        )}
        <SC
          label={t.completedThisWeek}
          value={completedThisWeek}
          color={C.gr}
          icon={CheckCircle2}
          series={completedSeries}
          seriesLabels={trendLabels}
          onClick={perms.reports_view ? () => onNav("reports") : undefined}
        />
        <SC
          label={t.completedThisMonth}
          value={completedThisMonth}
          color={C.blue}
          icon={Flag}
          series={completedSeries}
          seriesLabels={trendLabels}
          onClick={perms.reports_view ? () => onNav("reports") : undefined}
        />
        {perms.inv_pricing_view && (
          <SC
            label={t.materialThisMonth}
            value={money(materialCostThisMonth)}
            color={C.am}
            icon={DollarSign}
            series={materialCostSeries}
            seriesLabels={trendLabels}
            format={money}
            onClick={perms.reports_view ? () => onNav("reports") : undefined}
          />
        )}
      </CardGrid>

      {/* Dynamic Security & Alert Banners */}
      {user.role === "field" && newJobs.length > 0 && (
        <Callout
          tone="teal"
          bordered
          containsActions
          onClick={() => onNav("pull")}
          pad="var(--space-5) var(--space-7)"
          style={{ borderRadius: "var(--radius-lg)", marginBottom: 12 }}
        >
          <Row justify="space-between">
            <Row
              gap="7px"
              style={{
                fontWeight: "var(--weight-bold)",
                color: C.tl,
                fontSize: "var(--text-base)",
              }}
            >
              <PartyPopper size={16} aria-hidden="true" /> {newJobs.length} {t.newAssignments}
            </Row>
            <Btn v="teal" sz="sm">
              {t.view} →
            </Btn>
          </Row>
        </Callout>
      )}
      {perms.maint_manage && pendingReqs.length > 0 && (
        <Callout
          tone="plum"
          bordered
          containsActions
          onClick={() => onNav("requests")}
          pad="var(--space-5) var(--space-7)"
          style={{ borderRadius: "var(--radius-lg)", marginBottom: 12 }}
        >
          <Row justify="space-between">
            <Row
              gap="7px"
              style={{
                fontWeight: "var(--weight-bold)",
                color: C.pu,
                fontSize: "var(--text-base)",
              }}
            >
              <Bell size={15} aria-hidden="true" /> {pendingReqs.length} {t.pendingMaint}
            </Row>
            <Btn v="purple" sz="sm">
              {t.view} →
            </Btn>
          </Row>
        </Callout>
      )}
      {low.length > 0 && (
        <Callout
          tone="warn"
          bordered
          icon={AlertTriangle}
          size="sm"
          weight="semibold"
          color={C.am}
          style={{ borderRadius: "var(--radius-lg)", marginBottom: 12 }}
        >
          {low.length} {t.lowStockAlert}
        </Callout>
      )}

      {/* Quick actions and the weather share a row. The weather card is about 150px
          of content and was being stretched across the whole screen on its own; the
          action tiles are a 2×2 block of roughly the same height beside it. Both
          halves fall back to full width below 320px of column. */}
      <CardGrid
        minWidth={320}
        fit
        gap="var(--space-4)"
        style={{ alignItems: "start", marginBottom: 20 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "var(--space-3)",
          }}
        >
          <QuickActionCard
            title={t.pull}
            subtitle={t.dashQaStage}
            icon={Package}
            color="var(--c-slate)"
            onClick={() => onNav("pull")}
          />
          <QuickActionCard
            title={t.requests}
            subtitle={t.dashQaMaint}
            icon={Wrench}
            color="var(--c-plum)"
            onClick={() => onNav("requests")}
          />
          <QuickActionCard
            title={t.myAssignedJobs}
            subtitle={t.dashQaCheck}
            icon={ClipboardList}
            color="var(--c-teal)"
            onClick={() => onNav("pull")}
          />
          <QuickActionCard
            title={t.fleet}
            subtitle={t.dashQaFlag}
            icon={AlertTriangle}
            color="var(--c-rust)"
            onClick={() => onNav("fleet")}
          />
        </div>

        {/* Warehouse weather — relevant to scheduling roof work; shown for all roles */}
        <WeatherCard lang={lang} />
      </CardGrid>

      {/* Core Evaluation Router Branch — dashboardKind is resolved at the top of
          the component, because the KPI strip needs the same answer. */}
      {dashboardKind === "manager"
        ? renderManagerDashboard()
        : dashboardKind === "warehouse"
          ? renderWarehouseDashboard()
          : renderFieldDashboard()}

      {/* Live Assignment Modal Overlay */}
      {newJobAlert && (
        <Modal
          title={
            <Row as="span">
              <AlertOctagon size={17} aria-hidden="true" /> {t.newAssignments}
            </Row>
          }
          onClose={() => acknowledgeJob(false)}
        >
          <Stack gap={0} style={{ textAlign: "center", padding: "8px 0" }}>
            <Row gap={0} align="stretch" justify="center" style={{ marginBottom: 10 }}>
              <HardHat size={38} color={C.navy} strokeWidth={1.5} aria-hidden="true" />
            </Row>
            <Text as="h3" size="lg" weight="black" color={C.navy} style={{ margin: "0 0 6px 0" }}>
              {newJobAlert.title || newJobAlert.name || t.dashUntitledContract}
            </Text>
            <Text as="p" size="base" color={C.sub} style={{ margin: "0 0 14px 0" }}>
              {t.dashPoTracker} <strong>{newJobAlert.po || "—"}</strong>
            </Text>

            <Callout bordered pad={5} size="sm" style={{ textAlign: "left", marginBottom: 16 }}>
              <strong>
                <MapPin size={13} style={{ verticalAlign: -2 }} aria-hidden="true" />{" "}
                {t.dashDispatchAddress}:
              </strong>{" "}
              {newJobAlert.addr || newJobAlert.address || t.dashNoLocation}
              {newJobAlert.notes && (
                <>
                  <Divider dashed />
                  <strong>
                    <FileText size={13} style={{ verticalAlign: -2 }} aria-hidden="true" />{" "}
                    {t.dashCrewInstructions}:
                  </strong>{" "}
                  {newJobAlert.notes}
                </>
              )}
            </Callout>

            {alertTrailerNames.length > 0 && (
              <Callout
                tone="warn"
                bordered
                pad={5}
                size="sm"
                weight="bold"
                color={C.am}
                style={{ textAlign: "left", marginBottom: 16 }}
              >
                <Truck size={13} style={{ verticalAlign: -2 }} aria-hidden="true" />{" "}
                {t.dashBringTrailers}: {alertTrailerNames.join(", ")}
              </Callout>
            )}

            <Btn
              v="teal"
              onClick={() => acknowledgeJob(true)}
              style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}
            >
              {t.dashGotItMaterials}
            </Btn>
          </Stack>
        </Modal>
      )}

      {/* New Maintenance Request Alert Overlay — only one blocking modal at a time; job alerts take priority */}
      {!newJobAlert && maintAlert && (
        <Modal title={t.dashNewMaintReq} onClose={() => acknowledgeMaint(false)}>
          <Stack gap={0} style={{ textAlign: "center", padding: "8px 0" }}>
            <Row gap={0} align="stretch" justify="center" style={{ marginBottom: 10 }}>
              <Wrench size={38} color={C.navy} strokeWidth={1.5} aria-hidden="true" />
            </Row>
            <Text as="h3" size="lg" weight="black" color={C.navy} style={{ margin: "0 0 6px 0" }}>
              {maintAlert.vname || "Unknown Vehicle"}
            </Text>
            <Row gap={2} align="stretch" justify="center" wrap style={{ marginBottom: 12 }}>
              {maintAlert.urgency === "urgent" && (
                <Bdg color="red">
                  <AlertOctagon size={11} style={{ verticalAlign: -1 }} aria-hidden="true" /> URGENT
                </Bdg>
              )}
              <Bdg color="gray">{maintAlert.type}</Bdg>
            </Row>

            <Callout bordered pad={5} size="sm" style={{ textAlign: "left", marginBottom: 16 }}>
              <strong>
                <FileText size={13} style={{ verticalAlign: -2 }} aria-hidden="true" /> Reported
                Issue:
              </strong>{" "}
              {maintAlert.notes || "No description provided"}
              <>
                <Divider dashed />
                <strong>
                  <User size={13} style={{ verticalAlign: -2 }} aria-hidden="true" /> Submitted By:
                </strong>{" "}
                {maintAlert.uname || "Unknown"}
              </>
            </Callout>

            <Btn
              v="purple"
              onClick={() => acknowledgeMaint(true)}
              style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}
            >
              {t.dashGotItMaint}
            </Btn>
          </Stack>
        </Modal>
      )}

      {/* Maintenance Status Update Alert Overlay — tells the requester their ticket moved (scheduled/completed) */}
      {!newJobAlert && !maintAlert && statusAlert && (
        <Modal title={t.dashMaintUpdate} onClose={() => acknowledgeStatusUpdate(false)}>
          <Stack gap={0} style={{ textAlign: "center", padding: "8px 0" }}>
            <Row gap={0} align="stretch" justify="center" style={{ marginBottom: 10 }}>
              {statusAlert.status === "completed" ? (
                <CheckCircle2 size={38} color={C.navy} strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <Calendar size={38} color={C.navy} strokeWidth={1.5} aria-hidden="true" />
              )}
            </Row>
            <Text as="h3" size="lg" weight="black" color={C.navy} style={{ margin: "0 0 6px 0" }}>
              {statusAlert.vname || "Unknown Vehicle"}
            </Text>
            <Row gap={2} align="stretch" justify="center" wrap style={{ marginBottom: 12 }}>
              <Bdg
                color={
                  statusAlert.status === "pending"
                    ? "amber"
                    : statusAlert.status === "scheduled"
                      ? "blue"
                      : "green"
                }
              >
                {(statusAlert.status || "updated").toUpperCase()}
              </Bdg>
              <Bdg color="gray">{statusAlert.type}</Bdg>
            </Row>

            <Callout bordered pad={5} size="sm" style={{ textAlign: "left", marginBottom: 16 }}>
              <strong>
                <Wrench size={13} style={{ verticalAlign: -2 }} aria-hidden="true" /> Your
                maintenance request is now {statusAlert.status}.
              </strong>
              {statusAlert.status === "scheduled" && statusAlert.scheduled_date && (
                <>
                  <Divider dashed />
                  <strong>
                    <Calendar size={13} style={{ verticalAlign: -2 }} aria-hidden="true" />{" "}
                    Scheduled for:
                  </strong>{" "}
                  {new Date(statusAlert.scheduled_date).toLocaleDateString()}
                </>
              )}
              {statusAlert.status === "completed" && statusAlert.completed_at && (
                <>
                  <Divider dashed />
                  <strong>
                    <Flag size={13} style={{ verticalAlign: -2 }} aria-hidden="true" /> Completed
                    on:
                  </strong>{" "}
                  {new Date(statusAlert.completed_at).toLocaleDateString()}
                </>
              )}
              {statusAlert.wh_notes && (
                <>
                  <Divider dashed />
                  <strong>
                    <FileText size={13} style={{ verticalAlign: -2 }} aria-hidden="true" /> Shop
                    Notes:
                  </strong>{" "}
                  {statusAlert.wh_notes}
                </>
              )}
            </Callout>

            <Btn
              v="teal"
              onClick={() => acknowledgeStatusUpdate(true)}
              style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}
            >
              {t.dashGotItMyReq}
            </Btn>
          </Stack>
        </Modal>
      )}
    </div>
  );
}
