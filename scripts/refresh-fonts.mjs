// Refresh the self-hosted fonts in public/fonts/ from Google Fonts.
//
//   node scripts/refresh-fonts.mjs
//
// Run it when a weight is added, removed, or a family changes in the family
// list below and in src/tokens.css's @font-face block — the two are meant to
// match exactly. Not part of any build step; fonts are binary assets that
// belong in git, and regenerating them on every build would churn the diff for
// no reason the same way generate-ios-assets.mjs's icons don't regenerate on
// every build either.
//
// WHY SELF-HOSTED AT ALL
//
// src/tokens.css used to @import fonts.googleapis.com directly, which sends
// every visitor's IP address to Google before they have agreed to anything.
// Several EU courts (Munich among them) have fined sites for exactly this
// pattern once self-hosting is trivially available — which it is: these are
// static files, not something that needs to be fetched live. Self-hosting
// removes the transfer entirely.
//
// WHY "latin" ONLY
//
// Google's CSS2 API returns a separate @font-face block per Unicode subset
// (latin, latin-ext, cyrillic, cyrillic-ext, greek, vietnamese...). This app is
// English/Spanish only, and Google's "latin" subset already covers the Latin-1
// Supplement range Spanish needs (á é í ó ú ñ ü ¿ ¡) — latin-ext only adds
// diacritics for languages this app doesn't ship (Czech, Polish, Turkish...).
// Pulling every subset would mean shipping ~10x the font weight for nothing.
//
// This script fetches Google's CSS2 response with a modern-Chrome User-Agent
// (Google serves woff2 URLs only to UAs that support it), keeps just the
// "latin"-tagged blocks, downloads each referenced .woff2, and regenerates the
// exact @font-face CSS block to paste into tokens.css.

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "fonts");

// Keep this in sync with the family/weight list in the @import this file
// replaced (see the git history of src/tokens.css if you need the original).
const FAMILIES =
  "Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@400;600";

const CSS2_URL = `https://fonts.googleapis.com/css2?family=${FAMILIES}&display=swap`;
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} for ${url}`));
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} for ${url}`));
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

const css = await fetchText(CSS2_URL, { "User-Agent": CHROME_UA });

const blocks = css.split(/\n(?=\/\*)/).filter((b) => /^\/\* latin \*\//.test(b.trim()));
if (blocks.length === 0) {
  throw new Error("No 'latin' blocks found — Google's CSS2 response shape may have changed.");
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const faceCss = [];
for (const block of blocks) {
  const family = block.match(/font-family:\s*'([^']+)'/)[1];
  const weight = block.match(/font-weight:\s*(\d+)/)[1];
  const style = block.match(/font-style:\s*(\w+)/)[1];
  const url = block.match(/url\((https:\/\/[^)]+\.woff2)\)/)[1];
  const filename = `${family.toLowerCase().replace(/\s+/g, "-")}-${weight}${style === "italic" ? "i" : ""}.woff2`;

  await download(url, path.join(OUT_DIR, filename));
  console.log("downloaded", filename);

  faceCss.push(
    `@font-face {\n  font-family: "${family}";\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url("/fonts/${filename}") format("woff2");\n}`,
  );
}

console.log(`\n${blocks.length} font files written to public/fonts/.`);
console.log("\nPaste this into src/tokens.css's @font-face block if any file above is new:\n");
console.log(faceCss.join("\n"));
