// Repair the paths `cap sync` writes into the iOS SPM manifest when it runs on
// Windows. Invoked at the end of `npm run build:ios`.
//
// THE BUG
//
// Capacitor generates ios/App/CapApp-SPM/Package.swift with a local path per
// plugin. It builds that path with the host platform's separator, so a sync on
// Windows emits:
//
//     .package(name: "CapacitorCamera", path: "..\..\..\node_modules\@capacitor\camera")
//
// which is wrong twice over. Backslash is not a path separator on macOS, and it
// is the ESCAPE character in a Swift string literal: `\n` in `\node_modules` is a
// newline, and `\@` is not a valid escape at all. Package.swift stops being
// parseable Swift, so the failure is a manifest syntax error rather than a
// missing-file error, which sends you looking in the wrong place entirely.
//
// WHY NOT JUST LET CI FIX IT
//
// It would. `npm run build:ios` runs `cap sync ios` on the macOS runner too, and
// that regenerates the file correctly before xcodebuild sees it. But the broken
// version is what sits in the repo, so anyone who opens the Xcode project
// without syncing first hits it, and the file flips back and forth in every diff
// depending on who last ran a build. Normalising here means Windows and macOS
// produce byte-identical output and the committed manifest is always the correct
// one.
//
// Safe to run on macOS: there are no backslashes to replace, so it is a no-op.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MANIFEST = "ios/App/CapApp-SPM/Package.swift";

if (!existsSync(MANIFEST)) {
  // The iOS platform has not been added. Not an error: `npm run build:ios` is
  // the only caller and cap sync would have failed first.
  console.log(`normalize-spm-paths: ${MANIFEST} not found, nothing to do.`);
  process.exit(0);
}

const before = readFileSync(MANIFEST, "utf8");

// Only touch the inside of `path: "…"` literals. A blanket replace across the
// file would also rewrite any legitimate backslash in a URL or a comment.
const after = before.replace(/path:\s*"([^"]*)"/g, (match, p) =>
  p.includes("\\") ? match.replace(p, p.replace(/\\/g, "/")) : match,
);

if (after === before) {
  console.log("normalize-spm-paths: paths already POSIX, no change.");
  process.exit(0);
}

writeFileSync(MANIFEST, after);
console.log("normalize-spm-paths: rewrote Windows separators in", MANIFEST);
for (const [, p] of after.matchAll(/path:\s*"([^"]*)"/g)) console.log("  path:", p);
