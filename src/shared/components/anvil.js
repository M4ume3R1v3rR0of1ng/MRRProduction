// src/shared/components/anvil.js
//
// ANVIL's name, and the one way anything in the app asks it a question.
//
// WHY AN EVENT AND NOT A CONTEXT OR A PROP
//
// ChatWidget owns the conversation — the history, the in-flight request, the
// pending confirmation. The places that now want to hand it a question (the
// dashboard card, OmniSearch, a view's own "ask about this" affordance) are
// nowhere near it in the tree: the widget is mounted once at the root of
// App.jsx, beside the router, while the callers are inside routed views.
//
// Lifting the conversation into a context provider to connect them would make
// every view that reads that context re-render on each streamed reply, for the
// sake of one fire-and-forget call. A window event is the same mechanism the
// audit logger already uses to reach the toast system (see
// src/shared/utils/logger.js's reportAuditFailure) and costs nothing when
// nobody is listening.
//
// It is deliberately one-way. Callers ask; they get no reply and no promise
// that the widget was mounted to hear it. Anything that needs an answer should
// be reading the data itself, not asking an assistant for it.

export const ANVIL_NAME = "ANVIL";

// Expanded on first sight in the widget header, because an acronym nobody can
// unpack is just noise on a button.
export const ANVIL_EXPANSION = "Assistant for Navigating Vehicles, Inventory & Labor";

const ASK_EVENT = "steadwerk-anvil-ask";

/**
 * Opens ANVIL and asks it something.
 *
 * @param {string} question The question, as the user would have typed it.
 * @param {object} [context] What the caller had on screen: { view, record }.
 */
export function askAnvil(question, context = null) {
  const text = String(question || "").trim();
  if (!text || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { question: text, context } }));
}

/**
 * Subscribes to those asks. Returns an unsubscribe function, so it drops
 * straight out of a useEffect.
 */
export function onAnvilAsk(handler) {
  if (typeof window === "undefined") return () => {};
  const listener = (e) => handler(e.detail?.question, e.detail?.context);
  window.addEventListener(ASK_EVENT, listener);
  return () => window.removeEventListener(ASK_EVENT, listener);
}
