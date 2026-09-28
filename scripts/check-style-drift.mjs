// scripts/check-style-drift.mjs
//
// Views are built from inline style objects, and nothing stopped each new one
// from hand-rolling its own card, label, and spacing values — which is how the
// app ended up with 7 card radii and 18 sizes of uppercase label. The shared
// layer (Card, Stack, Row, Eyebrow, SectionTitle, Muted, Table in
// src/shared/components/LayoutPrimitives.jsx) only fixes that if new code
// reaches for it instead of adding more inline blocks.
//
// This is a ratchet, not a rewrite. style-baseline.json records, per .jsx file,
// how many `style={{` blocks and quoted hex color literals it has today. The
// check fails if any file goes UP — including a new file, which starts at zero.
// Existing code is never forced to change; it just can't get worse silently.
//
// Hex literals are counted because colors are supposed to come from C.* / the
// --c-* tokens, which flip for dark mode; a raw "#1f2937" doesn't. Only quoted
// JS strings count ("#fff", '#fff', `#fff`) — the CSS-in-template-string blocks
// the public pages carry (`color:#fff;`) are a different mechanism and aren't
// what this is guarding.
//
// When an increase is deliberate (a genuinely one-off layout, a canvas color),
// run `npm run check:styles -- --update` and commit the baseline change; it
// shows up in review as a visible, reasoned exception rather than drift. Run the
// same command after migrating a file to primitives to lock in the lower count.
//
// Exit 0 = no file grew. Exit 1 = one or more did.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = "src";
const BASELINE = "scripts/style-baseline.json";
const HEX_LITERAL = /["'`]#[0-9a-fA-F]{3,8}\b/g;

// Only style={{}} on a raw DOM element (<div>, <span>, <th>) counts. A `style`
// passed to a component (<Card style={{ marginBottom: 16 }}>) is the sanctioned
// one-property override, and counting it would make migrating a hand-built div
// to <Card> look like the file got worse. The owning tag is the nearest "<" +
// letter before the match — attribute values in this codebase don't contain
// "<x", so that's reliable enough for a ratchet.
function countDomInlineStyles(src) {
  let n = 0;
  let lastTagIsDom = false;
  for (const m of src.matchAll(/<([A-Za-z])|style=\{\{/g)) {
    if (m[1]) lastTagIsDom = m[1] >= "a" && m[1] <= "z";
    else if (lastTagIsDom) n++;
  }
  return n;
}

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (entry.endsWith(".jsx") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const current = {};
for (const file of walk(ROOT).sort()) {
  const rel = file.split(path.sep).join("/");
  const src = readFileSync(file, "utf8");
  const inline = countDomInlineStyles(src);
  const hex = (src.match(HEX_LITERAL) || []).length;
  if (inline || hex) current[rel] = { inline, hex };
}

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
  const totals = Object.values(current).reduce(
    (t, c) => ({ inline: t.inline + c.inline, hex: t.hex + c.hex }),
    { inline: 0, hex: 0 },
  );
  console.log(
    `Wrote ${BASELINE}: ${totals.inline} inline style blocks, ${totals.hex} hex literals across ${Object.keys(current).length} files.`,
  );
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`${BASELINE} is missing. Run \`npm run check:styles -- --update\` to create it.`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const grew = [];
const shrank = [];
for (const [file, now] of Object.entries(current)) {
  const was = baseline[file] || { inline: 0, hex: 0 };
  for (const key of ["inline", "hex"]) {
    if (now[key] > was[key]) grew.push(`  ${file}: ${key} ${was[key]} → ${now[key]}`);
    else if (now[key] < was[key]) shrank.push(file);
  }
}

if (grew.length > 0) {
  console.error(
    "Inline styling grew in these files (inline = style={{…}} blocks, hex = raw color literals):\n\n" +
      grew.join("\n") +
      "\n\nReach for Card / Stack / Row / Eyebrow / SectionTitle / Muted / Table from" +
      "\nsrc/shared/components/UIPrimitives.jsx, and C.* for colors. If the increase is" +
      "\ndeliberate, run `npm run check:styles -- --update` and commit the baseline.",
  );
  process.exit(1);
}

if (shrank.length > 0) {
  console.log(
    `No file grew. ${new Set(shrank).size} file(s) dropped below baseline — run \`npm run check:styles -- --update\` to lock that in.`,
  );
} else {
  console.log("No file grew past its inline-style or hex-literal baseline.");
}
