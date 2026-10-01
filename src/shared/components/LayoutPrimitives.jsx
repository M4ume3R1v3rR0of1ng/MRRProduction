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
        padding: CARD_PAD[pad] ?? space(pad),
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

// A tinted box: the inline notice, the warning above a form, the sunken well a
// list of small rows sits in. ~110 of these were hand-built, each picking its
// own wash, border weight and padding. `tone` picks the wash (and the border
// color when `bordered`); text color is left to inherit unless `color` is set,
// because the copies split about evenly between body ink and tone-colored text.
// `icon` lays a leading icon beside the content, top-aligned so it stays with
// the first line when the message wraps.
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
        border: bordered ? `1.5px solid ${t.line}` : undefined,
        borderRadius: "var(--radius-md)",
        padding: CALLOUT_PAD[pad] ?? space(pad),
        color,
        fontSize: size && `var(--text-${size})`,
        fontWeight: weight && `var(--weight-${weight})`,
        ...(Icon ? { display: "flex", alignItems: "flex-start", gap: "var(--space-2)" } : {}),
        ...style,
      }}
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

// Any other run of styled text: a value, a name, a bold inline label. Size and
// weight take the token name ("sm", "bold") so a call site can't wander off the
// scale; anything left unset inherits, exactly like a bare <span>. Unlike Muted
// it leaves margins alone, so <Text as="p"> keeps a paragraph's spacing.
// `font` picks a --font-* family: "display" for headline figures, "mono" for
// slugs, ids and amounts that should read as exact.
export function Text({ size, weight, color, font, as: Tag = "div", style, children, ...rest }) {
  return (
    <Tag
      style={{
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
