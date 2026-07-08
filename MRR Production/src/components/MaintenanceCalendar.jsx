// src/components/MaintenanceCalendar.jsx
import { useState, useMemo, useCallback } from "react";
import { C } from "../utils/helpers";
import { Bdg, Btn } from "./UIPrimitives";
import { supabase } from "../utils/supabase";
import { useNotify } from "../context/NotificationContext";
import { logAction } from "../utils/logger";

const toLocalDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const urgencyMeta = (urgency) => {
  if (urgency === "urgent") return { color: C.rd, label: "🚨 Urgent" };
  if (urgency === "soon") return { color: C.am, label: "⏳ Soon" };
  return { color: C.blue, label: "Standard" };
};

export default function MaintenanceCalendar({ reqs = [], vehs = [], user, setReqs, onRequestClick }) {
  const { showToast } = useNotify();
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);

  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const nextDay = new Date(currentWeekStart);
      nextDay.setDate(currentWeekStart.getDate() + i);
      days.push(nextDay);
    }
    return days;
  }, [currentWeekStart]);

  const activeReqs = useMemo(() => reqs.filter((r) => r.status === "pending" || r.status === "scheduled"), [reqs]);

  const reqsByDateAndVehicle = useMemo(() => {
    const index = {};
    activeReqs.forEach((r) => {
      if (!r.scheduled_date) return;
      const dateKey = r.scheduled_date.split("T")[0];
      if (!index[dateKey]) index[dateKey] = {};
      if (!index[dateKey][r.vid]) index[dateKey][r.vid] = [];
      index[dateKey][r.vid].push(r);
    });
    return index;
  }, [activeReqs]);

  const unscheduledReqs = useMemo(() => activeReqs.filter((r) => !r.scheduled_date), [activeReqs]);

  // Only show vehicles that actually have an active request — avoids a wall of empty rows.
  const vehicleRows = useMemo(() => {
    const vidsWithReqs = new Set(activeReqs.map((r) => r.vid));
    return vehs.filter((v) => vidsWithReqs.has(v.id));
  }, [vehs, activeReqs]);

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

  const todayString = toLocalDateKey(new Date());
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const weekLabel = weekStart && weekEnd
    ? `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "";
  const isCurrentWeek = toLocalDateKey(weekStart) <= todayString && todayString <= toLocalDateKey(weekEnd);

  const handleDropOnDate = async (dateKey) => {
    const reqId = draggingId;
    setDraggingId(null);
    setDragOverKey(null);
    if (!reqId || typeof setReqs !== "function") return;

    const req = reqs.find((r) => r.id === reqId);
    if (!req) return;
    if (req.scheduled_date && req.scheduled_date.split("T")[0] === dateKey) return;

    const prevScheduledDate = req.scheduled_date;
    const prevStatus = req.status;
    const updated = { ...req, scheduled_date: dateKey, status: "scheduled" };
    setReqs((p) => p.map((r) => (r.id === reqId ? updated : r)));

    try {
      const { error } = await supabase
        .from("maintenance_requests")
        .update({ scheduled_date: dateKey, status: "scheduled" })
        .eq("id", reqId);
      if (error) throw error;

      await logAction(
        user?.id,
        user?.email,
        "INV_MUTATION",
        `Rescheduled maintenance request for "${req.vname}" to ${dateKey}`,
        { ticket_id: reqId, scheduled_date: dateKey },
        "maintenance",
      );
    } catch (err) {
      console.error("Failed to reschedule maintenance request:", err);
      showToast?.(`Failed to reschedule request: ${err.message}`, "error");
      setReqs((p) => p.map((r) => (r.id === reqId ? { ...req, scheduled_date: prevScheduledDate, status: prevStatus } : r)));
    }
  };

  const handleDropOnUnscheduled = async () => {
    const reqId = draggingId;
    setDraggingId(null);
    setDragOverKey(null);
    if (!reqId || typeof setReqs !== "function") return;

    const req = reqs.find((r) => r.id === reqId);
    if (!req || !req.scheduled_date) return;

    const prevScheduledDate = req.scheduled_date;
    const prevStatus = req.status;
    const updated = { ...req, scheduled_date: "", status: "pending" };
    setReqs((p) => p.map((r) => (r.id === reqId ? updated : r)));

    try {
      const { error } = await supabase
        .from("maintenance_requests")
        .update({ scheduled_date: "", status: "pending" })
        .eq("id", reqId);
      if (error) throw error;
    } catch (err) {
      console.error("Failed to unschedule maintenance request:", err);
      showToast?.(`Failed to unschedule request: ${err.message}`, "error");
      setReqs((p) => p.map((r) => (r.id === reqId ? { ...req, scheduled_date: prevScheduledDate, status: prevStatus } : r)));
    }
  };

  const RequestCard = ({ req }) => {
    const meta = urgencyMeta(req.urgency);
    return (
      <div
        draggable={typeof setReqs === "function"}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDraggingId(req.id); }}
        onDragEnd={() => { setDraggingId(null); setDragOverKey(null); }}
        onClick={() => onRequestClick?.(req)}
        style={{
          background: C.w,
          borderLeft: `4px solid ${meta.color}`,
          borderRadius: "var(--radius-sm)",
          padding: "6px 8px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          cursor: onRequestClick ? "pointer" : "default",
          opacity: draggingId === req.id ? 0.4 : 1,
        }}
        title={`${req.vname}\nType: ${req.type}\nUrgency: ${req.urgency}\n${req.notes || ""}`}
      >
        <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-extrabold)", color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {req.vname}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, fontSize: "var(--text-2xs)", color: C.sub }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{req.type}</span>
          <span style={{ color: meta.color, fontWeight: "var(--weight-bold)", flexShrink: 0, marginLeft: 4 }}>{meta.label}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)", marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: "var(--space-5)" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>📅 Weekly Maintenance Schedule</h2>
          <p style={{ margin: "2px 0 0", fontSize: "var(--text-xs)", color: C.sub }}>Drag a request onto a day to schedule or reschedule it.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <Btn v="ghost" sz="sm" onClick={() => handleShiftWeek(-1)}>◀ Prev</Btn>
          <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", color: C.navy, minWidth: 200, textAlign: "center" }}>{weekLabel}</div>
          <Btn v="ghost" sz="sm" onClick={() => handleShiftWeek(1)}>Next ▶</Btn>
          {!isCurrentWeek && <Btn v="primary" sz="sm" onClick={handleGoToToday}>Today</Btn>}
        </div>
      </div>

      {/* ── Awaiting Scheduling tray (also a drop target, to unschedule) ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOverKey("__unscheduled__"); }}
        onDragLeave={() => setDragOverKey((k) => (k === "__unscheduled__" ? null : k))}
        onDrop={(e) => { e.preventDefault(); handleDropOnUnscheduled(); }}
        style={{
          border: `2px dashed ${dragOverKey === "__unscheduled__" ? C.blue : C.bd}`,
          background: dragOverKey === "__unscheduled__" ? "rgba(27, 82, 184, 0.06)" : "#f8fafc",
          borderRadius: "var(--radius-lg)",
          padding: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-extrabold)", color: C.sub, textTransform: "uppercase", marginBottom: 8 }}>
          📥 Awaiting Scheduling {unscheduledReqs.length > 0 && `(${unscheduledReqs.length})`}
        </div>
        {unscheduledReqs.length === 0 ? (
          <div style={{ fontSize: "var(--text-sm)", color: C.sub, fontStyle: "italic" }}>Nothing waiting — drag a scheduled request here to unschedule it.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
            {unscheduledReqs.map((r) => (
              <div key={r.id} style={{ width: 180 }}>
                <RequestCard req={r} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: C.lg }}>
              <th style={{ width: 170, padding: "12px 10px", textAlign: "left", color: C.sub, fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", borderBottom: `2px solid ${C.bd}` }}>
                🚛 Vehicle
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
            {vehicleRows.map((v) => (
              <tr key={v.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                <td style={{ padding: "14px 10px", verticalAlign: "middle", borderRight: `1px solid ${C.lg}` }}>
                  <div style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", color: C.navy }}>{v.name}</div>
                  <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 2 }}>#{v.plate || v.plates || "—"}</div>
                </td>

                {weekDays.map((day) => {
                  const dayKey = toLocalDateKey(day);
                  const isToday = dayKey === todayString;
                  const dayReqs = reqsByDateAndVehicle[dayKey]?.[v.id] || [];
                  const isDoubleBooked = dayReqs.length > 1;
                  const cellKey = `${v.id}::${dayKey}`;
                  const isDragOver = dragOverKey === cellKey;

                  return (
                    <td
                      key={dayKey}
                      onDragOver={(e) => { e.preventDefault(); setDragOverKey(cellKey); }}
                      onDragLeave={() => setDragOverKey((k) => (k === cellKey ? null : k))}
                      onDrop={(e) => { e.preventDefault(); handleDropOnDate(dayKey); }}
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
                        {dayReqs.map((r) => <RequestCard key={r.id} req={r} />)}
                        {isDoubleBooked && (
                          <div style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", color: C.rd, background: C.rB, padding: "2px 6px", borderRadius: "var(--radius-xs)", textAlign: "center" }}>
                            ⚠️ {dayReqs.length} requests
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}

            {vehicleRows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 32, textAlign: "center", color: C.sub, fontSize: "var(--text-base)", fontStyle: "italic" }}>
                  No active maintenance requests to schedule this week.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
