// src/shared/utils/deferredReload.test.js
//
// The thing being protected here is unsaved typing, and the failure mode is silent:
// a reload that lands mid-entry just looks to the user like the app threw their work
// away. So the two blockers are asserted directly, including the asymmetry between
// them — typing is absolute, an open dialog is not.
import { describe, it, expect, vi } from "vitest";
import {
  isTyping,
  isDialogOpen,
  reloadBlocker,
  reloadWhenIdle,
  URGENT_AFTER_MS,
} from "./deferredReload";

// A stand-in for `document`: activeElement plus the one querySelector the dialog
// check makes. Plain objects rather than jsdom, so this suite stays in the node
// environment with the rest of the pure logic.
const fakeDoc = ({ active = null, dialog = false } = {}) => ({
  activeElement: active,
  querySelector: (sel) => (sel === ".mrr-modal" && dialog ? {} : null),
});

const el = (tagName, extra = {}) => ({ tagName, ...extra });

describe("isTyping", () => {
  it("is true for the fields someone enters text into", () => {
    expect(isTyping(fakeDoc({ active: el("INPUT", { type: "text" }) }))).toBe(true);
    expect(isTyping(fakeDoc({ active: el("INPUT", { type: "number" }) }))).toBe(true);
    expect(isTyping(fakeDoc({ active: el("TEXTAREA") }))).toBe(true);
    expect(isTyping(fakeDoc({ active: el("SELECT") }))).toBe(true);
  });

  it("treats a typeless input as text, which is what the browser does", () => {
    expect(isTyping(fakeDoc({ active: el("INPUT") }))).toBe(true);
  });

  it("is true for a contenteditable, whose flag is a string not a boolean", () => {
    expect(isTyping(fakeDoc({ active: el("DIV", { isContentEditable: "true" }) }))).toBe(true);
    expect(isTyping(fakeDoc({ active: el("DIV", { isContentEditable: true }) }))).toBe(true);
    expect(isTyping(fakeDoc({ active: el("DIV", { isContentEditable: "false" }) }))).toBe(false);
  });

  it("is false for controls that hold no typed text", () => {
    // Reloading past a focused checkbox or button costs nobody anything, and
    // counting them would hold the update back for no reason.
    expect(isTyping(fakeDoc({ active: el("INPUT", { type: "checkbox" }) }))).toBe(false);
    expect(isTyping(fakeDoc({ active: el("INPUT", { type: "radio" }) }))).toBe(false);
    expect(isTyping(fakeDoc({ active: el("BUTTON") }))).toBe(false);
    expect(isTyping(fakeDoc({ active: el("BODY") }))).toBe(false);
  });

  it("survives no focus and no document at all", () => {
    expect(isTyping(fakeDoc())).toBe(false);
    expect(isTyping(null)).toBe(false);
    expect(isTyping(undefined)).toBe(false);
  });
});

describe("isDialogOpen", () => {
  it("finds any of the app's dialogs by their shared class", () => {
    expect(isDialogOpen(fakeDoc({ dialog: true }))).toBe(true);
    expect(isDialogOpen(fakeDoc({ dialog: false }))).toBe(false);
  });

  it("survives a document without querySelector", () => {
    expect(isDialogOpen({})).toBe(false);
    expect(isDialogOpen(null)).toBe(false);
  });
});

describe("reloadBlocker", () => {
  it("reports nothing to wait for on an idle page", () => {
    expect(reloadBlocker(fakeDoc())).toBeNull();
  });

  it("blocks on typing, and urgency does NOT override it", () => {
    // The whole point of the module. No elapsed time makes it acceptable to
    // reload the page out from under someone who is entering a quantity.
    const doc = fakeDoc({ active: el("INPUT", { type: "number" }) });
    expect(reloadBlocker(doc)).toBe("typing");
    expect(reloadBlocker(doc, { urgent: true })).toBe("typing");
  });

  it("blocks on an open dialog, but urgency DOES override that", () => {
    // A job drawer can sit open all afternoon. Treating it as absolute would mean
    // never reloading at all.
    const doc = fakeDoc({ dialog: true });
    expect(reloadBlocker(doc)).toBe("dialog");
    expect(reloadBlocker(doc, { urgent: true })).toBeNull();
  });

  it("reports typing ahead of a dialog when both are true", () => {
    const doc = fakeDoc({ active: el("TEXTAREA"), dialog: true });
    expect(reloadBlocker(doc, { urgent: true })).toBe("typing");
  });
});

describe("reloadWhenIdle", () => {
  // A hand-driven clock and interval, so no test waits on real time.
  const harness = (doc, { urgentAfterMs = URGENT_AFTER_MS } = {}) => {
    const reload = vi.fn();
    const onDefer = vi.fn();
    let tick = null;
    let clock = 0;
    const cancel = reloadWhenIdle({
      doc,
      reload,
      onDefer,
      urgentAfterMs,
      pollMs: 1000,
      now: () => clock,
      setIntervalFn: (fn) => {
        tick = fn;
        return 1;
      },
      clearIntervalFn: () => {
        tick = null;
      },
    });
    return {
      reload,
      onDefer,
      cancel,
      poll: (advanceMs = 1000) => {
        clock += advanceMs;
        tick?.();
      },
      get polling() {
        return tick !== null;
      },
    };
  };

  it("reloads immediately when the page is already idle", () => {
    // The common case: nobody is mid-entry, so the update lands as promptly as it
    // did before any of this deferral existed.
    const h = harness(fakeDoc());
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.polling).toBe(false);
  });

  it("waits while someone is typing, then reloads once they stop", () => {
    const doc = fakeDoc({ active: el("INPUT", { type: "number" }) });
    const h = harness(doc);
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.onDefer).toHaveBeenCalledWith("typing");

    h.poll();
    expect(h.reload).not.toHaveBeenCalled();

    doc.activeElement = el("BODY");
    h.poll();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("stops polling once it has reloaded, and never reloads twice", () => {
    const doc = fakeDoc({ active: el("TEXTAREA") });
    const h = harness(doc);
    doc.activeElement = null;
    h.poll();
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.polling).toBe(false);
    h.poll();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("gives up waiting on a dialog after the urgency cut-off", () => {
    // Bounded on purpose: once the new worker has activated, the previous build's
    // precache is gone, so a lazy route opened by the stale page can 404.
    const h = harness(fakeDoc({ dialog: true }), { urgentAfterMs: 5000 });
    expect(h.reload).not.toHaveBeenCalled();

    h.poll(1000);
    expect(h.reload).not.toHaveBeenCalled();

    h.poll(9000);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("still refuses to reload past the cut-off while someone is typing", () => {
    const doc = fakeDoc({ active: el("INPUT", { type: "text" }), dialog: true });
    const h = harness(doc, { urgentAfterMs: 5000 });

    h.poll(60_000);
    expect(h.reload).not.toHaveBeenCalled();

    doc.activeElement = null;
    h.poll();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled before it ever fires", () => {
    const h = harness(fakeDoc({ active: el("TEXTAREA") }));
    h.cancel();
    expect(h.polling).toBe(false);
    expect(h.reload).not.toHaveBeenCalled();
  });
});
