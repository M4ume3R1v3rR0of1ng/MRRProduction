import { supabase } from "./supabase";

// 1. Global UI Color Theme Utility
//
// Steadwerk — Direction 02, "The Raising": weathered barnwood + harvest amber.
//
// ⚠️ THE BRAND HAS NO RED. Destructive actions (delete, overdue) use a muted rust —
// still unmistakably "danger", without a color the brand doesn't own. Keep it that way.
//
// ── Why these are var() strings and not hex ──
// Every value here resolves to a CSS custom property defined in tokens.css, which
// has both a light and a dark set. Around 1,100 inline style objects across the
// views already read from this object, and inline styles cannot carry a media
// query — so pointing the values at variables is what makes the whole app
// themeable without editing those views at all. The browser resolves the var at
// paint time, so flipping data-theme on <html> reskins everything at once.
//
// The consequence: THESE ARE NOT HEX STRINGS. Never do string surgery on them.
// `${C.gold}14` used to make a translucent wash and now produces garbage CSS.
// Use color-mix(in srgb, ${C.gold} 8%, transparent) instead. If you need a real
// hex — a canvas, a PDF, a meta tag — import HEX below.
export const C = {
  // ── Semantic names. Prefer these in new code. ──
  barnwood: "var(--c-barnwood)", // the structural dark: sidebars, headings
  amber: "var(--c-amber)",       // the accent: CTAs, active states
  leather: "var(--c-leather)",   // the secondary accent
  ground: "var(--c-ground)",     // the app background
  surface: "var(--c-surface)",   // cards, modals, table backgrounds
  subtle: "var(--c-subtle)",     // light neutral: table stripes, wells
  line: "var(--c-line)",         // borders
  sub: "var(--c-sub)",           // muted secondary text
  pasture: "var(--c-pasture)",   // success / active
  rust: "var(--c-rust)",         // destructive. NOT red. See note above.
  warn: "var(--c-warn)",         // deep amber — warnings
  plum: "var(--c-plum)",
  teal: "var(--c-teal)",
  slate: "var(--c-slate)",

  // Chrome that stays dark in both themes: sidebar, mobile header, and the few
  // inverted strips inside views. Distinct from `barnwood`, which is the ink
  // token and therefore has to invert when the theme does.
  shell: "var(--c-shell)",
  shellInk: "var(--c-shell-ink)",
  // Text on a saturated fill (badges, role avatars, colored buttons).
  onAccent: "var(--c-on-accent)",

  // ── Back-compat aliases. ──
  // The original keys were literal color names that stopped being true when the
  // palette moved to "The Raising" (C.blue has been brown since that reskin).
  // They stay as aliases because a few hundred call sites use them; they are not
  // deprecated-with-a-deadline, just no longer the name to reach for first.
  navy: "var(--c-barnwood)",
  gold: "var(--c-amber)",
  blue: "var(--c-leather)",
  bg: "var(--c-ground)",
  w: "var(--c-surface)",
  lg: "var(--c-subtle)",
  bd: "var(--c-line)",
  gr: "var(--c-pasture)",
  rd: "var(--c-rust)",
  am: "var(--c-warn)",
  pu: "var(--c-plum)",
  tl: "var(--c-teal)",
  sl: "var(--c-slate)",

  // ── Tint backgrounds (badges, wells). ──
  gL: "var(--c-amber-wash)",
  gB: "var(--c-pasture-wash)",
  rB: "var(--c-rust-wash)",
  aB: "var(--c-warn-wash)",
  pB: "var(--c-plum-wash)",
  tB: "var(--c-teal-wash)",
  sB: "var(--c-slate-wash)",
};

// Literal light-mode hex, for the handful of consumers that cannot take a CSS
// variable: canvas, generated PDFs, and the <meta name="theme-color"> tag. Keep
// in sync with the :root block in tokens.css.
export const HEX = {
  barnwood: "#23282D",
  amber: "#C97B2D",
  leather: "#8A5A2B",
  ground: "#EDE6DA",
  surface: "#FFFFFF",
  homespun: "#EDE6DA",
};

// 2. Short Unique ID Generator String Macro
export const uid = () => Math.random().toString(36).slice(2, 10);

