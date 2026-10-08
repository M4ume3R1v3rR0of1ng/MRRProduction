import { useRef } from "react";
import { Camera, X } from "lucide-react";
import { C } from "../utils/helpers";
import { ROLES } from "../database/permissions";
import { translations } from "../utils/translations";
import { compressImg } from "../utils/helpers";
import { useNotify } from "../context/NotificationContext";
import { HAS_NATIVE_CAMERA, capturePhoto } from "../utils/photoCapture";
import { Stack, Row, Text, Muted, Card, IconSwatch } from "./LayoutPrimitives";

// The layout layer (Card, Stack, Row, Text, Callout, Table, Meter...) — kept in its own file
// so this one stops growing, but re-exported so views have one import path.
export {
  Card,
  Stack,
  Row,
  Eyebrow,
  SectionTitle,
  Muted,
  Text,
  Table,
  Callout,
  IconSwatch,
  Divider,
  Meter,
  PickRow,
  Grid,
} from "./LayoutPrimitives";

// A plain colored severity dot — used wherever a status is conveyed by color
// alone (jobStatusMeta in helpers.js), rather than reaching for an icon shape
// that would just be decoration.
export function StatusDot({ color, size = 8 }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
      }}
    />
  );
}

export function Spinner({ size = 18, color }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2.5px solid color-mix(in srgb, ${color || C.amber} 22%, transparent)`,
        borderTopColor: color || C.amber,
        animation: "mrr-spin 0.7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

export function LoadingState({ label = "Loading...", compact = false }) {
  return (
    <Stack
      gap={3}
      align="center"
      style={{
        justifyContent: "center",
        padding: compact ? "var(--space-5) 0" : "var(--space-9) 0",
      }}
    >
      <Spinner size={compact ? 16 : 22} />
      <Text as="span" size="sm" weight="semibold" color={C.sub}>
        {label}
      </Text>
    </Stack>
  );
}

// ── Skeletons ──
// Prefer these to LoadingState wherever the shape of the incoming content is
// known. A spinner says "wait"; a skeleton says "wait, and here is what is
// coming", and because the blocks are the real heights nothing reflows when the
// data arrives. Reach for LoadingState only when the result has no fixed shape.

export function Skeleton({ w = "100%", h = 14, r, style }) {
  return (
    <div
      className="mrr-skeleton"
      aria-hidden="true"
      style={{
        width: w,
        height: h,
        borderRadius: r ?? "var(--radius-sm)",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

// Rows of a data table. `cols` accepts widths so the placeholder matches the real
// column rhythm instead of an even split, which is what makes it read as a table.
export function SkeletonTable({
  rows = 6,
  cols = ["32%", "18%", "14%", "14%", "22%"],
  label = "Loading",
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} style={{ width: "100%" }}>
      <Row
        gap={6}
        align="stretch"
        style={{ padding: "12px 14px", borderBottom: `1.5px solid ${C.line}` }}
      >
        {cols.map((w, i) => (
          <Skeleton key={i} w={w} h={9} />
        ))}
      </Row>
      {Array.from({ length: rows }, (_, r) => (
        <Row key={r} gap={6} style={{ padding: "14px", borderBottom: `1px solid ${C.line}` }}>
          {cols.map((w, i) => (
            <Skeleton key={i} w={w} h={13} />
          ))}
        </Row>
      ))}
    </div>
  );
}

// Card grid placeholder. Uses the same responsive grid utility the real content
// does, so the count per row matches at every breakpoint.
export function SkeletonCards({ count = 6, height = 132, cols = 3, label = "Loading" }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={`sw-grid-${cols}`}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          style={{
            background: C.surface,
            border: `1px solid ${C.line}`,
            borderRadius: "var(--radius-xl)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-5)",
          }}
        >
          <Skeleton w={38} h={38} r="var(--radius-lg)" />
          <Skeleton w="58%" h={20} />
          <Skeleton w="82%" h={11} />
          <Skeleton w="40%" h={11} style={{ marginTop: "auto" }} />
          <div style={{ height: Math.max(0, height - 132) }} />
        </div>
      ))}
    </div>
  );
}

// The title row nearly every view opens with: an optional icon, an h1, an
// optional subtitle, and an actions slot pinned to the right. 8+ views had
// this exact row — same style values, copy-pasted — before it moved here.
export function PageHeader({ icon: Icon, title, subtitle, actions, style }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
        flexWrap: "wrap",
        gap: "var(--space-4)",
        ...style,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 9,
            fontSize: "var(--text-2xl)",
            fontWeight: "var(--weight-black)",
            color: C.navy,
          }}
        >
          {Icon && <Icon size={22} aria-hidden="true" />} {title}
        </h1>
        {subtitle && (
          <Muted as="p" size="sm" style={{ margin: "2px 0 0" }}>
            {subtitle}
          </Muted>
        )}
      </div>
      {actions && <Row wrap>{actions}</Row>}
    </div>
  );
}

// The responsive card-tiling grid every card-based list view rebuilt with its
// own minmax() value (130-340px, scattered per file for no reason tied to the
// content). One utility, one knob — plus `fit`, because auto-fit and
// auto-fill genuinely disagree whenever a row doesn't fill: auto-fill leaves
// a phantom empty track (cards stay their minmax width), auto-fit collapses
// it (cards stretch to fill the row). That's a real layout difference, not a
// style preference, so it has to survive the move into this component.
export function CardGrid({ minWidth = 260, gap = "var(--space-5)", fit = false, children, style }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${fit ? "auto-fit" : "auto-fill"}, minmax(${minWidth}px, 1fr))`,
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// A metric/KPI tile. Two looks, because two already existed and both are used
// enough to keep: "icon" (a tinted icon swatch beside the figure — Dashboard's
// original) and "borderLeft" (a flat color bar — Reports' original). Pick per
// call site with `variant`; don't invent a third look for a ninth screen.
export function StatTile({
  label,
  value,
  color,
  icon,
  onClick,
  sub,
  variant = "icon",
  style,
  children,
}) {
  if (variant === "borderLeft") {
    return (
      <Card
        variant="raised"
        pad={6}
        onClick={onClick}
        style={{ borderLeft: `5px solid ${color}`, flex: 1, minWidth: 160, ...style }}
      >
        <Text size="3xl" weight="black" color={color}>
          {value}
        </Text>
        <Muted style={{ marginTop: 3 }}>{label}</Muted>
        {sub && (
          <Muted size="2xs" style={{ marginTop: 4 }}>
            {sub}
          </Muted>
        )}
        {children}
      </Card>
    );
  }
  return (
    <Card pad={6} onClick={onClick} style={style}>
      <Row style={{ minWidth: 0 }}>
        {icon && <IconSwatch icon={icon} color={color} />}
        <Stack gap={0} style={{ minWidth: 0 }}>
          {/* nowrap + ellipsis: a valuation reads "$1,284,003" in a narrow
              column, and a number that wraps mid-figure is worse than one that
              is cut off. */}
          <Text
            size="2xl"
            weight="extrabold"
            color={color}
            truncate
            style={{ lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}
          >
            {value}
          </Text>
          <Text size="xs" weight="semibold" color={C.sub} style={{ marginTop: 2 }}>
            {label}
          </Text>
        </Stack>
      </Row>
      {sub && (
        <Muted size="2xs" style={{ marginTop: 4 }}>
          {sub}
        </Muted>
      )}
      {children}
    </Card>
  );
}

// The "nothing here" block a list shows when it's got zero rows — whether
// that's genuinely empty, or a filter/search hiding everything that exists.
// `spanGrid` is for use inside a CardGrid, where the block needs to bridge
// every column instead of occupying just one cell. `well` is the sunken,
// no-shadow look a couple of modals use for a smaller inline list instead of
// a whole page.
export function EmptyState({
  icon: Icon,
  iconSize = 30,
  message,
  messageStyle,
  actions,
  spanGrid,
  well,
  style,
}) {
  return (
    <div
      style={{
        ...(spanGrid ? { gridColumn: "1 / -1" } : {}),
        background: well ? C.lg : C.w,
        padding: well ? 24 : 32,
        borderRadius: well ? "var(--radius-md)" : "var(--radius-xl)",
        textAlign: "center",
        color: C.sub,
        boxShadow: well ? "none" : "var(--shadow-sm)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        ...style,
      }}
    >
      {Icon && <Icon size={iconSize} strokeWidth={1.5} aria-hidden="true" />}
      <span
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-semibold)",
          ...messageStyle,
        }}
      >
        {message}
      </span>
      {actions && (
        <Row gap={2} align="stretch" justify="center" wrap>
          {actions}
        </Row>
      )}
    </div>
  );
}

