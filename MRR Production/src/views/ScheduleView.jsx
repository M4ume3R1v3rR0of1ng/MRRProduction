// src/views/ScheduleView.jsx
//
// The full schedule: a month grid carrying jobs, the trailers going out with
// them, and shop time, with history.
//
// Read-only on purpose. CrewCalendar, TrailerCalendar and MaintenanceCalendar
// each already do drag-and-drop rescheduling for their own slice, inside their
// own view. Duplicating that here would mean three places to keep in step. What
// none of them offers is a single timeline you can page backwards through, so
// that is what this is: look across all three, and look at what already happened.
import { useMemo, useState } from "react";
import { C, parseDay, formatDay, todayLocal, fm } from "../utils/helpers";
import { buildSchedule, monthGrid, MONTH_NAMES, WEEKDAY_SHORT } from "../utils/schedule";
import { Btn, Bdg, Modal } from "../components/UIPrimitives";
import { translations } from "../utils/translations";

export default function ScheduleView({
  jobs = [],
  reqs = [],
  vehs = [],
  jobTrailers = [],
  users = [],
  jSC = {},
  onNav,
  lang = "en",
}) {
  const t = translations[lang] || translations.en;
  const today = todayLocal();
  const todayDate = parseDay(today);

  const [cursor, setCursor] = useState(() => ({ year: todayDate.getFullYear(), month: todayDate.getMonth() }));
  const [dayOpen, setDayOpen] = useState(null); // day key of the expanded day

  const keys = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

  // includeFinished: the point of paging backwards is seeing what actually ran.
  const days = useMemo(
    () => buildSchedule({ jobs, reqs, jobTrailers, vehs, users, keys, includeFinished: true }),
    [jobs, reqs, jobTrailers, vehs, users, keys],
  );

  const byKey = useMemo(() => new Map(days.map((d) => [d.key, d])), [days]);

  const step = (delta) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };
  const goToday = () => setCursor({ year: todayDate.getFullYear(), month: todayDate.getMonth() });

  const inMonth = (key) => parseDay(key).getMonth() === cursor.month;

  const monthTotals = days.reduce(
    (acc, d) => {
      if (!inMonth(d.key)) return acc;
      acc.jobs += d.jobs.length;
      acc.maint += d.maint.length;
      acc.conflicts += d.conflicts.length;
      return acc;
    },
    { jobs: 0, maint: 0, conflicts: 0 },
  );

  const isCurrentMonth = cursor.year === todayDate.getFullYear() && cursor.month === todayDate.getMonth();
  const openDay = dayOpen ? byKey.get(dayOpen) : null;

  return (
    <div>
      {/* ── header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: "var(--space-4)" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy }}>
            🗓️ {t.schedule || "Schedule"}
          </h1>
          <p style={{ margin: "2px 0 0", color: C.sub, fontSize: "var(--text-sm)" }}>
            {monthTotals.jobs} {monthTotals.jobs === 1 ? "job" : "jobs"} · {monthTotals.maint} in the shop
            {monthTotals.conflicts > 0 && (
              <span style={{ color: C.am, fontWeight: "var(--weight-bold)" }}> · {monthTotals.conflicts} conflict{monthTotals.conflicts > 1 ? "s" : ""}</span>
            )}
          </p>
        </div>
        <div className="sw-wrap" style={{ alignItems: "center", gap: "var(--space-3)" }}>
          <Btn v="ghost" sz="sm" onClick={() => step(-1)} aria-label="Previous month">←</Btn>
          <span style={{ minWidth: 148, textAlign: "center", fontFamily: "var(--font-display)", fontWeight: "var(--weight-extrabold)", fontSize: "var(--text-lg)", color: C.navy }}>
            {MONTH_NAMES[cursor.month]} {cursor.year}
          </span>
          <Btn v="ghost" sz="sm" onClick={() => step(1)} aria-label="Next month">→</Btn>
          {!isCurrentMonth && <Btn v="outline" sz="sm" onClick={goToday}>Today</Btn>}
        </div>
      </div>

      {/* ── legend ── */}
      <div className="sw-wrap" style={{ marginBottom: 12, fontSize: "var(--text-2xs)", color: C.sub, alignItems: "center" }}>
        <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: C.gr, marginRight: 5 }} />Job</span>
        <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: C.pu, marginRight: 5 }} />Shop</span>
        <span>🚛 trailers out</span>
        <span style={{ color: C.am }}>⚠️ booked and in the shop the same day</span>
        <span style={{ opacity: 0.55 }}>faded = finished</span>
      </div>

      {/* ── month grid ── */}
      <div className="sw-table-scroll">
        <div style={{ minWidth: 700 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
            {WEEKDAY_SHORT.map((d) => (
              <div key={d} style={{ textAlign: "center", fontSize: "var(--text-2xs)", fontWeight: "var(--weight-extrabold)", color: C.sub, textTransform: "uppercase", letterSpacing: "0.5px", padding: "4px 0" }}>
                {d}
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
            {days.map((day) => {
              const d = parseDay(day.key);
              const isToday = day.key === today;
              const otherMonth = !inMonth(day.key);
              const busy = day.jobs.length + day.maint.length;
              return (
                <button
                  key={day.key}
                  onClick={() => busy > 0 && setDayOpen(day.key)}
                  disabled={busy === 0}
                  style={{
                    background: isToday ? C.gL : otherMonth ? "transparent" : C.w,
                    border: isToday ? `1.5px solid ${C.gold}` : `1px solid ${C.bd}`,
                    borderRadius: "var(--radius-md)",
                    padding: "6px 6px 8px",
                    minHeight: 108,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    textAlign: "left",
                    cursor: busy > 0 ? "pointer" : "default",
                    opacity: otherMonth ? 0.45 : 1,
                    font: "inherit",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: isToday ? "var(--weight-black)" : "var(--weight-bold)", color: isToday ? C.am : C.navy, fontVariantNumeric: "tabular-nums" }}>
                      {d.getDate()}
                    </span>
                    {day.trailerCount > 0 && (
                      <span title={`${day.trailerCount} trailer(s) out`} style={{ fontSize: "var(--text-2xs)", color: C.sub }}>🚛{day.trailerCount}</span>
                    )}
                  </div>

                  {day.jobs.slice(0, 3).map((j) => (
                    <span
                      key={j.id}
                      title={`${j.title}${j.supervisor ? ` · ${j.supervisor}` : ""}`}
                      style={{
                        borderLeft: `3px solid ${C.gr}`, background: C.lg, borderRadius: 3,
                        padding: "2px 4px", fontSize: "var(--text-2xs)", color: C.navy,
                        fontWeight: "var(--weight-bold)", overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                        opacity: j.finished ? 0.55 : 1,
                        textDecoration: j.finished ? "line-through" : "none",
                      }}
                    >
                      {j.title}
                    </span>
                  ))}

                  {day.maint.slice(0, 2).map((m) => (
                    <span
                      key={m.id}
                      title={`${m.vehicle} · ${m.issue}`}
                      style={{
                        borderLeft: `3px solid ${C.pu}`, background: C.lg, borderRadius: 3,
                        padding: "2px 4px", fontSize: "var(--text-2xs)", color: C.navy,
                        fontWeight: "var(--weight-bold)", overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                        opacity: m.finished ? 0.55 : 1,
                      }}
                    >
                      🔧 {m.vehicle}
                    </span>
                  ))}

                  {busy > (day.jobs.length > 3 ? 3 : day.jobs.length) + (day.maint.length > 2 ? 2 : day.maint.length) && (
                    <span style={{ fontSize: "var(--text-2xs)", color: C.sub }}>
                      +{busy - Math.min(day.jobs.length, 3) - Math.min(day.maint.length, 2)} more
                    </span>
                  )}

                  {day.conflicts.length > 0 && (
                    <span style={{ fontSize: "var(--text-2xs)", color: C.am, fontWeight: "var(--weight-bold)" }}>
                      ⚠️ {day.conflicts.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {monthTotals.jobs === 0 && monthTotals.maint === 0 && (
        <p style={{ marginTop: 14, color: C.sub, fontSize: "var(--text-sm)", textAlign: "center" }}>
          Nothing scheduled in {MONTH_NAMES[cursor.month]} {cursor.year}. Jobs appear here once they have a scheduled date.
        </p>
      )}

      {/* ── one day, expanded ── */}
      {openDay && (
        <Modal
          title={parseDay(openDay.key).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          onClose={() => setDayOpen(null)}
          wide
        >
          {openDay.conflicts.length > 0 && (
            <div style={{ background: C.aB, border: `1px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "9px 12px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.am, fontWeight: "var(--weight-bold)" }}>
              ⚠️ {openDay.conflicts.join(", ")} {openDay.conflicts.length > 1 ? "are" : "is"} booked out and due in the shop on this day.
            </div>
          )}

          {openDay.jobs.length > 0 && (
            <>
              <h4 style={{ margin: "0 0 8px", color: C.navy, fontSize: "var(--text-sm)", textTransform: "uppercase" }}>Jobs ({openDay.jobs.length})</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: 16 }}>
                {openDay.jobs.map((j) => {
                  const st = jSC[j.status] || { c: "gray", l: j.status };
                  return (
                    <button
                      key={j.id}
                      onClick={() => { setDayOpen(null); onNav?.("buildjobs"); }}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-4)", background: C.lg, border: "none", borderRadius: "var(--radius-md)", padding: "10px 12px", cursor: "pointer", textAlign: "left", font: "inherit", width: "100%" }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-md)" }}>{j.title}</div>
                        <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>
                          {j.po || "No PO"}
                          {j.supervisor ? ` · ${j.supervisor}` : ""}
                          {j.trailers.length ? ` · 🚛 ${j.trailers.join(", ")}` : ""}
                        </div>
                      </div>
                      <Bdg color={st.c}>{st.l}</Bdg>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {openDay.maint.length > 0 && (
            <>
              <h4 style={{ margin: "0 0 8px", color: C.navy, fontSize: "var(--text-sm)", textTransform: "uppercase" }}>In the shop ({openDay.maint.length})</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {openDay.maint.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setDayOpen(null); onNav?.("requests"); }}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-4)", background: C.lg, border: "none", borderRadius: "var(--radius-md)", padding: "10px 12px", cursor: "pointer", textAlign: "left", font: "inherit", width: "100%" }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-md)" }}>🔧 {m.vehicle}</div>
                      <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>{m.issue}</div>
                    </div>
                    {m.finished ? <Bdg color="green">Done</Bdg> : m.urgency === "high" ? <Bdg color="red">Urgent</Bdg> : <Bdg color="gray">Scheduled</Bdg>}
                  </button>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
