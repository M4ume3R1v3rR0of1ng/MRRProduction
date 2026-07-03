// src/components/TrailerCalendar.jsx
import { useState, useMemo, useCallback } from "react";
import { C } from "../utils/helpers";
import { Btn } from "./UIPrimitives";
import { supabase } from "../utils/supabase";
import { useNotify } from "../context/NotificationContext";
import { logAction } from "../utils/logger";

// ── Local date string helper (avoids UTC offset bug from toISOString()) ──
const toLocalDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const resolveStatusColor = (statusConfig) => {
  const c = statusConfig?.c || "";
  if (!c) return "#94a3b8";
  if (c.startsWith("#") || c.startsWith("rgb")) return c;
  const colorMap = { blue: C.blue, amber: C.gold, gold: C.gold, green: C.gr, red: C.rd, teal: C.tl, gray: "#94a3b8" };
  return colorMap[c] ?? c;
};

export default function TrailerCalendar({ vehs = [], jobs = [], jobTrailers = [], setJobTrailers, setJobs, jSC = {}, user, perms, onJobClick }) {
  const { showToast } = useNotify();
  const canEdit = !!perms?.fleet_edit;
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);

  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const nextDay = new Date(currentWeekStart);
      nextDay.setDate(currentWeekStart.getDate() + i);
      days.push(nextDay);
    }
    return days;
  }, [currentWeekStart]);

  const trailerRows = useMemo(() => vehs.filter((v) => v.type === "trailer"), [vehs]);

  const jobsById = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j])), [jobs]);

  // Pre-index bookings by dateKey → trailerId for O(1) lookups in the grid
  const bookingsByDateAndTrailer = useMemo(() => {
    const index = {};
    jobTrailers.forEach((jt) => {
      const job = jobsById[jt.job_id];
      if (!job) return;
      const rawDate = job.scheduledDate || job.createdAt;
      if (!rawDate) return;
      const dateKey = rawDate.split("T")[0];
      if (!index[dateKey]) index[dateKey] = {};
      if (!index[dateKey][jt.trailer_id]) index[dateKey][jt.trailer_id] = [];
      index[dateKey][jt.trailer_id].push({ ...jt, job });
    });
    return index;
  }, [jobTrailers, jobsById]);

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

  // ── 🖐️ DRAG-AND-DROP: MOVE A BOOKING TO ANOTHER TRAILER / DAY ──
  const handleDropOnCell = async (dateKey, trailerId) => {
    const bookingId = draggingId;
    setDraggingId(null);
    setDragOverKey(null);
    if (!bookingId || typeof setJobTrailers !== "function") return;

    const booking = jobTrailers.find((jt) => jt.id === bookingId);
    if (!booking) return;
    const job = jobsById[booking.job_id];
    if (!job) return;

    const prevTrailerId = booking.trailer_id;
    const prevScheduledDate = job.scheduledDate;
    const currentDateKey = (job.scheduledDate || job.createdAt || "").split("T")[0];
    const trailerChanged = prevTrailerId !== trailerId;
    const dateChanged = currentDateKey !== dateKey;
    if (!trailerChanged && !dateChanged) return;

    if (trailerChanged) {
      setJobTrailers((p) => p.map((jt) => (jt.id === bookingId ? { ...jt, trailer_id: trailerId } : jt)));
    }
    if (dateChanged && typeof setJobs === "function") {
      setJobs((p) => p.map((j) => (j.id === job.id ? { ...j, scheduledDate: dateKey } : j)));
    }

    try {
      if (trailerChanged) {
        const { error } = await supabase.from("job_trailers").update({ trailer_id: trailerId }).eq("id", bookingId);
        if (error) throw error;
      }
      if (dateChanged) {
        const { error } = await supabase.from("jobs").update({ scheduledDate: dateKey }).eq("id", job.id);
        if (error) throw error;
      }
      const trailerName = vehs.find((v) => v.id === trailerId)?.name || trailerId;
      await logAction(
        user?.id,
        user?.email,
        "FLEET_STATUS_CHANGE",
        `Moved trailer booking for "${job.title || job.name}" to ${trailerName} on ${dateKey}`,
        { job_id: job.id, trailer_id: trailerId, booking_id: bookingId },
        "fleet",
      );
    } catch (err) {
      console.error("Failed to move trailer booking:", err);
      showToast?.(`Failed to move trailer booking: ${err.message}`, "error");
      if (trailerChanged) setJobTrailers((p) => p.map((jt) => (jt.id === bookingId ? { ...jt, trailer_id: prevTrailerId } : jt)));
      if (dateChanged && typeof setJobs === "function") setJobs((p) => p.map((j) => (j.id === job.id ? { ...j, scheduledDate: prevScheduledDate } : j)));
    }
  };

  // ── 🗑️ REMOVE A BOOKING DIRECTLY FROM THE CALENDAR ──
  const handleRemoveBooking = async (booking) => {
    if (typeof setJobTrailers !== "function") return;
    setJobTrailers((p) => p.filter((jt) => jt.id !== booking.id));

    try {
      const { error } = await supabase.from("job_trailers").delete().eq("id", booking.id);
      if (error) throw error;
      await logAction(
        user?.id,
        user?.email,
        "FLEET_STATUS_CHANGE",
        `Removed trailer booking for "${booking.job.title || booking.job.name}"`,
        { job_id: booking.job_id, trailer_id: booking.trailer_id, booking_id: booking.id },
        "fleet",
      );
    } catch (err) {
      console.error("Failed to remove trailer booking:", err);
      showToast?.(`Failed to remove trailer booking: ${err.message}`, "error");
      setJobTrailers((p) => [...p, booking]);
    }
  };

  const todayString = toLocalDateKey(new Date());
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const isCurrentWeek = toLocalDateKey(weekStart) <= todayString && todayString <= toLocalDateKey(weekEnd);

  const BookingCard = ({ booking }) => {
    const job = booking.job;
    const statusConfig = jSC[job.status] || { c: "gray", icon: "📋", l: job.status };
    const borderColor = resolveStatusColor(statusConfig);
    const jobLabel = job.title || job.name || "Untitled Job";

    return (
      <div
        draggable={canEdit}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDraggingId(booking.id); }}
        onDragEnd={() => { setDraggingId(null); setDragOverKey(null); }}
        onClick={() => onJobClick?.(job)}
        style={{
          position: "relative",
          background: C.w,
          borderLeft: `4px solid ${borderColor}`,
          borderRadius: "var(--radius-sm)",
          padding: "6px 8px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          cursor: onJobClick ? "pointer" : "default",
          opacity: draggingId === booking.id ? 0.4 : 1,
        }}
        title={`${jobLabel}\nPO: ${job.po}\nAddress: ${job.addr || "N/A"}\nStatus: ${statusConfig.l || job.status}`}
      >
        {canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); handleRemoveBooking(booking); }}
            title="Remove this trailer booking"
            style={{ position: "absolute", top: 2, right: 2, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.sub, lineHeight: 1, padding: 2 }}
          >
            ✕
          </button>
        )}
        <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-extrabold)", color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 14 }}>
          {jobLabel}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, fontSize: "var(--text-2xs)", color: C.sub }}>
          <span>📄 {job.po}</span>
          <span>{statusConfig.icon}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: "var(--radius-xl)", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", marginTop: 16 }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: "var(--space-5)" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>📅 Weekly Trailer Booking Calendar</h2>
          <p style={{ margin: "2px 0 0", fontSize: "var(--text-xs)", color: C.sub }}>
            {canEdit ? "Drag a booking to a different trailer or day to reassign it." : "Read-only — you don't have permission to reassign trailer bookings."}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <Btn v="ghost" sz="sm" onClick={() => handleShiftWeek(-1)}>◀ Prev</Btn>
          <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", color: C.navy, minWidth: 200, textAlign: "center" }}>
            {weekLabel}
          </div>
          <Btn v="ghost" sz="sm" onClick={() => handleShiftWeek(1)}>Next ▶</Btn>
          {!isCurrentWeek && <Btn v="primary" sz="sm" onClick={handleGoToToday}>Today</Btn>}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: C.lg }}>
              <th style={{ width: 170, padding: "12px 10px", textAlign: "left", color: C.sub, fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", borderBottom: `2px solid ${C.bd}` }}>
                🚚 Trailer
              </th>
              {weekDays.map((day) => {
                const isToday = toLocalDateKey(day) === todayString;
                return (
                  <th
                    key={toLocalDateKey(day)}
                    style={{
                      padding: "10px", textAlign: "center",
                      color: isToday ? C.blue : C.navy,
                      fontWeight: "var(--weight-extrabold)", fontSize: "var(--text-sm)",
                      borderBottom: isToday ? `3px solid ${C.blue}` : `2px solid ${C.bd}`,
                      background: isToday ? "rgba(27, 82, 184, 0.03)" : "transparent",
                    }}
                  >
                    <div>{day.toLocaleDateString("en-US", { weekday: "short" })}</div>
                    <div style={{ fontSize: "var(--text-md)", marginTop: 2 }}>{day.getDate()}</div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {trailerRows.map((trailer) => (
              <tr key={trailer.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                <td style={{ padding: "14px 10px", verticalAlign: "middle", borderRight: `1px solid ${C.lg}` }}>
                  <div style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", color: C.navy }}>{trailer.name}</div>
                  <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 2 }}>#{trailer.plate || "—"}</div>
                </td>

                {weekDays.map((day) => {
                  const dayKey = toLocalDateKey(day);
                  const isToday = dayKey === todayString;
                  const dayBookings = bookingsByDateAndTrailer[dayKey]?.[trailer.id] || [];
                  const isDoubleBooked = dayBookings.length > 1;
                  const cellKey = `${trailer.id}::${dayKey}`;
                  const isDragOver = dragOverKey === cellKey;

                  return (
                    <td
                      key={dayKey}
                      onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOverKey(cellKey); } }}
                      onDragLeave={() => setDragOverKey((k) => (k === cellKey ? null : k))}
                      onDrop={(e) => { if (canEdit) { e.preventDefault(); handleDropOnCell(dayKey, trailer.id); } }}
                      style={{
                        padding: "6px", verticalAlign: "top",
                        background: isDragOver ? "rgba(27, 82, 184, 0.12)" : isToday ? "rgba(27, 82, 184, 0.01)" : "transparent",
                        outline: isDragOver ? `2px dashed ${C.blue}` : "none",
                        outlineOffset: -2,
                        borderRight: `1px solid ${C.lg}`,
                        height: 90,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                        {dayBookings.map((b) => <BookingCard key={b.id} booking={b} />)}
                        {isDoubleBooked && (
                          <div style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", color: C.rd, background: C.rB, padding: "2px 6px", borderRadius: "var(--radius-xs)", textAlign: "center" }}>
                            ⚠️ {dayBookings.length} jobs — double-booked
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}

            {trailerRows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 32, textAlign: "center", color: C.sub, fontSize: "var(--text-base)", fontStyle: "italic" }}>
                  No trailers registered in the fleet yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
