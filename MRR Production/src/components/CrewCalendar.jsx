// src/components/CrewCalendar.jsx
import { useState, useMemo, useCallback } from "react";
import { C, fd } from "../utils/helpers";
import { Bdg, Btn } from "./UIPrimitives";

// ── Local date string helper (avoids UTC offset bug from toISOString()) ──
const toLocalDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// ── Resolve border color from jSC config, supports both named keys and hex ──
const resolveStatusColor = (statusConfig) => {
  const c = statusConfig?.c || "";
  if (!c) return "#94a3b8";
  // If it's already a hex/rgb value, use directly
  if (c.startsWith("#") || c.startsWith("rgb")) return c;
  // Map named keys to theme colors
  const colorMap = {
    blue: C.blue,
    amber: C.gold,
    gold: C.gold,
    green: C.gr,
    red: C.rd,
    teal: C.tl,
    gray: "#94a3b8",
  };
  return colorMap[c] ?? c;
};

export default function CrewCalendar({ jobs = [], users = [], jSC = {}, onJobClick }) {
  // ── 📅 CALENDAR WINDOWING NAVIGATION STATE ──
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Calculate the 7 days for the current week grid columns
  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const nextDay = new Date(currentWeekStart);
      nextDay.setDate(currentWeekStart.getDate() + i);
      days.push(nextDay);
    }
    return days;
  }, [currentWeekStart]);

  // Pre-index jobs by dateKey → assignedTo for O(1) lookups in the grid
  // Separated from weekDays so it doesn't recompute on week navigation
  const jobsByDateAndUser = useMemo(() => {
    const index = {};
    jobs.forEach((job) => {
      const rawDate = job.scheduledDate || job.createdAt;
      if (!rawDate) return;
      // Use local date parsing to avoid UTC offset issues
      const dateKey = rawDate.split("T")[0];
      const userId = job.assignedTo || "__unassigned__";
      if (!index[dateKey]) index[dateKey] = {};
      if (!index[dateKey][userId]) index[dateKey][userId] = [];
      index[dateKey][userId].push(job);
    });
    return index;
  }, [jobs]);

  const handleShiftWeek = useCallback((direction) => {
    setCurrentWeekStart((prev) => {
      const newDate = new Date(prev);
      newDate.setDate(prev.getDate() + direction * 7);
      return newDate;
    });
  }, []);

  const handleGoToToday = useCallback(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    setCurrentWeekStart(d);
  }, []);

  // Consistent role filter matching the parent (field + Site Supervisor)
  const fieldPersonnelList = useMemo(() => {
    return users.filter(
      (u) => (u.role === "field" || u.role === "Site Supervisor") && u.active !== false
    );
  }, [users]);

  // Collect unassigned jobs that fall within the current week
  const unassignedThisWeek = useMemo(() => {
    const weekDateKeys = weekDays.map(toLocalDateKey);
    const results = [];
    weekDateKeys.forEach((dk) => {
      const unassigned = jobsByDateAndUser[dk]?.["__unassigned__"] || [];
      results.push(...unassigned);
    });
    return results;
  }, [weekDays, jobsByDateAndUser]);

  const todayString = toLocalDateKey(new Date());
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const isCurrentWeek = toLocalDateKey(weekStart) <= todayString && todayString <= toLocalDateKey(weekEnd);

  const JobCard = ({ job }) => {
    const statusConfig = jSC[job.status] || { c: "gray", icon: "📋", l: job.status };
    const borderColor = resolveStatusColor(statusConfig);

    return (
      <div
        key={job.id}
        onClick={() => onJobClick?.(job)}
        style={{
          background: C.w,
          borderLeft: `4px solid ${borderColor}`,
          borderRadius: 6,
          padding: "6px 8px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          cursor: onJobClick ? "pointer" : "default",
        }}
        title={`${job.name}\nPO: ${job.po}\nAddress: ${job.addr || "N/A"}\nStatus: ${statusConfig.l || job.status}`}
      >
        <div style={{ fontSize: 11, fontWeight: 800, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {job.name}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, fontSize: 10, color: C.sub }}>
          <span>📄 {job.po}</span>
          <span>{statusConfig.icon}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.07)", marginTop: 16 }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.navy }}>📅 Weekly Production Crew & Shift Calendar</h2>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: C.sub }}>Visual dispatcher mapping active staging jobs across operational project rows.</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Btn v="ghost" sz="sm" onClick={() => handleShiftWeek(-1)}>◀ Prev</Btn>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, minWidth: 200, textAlign: "center" }}>
            {weekLabel}
          </div>
          <Btn v="ghost" sz="sm" onClick={() => handleShiftWeek(1)}>Next ▶</Btn>
          {!isCurrentWeek && (
            <Btn v="primary" sz="sm" onClick={handleGoToToday}>Today</Btn>
          )}
        </div>
      </div>

      {/* ── GRID ── */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: C.lg }}>
              <th style={{ width: 150, padding: "12px 10px", textAlign: "left", color: C.sub, fontSize: 11, fontWeight: 700, borderBottom: `2px solid ${C.bd}` }}>
                👷 Assigned Crew Lead
              </th>
              {weekDays.map((day) => {
                const isToday = toLocalDateKey(day) === todayString;
                return (
                  <th
                    key={toLocalDateKey(day)}
                    style={{
                      padding: "10px", textAlign: "center",
                      color: isToday ? C.blue : C.navy,
                      fontWeight: 800, fontSize: 12,
                      borderBottom: isToday ? `3px solid ${C.blue}` : `2px solid ${C.bd}`,
                      background: isToday ? "rgba(27, 82, 184, 0.03)" : "transparent",
                    }}
                  >
                    <div>{day.toLocaleDateString("en-US", { weekday: "short" })}</div>
                    <div style={{ fontSize: 14, marginTop: 2 }}>{day.getDate()}</div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {fieldPersonnelList.map((crewLead) => (
              <tr key={crewLead.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                <td style={{ padding: "14px 10px", verticalAlign: "middle", borderRight: `1px solid ${C.lg}` }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.navy }}>{crewLead.name}</div>
                  <div style={{ fontSize: 10, color: C.sub, textTransform: "capitalize", marginTop: 2 }}>
                    🛡️ {crewLead.role}
                  </div>
                </td>

                {weekDays.map((day) => {
                  const dayKey = toLocalDateKey(day);
                  const isToday = dayKey === todayString;
                  const dayJobs = jobsByDateAndUser[dayKey]?.[crewLead.id] || [];
                  const isDoubleBooked = dayJobs.length > 1;

                  return (
                    <td
                      key={dayKey}
                      style={{
                        padding: "6px", verticalAlign: "top",
                        background: isToday ? "rgba(27, 82, 184, 0.01)" : "transparent",
                        borderRight: `1px solid ${C.lg}`,
                        height: 90,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {dayJobs.map((job) => <JobCard key={job.id} job={job} />)}
                        {isDoubleBooked && (
                          <div style={{ fontSize: 10, fontWeight: 700, color: C.rd, background: C.rB, padding: "2px 6px", borderRadius: 4, textAlign: "center" }}>
                            ⚠️ {dayJobs.length} jobs — double-booked
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* ── Unassigned jobs row ── */}
            {unassignedThisWeek.length > 0 && (
              <tr style={{ borderBottom: `1px solid ${C.lg}`, background: "rgba(251,191,36,0.04)" }}>
                <td style={{ padding: "14px 10px", verticalAlign: "middle", borderRight: `1px solid ${C.lg}` }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.am }}>⚠️ Unassigned</div>
                  <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>No supervisor set</div>
                </td>
                {weekDays.map((day) => {
                  const dayKey = toLocalDateKey(day);
                  const isToday = dayKey === todayString;
                  const dayJobs = jobsByDateAndUser[dayKey]?.["__unassigned__"] || [];
                  return (
                    <td
                      key={dayKey}
                      style={{
                        padding: "6px", verticalAlign: "top",
                        background: isToday ? "rgba(27, 82, 184, 0.01)" : "transparent",
                        borderRight: `1px solid ${C.lg}`,
                        height: 90,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {dayJobs.map((job) => <JobCard key={job.id} job={job} />)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            )}

            {fieldPersonnelList.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 32, textAlign: "center", color: C.sub, fontSize: 13, fontStyle: "italic" }}>
                  No field operational crews registered to map schedule lines.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}