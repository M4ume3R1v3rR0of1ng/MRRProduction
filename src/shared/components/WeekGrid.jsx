// src/shared/components/WeekGrid.jsx
//
// The week-at-a-glance scheduler shared by the crew, maintenance and trailer
// calendars: a header with week navigation, a fixed-layout table with one
// labelled row per crew lead / vehicle / trailer and a drop-target cell per day,
// and the draggable chips that sit in those cells. The three calendars were
// ~500-line copies of each other; only what goes in the rows differed.
//
// The drag-over and today tints were literal rgba() of the light-mode leather
// blue, which read as a bright smear on the dark surface. They are color-mix()
// of the token now, so they theme with it.
import { AlertTriangle, X } from "lucide-react";
import { C } from "../utils/helpers";
import { Row, Stack, Text, Muted, Card, SectionTitle } from "./LayoutPrimitives";
import { Btn } from "./UIPrimitives";

const tint = (pct) => `color-mix(in srgb, ${C.blue} ${pct}%, transparent)`;

// Title + blurb on the left, ‹ week › and "Today" on the right.
export function WeekHeader({
  icon,
  title,
  subtitle,
  weekLabel,
  onShift,
  onToday,
  showToday,
  labels,
}) {
  return (
    <Row gap={5} justify="space-between" wrap style={{ marginBottom: 20 }}>
      <Stack gap={0}>
        <SectionTitle icon={icon} size="lg">
          {title}
        </SectionTitle>
        <Muted as="p" style={{ margin: "2px 0 0" }}>
          {subtitle}
        </Muted>
      </Stack>
      <Row>
        <Btn v="ghost" sz="sm" onClick={() => onShift(-1)}>
          {labels.prev}
        </Btn>
        <Text
          size="base"
          weight="bold"
          color={C.navy}
          style={{ minWidth: 200, textAlign: "center" }}
        >
          {weekLabel}
        </Text>
        <Btn v="ghost" sz="sm" onClick={() => onShift(1)}>
          {labels.next}
        </Btn>
        {showToday && (
          <Btn v="primary" sz="sm" onClick={onToday}>
            {labels.today}
          </Btn>
        )}
      </Row>
    </Row>
  );
}

// The grid itself. `days` are Date objects; `dayKey` turns one into the key the
// caller groups its rows by. Children are the <tr>s.
export function WeekTable({
  days,
  dayKey,
  todayKey,
  labelIcon: Icon,
  label,
  labelWidth,
  children,
}) {
  return (
    <div className="sw-table-scroll">
      <table
        style={{ width: "100%", borderCollapse: "collapse", minWidth: 800, tableLayout: "fixed" }}
      >
        <thead>
          <tr style={{ background: C.lg }}>
            <Text
              as="th"
              size="xs"
              weight="bold"
              color={C.sub}
              style={{
                width: labelWidth,
                padding: "12px 10px",
                textAlign: "left",
                borderBottom: `2px solid ${C.bd}`,
              }}
            >
              <Row gap={2}>
                {Icon && <Icon size={13} aria-hidden="true" />} {label}
              </Row>
            </Text>
            {days.map((day) => {
              const isToday = dayKey(day) === todayKey;
              return (
                <Text
                  as="th"
                  key={dayKey(day)}
                  size="sm"
                  weight="extrabold"
                  color={isToday ? C.blue : C.navy}
                  aria-current={isToday ? "date" : undefined}
                  style={{
                    padding: "10px",
                    textAlign: "center",
                    borderBottom: isToday ? `3px solid ${C.blue}` : `2px solid ${C.bd}`,
                    background: isToday ? tint(3) : "transparent",
                  }}
                >
                  <div>{day.toLocaleDateString("en-US", { weekday: "short" })}</div>
                  <Text size="md" style={{ marginTop: 2 }}>
                    {day.getDate()}
                  </Text>
                </Text>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// One row: the label cell, then whatever day cells the caller renders.
export function WeekRow({ label, highlight, children }) {
  return (
    <tr
      style={{
        borderBottom: `1px solid ${C.lg}`,
        background: highlight ? "color-mix(in srgb, var(--c-amber) 4%, transparent)" : undefined,
      }}
    >
      <td
        style={{ padding: "14px 10px", verticalAlign: "middle", borderRight: `1px solid ${C.lg}` }}
      >
        {label}
      </td>
      {children}
    </tr>
  );
}

// A day cell that accepts a dragged chip. `dragOver` and `setDragOver` are the
// calendar's own "which cell is under the pointer" state, keyed by `cellKey`.
// `disabled` refuses drops (read-only viewers) without hiding the cell.
export function DayCell({ cellKey, dragOver, setDragOver, isToday, onDrop, disabled, children }) {
  const over = dragOver === cellKey;
  return (
    <td
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(cellKey);
      }}
      onDragLeave={() => setDragOver((k) => (k === cellKey ? null : k))}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        onDrop();
      }}
      style={{
        padding: "6px",
        verticalAlign: "top",
        background: over ? tint(12) : isToday ? tint(1) : "transparent",
        outline: over ? `2px dashed ${C.blue}` : "none",
        outlineOffset: -2,
        borderRight: `1px solid ${C.lg}`,
        height: 90,
      }}
    >
      <Stack gap={2}>{children}</Stack>
    </td>
  );
}

// A booked item in a cell: a colored left edge, a one-line title and a detail
// line. `onRemove` adds the small × in the corner (trailer bookings).
export function EventChip({
  color,
  title,
  tooltip,
  dragging,
  draggable,
  onDragStart,
  onDragEnd,
  onClick,
  onRemove,
  removeLabel,
  children,
}) {
  return (
    <Card
      variant="raised"
      pad="6px 8px"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(e);
      }}
      onDragEnd={onDragEnd}
      containsActions={!!onRemove}
      onClick={onClick}
      title={tooltip}
      style={{
        position: "relative",
        borderLeft: `4px solid ${color}`,
        borderRadius: "var(--radius-sm)",
        opacity: dragging ? 0.4 : 1,
      }}
    >
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={removeLabel}
          aria-label={removeLabel}
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            color: C.sub,
            padding: 2,
          }}
        >
          <X size={11} aria-hidden="true" />
        </button>
      )}
      <Text
        size="xs"
        weight="extrabold"
        color={C.navy}
        truncate
        style={onRemove ? { paddingRight: 14 } : undefined}
      >
        {title}
      </Text>
      <Row
        gap={0}
        justify="space-between"
        style={{ marginTop: 4, fontSize: "var(--text-2xs)", color: C.sub }}
      >
        {children}
      </Row>
    </Card>
  );
}

// The red "two things in one slot" warning under a cell's chips.
export function ConflictNote({ children }) {
  return (
    <Row
      gap={1}
      justify="center"
      style={{
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-bold)",
        color: C.rd,
        background: C.rB,
        padding: "2px 6px",
        borderRadius: "var(--radius-xs)",
        textAlign: "center",
      }}
    >
      <AlertTriangle size={10} aria-hidden="true" /> {children}
    </Row>
  );
}

// Full-width message when there are no rows to draw.
export function EmptyWeekRow({ children }) {
  return (
    <tr>
      <Text
        as="td"
        colSpan={8}
        size="base"
        color={C.sub}
        style={{ padding: 32, textAlign: "center", fontStyle: "italic" }}
      >
        {children}
      </Text>
    </tr>
  );
}