// ── Calendar days vs instants ──
//
// A "2026-05-01" in this app means a calendar day: the day a batch was received,
// a job is scheduled, a truck was detailed. It is not an instant in time.
//
// JavaScript disagrees, and inconsistently. Per ECMA-262:
//
//   new Date("2026-05-01")            -> UTC midnight
//   new Date("2026-05-01T00:00:00")   -> LOCAL midnight
//
// Date-only was aligned with ISO 8601; date-time was left local for web
// compatibility. So the bare form lands at UTC midnight, which is the PREVIOUS
// day everywhere west of Greenwich — a batch received May 1 rendered "Apr 30"
// for every US user.
//
// parseDay reads a calendar day as local midnight. Anything else (a full
// timestamp with a Z or an offset, a Date, a number) falls straight through
// untouched, so instants keep their real meaning.
const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const parseDay = (d) => {
  const m = typeof d === "string" && DAY_ONLY.exec(d);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
};

// A Date to "YYYY-MM-DD" using LOCAL components.
//
// The mirror of the bug above. Writing a day with
//   new Date().toISOString().split("T")[0]
// takes the UTC date, so at UTC-4 anything entered after 8pm local was stored as
// tomorrow. The two skews partially cancelled on display, which is why this went
// unnoticed — an evening entry was written +1 and rendered -1.
export const formatDay = (date) => {
  const dt = date instanceof Date ? date : new Date(date);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

// Today's calendar day where the user actually is.
export const todayLocal = () => formatDay(new Date());

// 3. Date Formatting Utility (e.g., "May 28, 2026")
export const fd = (d) =>
  d
    ? parseDay(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

// 4. Timestamp Formatting Utility (e.g., "May 28, 2026, 11:21 AM")
export const ft = (d) =>
  parseDay(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

// 5. Currency Display Converter (e.g., $1,250.00)
export const fm = (n) =>
  "$" + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// 6. Real-time Inventory Summation Loop
export function tot(item) {
  // Defensive null guard ensures it won't throw if item or item.batches is missing
  if (!item || !item.batches || !Array.isArray(item.batches)) return 0;

  return item.batches.reduce(
    (sum, batch) => sum + (parseFloat(batch.rem) || 0),
    0,
  );
}
// 7. Pricing Evaluator Array sorter
export function newestPrice(item) {
  if (
    !item ||
    !item.batches ||
    !Array.isArray(item.batches) ||
    item.batches.length === 0
  )
    return 0;

  // Create a copy to sort chronologically by received date to grab the newest entry
  const sorted = [...item.batches].sort(
    (a, b) => new Date(b.rcvd) - new Date(a.rcvd),
  );
  return parseFloat(sorted[0]?.price) || 0;
}
// 8. Odometer Status Evaluator Rules
export const oilSt = (v) => {
  if (v.type !== "truck") return null;
  const p = (v.mi - v.lomi) / v.oii;
  return p >= 1 ? "overdue" : p >= 0.8 ? "soon" : "ok";
};

// 9. Canvas Downsampler for Compressed Image Uploads
// onError is optional; without it decode failures only hit the console — the
// original silent-failure mode. Pass it so the user learns their photo didn't
// take (HEIC and other formats the browser can't decode are common on phones).
export function compressImg(file, maxDim, quality, cb, onError) {
  const fail = (msg) => {
    console.error("Image processing failed:", msg);
    onError?.(msg);
  };
  const reader = new FileReader();
  reader.onerror = () => fail("That file could not be read — try selecting the photo again.");
  reader.onload = (ev) => {
    const img = new Image();
    img.onerror = () =>
      fail("That photo format isn't supported here — try a different photo, or take a screenshot of it and upload that.");
    img.onload = () => {
      let w = img.width,
        h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      cb(c.toDataURL("image/jpeg", quality));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// 10. The Standard First-In-First-Out (FIFO) Inventory Depletion Logic
// Allows pulling past what's physically on hand — the remainder is tracked
// as a negative synthetic batch instead of blocking the pull.
//
// `meta` stamps that negative row with WHO pulled it and WHICH job. It used to be
// written as an anonymous `by: "system"` with no reference, so an item sitting at
// -1 was untraceable: the ledger showed "received by system" and the audit_logs
// entry naming the job was deleted after 30 days. The batch row outlives the purge,
// so the provenance has to live here.
export const doFifo = (item, qty, meta = {}) => {
  const s = [...item.batches].sort(
    (a, b) => new Date(a.rcvd) - new Date(b.rcvd),
  );
  let r = qty,
    c = 0;
  // Which batch supplied which units, at which price. This is the only record of it:
  // `cost` alone collapses to a blended average (10 @ $10 + 5 @ $15 becomes "15 @
  // $11.67", a price no batch ever had), and nothing else in the system knows where a
  // job's material came from. Without it, correcting a batch price can only GUESS
  // which jobs to recalculate by matching on that average.
  const consumed = [];
  const u = s.map((b) => {
    if (r <= 0 || b.rem <= 0) return b;
    const t = Math.min(r, b.rem);
    r -= t;
    c += t * b.price;
    consumed.push({ bid: b.id, rcvd: b.rcvd, qty: t, price: b.price });
    return { ...b, rem: b.rem - t };
  });

  if (r > 0) {
    const lastPrice = s.length > 0 ? s[s.length - 1].price : 0;
    c += r * lastPrice;
    const neg = {
      id: "neg_" + Math.random().toString(36).slice(2, 10),
      rcvd: todayLocal(),
      qty: -r,
      price: lastPrice,
      // Falls back to "system" only when the caller supplied nothing, which keeps
      // rows written before `meta` existed reading the same way they always did.
      by: meta.by || "system",
      byName: meta.byName || null,
      rem: -r,
      short: true,
      ...(meta.jobId ? { jobId: meta.jobId } : {}),
      ...(meta.ref ? { ref: meta.ref } : {}),
    };
    u.push(neg);
    // Recorded as consumed too — those units were issued to the job and billed at the
    // newest price. Flagged so a report can say they came from stock that wasn't there.
    consumed.push({ bid: neg.id, rcvd: neg.rcvd, qty: r, price: lastPrice, short: true });
  }

  return { batches: u, cost: c, shortfall: Math.max(0, r), consumed };
};

// Five different things live in `batches`, and only one of them is a supplier
// delivery. Anything reading the batch list has to classify before it judges, or it
// flags a return for having no PO and buries the receipts that genuinely lack one.
//
//   shortfall  — doFifo's synthetic negative row when a pull exceeded stock
//   adjustment — Adjust Stock's correction row
//   return     — pull screen re-entry (deterministic ret_ id, priced at the job's blend)
//   price-only — Edit Materials' qty:0 row, created to hold a price
//   receipt    — an actual delivery; the only kind that owes a PO/vendor
//
// The adjustment test is a prefix, not equality: AdjustStockModal appends the typed
// reason ("Manual Adjustment — damaged in yard"), so an exact match silently missed
// every correction anyone bothered to explain and re-labelled it a receipt with a
// missing invoice.
export const batchKind = (b) => {
  if (!b) return "receipt";
  if (b.short || b.by === "system") return "shortfall";
  if (String(b.ref || "").startsWith("Manual Adjustment")) return "adjustment";
  if (!String(b.id || "").startsWith("b_")) return "return";
  return (parseFloat(b.qty) || 0) === 0 ? "price-only" : "receipt";
};

// Re-derive a pulled job line's cost with ONE batch repriced — what a batch price
// correction has to do to every job that took material from that batch.
//
// With a `consumed` split this is exact even for a pull that spanned several batches:
// only the units from batchId move, and the rest keep the price they were actually
// bought at. Without one (rows written before doFifo recorded the split) there is no
// breakdown to work from, so the caller must have already established that the whole
// line came from this batch — see jobsUsingBatch in InventoryView.
export const recostLine = (line, batchId, newPrice) => {
  const pulled = parseFloat(line?.pulled) || 0;
  const split = Array.isArray(line?.consumed) && line.consumed.length > 0 ? line.consumed : null;
  if (!split) {
    return { priceAtPull: newPrice, pullCost: pulled * newPrice };
  }
  const consumed = split.map((c) => (c.bid === batchId ? { ...c, price: newPrice } : c));
  const cost = consumed.reduce(
    (s, c) => s + (parseFloat(c.qty) || 0) * (parseFloat(c.price) || 0),
    0,
  );
  return { consumed, pullCost: cost, priceAtPull: pulled > 0 ? cost / pulled : 0 };
};

// Carry live pull-tracking fields over an edited job item list, so a stale
// editor (open since before a crew pulled materials) can't erase what was
// actually pulled/returned. The editor wins on planning fields; the recorded
// pull history survives.
export const mergePullTracking = (editedItems, liveItems) => {
  const liveById = new Map(
    (liveItems || []).filter(Boolean).map((i) => [i.iid, i]),
  );
  return (editedItems || []).map((item) => {
    if (!item) return item;
    const live = liveById.get(item.iid);
    if (!live) return item;
    const keep = {};
    // `consumed` is pull history like the rest — an editor that drops it would erase
    // the only record of which batches the job's material came from.
    ["pulled", "priceAtPull", "pullCost", "returned", "consumed"].forEach((k) => {
      if (live[k] !== undefined) keep[k] = live[k];
    });
    return { ...item, ...keep };
  });
};

// Returning unused material posts it back to stock as a new batch. The id is
// derived from the job and the item instead of uid(), because this particular
// write gets retried by hand.
//
// The crew completes a job from a truck. The commit reaches the database and the
// response is lost on the way back, so the browser reports "TypeError: Failed to
// fetch" and the button re-enables. They press it again — there is nothing else
// to do. With a random id the second attempt reads the live batches (which now
// already contain the first return), appends a SECOND one, and the warehouse
// gains stock that never physically came back. Nobody finds out: the count is
// higher, not lower, so nothing runs short.
//
// A deterministic id makes the retry recognisable, which is what makes it safe.
export const returnBatchId = (jobId, iid) => `ret_${jobId}_${iid}`;

// Idempotent by design: if the return already landed, the live batches come back
// untouched. Deliberately does NOT re-apply with a fresh `rem` — stock that was
// pulled again between the two attempts must not be resurrected by a retry.
export const applyReturnBatch = (batches, { jobId, iid, qty, price, by, byName = null, rcvd }) => {
  const live = batches || [];
  const id = returnBatchId(jobId, iid);
  if (live.some((b) => b && b.id === id)) return live;
  // byName alongside by, for the same reason doFifo stamps its shortfall row: the
  // id stops resolving the day that person is removed from the company.
  return [...live, { id, rcvd, qty, price: price || 0, by, byName, rem: qty }];
};

// 11. Additional helper functions can be added here as needed for future features or utilities.
export const predDays = (v) => {
  if (v.type !== "truck" || !v.mil || v.mil.length < 2) return null;
  const l = [...v.mil].sort((a, b) => new Date(a.dt) - new Date(b.dt));
  const sp = (new Date(l[l.length - 1].dt) - new Date(l[0].dt)) / 86400000;
  if (sp < 1) return null;
  const d = (l[l.length - 1].mi - l[0].mi) / sp;
  if (d <= 0) return null;
  const lf = v.oii - (v.mi - v.lomi);
  return lf <= 0 ? 0 : Math.round(lf / d);
};

export const displayName = (user) =>
  (user?.name || user?.full_name || "").split(" ")[0] || "User";

// The status line at the top of a job card: a dot, a colour, and a label.
//
// Build Jobs and Pull Inventory list the same jobs, so a job that reads
// "🟡 APPROVED" on one screen has to read the same on the other. This used to be
// a private function in Build Jobs while Pull Inventory drew a jSC badge, and the
// two disagreed on both wording and shape for the same row.
//
// jSC (App.jsx) is still the source for badges inside modals and calendars, where
// the pill shape is wanted. This is the card-header treatment only.
export const jobStatusMeta = (status) => {
  switch (String(status || "").toLowerCase()) {
    case "completed":
    case "closed":
      return { dot: "🟢", color: C.gr, label: "Completed" };
    case "active":
      return { dot: "🟡", color: C.am, label: "In Progress" };
    case "approved":
      return { dot: "🟡", color: C.blue, label: "Approved" };
    case "draft":
    default:
      return { dot: "🔴", color: C.rd, label: "Delayed / Draft" };
  }
};

export const detSt = (v) => {
  if (!v.ldd) return "overdue";
  // parseDay, not new Date: this subtracts a stored calendar day from the local
  // clock. Parsing ldd as UTC midnight mixed reference frames and made the
  // interval read up to a full timezone offset long, so "detail due" tripped
  // early. The elapsed-days comparison below is only meaningful if both sides
  // are in the same frame.
  const d = (new Date() - parseDay(v.ldd)) / 86400000;
  return d >= v.dii ? "overdue" : d >= v.dii * 0.8 ? "soon" : "ok";
};

// SMS alerting was removed here on 2026-08-06. canReceiveSMS and dispatchSMSAlert
// lived at this spot and were never called from anywhere in the app; the Supabase
// Edge Function they targeted ("send-sms") does not exist in this repo either.
// Meanwhile Profile offered a "text me alerts" checkbox, so the app collected a
// phone number and an explicit consent for a channel that could not deliver.
//
// Rebuilding it is not a matter of restoring these two functions: business SMS in
// the US requires A2P 10DLC brand and campaign registration before the first
// message will send. Do that first, then the edge function, then the toggle.
// profiles.phone_number is still collected and still used by OmniSearch.

export function mkJI(iid, name, cat, unit, plannedQty = 1) {
  return {
    iid: iid,
    iname: name,
    icat: cat,
    unit: unit,
    planned: parseFloat(plannedQty) || 0,
    pulled: 0, // Stamped as zero until field user initiates a pull
    returned: 0, // Populated when completing site logistics teardown
    priceAtPull: 0, // Populated dynamically via FIFO calculations upon load execution
    pullCost: 0, // Populated dynamically via FIFO calculations upon load execution
  };
}

