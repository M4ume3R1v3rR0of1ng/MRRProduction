// src/features/maintenance/MaintenanceCalendar.jsx
import { useState, useMemo, useCallback } from "react";
import { AlertOctagon, Clock, Calendar, Truck, Inbox } from "lucide-react";
import { translations } from "@/shared/utils/translations";
import { C } from "@/shared/utils/helpers";
import { Row, Stack, Muted, Text, Card, Callout, Eyebrow } from "@/shared/components/UIPrimitives";
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

const toLocalDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const urgencyMeta = (urgency) => {
  if (urgency === "urgent") return { color: C.rd, icon: AlertOctagon, label: "Urgent" };
  if (urgency === "soon") return { color: C.am, icon: Clock, label: "Soon" };
  return { color: C.blue, icon: null, label: "Standard" };
};

export default function MaintenanceCalendar({
  reqs = [],
  vehs = [],
  user,
  setReqs,
  onRequestClick,
  lang = "en",
}) {
  const t = translations[lang] || translations.en;
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

  const activeReqs = useMemo(
    () => reqs.filter((r) => r.status === "pending" || r.status === "scheduled"),
    [reqs],
  );

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
  const weekLabel =
    weekStart && weekEnd
      ? `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
      : "";
  const isCurrentWeek =
    toLocalDateKey(weekStart) <= todayString && todayString <= toLocalDateKey(weekEnd);

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
      setReqs((p) =>
        p.map((r) =>
          r.id === reqId ? { ...req, scheduled_date: prevScheduledDate, status: prevStatus } : r,
        ),
      );
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
      setReqs((p) =>
        p.map((r) =>
          r.id === reqId ? { ...req, scheduled_date: prevScheduledDate, status: prevStatus } : r,
        ),
      );
    }
  };

  const RequestCard = ({ req }) => {
    const meta = urgencyMeta(req.urgency);
    return (
      <EventChip
        color={meta.color}
        title={req.vname}
        tooltip={`${req.vname}\nType: ${req.type}\nUrgency: ${req.urgency}\n${req.notes || ""}`}
        dragging={draggingId === req.id}
        draggable={typeof setReqs === "function"}
        onDragStart={() => setDraggingId(req.id)}
        onDragEnd={() => {
          setDraggingId(null);
          setDragOverKey(null);
        }}
        onClick={onRequestClick ? () => onRequestClick(req) : undefined}
      >
        <Text as="span" truncate>
          {req.type}
        </Text>
        <Row
          inline
          as="span"
          gap="3px"
          style={{
            color: meta.color,
            fontWeight: "var(--weight-bold)",
            flexShrink: 0,
            marginLeft: 4,
          }}
        >
          {meta.icon && <meta.icon size={10} aria-hidden="true" />} {meta.label}
        </Row>
      </EventChip>
    );
  };

  const trayOver = dragOverKey === "__unscheduled__";

  return (
    <Card variant="raised" pad={8} style={{ marginTop: 16 }}>
      <WeekHeader
        icon={Calendar}
        title="Weekly Maintenance Schedule"
        subtitle={t.mcSubtitle}
        weekLabel={weekLabel}
        onShift={handleShiftWeek}
        onToday={handleGoToToday}
        showToday={!isCurrentWeek}
        labels={{ prev: t.calPrev, next: t.calNext, today: t.calToday }}
      />

      {/* ── Awaiting Scheduling tray (also a drop target, to unschedule) ── */}
      <Callout
        pad={5}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverKey("__unscheduled__");
        }}
        onDragLeave={() => setDragOverKey((k) => (k === "__unscheduled__" ? null : k))}
        onDrop={(e) => {
          e.preventDefault();
          handleDropOnUnscheduled();
        }}
        style={{
          border: `2px dashed ${trayOver ? C.blue : C.bd}`,
          borderRadius: "var(--radius-lg)",
          marginBottom: 20,
          ...(trayOver && { background: `color-mix(in srgb, ${C.blue} 6%, transparent)` }),
        }}
      >
        <Eyebrow as={Row} gap={2} style={{ marginBottom: 8 }}>
          <Inbox size={12} aria-hidden="true" /> Awaiting Scheduling{" "}
          {unscheduledReqs.length > 0 && `(${unscheduledReqs.length})`}
        </Eyebrow>
        {unscheduledReqs.length === 0 ? (
          <Muted size="sm" style={{ fontStyle: "italic" }}>
            {t.mcUnschedule}
          </Muted>
        ) : (
          <Row align="stretch" wrap>
            {unscheduledReqs.map((r) => (
              <Stack key={r.id} gap={0} style={{ width: 180 }}>
                <RequestCard req={r} />
              </Stack>
            ))}
          </Row>
        )}
      </Callout>

      <WeekTable
        days={weekDays}
        dayKey={toLocalDateKey}
        todayKey={todayString}
        labelIcon={Truck}
        label="Vehicle"
        labelWidth={170}
      >
        {vehicleRows.map((v) => (
          <WeekRow
            key={v.id}
            label={
              <>
                <Text size="base" weight="bold" color={C.navy}>
                  {v.name}
                </Text>
                <Muted size="2xs" style={{ marginTop: 2 }}>
                  #{v.plate || v.plates || "—"}
                </Muted>
              </>
            }
          >
            {weekDays.map((day) => {
              const dayKey = toLocalDateKey(day);
              const dayReqs = reqsByDateAndVehicle[dayKey]?.[v.id] || [];
              return (
                <DayCell
                  key={dayKey}
                  cellKey={`${v.id}::${dayKey}`}
                  dragOver={dragOverKey}
                  setDragOver={setDragOverKey}
                  isToday={dayKey === todayString}
                  onDrop={() => handleDropOnDate(dayKey)}
                >
                  {dayReqs.map((r) => (
                    <RequestCard key={r.id} req={r} />
                  ))}
                  {dayReqs.length > 1 && <ConflictNote>{dayReqs.length} requests</ConflictNote>}
                </DayCell>
              );
            })}
          </WeekRow>
        ))}

        {vehicleRows.length === 0 && <EmptyWeekRow>{t.mcNoRequests}</EmptyWeekRow>}
      </WeekTable>
    </Card>
  );
}
