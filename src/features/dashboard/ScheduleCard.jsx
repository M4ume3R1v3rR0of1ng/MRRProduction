// src/features/dashboard/ScheduleCard.jsx
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
import { Calendar, AlertTriangle, Truck, Wrench } from "lucide-react";
import { C, parseDay, todayLocal } from "@/shared/utils/helpers";
import { buildSchedule } from "@/shared/utils/schedule";
import {
  Row,
  Text,
  Eyebrow,
  Muted,
  TextBtn,
  Callout,
  Card,
  SectionTitle,
} from "@/shared/components/UIPrimitives";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function ScheduleCard({ jobs, reqs, jobTrailers, vehs, users, onNav, lang = "en" }) {
  const today = todayLocal();
  const week = buildSchedule({ jobs, reqs, jobTrailers, vehs, users, from: today });
  const totalJobs = week.reduce((s, d) => s + d.jobs.length, 0);
  const totalMaint = week.reduce((s, d) => s + d.maint.length, 0);
  const anyConflict = week.some((d) => d.conflicts.length > 0);
  const es = lang === "es";

  return (
    <Card>
      <Row gap={4} align="baseline" justify="space-between" wrap style={{ marginBottom: 12 }}>
        <SectionTitle as="h3" icon={Calendar}>
          {es ? "La semana que viene" : "The week ahead"}
        </SectionTitle>
        <Row gap={4} align="baseline">
          <Text as="span" size="2xs" weight="bold" color={C.sub}>
            {totalJobs} {es ? "trabajos" : totalJobs === 1 ? "job" : "jobs"} · {totalMaint}{" "}
            {es ? "en taller" : "in shop"}
          </Text>
          {/* The way through to the full month view, where the past lives. This
              card only ever shows the next seven days. */}
          <TextBtn onClick={() => onNav?.("schedule")} size="2xs" style={{ whiteSpace: "nowrap" }}>
            {es ? "Ver calendario completo →" : "Full calendar →"}
          </TextBtn>
        </Row>
      </Row>

      {anyConflict && (
        <Callout
          tone="warn"
          bordered
          icon={AlertTriangle}
          pad="7px 10px"
          size="2xs"
          weight="bold"
          color={C.am}
          style={{ marginBottom: 10 }}
        >
          {es
            ? "Un vehículo está reservado y en el taller el mismo día."
            : "A vehicle is booked out and in the shop on the same day."}
        </Callout>
      )}

      <div className="sw-table-scroll">
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(96px, 1fr))", gap: 4 }}
        >
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
                <Row gap={0} align="baseline" justify="space-between">
                  <Eyebrow
                    as="span"
                    color={isToday ? C.am : C.sub}
                    style={{ fontSize: "var(--text-2xs)", letterSpacing: "0.4px" }}
                  >
                    {WEEKDAY[d.getDay()]}
                  </Eyebrow>
                  <Text
                    as="span"
                    size="sm"
                    weight="black"
                    color={isToday ? C.navy : C.sub}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {d.getDate()}
                  </Text>
                </Row>

                {busy === 0 && (
                  <Muted as="span" size="2xs" style={{ opacity: 0.6 }}>
                    —
                  </Muted>
                )}

                {day.jobs.slice(0, 2).map((j) => (
                  <button
                    key={j.id}
                    onClick={() => onNav?.("buildjobs")}
                    title={`${j.title}${j.supervisor ? ` · ${j.supervisor}` : ""}${j.trailers.length ? ` · ${j.trailers.join(", ")}` : ""}`}
                    style={{
                      background: C.w,
                      border: `1px solid ${C.bd}`,
                      borderLeft: `3px solid ${C.gr}`,
                      borderRadius: 4,
                      padding: "3px 5px",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: "var(--text-2xs)",
                      color: C.navy,
                      fontWeight: "var(--weight-bold)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}
                  >
                    {j.title}
                    {j.trailers.length > 0 && (
                      <Row
                        inline
                        as="span"
                        gap="2px"
                        style={{ color: C.sub, fontWeight: "normal" }}
                      >
                        {" "}
                        <Truck size={10} aria-hidden="true" />
                        {j.trailers.length}
                      </Row>
                    )}
                  </button>
                ))}
                {day.jobs.length > 2 && (
                  <Muted as="span" size="2xs">
                    +{day.jobs.length - 2} more
                  </Muted>
                )}

                {day.maint.slice(0, 2).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onNav?.("requests")}
                    title={`${m.vehicle} · ${m.issue}`}
                    style={{
                      background: C.w,
                      border: `1px solid ${C.bd}`,
                      borderLeft: `3px solid ${C.pu}`,
                      borderRadius: 4,
                      padding: "3px 5px",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: "var(--text-2xs)",
                      color: C.navy,
                      fontWeight: "var(--weight-bold)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}
                  >
                    <Wrench size={10} aria-hidden="true" /> {m.vehicle}
                  </button>
                ))}
                {day.maint.length > 2 && (
                  <Muted as="span" size="2xs">
                    +{day.maint.length - 2} more
                  </Muted>
                )}

                {day.conflicts.length > 0 && (
                  <Row
                    inline
                    title={`${day.conflicts.join(", ")} booked and in the shop`}
                    as="span"
                    gap="3px"
                    style={{
                      fontSize: "var(--text-2xs)",
                      color: C.am,
                      fontWeight: "var(--weight-bold)",
                    }}
                  >
                    <AlertTriangle size={10} aria-hidden="true" /> {day.conflicts.length}
                  </Row>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {totalJobs === 0 && totalMaint === 0 && (
        <Muted as="p" size="2xs" style={{ margin: "10px 0 0" }}>
          {es
            ? "Nada programado esta semana. Asigne fechas en Trabajos o Mantenimiento."
            : "Nothing scheduled this week. Set dates in Build Jobs or Maintenance."}
        </Muted>
      )}
    </Card>
  );
}
