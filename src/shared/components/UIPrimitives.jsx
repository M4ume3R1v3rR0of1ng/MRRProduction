import { useRef } from "react";
import { Camera, X } from "lucide-react";
import { C } from "../utils/helpers";
import { ROLES } from "../database/permissions";
import { translations } from "../utils/translations";
import { compressImg } from "../utils/helpers";
import { useNotify } from "../context/NotificationContext";
import { HAS_NATIVE_CAMERA, capturePhoto } from "../utils/photoCapture";

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        padding: compact ? "var(--space-5) 0" : "var(--space-9) 0",
      }}
    >
      <Spinner size={compact ? 16 : 22} />
      <span
        style={{ fontSize: "var(--text-sm)", color: C.sub, fontWeight: "var(--weight-semibold)" }}
      >
        {label}
      </span>
    </div>
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
      <div
        style={{
          display: "flex",
          gap: "var(--space-6)",
          padding: "12px 14px",
          borderBottom: `1.5px solid ${C.line}`,
        }}
      >
        {cols.map((w, i) => (
          <Skeleton key={i} w={w} h={9} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          style={{
            display: "flex",
            gap: "var(--space-6)",
            padding: "14px",
            borderBottom: `1px solid ${C.line}`,
            alignItems: "center",
          }}
        >
          {cols.map((w, i) => (
            <Skeleton key={i} w={w} h={13} />
          ))}
        </div>
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
          <p style={{ margin: "2px 0 0", color: C.sub, fontSize: "var(--text-sm)" }}>{subtitle}</p>
        )}
      </div>
      {actions && (
        <div
          style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}
        >
          {actions}
        </div>
      )}
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
  icon: Icon,
  onClick,
  sub,
  variant = "icon",
  style,
}) {
  if (variant === "borderLeft") {
    return (
      <div
        onClick={onClick}
        className={onClick ? "mrr-card mrr-card-click" : "mrr-card"}
        style={{
          background: C.w,
          borderRadius: "var(--radius-xl)",
          padding: 14,
          borderLeft: `5px solid ${color}`,
          boxShadow: "var(--shadow-sm)",
          flex: 1,
          minWidth: 160,
          ...style,
        }}
      >
        <div style={{ fontSize: "var(--text-3xl)", fontWeight: "var(--weight-black)", color }}>
          {value}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 3 }}>{label}</div>
        {sub && (
          <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 4 }}>{sub}</div>
        )}
      </div>
    );
  }
  return (
    <div
      onClick={onClick}
      className={onClick ? "mrr-card mrr-card-click" : "mrr-card"}
      style={{
        background: C.w,
        borderRadius: "var(--radius-xl)",
        padding: 14,
        border: `1px solid ${C.bd}`,
        minWidth: 0,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
        {Icon && (
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "var(--radius-lg)",
              background: `color-mix(in srgb, ${color} 8%, transparent)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon size={18} color={color} aria-hidden="true" />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--text-2xl)",
              fontWeight: "var(--weight-extrabold)",
              color,
              lineHeight: 1.1,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {value}
          </div>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: C.sub,
              marginTop: 2,
              fontWeight: "var(--weight-semibold)",
            }}
          >
            {label}
          </div>
        </div>
      </div>
      {sub && <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 4 }}>{sub}</div>}
    </div>
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
        style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", ...messageStyle }}
      >
        {message}
      </span>
      {actions && (
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

// A status-filter toggle with a count badge — verbatim duplicated between
// Build Jobs and Pull Inventory before this. `count` of 0 hides the badge
// rather than showing "0", which would read as a dead filter worth clicking.
export function FilterPill({ label, count, active, onClick, title }) {
  return (
    <Btn v={active ? "primary" : "ghost"} sz="sm" onClick={onClick} aria-pressed={active} title={title}>
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

export function Modal({ title, onClose, children, wide, extraWide, disableCloseButton }) {
  return (
    <div
      className="mrr-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--c-backdrop)",
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
            borderBottom: "2px solid var(--brand-accent, var(--c-amber))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "sticky",
            top: 0,
            background: C.w,
            zIndex: 1,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "var(--text-lg)",
              fontWeight: "var(--weight-extrabold)",
              color: C.navy,
            }}
          >
            {title}
          </h2>
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
        <div style={{ padding: "var(--space-8)" }}>{children}</div>
      </div>
    </div>
  );
}

export function Fld({ label, children, hint }) {
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
    <div style={{ marginBottom: "var(--space-5)" }}>
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
        <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-xs)", color: C.sub }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Inp(p) {
  return (
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
        ...p.style,
      }}
    />
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

export function Btn({ children, v = "primary", sz = "md", ...p }) {
  // Every filled variant takes C.onAccent, not C.surface. They used to read C.w,
  // which was literally white and worked by accident; now that surface inverts to
  // near-black in dark mode, C.w on a filled button would be dark ink on a dark
  // fill. onAccent is the token that means "ink that sits on a saturated color".
  const vs = {
    primary: { background: C.leather, color: C.onAccent, border: "none" },
    gold: {
      background: "var(--brand-accent, var(--c-amber))",
      color: "var(--brand-accent-ink, var(--c-shell))",
      border: "none",
    },
    outline: { background: "transparent", color: C.leather, border: `2px solid ${C.leather}` },
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
  };
  return (
    <button
      {...p}
      className={`mrr-btn ${p.className || ""}`}
      style={{
        ...vs[v],
        ...ss[sz],
        borderRadius: "var(--radius-lg)",
        cursor: "pointer",
        fontWeight: "var(--weight-bold)",
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        ...p.style,
      }}
    >
      {children}
    </button>
  );
}

export function Bdg({ children, color = "blue" }) {
  const bg = {
    blue: "var(--c-leather-wash)",
    green: C.gB,
    red: C.rB,
    amber: C.aB,
    gold: C.gL,
    purple: C.pB,
    gray: "var(--c-subtle)",
    teal: C.tB,
    sky: C.sB,
  };
  const fg = {
    blue: C.blue,
    green: C.gr,
    red: C.rd,
    amber: C.am,
    gold: "var(--c-warn)",
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

export function RoleBdg({ role, lang = "en" }) {
  const r = ROLES[role] || { label: "Employee", color: "gray" };
  const t = translations[lang] || translations.en;
  const label = t[ROLE_LABEL_KEYS[role]] || r.label;
  return <Bdg color={r.color}>{label}</Bdg>;
}

export function Toggle({ on, onChange, disabled = false }) {
  return (
    <div
      onClick={!disabled ? onChange : undefined}
      style={{
        width: 38,
        height: 22,
        borderRadius: "var(--radius-pill)",
        background: disabled ? "var(--c-disabled)" : on ? C.pasture : "var(--c-disabled)",
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
          background: disabled ? "var(--c-disabled-ink)" : C.surface,
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
                color: "#fff",
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
          <span
            style={{
              fontSize: "var(--text-sm)",
              color: C.sub,
              fontWeight: "var(--weight-semibold)",
            }}
          >
            {label}
          </span>
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
