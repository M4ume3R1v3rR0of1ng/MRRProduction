// src/features/jobs/CrewCalendar.jsx
import { useState, useMemo, useCallback } from "react";
import { FileEdit, FileText, Calendar, HardHat, Shield, AlertTriangle } from "lucide-react";
import { translations } from "@/shared/utils/translations";
import { C } from "@/shared/utils/helpers";
import { Row, Muted, Text, Card } from "@/shared/components/UIPrimitives";
import { supabase } from "@/shared/utils/supabase";
import { useNotify } from "@/shared/context/NotificationContext";
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

// ── Resolve border color from jSC config, supports both named keys and hex ──
const resolveStatusColor = (statusConfig) => {
  const c = statusConfig?.c || "";
  if (!c) return C.sub;
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
    gray: C.sub,
  };
  return colorMap[c] ?? c;
};

export default function CrewCalendar({
  jobs = [],
  users = [],
  jSC = {},
  onJobClick,
  setJobs,
  lang = "en",
}) {
  const t = translations[lang] || translations.en;
  const { showToast } = useNotify();
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  // ── CALENDAR WINDOWING NAVIGATION STATE ──
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
      const userId = job.assignedto || job.assignedTo || "__unassigned__";
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

  // ── DRAG-AND-DROP: RESCHEDULE / REASSIGN A JOB ──
  const handleDropOnCell = async (dateKey, assigneeId) => {
    const jobId = draggingId;
    setDraggingId(null);
    setDragOverKey(null);
    if (!jobId || typeof setJobs !== "function") return;

    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    const prevScheduledDate = job.scheduledDate;
    const prevAssignedTo = job.assignedto || job.assignedTo || "";
    if (prevScheduledDate === dateKey && prevAssignedTo === (assigneeId || "")) return;

    const updated = { ...job, scheduledDate: dateKey, assignedto: assigneeId || "" };
    setJobs((p) => p.map((j) => (j.id === jobId ? updated : j)));

    try {
      const { error } = await supabase
        .from("jobs")
        .update({ scheduledDate: dateKey, assignedto: assigneeId || "" })
        .eq("id", jobId);
      if (error) throw error;
    } catch (err) {
      console.error("Failed to reschedule job:", err);
      showToast?.(`Failed to reschedule job: ${err.message}`, "error");
      // Revert the optimistic update since the write didn't actually persist.
      setJobs((p) =>
        p.map((j) =>
          j.id === jobId
            ? { ...job, scheduledDate: prevScheduledDate, assignedto: prevAssignedTo }
            : j,
        ),
      );
    }
  };

  // Consistent role filter matching the parent (field + Site Supervisor)
  const fieldPersonnelList = useMemo(() => {
    return users.filter(
      (u) => (u.role === "field" || u.role === "Site Supervisor") && u.active !== false,
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

  const isCurrentWeek =
    toLocalDateKey(weekStart) <= todayString && todayString <= toLocalDateKey(weekEnd);

  const JobCard = ({ job }) => {
    const statusConfig = jSC[job.status] || { c: "gray", icon: FileEdit, l: job.status };
    const borderColor = resolveStatusColor(statusConfig);
    const jobLabel = job.title || job.name || "Untitled Job";
    return (
      <EventChip
        color={borderColor}
        title={jobLabel}
        tooltip={`${jobLabel}\nPO: ${job.po}\nAddress: ${job.addr || "N/A"}\nStatus: ${statusConfig.l || job.status}`}
        dragging={draggingId === job.id}
        draggable={typeof setJobs === "function"}
        onDragStart={() => setDraggingId(job.id)}
        onDragEnd={() => {
          setDraggingId(null);
          setDragOverKey(null);
        }}
        onClick={onJobClick ? () => onJobClick(job) : undefined}
      >
        <Row inline as="span" gap="3px">
          <FileText size={10} aria-hidden="true" /> {job.po}
        </Row>
        <statusConfig.icon size={12} color={borderColor} aria-hidden="true" />
      </EventChip>
    );
  };

  const cell = (dayKey, ownerKey, assignTo, extra) => {
    const dayJobs = jobsByDateAndUser[dayKey]?.[ownerKey] || [];
    return (
      <DayCell
        key={dayKey}
        cellKey={`${ownerKey}::${dayKey}`}
        dragOver={dragOverKey}
        setDragOver={setDragOverKey}
        isToday={dayKey === todayString}
        onDrop={() => handleDropOnCell(dayKey, assignTo)}
      >
        {dayJobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
        {extra?.(dayJobs)}
      </DayCell>
    );
  };

  return (
    <Card variant="raised" pad={8} style={{ marginTop: 16 }}>
      <WeekHeader
        icon={Calendar}
        title="Weekly Production Crew & Shift Calendar"
        subtitle={t.ccSubtitle}
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
        labelIcon={HardHat}
        label="Assigned Crew Lead"
        labelWidth={150}
      >
        {fieldPersonnelList.map((crewLead) => (
          <WeekRow
            key={crewLead.id}
            label={
              <>
                <Text size="base" weight="bold" color={C.navy}>
                  {crewLead.name}
                </Text>
                <Row
                  gap={1}
                  style={{
                    fontSize: "var(--text-2xs)",
                    color: C.sub,
                    textTransform: "capitalize",
                    marginTop: 2,
                  }}
                >
                  <Shield size={10} aria-hidden="true" /> {crewLead.role}
                </Row>
              </>
            }
          >
            {weekDays.map((day) =>
              cell(toLocalDateKey(day), crewLead.id, crewLead.id, (dayJobs) =>
                dayJobs.length > 1 ? (
                  <ConflictNote>{dayJobs.length} jobs — double-booked</ConflictNote>
                ) : null,
              ),
            )}
          </WeekRow>
        ))}

        {/* ── Unassigned jobs row (always rendered as a drop target for unassigning) ── */}
        {(unassignedThisWeek.length > 0 || typeof setJobs === "function") && (
          <WeekRow
            highlight
            label={
              <>
                <Row
                  gap={2}
                  style={{
                    fontWeight: "var(--weight-bold)",
                    fontSize: "var(--text-base)",
                    color: C.am,
                  }}
                >
                  <AlertTriangle size={14} aria-hidden="true" /> Unassigned
                </Row>
                <Muted size="2xs" style={{ marginTop: 2 }}>
                  {t.ccNoSupervisor}
                </Muted>
              </>
            }
          >
            {weekDays.map((day) => cell(toLocalDateKey(day), "__unassigned__", ""))}
          </WeekRow>
        )}

        {fieldPersonnelList.length === 0 && <EmptyWeekRow>{t.ccNoCrews}</EmptyWeekRow>}
      </WeekTable>
    </Card>
  );
}
