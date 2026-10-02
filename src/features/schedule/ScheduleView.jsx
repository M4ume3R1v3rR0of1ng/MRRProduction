// src/features/schedule/ScheduleView.jsx
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
import { Calendar, Truck, Wrench, AlertTriangle } from "lucide-react";
import { C, parseDay, todayLocal } from "@/shared/utils/helpers";
import { buildSchedule, monthGrid, monthNames, weekdayShort } from "@/shared/utils/schedule";
import {
  Btn,
  Bdg,
  Modal,
  PageHeader,
  Row,
  Stack,
  Text,
  Muted,
  StatusDot,
  Eyebrow,
  Callout,
} from "@/shared/components/UIPrimitives";
import { translations } from "@/shared/utils/translations";

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
  const MONTH_NAMES = monthNames(lang);
  const WEEKDAY_SHORT = weekdayShort(lang);
  const today = todayLocal();
  const todayDate = parseDay(today);

  const [cursor, setCursor] = useState(() => ({
    year: todayDate.getFullYear(),
    month: todayDate.getMonth(),
  }));
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

  const isCurrentMonth =
    cursor.year === todayDate.getFullYear() && cursor.month === todayDate.getMonth();
  const openDay = dayOpen ? byKey.get(dayOpen) : null;

  return (
    <div>
      {/* ── header ── */}
      <PageHeader
        icon={Calendar}
        title={t.schedule || "Schedule"}
        subtitle={
          <>
            {monthTotals.jobs} {monthTotals.jobs === 1 ? t.schJob : t.schJobs} · {monthTotals.maint}{" "}
            {t.schInShop}
            {monthTotals.conflicts > 0 && (
              <Text as="span" weight="bold" color={C.am}>
                {" "}
                · {monthTotals.conflicts}{" "}
                {monthTotals.conflicts > 1 ? t.schConflicts : t.schConflict}
              </Text>
            )}
          </>
        }
        actions={
          <>
            <Btn v="ghost" sz="sm" onClick={() => step(-1)} aria-label={t.schPrevMonth}>
              ←
            </Btn>
            <Text
              as="span"
              size="lg"
              weight="extrabold"
              color={C.navy}
              font="display"
              style={{ minWidth: 148, textAlign: "center" }}
            >
              {MONTH_NAMES[cursor.month]} {cursor.year}
            </Text>
            <Btn v="ghost" sz="sm" onClick={() => step(1)} aria-label={t.schNextMonth}>
              →
            </Btn>
            {!isCurrentMonth && (
              <Btn v="outline" sz="sm" onClick={goToday}>
                {t.schToday}
              </Btn>
            )}
          </>
        }
      />

      {/* ── legend ── */}
      <Muted size="2xs" className="sw-wrap" style={{ marginBottom: 12, alignItems: "center" }}>
        <Row inline as="span" gap="5px">
          <StatusDot color={C.gr} size={9} />
          {t.schLegendJob}
        </Row>
        <Row inline as="span" gap="5px">
          <StatusDot color={C.pu} size={9} />
          {t.schLegendShop}
        </Row>
        <span>{t.schLegendTrailers}</span>
        <Text as="span" color={C.am}>
          {t.schLegendConflict}
        </Text>
        <Text as="span" style={{ opacity: 0.55 }}>
          {t.schLegendFaded}
        </Text>
      </Muted>

      {/* ── month grid ── */}
      <div className="sw-table-scroll">
        <div style={{ minWidth: 700 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 3,
              marginBottom: 3,
            }}
          >
            {WEEKDAY_SHORT.map((d) => (
              <Eyebrow
                key={d}
                style={{ textAlign: "center", fontSize: "var(--text-2xs)", padding: "4px 0" }}
              >
                {d}
              </Eyebrow>
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
                  <Row gap={0} align="baseline" justify="space-between">
                    <Text
                      as="span"
                      size="sm"
                      weight={isToday ? "black" : "bold"}
                      color={isToday ? C.am : C.navy}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {d.getDate()}
                    </Text>
                    {day.trailerCount > 0 && (
                      <Row
                        inline
                        title={`${day.trailerCount} trailer(s) out`}
                        as="span"
                        gap="2px"
                        style={{ fontSize: "var(--text-2xs)", color: C.sub }}
                      >
                        <Truck size={10} aria-hidden="true" />
                        {day.trailerCount}
                      </Row>
                    )}
                  </Row>

                  {day.jobs.slice(0, 3).map((j) => (
                    <span
                      key={j.id}
                      title={`${j.title}${j.supervisor ? ` · ${j.supervisor}` : ""}`}
                      style={{
                        borderLeft: `3px solid ${C.gr}`,
                        background: C.lg,
                        borderRadius: 3,
                        padding: "2px 4px",
                        fontSize: "var(--text-2xs)",
                        color: C.navy,
                        fontWeight: "var(--weight-bold)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
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
                        borderLeft: `3px solid ${C.pu}`,
                        background: C.lg,
                        borderRadius: 3,
                        padding: "2px 4px",
                        fontSize: "var(--text-2xs)",
                        color: C.navy,
                        fontWeight: "var(--weight-bold)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        opacity: m.finished ? 0.55 : 1,
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <Wrench size={9} aria-hidden="true" /> {m.vehicle}
                    </span>
                  ))}

                  {busy >
                    (day.jobs.length > 3 ? 3 : day.jobs.length) +
                      (day.maint.length > 2 ? 2 : day.maint.length) && (
                    <Muted as="span" size="2xs">
                      +{busy - Math.min(day.jobs.length, 3) - Math.min(day.maint.length, 2)} more
                    </Muted>
                  )}

                  {day.conflicts.length > 0 && (
                    <Row
                      inline
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
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {monthTotals.jobs === 0 && monthTotals.maint === 0 && (
        <Text as="p" size="sm" color={C.sub} style={{ marginTop: 14, textAlign: "center" }}>
          {t.schEmpty.replace("{month}", MONTH_NAMES[cursor.month] + " " + cursor.year)}
        </Text>
      )}

      {/* ── one day, expanded ── */}
      {openDay && (
        <Modal
          title={parseDay(openDay.key).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
          onClose={() => setDayOpen(null)}
          wide
        >
          {openDay.conflicts.length > 0 && (
            <Callout
              tone="warn"
              bordered
              icon={AlertTriangle}
              pad="9px 12px"
              size="sm"
              weight="bold"
              color={C.am}
              style={{ marginBottom: 14 }}
            >
              {openDay.conflicts.join(", ")} {openDay.conflicts.length > 1 ? "are" : "is"} booked
              out and due in the shop on this day.
            </Callout>
          )}

          {openDay.jobs.length > 0 && (
            <>
              <Text
                as="h4"
                size="sm"
                color={C.navy}
                style={{ margin: "0 0 8px", textTransform: "uppercase" }}
              >
                Jobs ({openDay.jobs.length})
              </Text>
              <Stack gap={2} style={{ marginBottom: 16 }}>
                {openDay.jobs.map((j) => {
                  const st = jSC[j.status] || { c: "gray", l: j.status };
                  return (
                    <Callout
                      as="button"
                      type="button"
                      key={j.id}
                      onClick={() => {
                        setDayOpen(null);
                        onNav?.("buildjobs");
                      }}
                      pad="10px 12px"
                      style={{ width: "100%" }}
                    >
                      <Row gap={4} justify="space-between">
                        <Stack gap={0} style={{ minWidth: 0 }}>
                          <Text size="md" weight="bold" color={C.navy}>
                            {j.title}
                          </Text>
                          <Muted size="2xs">
                            {j.po || "No PO"}
                            {j.supervisor ? ` · ${j.supervisor}` : ""}
                            {j.trailers.length > 0 && (
                              <>
                                {" · "}
                                <Truck
                                  size={10}
                                  style={{ verticalAlign: -1 }}
                                  aria-hidden="true"
                                />{" "}
                                {j.trailers.join(", ")}
                              </>
                            )}
                          </Muted>
                        </Stack>
                        <Bdg color={st.c}>{st.l}</Bdg>
                      </Row>
                    </Callout>
                  );
                })}
              </Stack>
            </>
          )}

          {openDay.maint.length > 0 && (
            <>
              <Text
                as="h4"
                size="sm"
                color={C.navy}
                style={{ margin: "0 0 8px", textTransform: "uppercase" }}
              >
                In the shop ({openDay.maint.length})
              </Text>
              <Stack gap={2}>
                {openDay.maint.map((m) => (
                  <Callout
                    as="button"
                    type="button"
                    key={m.id}
                    onClick={() => {
                      setDayOpen(null);
                      onNav?.("requests");
                    }}
                    pad="10px 12px"
                    style={{ width: "100%" }}
                  >
                    <Row gap={4} justify="space-between">
                      <Stack gap={0} style={{ minWidth: 0 }}>
                        <Row
                          gap="5px"
                          style={{
                            fontWeight: "var(--weight-bold)",
                            color: C.navy,
                            fontSize: "var(--text-md)",
                          }}
                        >
                          <Wrench size={12} aria-hidden="true" /> {m.vehicle}
                        </Row>
                        <Muted size="2xs">{m.issue}</Muted>
                      </Stack>
                      {m.finished ? (
                        <Bdg color="green">{t.schDone}</Bdg>
                      ) : m.urgency === "high" ? (
                        <Bdg color="red">{t.schUrgent}</Bdg>
                      ) : (
                        <Bdg color="gray">{t.schScheduled}</Bdg>
                      )}
                    </Row>
                  </Callout>
                ))}
              </Stack>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
