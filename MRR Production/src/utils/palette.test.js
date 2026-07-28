// src/utils/palette.test.js
//
// Guards the invariant that makes dark mode work at all.
//
// The whole app themes itself because every value in C is a var() reference that
// tokens.css redefines under [data-theme="dark"]. The failure mode is quiet: drop
// one literal hex into C, or reach for C.surface as ink on a colored fill, and a
// single corner of the app renders wrong in one theme only. Nothing else catches
// that, so it is checked here.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { C, HEX } from "./helpers";
import { readTheme, resolveTheme, nextTheme, THEME_CYCLE } from "./theme";

const tokens = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");

const ruleBody = (selector) => {
  const start = tokens.indexOf(selector);
  if (start === -1) throw new Error(`tokens.css has no ${selector} rule`);
  const open = tokens.indexOf("{", start);
  return tokens.slice(open, tokens.indexOf("\n}", open));
};

describe("C palette", () => {
  it("holds only var() references, never literal colors", () => {
    const literal = Object.entries(C).filter(([, v]) => !/^var\(--c-[a-z-]+\)$/.test(v));
    expect(literal).toEqual([]);
  });

  it("resolves every reference to a variable tokens.css actually defines", () => {
    const light = ruleBody(":root {");
    const missing = Object.entries(C)
      .map(([key, v]) => [key, v.slice(4, -1)])
      .filter(([, name]) => !light.includes(`${name}:`));
    expect(missing).toEqual([]);
  });

  it("gives every light variable a dark counterpart", () => {
    const names = (body) => new Set((body.match(/--c-[a-z-]+(?=:)/g) || []));
    const light = names(ruleBody(":root {"));
    const dark = names(ruleBody(':root[data-theme="dark"]'));
    expect([...light].filter((n) => !dark.has(n))).toEqual([]);
  });

  it("keeps the back-compat aliases on the same slots as the semantic names", () => {
    expect(C.navy).toBe(C.barnwood);
    expect(C.gold).toBe(C.amber);
    expect(C.blue).toBe(C.leather);
    expect(C.w).toBe(C.surface);
    expect(C.rd).toBe(C.rust);
    expect(C.bd).toBe(C.line);
  });

  it("keeps chrome, ink, and on-accent as three distinct slots", () => {
    // shell must not follow barnwood: barnwood inverts for text, the sidebar must not.
    // onAccent must not follow surface: surface inverts to near-black, which would put
    // dark ink on a dark fill.
    expect(new Set([C.shell, C.barnwood, C.onAccent, C.surface]).size).toBe(4);
  });

  it("still exposes literal hex for consumers that cannot take a variable", () => {
    for (const v of Object.values(HEX)) expect(v).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

// ── Static audit of the views ──
//
// The palette tests above prove the tokens are wired correctly. They cannot see
// a view that ignores the tokens and hardcodes a color, which is a quieter bug:
// the surface stays white in dark mode while the text on it inverts to cream,
// and you get pale-on-white. That shipped once already. This catches it.
const SRC = fileURLToPath(new URL("..", import.meta.url));

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && p.endsWith(".jsx") ? [p] : [];
  });

// LandingPage and TermsPage are standalone public pages that carry their own
// self-contained stylesheet and their own light/dark handling.
const appFiles = walk(SRC).filter((p) => !/Landing|Terms/.test(p));

const luminance = (hex) => {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const isLight = (v) => {
  const raw = v.replace(/["']/g, "");
  if (raw === "white") return true;
  const l = luminance(raw);
  return l !== null && l > 0.75;
};

const BG = /(?:background|backgroundColor)\s*:\s*[^,;}\n]*?(#[0-9a-fA-F]{3,6}|["']white["'])/g;
const INK = /color\s*:\s*[^,;}\n]*?(#[0-9a-fA-F]{3,6}|["']white["'])/g;
const BARNWOOD_BG = /(?:background|backgroundColor)\s*:[^,;}\n]*var\(--c-barnwood\)/;
// Ink is allowed to be a literal light color when it demonstrably sits on
// something dark in both themes: the shell chrome, an on-accent fill, or a
// black scrim over a photo.
const ON_DARK = /shell|on-accent|rgba\(0, ?0, ?0|rgba\(15, ?23, ?42/;

const scan = (test, skip) => {
  const hits = [];
  for (const file of appFiles) {
    const rel = relative(SRC, file).replace(/\\/g, "/");
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (skip && skip.test(line)) return;
      if (test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
  }
  return hits;
};

describe("view color audit", () => {
  it("has no hardcoded light background left in any view", () => {
    // A literal white panel does not invert. Its text does. That is the bug.
    const hits = scan((l) => [...l.matchAll(BG)].some((m) => isLight(m[1])));
    expect(hits).toEqual([]);
  });

  it("has no literal light ink outside a provably dark context", () => {
    const hits = scan((l) => [...l.matchAll(INK)].some((m) => isLight(m[1])), ON_DARK);
    expect(hits).toEqual([]);
  });

  it("never paints a background with the ink token", () => {
    // --c-barnwood inverts to cream for dark-mode text. Anything using it as a
    // surface wants --c-shell, which stays dark in both themes.
    const hits = scan((l) => BARNWOOD_BG.test(l));
    expect(hits).toEqual([]);
  });

  it("actually scanned the app, including App.jsx", () => {
    // The first sweep missed App.jsx entirely and left a hardcoded red banner
    // behind. Assert the file list is real so a broken glob fails loudly instead
    // of passing everything vacuously.
    expect(appFiles.length).toBeGreaterThan(20);
    expect(appFiles.some((p) => p.endsWith("App.jsx"))).toBe(true);
  });
});

describe("theme preference", () => {
  it("falls back to system when there is no storage to read", () => {
    expect(readTheme()).toBe("system");
  });

  it("passes explicit preferences through untouched", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("cycles through every state and returns to the start", () => {
    let pref = "system";
    const seen = [pref];
    for (let i = 0; i < THEME_CYCLE.length; i++) {
      pref = nextTheme(pref);
      seen.push(pref);
    }
    expect(seen.slice(0, -1).sort()).toEqual([...THEME_CYCLE].sort());
    expect(seen[seen.length - 1]).toBe("system");
  });
});
