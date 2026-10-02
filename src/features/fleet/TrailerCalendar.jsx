// src/features/fleet/TrailerCalendar.jsx
import { useState, useMemo, useCallback } from "react";
import { Calendar, Truck, FileText, FileEdit } from "lucide-react";
import { translations } from "@/shared/utils/translations";
import { C } from "@/shared/utils/helpers";
import { Row, Muted, Text, Card } from "@/shared/components/UIPrimitives";
import { supabase } from "@/shared/utils/supabase";
import { useNotify } from "@/shared/context/NotificationContext";
import { logAction } from "@/shared/utils/logger";
import {
  WeekHeader,
  WeekTable,
  WeekRow,
  DayCell,
  EventChip,
  ConflictNote,
  EmptyWeekRow,
} from "@/shared/components/WeekGrid";

// ── Local date string helper (avoids UTC offset bug from toISOString()) ──
const toLocalDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const resolveStatusColor = (statusConfig) => {
  const c = statusConfig?.c || "";
  if (!c) return "var(--c-sub)";
  if (c.startsWith("#") || c.startsWith("rgb")) return c;
  const colorMap = {
    blue: C.blue,
    amber: C.gold,
    gold: C.gold,
    green: C.gr,
    red: C.rd,
    teal: C.tl,
    gray: "var(--c-sub)",
  };
  return colorMap[c] ?? c;
};

export default function TrailerCalendar({
  vehs = [],
  jobs = [],
  jobTrailers = [],
  setJobTrailers,
  setJobs,
  jSC = {},
  user,
  perms,
  onJobClick,
  lang = "en",
}) {
  const t = translations[lang] || translations.en;
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

  // ── DRAG-AND-DROP: MOVE A BOOKING TO ANOTHER TRAILER / DAY ──
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
      setJobTrailers((p) =>
        p.map((jt) => (jt.id === bookingId ? { ...jt, trailer_id: trailerId } : jt)),
      );
    }
    if (dateChanged && typeof setJobs === "function") {
      setJobs((p) => p.map((j) => (j.id === job.id ? { ...j, scheduledDate: dateKey } : j)));
    }

    try {
      if (trailerChanged) {
        const { error } = await supabase
          .from("job_trailers")
          .update({ trailer_id: trailerId })
          .eq("id", bookingId);
        if (error) throw error;
      }
      if (dateChanged) {
        const { error } = await supabase
          .from("jobs")
          .update({ scheduledDate: dateKey })
          .eq("id", job.id);
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
      if (trailerChanged)
        setJobTrailers((p) =>
          p.map((jt) => (jt.id === bookingId ? { ...jt, trailer_id: prevTrailerId } : jt)),
        );
      if (dateChanged && typeof setJobs === "function")
        setJobs((p) =>
          p.map((j) => (j.id === job.id ? { ...j, scheduledDate: prevScheduledDate } : j)),
        );
    }
  };

  // ── REMOVE A BOOKING DIRECTLY FROM THE CALENDAR ──
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
  const isCurrentWeek =
    toLocalDateKey(weekStart) <= todayString && todayString <= toLocalDateKey(weekEnd);

  const BookingCard = ({ booking }) => {
    const job = booking.job;
    const statusConfig = jSC[job.status] || { c: "gray", icon: FileEdit, l: job.status };
    const borderColor = resolveStatusColor(statusConfig);
    const jobLabel = job.title || job.name || "Untitled Job";
    return (
      <EventChip
        color={borderColor}
        title={jobLabel}
        tooltip={`${jobLabel}\nPO: ${job.po}\nAddress: ${job.addr || "N/A"}\nStatus: ${statusConfig.l || job.status}`}
        dragging={draggingId === booking.id}
        draggable={canEdit}
        onDragStart={() => setDraggingId(booking.id)}
        onDragEnd={() => {
          setDraggingId(null);
          setDragOverKey(null);
        }}
        onClick={onJobClick ? () => onJobClick(job) : undefined}
        onRemove={canEdit ? () => handleRemoveBooking(booking) : undefined}
        removeLabel={t.tcRemoveBooking}
      >
        <Row inline as="span" gap="3px">
          <FileText size={10} aria-hidden="true" /> {job.po}
        </Row>
        <statusConfig.icon size={12} color={borderColor} aria-hidden="true" />
      </EventChip>
    );
  };

  return (
    <Card variant="raised" pad={8} style={{ marginTop: 16 }}>
      <WeekHeader
        icon={Calendar}
        title="Weekly Trailer Booking Calendar"
        subtitle={
          canEdit
            ? "Drag a booking to a different trailer or day to reassign it."
            : "Read-only — you don't have permission to reassign trailer bookings."
        }
        weekLabel={weekLabel}
        onShift={handleShiftWeek}
        onToday={handleGoToToday}
        showToday={!isCurrentWeek}
        labels={{ prev: t.calPrev, next: t.calNext, today: t.calToday }}
      />

      <WeekTable
        days={weekDays}
        dayKey={toLocalDateKey}
        todayKey={todayString}
        labelIcon={Truck}
        label="Trailer"
        labelWidth={170}
      >
        {trailerRows.map((trailer) => (
          <WeekRow
            key={trailer.id}
            label={
              <>
                <Text size="base" weight="bold" color={C.navy}>
                  {trailer.name}
                </Text>
                <Muted size="2xs" style={{ marginTop: 2 }}>
                  #{trailer.plate || "—"}
                </Muted>
              </>
            }
          >
            {weekDays.map((day) => {
              const dayKey = toLocalDateKey(day);
              const dayBookings = bookingsByDateAndTrailer[dayKey]?.[trailer.id] || [];
              return (
                <DayCell
                  key={dayKey}
                  cellKey={`${trailer.id}::${dayKey}`}
                  dragOver={dragOverKey}
                  setDragOver={setDragOverKey}
                  isToday={dayKey === todayString}
                  disabled={!canEdit}
                  onDrop={() => handleDropOnCell(dayKey, trailer.id)}
                >
                  {dayBookings.map((b) => (
                    <BookingCard key={b.id} booking={b} />
                  ))}
                  {dayBookings.length > 1 && (
                    <ConflictNote>{dayBookings.length} jobs — double-booked</ConflictNote>
                  )}
                </DayCell>
              );
            })}
          </WeekRow>
        ))}

        {trailerRows.length === 0 && <EmptyWeekRow>{t.tcNoTrailers}</EmptyWeekRow>}
      </WeekTable>
    </Card>
  );
}
