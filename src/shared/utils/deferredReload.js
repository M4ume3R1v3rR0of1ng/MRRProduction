// src/shared/utils/deferredReload.js
//
// Hold a new deploy's reload until it won't cost anyone their work.
//
// ── Why this exists ──
//
// vite-plugin-pwa runs in autoUpdate mode, and its register client reloads the tab
// the instant a new service worker activates:
//
//   wb.addEventListener("activated", (event) => {
//     if (event.isUpdate || event.isExternal) {
//       if (onNeedReload) onNeedReload(); else window.location.reload();
//     }
//   });
//
// Every push to main triggers a build, so that reload can land at any moment — including
// while a warehouse user is half-way through typing a pull quantity, a chat message or a
// job edit. window.location.reload() discards all of it with no warning and no way to get
// it back. Supplying onNeedReload takes ownership of the moment instead of the fact.
//
// ── Why it cannot simply wait forever ──
//
// Once the new worker has activated it is already serving assets, and
// `cleanupOutdatedCaches: true` (vite.config.js) has deleted the previous build's
// precache. Every view in this app is lazy (see the `lazy(...)` calls in App.jsx), so a
// route the user opens AFTER activation fetches a chunk whose hash no longer exists on
// the server either — a "Failed to fetch dynamically imported module" crash. The longer
// the old page runs, the more likely someone walks into that.
//
// So waiting is bounded, and the two blockers are deliberately not equal:
//
//   typing   blocks forever. Yanking the keyboard out from under someone mid-entry is
//            the exact harm this module exists to prevent, so no timeout overrides it.
//   dialog   blocks only until URGENT_AFTER_MS. An open modal is a normal resting state
//            in this app (a job drawer can sit open all afternoon), so treating it as an
//            absolute blocker would mean never reloading at all.
//
// A hidden tab is deliberately NOT treated as a free moment. The obvious thought is that
// nobody is looking so the reload is free — but "typed half a message, switched tabs" is
// a common way to arrive at hidden, and reloading there loses exactly what this is meant
// to protect. The poll picks the tab up when it is genuinely idle regardless of whether
// it is visible.

// Focus in one of these means characters are being entered that a reload would discard.
// Checkboxes, radios and buttons are excluded on purpose: they hold no typed text, so
// reloading past a focused checkbox costs nothing.
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

// An <input> with no type attribute is a text input — the default. Reading the IDL
// property rather than getAttribute already normalises that, but tests build plain
// objects, so the empty case is handled here too.
const isTextInput = (el) => {
  const tag = String(el?.tagName || "").toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "select") return true;
  if (tag !== "input") return false;
  const type = String(el.type || "text").toLowerCase();
  return TEXT_INPUT_TYPES.has(type);
};

export const isTyping = (doc) => {
  const el = doc?.activeElement;
  if (!el) return false;
  // contentEditable is a string ("true"/"false"/"inherit"), not a boolean.
  if (String(el.isContentEditable) === "true" || el.isContentEditable === true) return true;
  return isTextInput(el);
};

// Every dialog in the app carries this class: the Modal primitive
// (UIPrimitives.jsx), the confirm dialog (NotificationContext.jsx) and the job
// hand-off sheet (JobHandoff.jsx). One selector covers all three, so a new dialog
// built from the primitive is counted without anything being registered here.
export const isDialogOpen = (doc) => Boolean(doc?.querySelector?.(".mrr-modal"));

// Why a reload cannot happen right now, or null when it can. `urgent` relaxes the
// dialog blocker only — never the typing one.
export const reloadBlocker = (doc, { urgent = false } = {}) => {
  if (isTyping(doc)) return "typing";
  if (!urgent && isDialogOpen(doc)) return "dialog";
  return null;
};

// How often to look for a gap. Short enough that the reload follows closely behind
// the moment someone stops, long enough not to reload the instant they tab out of a
// field on their way back to it.
export const POLL_MS = 15_000;
// After this long held back, an open dialog stops counting. Long enough that it
// effectively never fires during real work, short enough that a tab left open with a
// modal up does not run yesterday's bundle indefinitely.
export const URGENT_AFTER_MS = 30 * 60_000;

// Reloads as soon as the page is idle. Returns a cancel function.
//
// Everything it touches is injected so the whole thing is testable with plain objects
// and fake timers — see deferredReload.test.js.
export function reloadWhenIdle({
  doc = typeof document === "undefined" ? null : document,
  reload,
  pollMs = POLL_MS,
  urgentAfterMs = URGENT_AFTER_MS,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onDefer,
} = {}) {
  const doReload = reload || (() => typeof window !== "undefined" && window.location.reload());
  const startedAt = now();
  let timer = null;
  let finished = false;

  const cancel = () => {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  };

  const attempt = () => {
    if (finished) return true;
    const urgent = now() - startedAt >= urgentAfterMs;
    const blocker = reloadBlocker(doc, { urgent });
    if (blocker) {
      onDefer?.(blocker);
      return false;
    }
    finished = true;
    cancel();
    doReload();
    return true;
  };

  // Try straight away: most of the time nobody is mid-entry and the update lands as
  // promptly as it did before this module existed.
  if (!attempt()) timer = setIntervalFn(attempt, pollMs);

  return cancel;
}
