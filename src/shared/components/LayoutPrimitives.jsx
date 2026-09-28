import { C } from "../utils/helpers";

// The layer above Btn/Inp/Modal: surfaces, spacing, and the small text styles
// views kept rebuilding inline. Before these existed, 17 files hand-built card
// containers with 7 different radii and ~13 paddings (three of them with a local
// `const card = {...}`), and uppercase section labels came in 18 font-size
// variants. Every default below is the variant that was already most common in
// the codebase, not a new look — so migrating a call site should be visually a
// no-op. If a screen genuinely needs something else, pass `style` for the one
// property that differs rather than adding a variant for a single caller.
//
// Re-exported from UIPrimitives.jsx, so import from there like everything else.

// `gap` takes a --space-* step (1-10) so call sites stay on the scale; a string
// passes through untouched for the rare case that needs something off-scale.
const space = (g) => (typeof g === "number" ? `var(--space-${g})` : g);

const CARD_PAD = {
  none: 0,
  sm: "var(--space-4) var(--space-5)",
  md: "var(--space-7)",
  lg: "var(--space-9)",
};

// outlined: border + the faint shadow .mrr-card already carries (the default
// look of list cards). raised: no border, a little more lift (settings panels,
// MfaPanel). flat: border only, for cards nested inside another surface where a
// second shadow reads as muddy.
const CARD_VARIANT = {
  outlined: { border: `1px solid ${C.line}` },
  raised: { boxShadow: "var(--shadow-sm)" },
  flat: { border: `1px solid ${C.line}`, boxShadow: "none" },
};

// `onClick` makes it a real control: pointer cursor + hover lift from
// .mrr-card-click, and keyboard activation, which none of the hand-built
// clickable cards had. `hover` gives the lift alone, for cards whose actions
// live on buttons inside them.
export function Card({
  variant = "outlined",
  pad = "md",
  onClick,
  hover,
  as: Tag = "div",
  className,
  style,
  children,
  ...rest
}) {
  const cls = ["mrr-card", onClick ? "mrr-card-click" : hover ? "mrr-card-hover" : null, className]
    .filter(Boolean)
    .join(" ");
  const interactive = onClick
    ? {
        role: "button",
        tabIndex: 0,
        onClick,
        onKeyDown: (e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(e);
          }
        },
      }
    : {};
  return (
    <Tag
      className={cls}
      style={{
        background: C.surface,
        borderRadius: "var(--radius-xl)",
        padding: CARD_PAD[pad] ?? pad,
        minWidth: 0,
        ...CARD_VARIANT[variant],
        ...style,
      }}
      {...interactive}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// Vertical flex with a gap — the single most repeated inline block in the app.
export function Stack({ gap = 5, align, as: Tag = "div", style, children, ...rest }) {
  return (
    <Tag
      style={{
        display: "flex",
        flexDirection: "column",
        gap: space(gap),
        alignItems: align,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// Horizontal flex, vertically centered by default. `wrap` for toolbars and
// chip rows that have to survive a phone-width screen.
export function Row({
  gap = 3,
  align = "center",
  justify,
  wrap,
  as: Tag = "div",
  style,
  children,
  ...rest
}) {
  return (
    <Tag
      style={{
        display: "flex",
        alignItems: align,
        justifyContent: justify,
        flexWrap: wrap ? "wrap" : undefined,
        gap: space(gap),
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// The small uppercase label over a group of fields or a stat. 11px / 800 /
// 0.5px letter-spacing / muted was the majority of the 64 hand-built copies.
export function Eyebrow({ color = C.sub, as: Tag = "div", style, children, ...rest }) {
  return (
    <Tag
      style={{
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-extrabold)",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// A heading for a section inside a view (PageHeader owns the view's h1). `md`
// is the card/section title; `lg` the larger heading a few settings panels use.
// `actions` pins controls to the right of the same row.
export function SectionTitle({
  icon: Icon,
  size = "md",
  actions,
  as: Tag = "h2",
  style,
  children,
}) {
  const heading = (
    <Tag
      style={{
        margin: 0,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        fontSize: size === "lg" ? "var(--text-lg)" : "var(--text-base)",
        fontWeight: "var(--weight-extrabold)",
        color: C.barnwood,
        ...(actions ? {} : style),
      }}
    >
      {Icon && <Icon size={size === "lg" ? 18 : 16} aria-hidden="true" />}
      {children}
    </Tag>
  );
  if (!actions) return heading;
  return (
    <Row justify="space-between" wrap style={style}>
      {heading}
      <Row gap={3} wrap>
        {actions}
      </Row>
    </Row>
  );
}

// Secondary text: timestamps, captions, helper lines under a value.
const MUTED_SIZE = { "2xs": "var(--text-2xs)", xs: "var(--text-xs)", sm: "var(--text-sm)" };
export function Muted({ size = "xs", as: Tag = "div", style, children, ...rest }) {
  return (
    <Tag style={{ fontSize: MUTED_SIZE[size], color: C.sub, margin: 0, ...style }} {...rest}>
      {children}
    </Tag>
  );
}

// A data table: the horizontal-scroll wrapper, .mrr-table's header styling,
// and default cell padding (.mrr-table-pad — opt-in, so the 25 existing tables
// that pad their own cells inline are unaffected). `stickyHead` pins the
// header; it needs `maxHeight` to have a scroll container to stick within.
// Children are the usual <thead>/<tbody>.
export function Table({ stickyHead, maxHeight, style, tableStyle, children }) {
  return (
    <div
      className="sw-table-scroll"
      style={{
        ...(maxHeight ? { maxHeight, overflowY: "auto" } : {}),
        ...style,
      }}
    >
      <table
        className={`mrr-table mrr-table-pad${stickyHead ? " mrr-table-sticky" : ""}`}
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "var(--text-sm)",
          ...tableStyle,
        }}
      >
        {children}
      </table>
    </div>
  );
}
