// scripts/check-money-coverage.mjs
//
// tsconfig.money-permissions.json type-checks a hand-picked list of files, not
// the whole app, because turning checkJs on project-wide lights up hundreds of
// pre-existing errors in unrelated JSX views. That's the right call, but a
// hand-picked list only stays honest if something notices when a new
// money-moving file doesn't get added to it. Nothing did — delete-company.js
// started cancelling Stripe subscriptions and deleting Stripe customers
// without ever being added to "include", and got zero type checking.
//
// This doesn't try to catch everything the scoped tsconfig cares about — access
// decisions are judgment calls a script can't safely make (nearly every Netlify
// function imports the tenant/auth boundary for routine plumbing, so "imports
// tenant.js" would flag almost the whole directory). It catches the one signal
// that's unambiguous: a file that imports the "stripe" package IS moving money,
// full stop. If it's missing from the include list, that's a real gap, not a
// judgment call.
//
// Exit 0 = every stripe-importing file under the scanned roots is covered.
// Exit 1 = one or more aren't — add them to tsconfig.money-permissions.json's
// "include" array by hand, annotate with JSDoc, and re-run `npm run typecheck:money`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const STRIPE_IMPORT = /\bfrom\s+["']stripe["']|\brequire\(\s*["']stripe["']\s*\)/;

// Where money-moving code plausibly lives. Not the whole src tree, for the same
// reason the tsconfig itself isn't: JSX views aren't in scope for this check.
const SCAN_ROOTS = [
  "netlify/functions",
  "src/features/billing",
  "src/features/settings",
  "src/features/reports",
  "src/shared/database",
];

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out = out.concat(walk(full));
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

const candidates = SCAN_ROOTS.filter((root) => {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
}).flatMap(walk);

// tsconfig.money-permissions.json is JSONC (a header comment block above the
// object) so it isn't valid JSON as-is. Every comment in that file is a
// whole line starting with "//" — there are no trailing inline comments — so
// dropping those lines is enough to make the rest parse.
const tsconfigPath = "tsconfig.money-permissions.json";
const raw = readFileSync(tsconfigPath, "utf8");
const jsonText = raw
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
const { include } = JSON.parse(jsonText);
const included = new Set(include.map((p) => p.split(path.sep).join("/")));

const missing = [];
for (const file of candidates) {
  const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
  if (included.has(rel)) continue;
  const content = readFileSync(file, "utf8");
  if (STRIPE_IMPORT.test(content)) missing.push(rel);
}

if (missing.length > 0) {
  console.error(
    `These files import "stripe" — they move money — but aren't in ${tsconfigPath}'s "include" list, so they get zero type checking:\n`,
  );
  missing.forEach((f) => console.error(`  - ${f}`));
  console.error(
    `\nAdd each one to ${tsconfigPath}'s "include" array by hand, annotate it with JSDoc as you go, and re-run \`npm run typecheck:money\`.`,
  );
  process.exit(1);
}

console.log(
  `OK — every file importing "stripe" under ${SCAN_ROOTS.join(", ")} is covered by ${tsconfigPath}.`,
);