// A status-filter toggle with a count badge — verbatim duplicated between
// Build Jobs and Pull Inventory before this. `count` of 0 hides the badge
// rather than showing "0", which would read as a dead filter worth clicking.
export function FilterPill({ label, count, active, onClick, title }) {
  return (
    <Btn
      v={active ? "primary" : "ghost"}
      sz="sm"
      onClick={onClick}
      aria-pressed={active}
      title={title}
    >
      {label}
      {count > 0 && (
        <span
          style={{
            marginLeft: 4,
            background: active ? "rgba(255,255,255,0.3)" : C.lg,
            color: active ? C.onAccent : C.sub,
            borderRadius: 20,
            fontSize: "var(--text-2xs)",
            padding: "1px 6px",
            fontWeight: "var(--weight-extrabold)",
          }}
        >
          {count}
        </span>
      )}
    </Btn>
  );
}

// A two-or-three-way view switch (list / calendar) on a sunken track — the
// one control Build Jobs and Maintenance each hand-rolled as a pair of raw
// buttons. aria-pressed says which side is showing.
export function Segmented({ options, value, onChange, style }) {
  return (
    <Row
      gap={0}
      role="group"
      style={{ background: C.lg, padding: 4, borderRadius: "var(--radius-md)", ...style }}
    >
      {options.map(({ value: v, label, icon: Icon }) => {
        const on = v === value;
        return (
          <Row
            as="button"
            type="button"
            key={v}
            gap={2}
            aria-pressed={on}
            onClick={() => onChange(v)}
            style={{
              padding: "6px 12px",
              border: "none",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-bold)",
              cursor: "pointer",
              background: on ? C.w : "transparent",
              color: on ? C.navy : C.sub,
              boxShadow: on ? "var(--shadow-xs)" : "none",
            }}
          >
            {Icon && <Icon size={13} aria-hidden="true" />} {label}
          </Row>
        );
      })}
    </Row>
  );
}

