// src/components/ScheduleCard.jsx
//
// The week ahead, on one strip: jobs, the trailers going out with them, and shop
// time. Answers "what is coming up" without opening three views.
//
// This is deliberately NOT a fourth month grid. CrewCalendar, TrailerCalendar and
// MaintenanceCalendar are each a full drag-and-drop scheduler living inside a
// different view, and none of them can see the other two. The gap that actually
// bites a dispatcher is the overlap: a crew booked the same day their trailer is
// already committed, or a truck due in the shop on a day it is scheduled to run.
// So this shows all three sources against the same seven days and flags the
// collisions. Editing still belongs to the full calendars.
import { C, parseDay, todayLocal } from "../utils/helpers";
import { buildSchedule } from "../utils/schedule";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function ScheduleCard({ jobs, reqs, jobTrailers, vehs, users, onNav, lang = "en" }) {
  const today = todayLocal();
  const week = buildSchedule({ jobs, reqs, jobTrailers, vehs, users, from: today });
  const totalJobs = week.reduce((s, d) => s + d.jobs.length, 0);
  const totalMaint = week.reduce((s, d) => s + d.maint.length, 0);
  const anyConflict = week.some((d) => d.conflicts.length > 0);
  const es = lang === "es";

  return (
    <div
      className="mrr-card"
      style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 16, border: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)", marginBottom: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>
          🗓️ {es ? "La semana que viene" : "The week ahead"}
        </h3>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-4)" }}>
          <span style={{ fontSize: "var(--text-2xs)", color: C.sub, fontWeight: "var(--weight-bold)" }}>
            {totalJobs} {es ? "trabajos" : totalJobs === 1 ? "job" : "jobs"} · {totalMaint} {es ? "en taller" : "in shop"}
          </span>
          {/* The way through to the full month view, where the past lives. This
              card only ever shows the next seven days. */}
          <button
            onClick={() => onNav?.("schedule")}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit",
                     fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", color: C.blue, whiteSpace: "nowrap" }}
          >
            {es ? "Ver calendario completo →" : "Full calendar →"}
          </button>
        </div>
      </div>

      {anyConflict && (
        <div style={{ background: C.aB, border: `1px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "7px 10px", marginBottom: 10, fontSize: "var(--text-2xs)", color: C.am, fontWeight: "var(--weight-bold)" }}>
          ⚠️ {es ? "Un vehículo está reservado y en el taller el mismo día." : "A vehicle is booked out and in the shop on the same day."}
        </div>
      )}

      <div className="sw-table-scroll">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(96px, 1fr))", gap: 4 }}>
          {week.map((day) => {
            const d = parseDay(day.key);
            const isToday = day.key === today;
            const busy = day.jobs.length + day.maint.length;
            return (
              <div
                key={day.key}
                style={{
                  background: isToday ? C.gL : C.lg,
                  border: isToday ? `1.5px solid ${C.gold}` : "1px solid transparent",
                  borderRadius: "var(--radius-md)",
                  padding: "8px 7px",
                  minHeight: 104,
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-extrabold)", color: isToday ? C.am : C.sub, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                    {WEEKDAY[d.getDay()]}
                  </span>
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-black)", color: isToday ? C.navy : C.sub, fontVariantNumeric: "tabular-nums" }}>
                    {d.getDate()}
                  </span>
                </div>

                {busy === 0 && (
                  <span style={{ fontSize: "var(--text-2xs)", color: C.sub, opacity: 0.6 }}>—</span>
                )}

                {day.jobs.slice(0, 2).map((j) => (
                  <button
                    key={j.id}
                    onClick={() => onNav?.("buildjobs")}
                    title={`${j.title}${j.supervisor ? ` · ${j.supervisor}` : ""}${j.trailers.length ? ` · ${j.trailers.join(", ")}` : ""}`}
                    style={{
                      background: C.w, border: `1px solid ${C.bd}`, borderLeft: `3px solid ${C.gr}`,
                      borderRadius: 4, padding: "3px 5px", cursor: "pointer", textAlign: "left",
                      fontSize: "var(--text-2xs)", color: C.navy, fontWeight: "var(--weight-bold)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%",
                    }}
                  >
                    {j.title}
                    {j.trailers.length > 0 && <span style={{ color: C.sub, fontWeight: "normal" }}> 🚛{j.trailers.length}</span>}
                  </button>
                ))}
                {day.jobs.length > 2 && (
                  <span style={{ fontSize: "var(--text-2xs)", color: C.sub }}>+{day.jobs.length - 2} more</span>
                )}

                {day.maint.slice(0, 2).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onNav?.("requests")}
                    title={`${m.vehicle} · ${m.issue}`}
                    style={{
                      background: C.w, border: `1px solid ${C.bd}`, borderLeft: `3px solid ${C.pu}`,
                      borderRadius: 4, padding: "3px 5px", cursor: "pointer", textAlign: "left",
                      fontSize: "var(--text-2xs)", color: C.navy, fontWeight: "var(--weight-bold)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%",
                    }}
                  >
                    🔧 {m.vehicle}
                  </button>
                ))}
                {day.maint.length > 2 && (
                  <span style={{ fontSize: "var(--text-2xs)", color: C.sub }}>+{day.maint.length - 2} more</span>
                )}

                {day.conflicts.length > 0 && (
                  <span title={`${day.conflicts.join(", ")} booked and in the shop`} style={{ fontSize: "var(--text-2xs)", color: C.am, fontWeight: "var(--weight-bold)" }}>
                    ⚠️ {day.conflicts.length}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {totalJobs === 0 && totalMaint === 0 && (
        <p style={{ margin: "10px 0 0", fontSize: "var(--text-2xs)", color: C.sub }}>
          {es
            ? "Nada programado esta semana. Asigne fechas en Trabajos o Mantenimiento."
            : "Nothing scheduled this week. Set dates in Build Jobs or Maintenance."}
        </p>
      )}
    </div>
  );
}
