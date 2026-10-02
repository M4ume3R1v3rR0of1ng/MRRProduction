// Renders public/og-image.png, the 1200x630 card that link previews show when
// steadwerk.com is pasted into a text, an email, LinkedIn, Slack and so on.
//
// The card is static HTML screenshotted by Playwright (already a dev dependency
// for e2e), so the brand mark and fonts are the real ones from public/ rather
// than a hand-exported image that drifts. Rerun after changing the hero copy:
//
//   node scripts/render-og-image.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pub = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));
const font = (f) => readFileSync(pub(`fonts/${f}`)).toString("base64");

const html = `<!doctype html><html><head><style>
@font-face{font-family:SG;font-weight:700;src:url(data:font/woff2;base64,${font("space-grotesk-700.woff2")})}
@font-face{font-family:Inter;font-weight:500;src:url(data:font/woff2;base64,${font("inter-500.woff2")})}
@font-face{font-family:Mono;font-weight:600;src:url(data:font/woff2;base64,${font("ibm-plex-mono-600.woff2")})}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#23282D;color:#F4F1EA;font-family:Inter;
  padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between;
  border-bottom:14px solid #C97B2D}
.brand{display:flex;align-items:center;gap:20px;font-family:SG;font-size:44px;letter-spacing:-.5px}
h1{font-family:SG;font-size:92px;line-height:1.02;letter-spacing:-2px}
h1 span{color:#C97B2D}
p{font-size:30px;color:#B9B4AA;max-width:900px;line-height:1.35}
.url{font-family:Mono;font-size:24px;color:#C97B2D;letter-spacing:1px}
</style></head><body>
<div class="brand"><svg width="64" height="64" viewBox="96 144 320 224"><path d="M112 160 L176 352 L256 192 L336 352 L400 160" fill="none" stroke="#C97B2D" stroke-width="40" stroke-linecap="square" stroke-linejoin="miter"/></svg>Steadwerk</div>
<div><h1>Tools that work as<br>hard as <span>you do.</span></h1></div>
<div><p>Inventory, fleet, jobs and maintenance software for roofing and construction crews.</p>
<div class="url" style="margin-top:20px">STEADWERK.COM</div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
// A string, not a closure: it runs in the page, where `document` exists.
await page.evaluate("document.fonts.ready");
await page.screenshot({ path: pub("og-image.png") });
await browser.close();
console.log("wrote public/og-image.png");