// Underline tabs across the top of a view. aria-selected marks the open one.
export function Tabs({ tabs, value, onChange, style }) {
  return (
    <Row
      gap={2}
      align="stretch"
      wrap
      role="tablist"
      style={{ marginBottom: 16, borderBottom: `2px solid ${C.bd}`, ...style }}
    >
      {tabs.map(({ id, label, icon: Icon, title }) => {
        const on = id === value;
        return (
          <Row
            as="button"
            type="button"
            key={id}
            gap={2}
            role="tab"
            aria-selected={on}
            title={title}
            onClick={() => onChange(id)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "8px 14px",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-extrabold)",
              color: on ? C.navy : C.sub,
              borderBottom: `3px solid ${on ? C.gold : "transparent"}`,
              marginBottom: -2,
            }}
          >
            {Icon && <Icon size={14} aria-hidden="true" />} {label}
          </Row>
        );
      })}
    </Row>
  );
}

// `footer` is a sticky action bar pinned to the bottom of the scrolling panel.
// Use it when the confirm button is the last thing in a body that can outgrow
// a phone screen: without it the table runs off the bottom, nothing on screen
// says there is more, and the modal reads as finished with the button below
// the fold.
export function Modal({ title, onClose, children, footer, wide, extraWide, disableCloseButton }) {
  return (
    <div
      className="mrr-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: C.backdrop,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-5)",
      }}
    >
      <div
        className="mrr-modal"
        style={{
          background: C.w,
          borderRadius: "var(--radius-2xl)",
          width: "100%",
          maxWidth: extraWide ? 900 : wide ? 740 : 480,
          maxHeight: "92vh",
          overflowY: "auto",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div
          style={{
            padding: "var(--space-7) var(--space-8)",
            borderBottom: `2px solid ${C.accent}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "sticky",
            top: 0,
            background: C.w,
            zIndex: 1,
          }}
        >
          <Text as="h2" size="lg" weight="extrabold" color={C.navy} style={{ margin: 0 }}>
            {title}
          </Text>
          {!disableCloseButton && (
            <button
              type="button"
              className="mrr-close"
              onClick={onClose}
              aria-label="Close"
              style={{
                border: "none",
                cursor: "pointer",
                fontSize: 24,
                color: C.sub,
                lineHeight: 1,
                padding: "2px 8px",
              }}
            >
              ×
            </button>
          )}
        </div>
        <div style={{ padding: footer ? "var(--space-8) var(--space-8) 0" : "var(--space-8)" }}>
          {children}
        </div>
        {footer && (
          <Row
            gap={4}
            align="stretch"
            style={{
              position: "sticky",
              bottom: 0,
              padding: "var(--space-4) var(--space-8) var(--space-8)",
              background: C.w,
              borderTop: `1px solid ${C.lg}`,
            }}
          >
            {footer}
          </Row>
        )}
      </div>
    </div>
  );
}

export function Fld({ label, children, hint, style }) {
  // {children} used to render as the <label>'s sibling, not inside it — so the
  // label text and the actual input had no association at all, implicit or
  // explicit. A screen reader focusing the input never announced what it was,
  // and clicking the label text did nothing, because as far as the DOM was
  // concerned they were two unrelated elements that happened to sit near each
  // other. Nesting the control inside the <label> is the standard implicit-label
  // pattern: it associates automatically with no id/htmlFor bookkeeping needed,
  // and works the same for every kind of child Fld already wraps across the
  // app — a plain <input>, a <select>, or a non-input control group (like the
  // billing-interval toggle in LoginScreen) that simply ignores it.
  return (
    <div style={{ marginBottom: "var(--space-5)", ...style }}>
      <label style={{ display: "block" }}>
        <span
          style={{
            display: "block",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-bold)",
            color: C.navy,
            marginBottom: "var(--space-1)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          {label}
        </span>
        {children}
      </label>
      {hint && (
        <Muted as="p" style={{ margin: "var(--space-1) 0 0" }}>
          {hint}
        </Muted>
      )}
    </div>
  );
}

// `prefix` puts a fixed mark inside the left edge of the box — "$" on a money
// field, a search icon on a filter. Nine screens built this by hand as a
// relative wrapper plus an absolutely positioned span; the padding that keeps
// typed text clear of the mark is the part they each guessed differently.
export function Inp({ prefix, ...p }) {
  const input = (
    <input
      {...p}
      className={`mrr-input ${p.className || ""}`}
      style={{
        width: "100%",
        padding: "10px 12px",
        border: `1.5px solid ${C.bd}`,
        borderRadius: "var(--radius-md)",
        fontSize: "var(--text-md)",
        boxSizing: "border-box",
        background: C.w,
        ...(prefix ? { paddingLeft: typeof prefix === "string" ? 22 : 28 } : {}),
        ...p.style,
      }}
    />
  );
  if (!prefix) return input;
  return (
    <span style={{ position: "relative", display: "block" }}>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: typeof prefix === "string" ? 10 : 9,
          top: "50%",
          transform: "translateY(-50%)",
          color: C.sub,
          display: "flex",
          pointerEvents: "none",
        }}
      >
        {prefix}
      </span>
      {input}
    </span>
  );
}

export function TA(p) {
  return (
    <textarea
      {...p}
      className={`mrr-input ${p.className || ""}`}
      style={{
        width: "100%",
        padding: "10px 12px",
        border: `1.5px solid ${C.bd}`,
        borderRadius: "var(--radius-md)",
        fontSize: "var(--text-md)",
        boxSizing: "border-box",
        background: C.w,
        resize: "vertical",
        fontFamily: "inherit",
        minHeight: 70,
        ...p.style,
      }}
    />
  );
}

export function Sel({ children, ...p }) {
  return (
    <select
      {...p}
      className={`mrr-input ${p.className || ""}`}
      style={{
        width: "100%",
        padding: "10px 12px",
        border: `1.5px solid ${C.bd}`,
        borderRadius: "var(--radius-md)",
        fontSize: "var(--text-md)",
        background: C.w,
        boxSizing: "border-box",
        ...p.style,
      }}
    >
      {children}
    </select>
  );
}

// `tone` recolors the outline variant (text + border) for the destructive or
// secondary outlined actions that used to hand-roll their own button for it.
// `block` stretches it across its container with the label centred — the
// width/justifyContent pair that full-width form buttons kept restating.
export function Btn({ children, v = "primary", sz = "md", tone, block, ...p }) {
  // Every filled variant takes C.onAccent, not C.surface. They used to read C.w,
  // which was literally white and worked by accident; now that surface inverts to
  // near-black in dark mode, C.w on a filled button would be dark ink on a dark
  // fill. onAccent is the token that means "ink that sits on a saturated color".
  const vs = {
    primary: { background: C.leather, color: C.onAccent, border: "none" },
    gold: {
      background: C.accent,
      color: C.accentInk,
      border: "none",
    },
    outline: {
      background: "transparent",
      color: tone || C.leather,
      border: `2px solid ${tone || C.leather}`,
    },
    ghost: { background: C.subtle, color: C.barnwood, border: "none" },
    danger: { background: C.rust, color: C.onAccent, border: "none" },
    purple: { background: C.plum, color: C.onAccent, border: "none" },
    green: { background: C.pasture, color: C.onAccent, border: "none" },
    teal: { background: C.teal, color: C.onAccent, border: "none" },
    sky: { background: C.slate, color: C.onAccent, border: "none" },
  };
  const ss = {
    sm: { padding: "5px 11px", fontSize: "var(--text-sm)" },
    md: { padding: "9px 16px", fontSize: "var(--text-base)" },
    lg: { padding: "12px 22px", fontSize: "var(--text-md)" },
    // The one primary action on a screen with nothing else to do (sign in).
    xl: { padding: "14px 22px", fontSize: "var(--text-lg)" },
  };
  return (
    <button
      {...p}
      className={`mrr-btn ${p.className || ""}`}
      style={{
        ...vs[v],
        ...ss[sz],
        borderRadius: "var(--radius-lg)",
        cursor: p.disabled ? "not-allowed" : "pointer",
        fontWeight: "var(--weight-bold)",
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        ...(block ? { width: "100%", justifyContent: "center" } : {}),
        ...p.style,
      }}
    >
      {children}
    </button>
  );
}

// A text-only action: "Edit", "Remove", the × on a list row, a link inside a
// sentence. Btn is wrong for these — its fill, shadow and hover lift make a
// one-word action shout. `underline` for one that sits in running text and
// would otherwise not read as clickable.
export function TextBtn({
  color = C.blue,
  size,
  weight = "bold",
  underline,
  style,
  children,
  ...p
}) {
  return (
    <button
      {...p}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        font: "inherit",
        cursor: p.disabled ? "not-allowed" : "pointer",
        fontSize: size && `var(--text-${size})`,
        fontWeight: `var(--weight-${weight})`,
        color,
        ...(underline ? { textDecoration: "underline", textUnderlineOffset: 2 } : {}),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// A checkbox drawn as a toggleable pill, for picking several of a short list
// (the trailers on a job). The whole pill is the label, so it's one big target.
export function CheckChip({ checked, onChange, disabled, children }) {
  return (
    <Row
      as="label"
      gap="5px"
      style={{
        background: checked ? C.tB : C.lg,
        border: `1px solid ${checked ? C.tl : C.bd}`,
        borderRadius: "var(--radius-pill)",
        padding: "5px 12px",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-semibold)",
        color: checked ? C.tl : C.navy,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        style={{ margin: 0 }}
      />
      {children}
    </Row>
  );
}

export function Bdg({ children, color = "blue" }) {
  const bg = {
    blue: C.leatherWash,
    green: C.gB,
    red: C.rB,
    amber: C.aB,
    gold: C.gL,
    purple: C.pB,
    gray: C.subtle,
    teal: C.tB,
    sky: C.sB,
  };
  const fg = {
    blue: C.blue,
    green: C.gr,
    red: C.rd,
    amber: C.am,
    gold: C.warn,
    purple: C.pu,
    gray: C.sub,
    teal: C.tl,
    sky: C.sl,
  };
  return (
    <span
      style={{
        padding: "3px var(--space-3)",
        borderRadius: "var(--radius-pill)",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-bold)",
        background: bg[color] || C.lg,
        color: fg[color] || C.sub,
        display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}

// Role key -> dictionary key. ROLES still owns the colour and the English
// fallback; only the visible label comes from the active language.
const ROLE_LABEL_KEYS = {
  admin: "roleAdmin",
  warehouse: "roleWarehouse",
  coordinator: "roleCoordinator",
  manager: "roleManager",
  field: "roleField",
  employee: "roleEmployee",
  bookkeeper: "roleBookkeeper",
};

// A role's visible name in the active language. Exported because the role-preview
// picker and its banner have to agree with this badge word for word — three
// spellings of "Site Supervisor" in one screenshot is how a training clip
// teaches a name the app does not use.
export function roleLabel(role, lang = "en") {
  const t = translations[lang] || translations.en;
  return t[ROLE_LABEL_KEYS[role]] || ROLES[role]?.label || role || "Employee";
}

export function RoleBdg({ role, lang = "en" }) {
  const r = ROLES[role] || { label: "Employee", color: "gray" };
  return <Bdg color={r.color}>{roleLabel(role, lang)}</Bdg>;
}

export function Toggle({ on, onChange, disabled = false }) {
  return (
    <div
      onClick={!disabled ? onChange : undefined}
      style={{
        width: 38,
        height: 22,
        borderRadius: "var(--radius-pill)",
        background: disabled ? C.disabled : on ? C.pasture : C.disabled,
        cursor: disabled ? "default" : "pointer",
        position: "relative",
        transition: "background 0.15s",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 3,
          left: on ? 19 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: disabled ? C.disabledInk : C.surface,
          transition: "left 0.15s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </div>
  );
}

// Every field photo in the app comes through here: vehicle shots, inspection
// evidence, maintenance requests, product photos, and job before/after pairs.
// That makes it the one place worth teaching about the native camera — six call
// sites pick it up without changing.
export function PhotoUpload({
  current,
  onUpload,
  maxDim = 350,
  quality = 0.72,
  label = "Upload Photo",
  previewHeight = 160,
  canRemove = true,
}) {
  const ref = useRef();
  const notify = useNotify();

  // Both paths converge on the same compressImg call. Whatever the photo came
  // from, it is resized and re-encoded identically before anyone stores it.
  const accept = (file) => {
    if (file)
      compressImg(file, maxDim, quality, onUpload, (msg) => notify?.showToast?.(msg, "error"));
  };

  const handle = (e) => {
    accept(e.target.files[0]);
    e.target.value = "";
  };

  // iOS: the native camera sheet. Everywhere else: the hidden file input, which
  // is the behaviour this component has always had.
  const openPicker = async () => {
    if (!HAS_NATIVE_CAMERA) {
      ref.current?.click();
      return;
    }
    try {
      const file = await capturePhoto();
      // null means they backed out of the sheet. Nothing to report.
      if (file) accept(file);
    } catch (err) {
      // Reaching here almost always means the permission was denied, and iOS
      // will not prompt a second time — the only way back is Settings. Say that,
      // because "couldn't take photo" leaves someone tapping a button that has
      // already decided not to work.
      notify?.showToast?.(
        "Steadwerk needs camera access to attach a photo. Turn it on in Settings > Steadwerk.",
        "error",
      );
      console.error("Native photo capture failed:", err);
    }
  };
  return (
    <div>
      {current ? (
        <div
          style={{
            position: "relative",
            marginBottom: "var(--space-4)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            border: `1.5px solid ${C.bd}`,
          }}
        >
          <img
            src={current}
            alt=""
            style={{ width: "100%", height: previewHeight, objectFit: "cover", display: "block" }}
          />
          {canRemove && (
            <button
              onClick={() => onUpload(null)}
              style={{
                position: "absolute",
                top: "var(--space-2)",
                right: "var(--space-2)",
                background: "rgba(0,0,0,0.55)",
                color: C.onScrim,
                border: "none",
                borderRadius: "50%",
                width: 26,
                height: 26,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            height: previewHeight,
            background: C.lg,
            borderRadius: "var(--radius-lg)",
            border: `2px dashed ${C.bd}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "var(--space-4)",
            cursor: "pointer",
            gap: "var(--space-2)",
          }}
          onClick={openPicker}
        >
          <Camera size={26} color={C.sub} strokeWidth={1.75} aria-hidden="true" />
          <Text as="span" size="sm" weight="semibold" color={C.sub}>
            {label}
          </Text>
        </div>
      )}
      {/* Not rendered in the iOS build: there is no code path left that clicks
          it, and an orphaned file input is one refactor away from becoming the
          web picker appearing on a phone again. */}
      {!HAS_NATIVE_CAMERA && (
        <input
          ref={ref}
          type="file"
          accept="image/*"
          onChange={handle}
          style={{ display: "none" }}
        />
      )}
    </div>
  );
}
