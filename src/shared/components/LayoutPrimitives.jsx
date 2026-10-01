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
// 0 means no gap (there is no --space-0), for a Row that only wants the flex.
const space = (g) => (g === 0 ? 0 : typeof g === "number" ? `var(--space-${g})` : g);

// Named steps for the common cases; a number is a single --space-* step all
// round (pad={8} = 20px), same as Stack/Row gap.
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

// What makes a non-button surface a real control: focusable, announced as a
// button, and activated by Enter/Space — but not when the key press belongs to
// a field or button nested inside it.
//
// `containsActions` is for a surface that holds its own buttons (a job card
// with Approve/Delete on it). A role="button" can't contain buttons — ARIA
// makes a button's children presentational, so screen readers would lose the
// nested actions entirely — so that surface stays a plain clickable region and
// keyboard users reach things through the buttons inside it.
function clickable(onClick, containsActions) {
  if (!onClick) return {};
  if (containsActions) return { onClick };
  return {
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
  };
}

// `onClick` makes it a real control: pointer cursor + hover lift from
// .mrr-card-click, and keyboard activation, which none of the hand-built
// clickable cards had. `hover` gives the lift alone, for cards whose actions
// live on buttons inside them.
export function Card({
  variant = "outlined",
  pad = "md",
  onClick,
  containsActions,
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
  // A Card rendered as a real <button> already has the semantics and keyboard
  // activation; adding them again would fire onClick twice on Enter.
  const native = Tag === "button" || Tag === "a";
  return (
    <Tag
      className={cls}
      style={{
        background: C.surface,
        borderRadius: "var(--radius-xl)",
        padding: CARD_PAD[pad] ?? space(pad),
        minWidth: 0,
        ...CARD_VARIANT[variant],
        ...style,
      }}
      {...clickable(onClick, containsActions || native)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// A tinted box: the inline notice, the warning above a form, the sunken well a
// list of small rows sits in. ~110 of these were hand-built, each picking its
// own wash, border weight and padding. `tone` picks the wash (and the border
// color when `bordered`); text color is left to inherit unless `color` is set,
// because the copies split about evenly between body ink and tone-colored text.
// `icon` lays a leading icon beside the content, top-aligned so it stays with
// the first line when the message wraps. `onClick` turns it into a banner or
// list row you can activate, with the same keyboard handling as Card.
const CALLOUT_TONE = {
  neutral: { bg: C.subtle, line: C.line },
  warn: { bg: C.aB, line: C.warn },
  danger: { bg: C.rB, line: C.rust },
  success: { bg: C.gB, line: C.pasture },
  info: { bg: C.sB, line: C.slate },
  teal: { bg: C.tB, line: C.teal },
  plum: { bg: C.pB, line: C.plum },
  gold: { bg: C.gL, line: C.amber },
};
const CALLOUT_PAD = {
  sm: "var(--space-3) var(--space-5)",
  md: "var(--space-4) var(--space-6)",
};
export function Callout({
  tone = "neutral",
  bordered,
  icon: Icon,
  color,
  size,
  weight,
  pad = "md",
  onClick,
  containsActions,
  as: Tag = "div",
  style,
  children,
  ...rest
}) {
  const t = CALLOUT_TONE[tone];
  return (
    <Tag
      style={{
        background: t.bg,
        // Neutral wells were drawn with a hairline, tinted notices with a
        // heavier tone-colored edge; keeping both weights keeps both reads.
        border: bordered ? `${tone === "neutral" ? 1 : 1.5}px solid ${t.line}` : undefined,
        borderRadius: "var(--radius-md)",
        padding: CALLOUT_PAD[pad] ?? space(pad),
        color,
        fontSize: size && `var(--text-${size})`,
        fontWeight: weight && `var(--weight-${weight})`,
        ...(Icon ? { display: "flex", alignItems: "flex-start", gap: "var(--space-2)" } : {}),
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
      {...clickable(onClick, containsActions)}
      {...rest}
    >
      {Icon ? (
        <>
          <Icon size={14} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
          <Text style={{ minWidth: 0 }}>{children}</Text>
        </>
      ) : (
        children
      )}
    </Tag>
  );
}

// The tinted square an icon sits in beside a stat or an action title. The
// tint is the icon's own color at a low mix, so it themes with whatever color
// the caller passes rather than needing a matching wash token.
export function IconSwatch({ icon: Icon, color, size = 34, iconSize = 18, tint = 8 }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-lg)",
        background: `color-mix(in srgb, ${color} ${tint}%, transparent)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {Icon && <Icon size={iconSize} color={color} aria-hidden="true" />}
    </span>
  );
}

// One pickable row in a list of results (a search hit, a lookup match). The
// hover/focus wash lives in CSS (.mrr-pick-row) — three screens did it with
// onMouseEnter/onMouseLeave rewriting style.background, which never showed for
// keyboard focus and left the row stuck highlighted if the list re-rendered
// under the pointer.
export function PickRow({ onClick, style, children, ...rest }) {
  return (
    <div
      className="mrr-pick-row"
      style={{
        padding: "10px 14px",
        cursor: "pointer",
        borderBottom: `1px solid ${C.subtle}`,
        ...style,
      }}
      {...clickable(onClick)}
      {...rest}
    >
      {children}
    </div>
  );
}

// A horizontal rule between two parts of one surface. `space` is the --space-*
// step above and below it.
export function Divider({ dashed, space: s = 3, style }) {
  return (
    <hr
      style={{
        border: 0,
        borderTop: `1px ${dashed ? "dashed" : "solid"} ${C.line}`,
        margin: `${space(s)} 0`,
        ...style,
      }}
    />
  );
}

// A horizontal magnitude bar: a track and a fill at `value` (0-1) of it.
// Rounded at the data end, square at the baseline it grows from, and a nonzero
// value keeps a 3px stub so a small amount never reads as nothing.
export function Meter({ value, color, track = C.subtle, height = 6, style }) {
  const pct = Math.min(1, Math.max(0, value || 0));
  return (
    <div style={{ height, background: track, borderRadius: 2, ...style }}>
      <div
        style={{
          width: `${(pct * 100).toFixed(1)}%`,
          minWidth: pct > 0 ? 3 : 0,
          height: "100%",
          background: color,
          borderRadius: "2px 4px 4px 2px",
        }}
      />
    </div>
  );
}

// The responsive column grid (.sw-grid-2/3/4: columns step down at the tablet
// and phone breakpoints) with its gap on the spacing scale. Before this, each
// call site paired the class with an inline style just to change the gap.
export function Grid({ cols = 2, gap = 6, as: Tag = "div", style, children, ...rest }) {
  return (
    <Tag className={`sw-grid-${cols}`} style={{ gap: space(gap), ...style }} {...rest}>
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
// chip rows that have to survive a phone-width screen. `inline` for an icon +
// label pair that sits in a line of text or inside a badge.
export function Row({
  gap = 3,
  align = "center",
  justify,
  wrap,
  inline,
  as: Tag = "div",
  style,
  children,
  ...rest
}) {
  return (
    <Tag
      style={{
        display: inline ? "inline-flex" : "flex",
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

// Any other run of styled text: a value, a name, a bold inline label. Size and
// weight take the token name ("sm", "bold") so a call site can't wander off the
// scale; anything left unset inherits, exactly like a bare <span>. Unlike Muted
// it leaves margins alone, so <Text as="p"> keeps a paragraph's spacing.
// `font` picks a --font-* family: "display" for headline figures, "mono" for
// slugs, ids and amounts that should read as exact. `truncate` holds the text
// to one line with an ellipsis — the three-property combo every narrow card
// column spelled out by hand (it also needs minWidth: 0 on a flex parent).
const TRUNCATE = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
export function Text({
  size,
  weight,
  color,
  font,
  truncate,
  as: Tag = "div",
  style,
  children,
  ...rest
}) {
  return (
    <Tag
      style={{
        ...(truncate ? TRUNCATE : {}),
        fontFamily: font && `var(--font-${font})`,
        fontSize: size && `var(--text-${size})`,
        fontWeight: weight && (weight === "normal" ? "normal" : `var(--weight-${weight})`),
        color,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// A data table: the horizontal-scroll wrapper, .mrr-table's header styling,
// and cell padding. `pad` sets the padding of every header and body cell at
// once — before this, each <td> carried its own copy ("7px 10px", "8px 10px",
// "9px 10px"...) and headers padded differently from the cells under them, so
// columns didn't line up. pad="none" leaves cells to pad themselves.
// `size` is the --text-* step for the table body. `stickyHead` pins the header;
// it needs `maxHeight` to have a scroll container to stick within. Children are
// the usual <thead>/<tbody>. Body rows get a hairline divider unless
// ruled={false}; a per-<tr> border was the other thing every table hand-rolled.
const CELL_PAD = {
  sm: "var(--space-2) var(--space-4)",
  md: "var(--space-3) var(--space-4)",
  lg: "var(--space-4) var(--space-5)",
  xl: "var(--space-5) var(--space-6)",
};
export function Table({
  pad = "md",
  size = "sm",
  minWidth,
  ruled = true,
  stickyHead,
  maxHeight,
  style,
  tableStyle,
  children,
}) {
  const cls = [
    "mrr-table",
    pad !== "none" && "mrr-table-pad",
    ruled && "mrr-table-ruled",
    stickyHead && "mrr-table-sticky",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className="sw-table-scroll"
      style={{
        ...(maxHeight ? { maxHeight, overflowY: "auto" } : {}),
        ...style,
      }}
    >
      <table
        className={cls}
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: `var(--text-${size})`,
          minWidth,
          "--cell-pad": CELL_PAD[pad],
          ...tableStyle,
        }}
      >
        {children}
      </table>
    </div>
  );
}
