// @vitest-environment jsdom
//
// Opted in per-file, the same way the component suites do (see
// src/test/permissionMatrix.test.jsx): this is the one thing in the module that
// is genuinely about the browser — askAnvil dispatches a window event and
// no-ops without one, so under the default node environment every assertion
// here would pass vacuously by observing nothing.
import { describe, it, expect, vi, afterEach } from "vitest";
import { askAnvil, onAnvilAsk, ANVIL_NAME, ANVIL_EXPANSION } from "./anvil";

// The one channel between "somewhere in the app" and ChatWidget. See anvil.js
// for why it is an event rather than a context provider.
describe("askAnvil / onAnvilAsk", () => {
  const unsubscribes = [];
  const listen = (handler) => {
    const off = onAnvilAsk(handler);
    unsubscribes.push(off);
    return off;
  };

  afterEach(() => {
    while (unsubscribes.length) unsubscribes.pop()();
  });

  it("delivers the question and the caller's context", () => {
    const heard = vi.fn();
    listen(heard);
    askAnvil("What maintenance is due?", { view: "dashboard" });
    expect(heard).toHaveBeenCalledWith("What maintenance is due?", { view: "dashboard" });
  });

  it("trims the question, since it comes from a text input", () => {
    const heard = vi.fn();
    listen(heard);
    askAnvil("   which trucks are overdue  ");
    expect(heard).toHaveBeenCalledWith("which trucks are overdue", null);
  });

  it("sends nothing for an empty or whitespace-only ask", () => {
    const heard = vi.fn();
    listen(heard);
    askAnvil("");
    askAnvil("   ");
    askAnvil(null);
    expect(heard).not.toHaveBeenCalled();
  });

  it("reaches every listener", () => {
    const a = vi.fn();
    const b = vi.fn();
    listen(a);
    listen(b);
    askAnvil("hello");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stops delivering once unsubscribed, so it drops out of a useEffect cleanly", () => {
    const heard = vi.fn();
    const off = onAnvilAsk(heard);
    off();
    askAnvil("hello");
    expect(heard).not.toHaveBeenCalled();
  });

  // A caller must not care whether the widget was mounted to hear it — the
  // whole point of the one-way design.
  it("is harmless with nobody listening", () => {
    expect(() => askAnvil("anyone there?")).not.toThrow();
  });

  it("keeps the name and its expansion together", () => {
    expect(ANVIL_NAME).toBe("A.N.V.I.L.");
    // The acronym, unpacked. Checked because the two drifting apart is exactly
    // the kind of thing nobody notices. The name is written with a stop after
    // each letter, so the initials are assembled the same way to compare.
    const initials = ANVIL_EXPANSION.split(/[\s&]+/)
      .filter((w) => /^[A-Z]/.test(w))
      .map((w) => `${w[0]}.`)
      .join("");
    expect(initials).toBe(ANVIL_NAME);
  });
});
