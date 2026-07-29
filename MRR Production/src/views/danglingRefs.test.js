// src/views/danglingRefs.test.js
//
// Catches a setter that is called but never declared, imported, or received.
//
// This exists because that bug shipped. Extracting the bulk-receive state out of
// InventoryView left one caller behind — a button whose onClick still reset three
// pieces of state that no longer existed. The build stayed green the whole time,
// because an undefined identifier is a runtime ReferenceError and esbuild does
// not resolve identifiers. Nothing caught it until the file was read by eye.
//
// Scope is deliberately narrow. It checks setX-shaped calls only, which is
// precisely the shape a half-finished state extraction leaves behind, and skips
// anything reached through a dot so DOM methods do not trip it.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".jsx") ? [p] : [];
  });

// Every identifier inside the balanced {...} that starts at `open`.
const bindingsIn = (src, open) => {
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  return [...src.slice(open + 1, end).matchAll(/([A-Za-z_$][\w$]*)\s*(?:[,:=}]|$)/g)].map((m) => m[1]);
};

const declaredIn = (src) => {
  const declared = new Set();
  for (const m of src.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  // const [value, setValue] = useState(...)
  for (const m of src.matchAll(/\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]/g)) {
    declared.add(m[1]);
    declared.add(m[2]);
  }
  for (const m of src.matchAll(/import\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))/g)) {
    if (m[1]) for (const n of m[1].split(",")) declared.add(n.trim().split(/\s+as\s+/).pop());
    else declared.add(m[2]);
  }
  // Object destructuring, multi-line aware: component props and const { x } = hook().
  for (const m of src.matchAll(/(?:function\s+[A-Za-z_$][\w$]*\s*\(|=>\s*|\(\s*|=\s*)\{/g)) {
    for (const n of bindingsIn(src, m.index + m[0].length - 1)) declared.add(n);
  }
  return declared;
};

const BUILTIN = new Set(["setTimeout", "setInterval", "setImmediate"]);

export const danglingSetters = (src) => {
  const declared = declaredIn(src);
  const out = new Set();
  // The leading class excludes `.setX(` and `?.setX(`, so DOM and library
  // methods (el.setAttribute, style.setProperty, date.setHours) never match.
  for (const m of src.matchAll(/(^|[^.\w$?])\b(set[A-Z][\w$]*)\s*\(/gm)) {
    if (!declared.has(m[2]) && !BUILTIN.has(m[2])) out.add(m[2]);
  }
  return [...out];
};

const files = walk(SRC).filter((p) => !/Landing|Terms/.test(p));

describe("dangling references", () => {
  it("scanned a real set of view files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("has no setter called without being declared, imported, or received", () => {
    const offenders = files
      .map((f) => [f.replace(SRC, "").replace(/\\/g, "/"), danglingSetters(readFileSync(f, "utf8"))])
      .filter(([, missing]) => missing.length)
      .map(([f, missing]) => `${f}: ${missing.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("would catch the bug that prompted this file", () => {
    // The actual regression: an extracted setter still called from a button.
    const broken = `
      export default function View({ inv }) {
        const [modal, setModal] = useState(null);
        return <Btn onClick={() => { setBulkItems([]); setModal("bulk"); }}>Receive</Btn>;
      }`;
    expect(danglingSetters(broken)).toEqual(["setBulkItems"]);
  });

  it("does not flag setters that are received as props", () => {
    const fine = `
      export default function View({ inv, setInv, setJobs }) {
        return <Btn onClick={() => { setInv([]); setJobs([]); }}>Go</Btn>;
      }`;
    expect(danglingSetters(fine)).toEqual([]);
  });

  it("does not flag DOM or date methods reached through a dot", () => {
    const fine = `
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      el.setAttribute("x", "1");
      root.style.setProperty("--c", "red");
      node?.setSelectionRange(0, 1);`;
    expect(danglingSetters(fine)).toEqual([]);
  });
});
