// src/components/SteadwerkMark.jsx
//
// Direction 02 — "The Raising".
//
// The mark is the W of *werk* drawn as a barn truss, set in a squared badge — the
// datestone a mason sets into a finished barn to mark the year and the family name.
//
// Two pieces on purpose:
//   <TrussMark />      the bare truss. Survives at favicon size, where a badge fills in.
//   <SteadwerkMark />  truss + badge. For the login screen, sidebar, PDF headers, decals.
//
// This is PLATFORM branding — Steadwerk, the thing you own and sell. It is deliberately
// separate from a tenant's own logo (companies.branding.logo), which is what a customer
// sees inside their portal. Never render this in place of theirs.

export const BRAND = {
  barnwood: "#23282D",       // primary dark — structure
  amber: "#C97B2D",          // primary accent — lantern glow, wheat at cutting
  amberDeep: "#A8641F",      // the amber, darkened for text on light backgrounds
  leather: "#8A5A2B",        // harness leather — secondary
  pasture: "#4A7A5C",        // pasture green — success, "active"
  homespun: "#EDE6DA",       // the light ground
  plowshare: "#6E7780",      // muted grey — secondary text
  rust: "#A34E28",           // destructive. NOT red — the brand has no red in it.
};

export const TAGLINE = "EVERY JOB. EVERY TRUCK.";
export const TAGLINE_ALT = "WORK RUNS STEADY.";

// The bare truss — a barn frame, pegged, no nails. Reads at 16px.
export function TrussMark({ color = BRAND.amber, size = 40 }) {
  return (
    <svg width={size} height={size * 0.77} viewBox="0 0 40 40" aria-hidden="true">
      <path
        d="M4 8 L12 32 L20 12 L28 32 L36 8"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

// Truss in a datestone badge. `filled` gives the solid-dark badge used on light grounds.
export function SteadwerkMark({ size = 64, filled = false }) {
  const stroke = filled ? BRAND.barnwood : BRAND.amber;
  const fill = filled ? BRAND.barnwood : "none";
  const truss = BRAND.amber;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Steadwerk">
      <rect x="4" y="4" width="56" height="56" rx="10" fill={fill} stroke={stroke} strokeWidth="3" />
      <path
        d="M14 20 L22 44 L32 24 L42 44 L50 20"
        fill="none"
        stroke={truss}
        strokeWidth="5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

// The full lockup: badge + wordmark + tagline. `onDark` flips it for the barnwood ground.
export function SteadwerkLockup({ onDark = false, size = 64, showTagline = true }) {
  const word = onDark ? BRAND.homespun : BRAND.barnwood;
  const tag = onDark ? BRAND.amber : BRAND.amberDeep;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
      <SteadwerkMark size={size} filled={!onDark} />
      <div style={{ textAlign: "left" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 900,
            fontSize: size * 0.42,
            letterSpacing: 1.5,
            color: word,
            lineHeight: 1.1,
          }}
        >
          STEADWERK
        </div>
        {showTagline && (
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: Math.max(8, size * 0.14),
              letterSpacing: 2.5,
              fontWeight: 700,
              color: tag,
              marginTop: 3,
            }}
          >
            {TAGLINE}
          </div>
        )}
      </div>
    </div>
  );
}

export default SteadwerkMark;
