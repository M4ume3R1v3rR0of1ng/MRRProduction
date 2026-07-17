import { supabase } from "./supabase";

// 1. Global UI Color Theme Utility
//
// Steadwerk — Direction 02, "The Raising": weathered barnwood + harvest amber.
//
// The KEYS are unchanged on purpose. Every view already references C.navy / C.gold /
// C.blue, so remapping the values here reskins the whole app without editing twenty
// files. The names are now historical (C.blue is no longer blue) — they read as slots
// in the palette, not as literal colors:
//
//   navy → the structural dark        gold → the accent
//   blue → the secondary accent       sub  → muted secondary text
//
// ⚠️ THE BRAND HAS NO RED. Destructive actions (delete, overdue) use a muted rust —
// still unmistakably "danger", without a color the brand doesn't own. Keep it that way.
export const C = {
  blue: "#8A5A2B", // Harness Leather — secondary accent (was blue)
  navy: "#23282D", // Barnwood — primary dark, sidebars, headings
  gold: "#C97B2D", // Harvest Amber — primary accent, CTAs
  gL: "#FAF3E9",   // amber wash
  w: "#fff",
  bg: "#EDE6DA",   // Homespun — the app ground
  lg: "#F4F0E7",   // light neutral, table stripes
  bd: "#DCD3C4",   // borders, warmed to match the ground
  sub: "#6E7780",  // Plowshare — secondary text
  gr: "#4A7A5C",   // Pasture Green — success / active
  gB: "#E2EDE6",
  rd: "#A34E28",   // muted rust — destructive. NOT red. See note above.
  rB: "#F7E4DA",
  am: "#A8641F",   // deep amber — warnings on light ground
  aB: "#F7EBDA",
  pu: "#5C5470",   // muted plum-grey (bright purple would fight the palette)
  pB: "#E9E6EE",
  tl: "#3E6B6B",   // muted teal
  tB: "#DDE9E9",
  sl: "#4A6178",   // slate
  sB: "#E4EAF0",
};

// 2. Short Unique ID Generator String Macro
export const uid = () => Math.random().toString(36).slice(2, 10);

// 3. Date Formatting Utility (e.g., "May 28, 2026")
export const fd = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

// 4. Timestamp Formatting Utility (e.g., "May 28, 2026, 11:21 AM")
export const ft = (d) =>
  new Date(d).toLocaleString("en-US", {
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
export const doFifo = (item, qty) => {
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
      rcvd: new Date().toISOString().split("T")[0],
      qty: -r,
      price: lastPrice,
      by: "system",
      rem: -r,
      short: true,
    };
    u.push(neg);
    // Recorded as consumed too — those units were issued to the job and billed at the
    // newest price. Flagged so a report can say they came from stock that wasn't there.
    consumed.push({ bid: neg.id, rcvd: neg.rcvd, qty: r, price: lastPrice, short: true });
  }

  return { batches: u, cost: c, shortfall: Math.max(0, r), consumed };
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

export const detSt = (v) => {
  if (!v.ldd) return "overdue";
  const d = (new Date() - new Date(v.ldd)) / 86400000;
  return d >= v.dii ? "overdue" : d >= v.dii * 0.8 ? "soon" : "ok";
};

export const canReceiveSMS = (userProfile) => {
  return (
    userProfile &&
    userProfile.receive_sms_alerts &&
    userProfile.phone_number &&
    userProfile.phone_number.trim().length >= 10
  );
};
/**
 * Dispatches an SMS alert payload over the secure Supabase Edge Function gateway.
 * @param {string} phone - Target recipient cell number.
 * @param {string} textMsg - Text notification body copy.
 */
export const dispatchSMSAlert = async (phone, textMsg) => {
  if (!phone || !textMsg) return;

  // Normalize phone formatting to strict E.164 compliance string
  let cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length === 10) {
    cleanPhone = `+1${cleanPhone}`; // Enforces standard US country routing prefix
  } else if (!cleanPhone.startsWith("+")) {
    cleanPhone = `+${cleanPhone}`;
  }

  try {
    const { data, error } = await supabase.functions.invoke("send-sms", {
      body: { to: cleanPhone, message: textMsg },
    });

    if (error) {
      console.error("SMS Gateway Relay Error:", error.message);
    } else {
      console.log("SMS notification packet dispatched cleanly:", data);
    }
  } catch (err) {
    console.error("Failed to connect to SMS Edge Function:", err);
  }
};
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

