// src/views/LandingPage.jsx
//
// The public front door — the first thing a logged-out visitor sees. Marketing
// page for Steadwerk built on the "Raising" brand system, with buttons that hand
// off to the real LoginScreen (sign in) and signup (start a company) flows.
//
// All styles are scoped under .sw-landing so nothing here leaks into the app's
// global stylesheet (tokens.css). The page carries its own light/dark toggle via
// a data-sw-theme attribute on its own wrapper — it never touches the document
// root, so it can't fight the rest of the app.
import { useEffect, useRef, useState } from "react";

// The published rates, in one place. These must match what Stripe actually
// charges — BASE/PACK mirror BillingView.jsx, and TRIAL_DAYS mirrors
// trial_period_days in netlify/functions/create-checkout.js. A landing page that
// advertises terms the checkout doesn't honor is a refund request waiting to
// happen, so change these together or not at all.
const BASE_PRICE = 99;
const BASE_SEATS = 10;
const PACK_PRICE = 10;
const PACK_SEATS = 5;
const TRIAL_DAYS = 14;

const CSS = `
.sw-landing {
  --ground:#F6F3EC; --surface:#FFFFFF; --surface-2:#EDE6DA;
  --ink:#23282D; --ink-soft:#515960; --muted:#6E7780;
  --line:rgba(35,40,45,.14); --line-2:rgba(35,40,45,.30);
  --accent:#C97B2D; --accent-deep:#8A5A2B; --good:#4A7A5C; --signal:#D64545;
  --hero-1:#2F353C; --hero-2:#23282D; --hero-3:#171B1F;
  --on-dark:#EDE6DA; --on-dark-soft:rgba(237,230,218,.70);
  --lattice:rgba(201,123,45,.06); --shadow:0 4px 22px rgba(35,40,45,.09);

  min-height:100vh; background:var(--ground); color:var(--ink);
  font-family:"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size:17px; line-height:1.7; -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility; overflow-x:hidden;
}
@media (prefers-color-scheme: dark) {
  .sw-landing:not([data-sw-theme="light"]) {
    --ground:#191D21; --surface:#23282D; --surface-2:#2B3137;
    --ink:#ECE6DA; --ink-soft:#A7AEB5; --muted:#8A929A;
    --line:rgba(237,230,218,.14); --line-2:rgba(237,230,218,.26);
    --accent:#DB9550; --accent-deep:#E7A968; --good:#7AAE8C; --signal:#E06B6B;
    --hero-1:#2A2F35; --hero-2:#20242A; --hero-3:#14171A;
    --lattice:rgba(219,149,80,.07); --shadow:0 4px 24px rgba(0,0,0,.4);
  }
}
.sw-landing[data-sw-theme="dark"] {
  --ground:#191D21; --surface:#23282D; --surface-2:#2B3137;
  --ink:#ECE6DA; --ink-soft:#A7AEB5; --muted:#8A929A;
  --line:rgba(237,230,218,.14); --line-2:rgba(237,230,218,.26);
  --accent:#DB9550; --accent-deep:#E7A968; --good:#7AAE8C; --signal:#E06B6B;
  --hero-1:#2A2F35; --hero-2:#20242A; --hero-3:#14171A;
  --lattice:rgba(219,149,80,.07); --shadow:0 4px 24px rgba(0,0,0,.4);
}
.sw-landing[data-sw-theme="light"] {
  --ground:#F6F3EC; --surface:#FFFFFF; --surface-2:#EDE6DA;
  --ink:#23282D; --ink-soft:#515960; --muted:#6E7780;
  --line:rgba(35,40,45,.14); --line-2:rgba(35,40,45,.30);
  --accent:#C97B2D; --accent-deep:#8A5A2B; --good:#4A7A5C; --signal:#D64545;
  --hero-1:#2F353C; --hero-2:#23282D; --hero-3:#171B1F;
  --lattice:rgba(201,123,45,.06); --shadow:0 4px 22px rgba(35,40,45,.09);
}

.sw-landing, .sw-landing *, .sw-landing *::before, .sw-landing *::after { box-sizing:border-box; }
.sw-landing h1, .sw-landing h2, .sw-landing h3 { font-family:"Space Grotesk", ui-sans-serif, system-ui, sans-serif; font-weight:700; margin:0; line-height:1.05; letter-spacing:-.02em; text-wrap:balance; }
.sw-landing p { margin:0; }
.sw-landing a { color:var(--accent-deep); text-decoration:none; }
.sw-landing a:hover { text-decoration:underline; text-underline-offset:3px; }
.sw-landing :focus-visible { outline:2.5px solid var(--accent); outline-offset:3px; border-radius:2px; }

.sw-landing .wrap { width:100%; max-width:1120px; margin:0 auto; padding:0 28px; }
.sw-landing .tnum { font-variant-numeric:tabular-nums; }

.sw-landing .mk-rect { fill:var(--ink); }
.sw-landing .mk-stroke { stroke:var(--accent); }

.sw-landing .eyebrow {
  font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:11.5px; font-weight:600; letter-spacing:.22em; text-transform:uppercase;
  color:var(--accent-deep); display:inline-flex; gap:10px; align-items:center;
}
.sw-landing .eyebrow::before { content:""; width:22px; height:1px; background:var(--accent); display:inline-block; }

.sw-landing .btn {
  display:inline-flex; align-items:center; gap:9px; cursor:pointer;
  font-family:"Space Grotesk", sans-serif; font-weight:700; font-size:15.5px;
  padding:13px 22px; border-radius:3px; border:1.5px solid transparent;
  transition:background .18s ease, color .18s ease, border-color .18s ease, transform .12s ease;
  text-decoration:none; line-height:1;
}
.sw-landing .btn:hover { text-decoration:none; }
.sw-landing .btn:active { transform:translateY(1px); }
.sw-landing .btn-primary { background:var(--accent); color:#23282D; }
.sw-landing .btn-primary:hover { background:var(--accent-deep); color:#231a10; }
.sw-landing .btn-ghost { background:transparent; color:var(--ink); border-color:var(--line-2); }
.sw-landing .btn-ghost:hover { border-color:var(--accent); color:var(--accent-deep); }
.sw-landing .btn-lg { padding:16px 28px; font-size:16.5px; }

.sw-landing .nav {
  position:sticky; top:0; z-index:50;
  background:color-mix(in srgb, var(--ground) 88%, transparent);
  backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); border-bottom:1px solid var(--line);
}
.sw-landing .nav-in { display:flex; align-items:center; justify-content:space-between; height:66px; }
.sw-landing .brand { display:flex; align-items:center; gap:11px; cursor:pointer; }
.sw-landing .brand .wm { font-family:"Space Grotesk", sans-serif; font-weight:700; font-size:19px; letter-spacing:.06em; color:var(--ink); }
.sw-landing .nav-links { display:flex; align-items:center; gap:28px; }
.sw-landing .nav-links a { color:var(--ink-soft); font-size:15px; font-weight:500; }
.sw-landing .nav-links a:hover { color:var(--accent-deep); text-decoration:none; }
.sw-landing .nav-actions { display:flex; align-items:center; gap:14px; }
.sw-landing .theme-btn {
  background:transparent; border:1px solid var(--line-2); color:var(--ink-soft);
  width:38px; height:38px; border-radius:3px; cursor:pointer; display:grid; place-items:center;
  font-size:15px; transition:border-color .18s, color .18s; flex:0 0 auto;
}
.sw-landing .theme-btn:hover { border-color:var(--accent); color:var(--accent-deep); }
@media (max-width:820px){ .sw-landing .nav-links { display:none; } .sw-landing .nav-hide-sm { display:none; } }

.sw-landing .hero {
  position:relative; overflow:hidden; color:var(--on-dark);
  background:
    repeating-linear-gradient(115deg, transparent 0 46px, var(--lattice) 46px 48px),
    radial-gradient(ellipse at 50% -10%, var(--hero-1) 0%, var(--hero-2) 55%, var(--hero-3) 100%);
  border-bottom:1px solid var(--line);
}
.sw-landing .hero-in { padding:clamp(64px,10vw,120px) 0 clamp(56px,8vw,104px); }
.sw-landing .hero-grid { display:grid; grid-template-columns:1.35fr 1fr; gap:56px; align-items:center; }
@media (max-width:900px){ .sw-landing .hero-grid { grid-template-columns:1fr; gap:44px; } }
.sw-landing .hero .eyebrow { color:var(--accent); }
.sw-landing .hero .eyebrow::before { background:var(--accent); }
.sw-landing .hero h1 { font-size:clamp(40px,6.4vw,74px); color:var(--on-dark); margin:22px 0 0; }
.sw-landing .hero h1 .amb { color:var(--accent); }
.sw-landing .hero-sub { margin-top:22px; max-width:34ch; font-size:clamp(16.5px,2.1vw,19px); color:var(--on-dark-soft); line-height:1.65; }
.sw-landing .hero-cta { margin-top:34px; display:flex; gap:14px; flex-wrap:wrap; }
.sw-landing .hero-ghost { background:transparent; color:var(--on-dark); border-color:rgba(237,230,218,.28); }
.sw-landing .hero-ghost:hover { border-color:var(--accent); color:var(--accent); }
.sw-landing .hero-meta { margin-top:30px; display:flex; gap:26px; flex-wrap:wrap; color:var(--on-dark-soft); font-size:12.5px; }
.sw-landing .hero-meta b { color:var(--on-dark); font-weight:600; }

.sw-landing .truss-art { display:flex; justify-content:center; }
.sw-landing .truss-art svg { width:min(340px,80%); height:auto; }
/* Draw the truss, hold it, erase it, repeat. The hold is what keeps this from
   reading as a busy loading spinner — the finished W is on screen for roughly
   half of every cycle. Erasing to -220 (rather than snapping back to 220) means
   the stroke leaves the way it arrived, so the restart has no visible seam. */
.sw-landing .truss-draw path.mk-stroke { stroke-dasharray:220; stroke-dashoffset:220; animation:sw-draw 4.5s cubic-bezier(.6,0,.2,1) .25s infinite; }
@keyframes sw-draw {
  0%   { stroke-dashoffset:220; }
  35%  { stroke-dashoffset:0; }
  70%  { stroke-dashoffset:0; }
  100% { stroke-dashoffset:-220; }
}
@media (prefers-reduced-motion: reduce){ .sw-landing .truss-draw path.mk-stroke { animation:none; stroke-dashoffset:0; } }

.sw-landing .strip { border-bottom:1px solid var(--line); background:var(--surface-2); }
.sw-landing .strip-in { padding:clamp(40px,6vw,66px) 0; display:grid; grid-template-columns:.9fr 1.1fr; gap:44px; align-items:center; }
@media (max-width:820px){ .sw-landing .strip-in { grid-template-columns:1fr; gap:26px; } }
.sw-landing .strip h2 { font-size:clamp(26px,3.4vw,34px); }
.sw-landing .steal-list { display:flex; flex-direction:column; gap:2px; }
.sw-landing .steal { display:flex; gap:14px; align-items:baseline; padding:12px 0; border-bottom:1px solid var(--line); }
.sw-landing .steal:last-child { border-bottom:none; }
.sw-landing .steal .n { font-family:"IBM Plex Mono",monospace; font-size:11px; color:var(--muted); letter-spacing:.1em; flex:0 0 34px; }
.sw-landing .steal .t { font-size:16px; }
.sw-landing .steal .t b { font-weight:600; }

.sw-landing .band { padding:clamp(64px,9vw,108px) 0; }
.sw-landing .band-head { max-width:60ch; margin-bottom:44px; }
.sw-landing .band-head h2 { font-size:clamp(28px,4vw,42px); margin:16px 0 0; }
.sw-landing .band-head p { margin-top:16px; color:var(--ink-soft); font-size:18px; }

.sw-landing .ledger { display:grid; grid-template-columns:repeat(3,1fr); gap:0; border:1px solid var(--line-2); background:var(--line); }
@media (max-width:860px){ .sw-landing .ledger { grid-template-columns:1fr 1fr; } }
@media (max-width:560px){ .sw-landing .ledger { grid-template-columns:1fr; } }
.sw-landing .cell { background:var(--surface); padding:30px 28px 32px; display:flex; flex-direction:column; gap:12px; position:relative; }
.sw-landing .cell .code { font-family:"IBM Plex Mono",monospace; font-size:12px; font-weight:600; letter-spacing:.12em; color:var(--accent-deep); }
.sw-landing .cell h3 { font-size:20px; }
.sw-landing .cell .lead { font-family:"Space Grotesk",sans-serif; font-weight:500; font-size:16px; color:var(--ink); }
.sw-landing .cell p { color:var(--ink-soft); font-size:14.5px; line-height:1.6; }
.sw-landing .cell::after { content:""; position:absolute; top:0; left:28px; width:26px; height:3px; background:var(--accent); }

.sw-landing .glass { background:var(--surface-2); border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
.sw-landing .mock { background:var(--surface); border:1px solid var(--line-2); border-radius:5px; box-shadow:var(--shadow); overflow:hidden; }
.sw-landing .mock-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 18px; border-bottom:1px solid var(--line); background:var(--surface-2); }
.sw-landing .mock-bar .ttl { font-family:"Space Grotesk",sans-serif; font-weight:700; font-size:14.5px; display:flex; align-items:center; gap:9px; }
.sw-landing .mock-bar .meta { font-family:"IBM Plex Mono",monospace; font-size:11.5px; color:var(--muted); letter-spacing:.08em; }
.sw-landing .tbl-scroll { overflow-x:auto; }
.sw-landing table.inv { width:100%; border-collapse:collapse; min-width:560px; }
.sw-landing table.inv th, .sw-landing table.inv td { text-align:left; padding:13px 18px; border-bottom:1px solid var(--line); font-size:14px; white-space:nowrap; }
.sw-landing table.inv th { font-family:"IBM Plex Mono",monospace; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); font-weight:600; }
.sw-landing table.inv td.num { font-family:"IBM Plex Mono",monospace; text-align:right; }
.sw-landing table.inv tr:last-child td { border-bottom:none; }
.sw-landing table.inv .item { font-weight:600; color:var(--ink); }
.sw-landing table.inv .loc { font-family:"IBM Plex Mono",monospace; font-size:12.5px; color:var(--ink-soft); }
.sw-landing .pill { display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:600; padding:4px 11px; border-radius:20px; font-family:"IBM Plex Mono",monospace; letter-spacing:.03em; }
.sw-landing .pill::before { content:""; width:8px; height:8px; border-radius:50%; }
.sw-landing .pill.ok { color:var(--good); background:color-mix(in srgb, var(--good) 15%, transparent); }
.sw-landing .pill.ok::before { background:var(--good); }
.sw-landing .pill.low { color:var(--accent-deep); background:color-mix(in srgb, var(--accent) 18%, transparent); }
.sw-landing .pill.low::before { background:var(--accent); }
.sw-landing .pill.out { color:var(--signal); background:color-mix(in srgb, var(--signal) 15%, transparent); }
.sw-landing .pill.out::before { background:var(--signal); }
.sw-landing .cap { margin-top:16px; font-size:13px; color:var(--muted); font-family:"IBM Plex Mono",monospace; letter-spacing:.04em; }

/* ---- pricing: a spec sheet, not a pricing table. Two rates, stated plainly,
   with the numbers in the same tabular mono the inventory grid uses. ---- */
.sw-landing .rates { display:grid; grid-template-columns:1.15fr 1fr; gap:0; border:1px solid var(--line-2); background:var(--line); }
@media (max-width:760px){ .sw-landing .rates { grid-template-columns:1fr; } }
.sw-landing .rate { background:var(--surface); padding:34px 32px 36px; display:flex; flex-direction:column; gap:14px; position:relative; }
.sw-landing .rate.lead-rate::after { content:""; position:absolute; top:0; left:32px; width:26px; height:3px; background:var(--accent); }
.sw-landing .rate .code { font-family:"IBM Plex Mono",monospace; font-size:12px; font-weight:600; letter-spacing:.12em; color:var(--accent-deep); }
.sw-landing .rate .fig { display:flex; align-items:baseline; gap:9px; }
.sw-landing .rate .amt { font-family:"Space Grotesk",sans-serif; font-weight:700; font-size:clamp(38px,5.5vw,54px); line-height:1; letter-spacing:-.03em; font-variant-numeric:tabular-nums; }
.sw-landing .rate .per { font-family:"IBM Plex Mono",monospace; font-size:13px; color:var(--muted); letter-spacing:.06em; }
.sw-landing .rate .what { font-family:"Space Grotesk",sans-serif; font-weight:500; font-size:17px; color:var(--ink); }
.sw-landing .rate p { color:var(--ink-soft); font-size:14.5px; line-height:1.6; }
.sw-landing .rate-list { list-style:none; margin:4px 0 0; padding:0; display:flex; flex-direction:column; gap:9px; }
.sw-landing .rate-list li { font-size:14.5px; color:var(--ink-soft); display:flex; gap:11px; align-items:baseline; }
.sw-landing .rate-list li::before { content:"+"; font-family:"IBM Plex Mono",monospace; color:var(--accent); font-weight:600; flex:0 0 auto; }
.sw-landing .rate-cta { margin-top:8px; display:flex; flex-direction:column; gap:12px; align-items:flex-start; }
.sw-landing .rate-note { font-family:"IBM Plex Mono",monospace; font-size:12.5px; color:var(--muted); letter-spacing:.03em; }

/* ---- faq: native details/summary, so it works with no JS and stays keyboard
   and screen-reader navigable for free. ---- */
.sw-landing .faq { max-width:80ch; border-top:1px solid var(--line-2); }
.sw-landing .faq details { border-bottom:1px solid var(--line); }
.sw-landing .faq summary {
  cursor:pointer; list-style:none; padding:20px 40px 20px 0; position:relative;
  font-family:"Space Grotesk",sans-serif; font-weight:500; font-size:17.5px; color:var(--ink);
}
.sw-landing .faq summary::-webkit-details-marker { display:none; }
.sw-landing .faq summary::after {
  content:"+"; position:absolute; right:8px; top:50%; transform:translateY(-50%);
  font-family:"IBM Plex Mono",monospace; font-size:20px; color:var(--accent); line-height:1;
}
.sw-landing .faq details[open] summary::after { content:"–"; }
.sw-landing .faq summary:hover { color:var(--accent-deep); }
.sw-landing .faq .ans { padding:0 40px 24px 0; color:var(--ink-soft); font-size:15.5px; line-height:1.7; }
.sw-landing .faq .ans b { color:var(--ink); font-weight:600; }

.sw-landing .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:0; }
@media (max-width:780px){ .sw-landing .steps { grid-template-columns:1fr; } }
.sw-landing .step { padding:30px 30px 34px; border-left:1px solid var(--line-2); }
.sw-landing .step:first-child { border-left:none; padding-left:0; }
@media (max-width:780px){ .sw-landing .step { border-left:none; border-top:1px solid var(--line-2); padding:26px 0; } .sw-landing .step:first-child { border-top:none; } }
.sw-landing .step .idx { font-family:"IBM Plex Mono",monospace; font-size:13px; font-weight:600; color:var(--accent); letter-spacing:.1em; }
.sw-landing .step h3 { font-size:21px; margin:14px 0 10px; }
.sw-landing .step p { color:var(--ink-soft); font-size:15px; }

.sw-landing .story {
  color:var(--on-dark);
  background:
    repeating-linear-gradient(115deg, transparent 0 46px, var(--lattice) 46px 48px),
    var(--hero-2);
}
.sw-landing .story-in { padding:clamp(64px,9vw,104px) 0; display:grid; grid-template-columns:1fr 1fr; gap:56px; align-items:center; }
@media (max-width:860px){ .sw-landing .story-in { grid-template-columns:1fr; gap:36px; } }
.sw-landing .story .eyebrow { color:var(--accent); }
.sw-landing .story .eyebrow::before { background:var(--accent); }
.sw-landing .story h2 { color:var(--on-dark); font-size:clamp(26px,3.6vw,38px); margin:18px 0 20px; }
.sw-landing .story p { color:var(--on-dark-soft); font-size:16.5px; margin-bottom:16px; }
.sw-landing .quote {
  border-top:2px solid var(--accent); border-bottom:1px solid rgba(237,230,218,.18);
  padding:22px 0; font-family:"Space Grotesk",sans-serif; font-weight:500;
  font-size:clamp(20px,2.6vw,26px); color:var(--on-dark); line-height:1.3;
}
.sw-landing .quote .by { display:block; margin-top:14px; font-family:"IBM Plex Mono",monospace; font-size:12px; font-weight:400; letter-spacing:.06em; color:var(--on-dark-soft); }
.sw-landing .story-facts { display:flex; flex-direction:column; gap:0; border:1px solid rgba(237,230,218,.18); border-radius:5px; overflow:hidden; }
.sw-landing .fact { display:flex; justify-content:space-between; gap:16px; padding:16px 20px; border-bottom:1px solid rgba(237,230,218,.14); }
.sw-landing .fact:last-child { border-bottom:none; }
.sw-landing .fact .k { font-family:"IBM Plex Mono",monospace; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); }
.sw-landing .fact .v { font-size:15px; color:var(--on-dark); text-align:right; }

.sw-landing .cta-band { padding:clamp(56px,8vw,92px) 0; text-align:center; border-bottom:1px solid var(--line); }
.sw-landing .cta-band h2 { font-size:clamp(28px,4.4vw,46px); }
.sw-landing .cta-band p { margin:16px auto 0; max-width:46ch; color:var(--ink-soft); font-size:18px; }
.sw-landing .cta-actions { margin-top:30px; display:flex; gap:14px; justify-content:center; flex-wrap:wrap; }
.sw-landing .cta-band p.cta-note { margin-top:18px; font-family:"IBM Plex Mono",monospace; font-size:13px; letter-spacing:.03em; color:var(--muted); }

.sw-landing .tb { background:var(--surface); }
.sw-landing .tb-in { padding:44px 0 40px; display:grid; grid-template-columns:1.4fr 1fr 1fr; gap:34px; }
@media (max-width:760px){ .sw-landing .tb-in { grid-template-columns:1fr 1fr; gap:26px; } }
.sw-landing .tb .brand .wm { font-size:18px; }
.sw-landing .tb .tag { margin-top:12px; color:var(--ink-soft); font-size:14px; max-width:30ch; }
.sw-landing .tb h4 { font-family:"IBM Plex Mono",monospace; font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); margin:0 0 14px; font-weight:600; }
.sw-landing .tb ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px; }
.sw-landing .tb ul a, .sw-landing .tb ul button { color:var(--ink-soft); font-size:14.5px; background:none; border:none; padding:0; cursor:pointer; font-family:inherit; text-align:left; }
.sw-landing .tb ul a:hover, .sw-landing .tb ul button:hover { color:var(--accent-deep); text-decoration:underline; }
.sw-landing .tb-rule { border-top:1px solid var(--line); }
.sw-landing .tb-foot { padding:16px 0 30px; display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap; font-family:"IBM Plex Mono",monospace; font-size:11px; letter-spacing:.08em; color:var(--muted); }

.sw-landing .reveal { opacity:0; transform:translateY(18px); transition:opacity .7s ease, transform .7s ease; }
.sw-landing .reveal.in { opacity:1; transform:none; }
@media (prefers-reduced-motion: reduce){ .sw-landing .reveal { opacity:1; transform:none; transition:none; } }
`;

const Badge = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect className="mk-rect" x="4" y="4" width="56" height="56" rx="10" />
    <path className="mk-stroke" d="M14 20 L22 44 L32 24 L42 44 L50 20" fill="none" strokeWidth="5" strokeLinecap="square" />
  </svg>
);

export default function LandingPage({ onSignIn, onStart, onShowTerms }) {
  const [theme, setTheme] = useState(null); // null = follow OS preference
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const items = root.querySelectorAll(".reveal");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("in");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const scrollTo = (id) => (e) => {
    e.preventDefault();
    const el = rootRef.current?.querySelector(`#${id}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const toggleTheme = () =>
    setTheme((t) => {
      const osDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const current = t || (osDark ? "dark" : "light");
      return current === "dark" ? "light" : "dark";
    });

  const scrollTop = (e) => {
    e.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rootRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="sw-landing" ref={rootRef} data-sw-theme={theme || undefined}>
      <style>{CSS}</style>

      {/* ── NAV ── */}
      <header className="nav">
        <div className="wrap nav-in">
          <a className="brand" href="#top" onClick={scrollTop} aria-label="Steadwerk home">
            <Badge size={34} />
            <span className="wm">STEADWERK</span>
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a href="#features" onClick={scrollTo("features")}>What it does</a>
            <a href="#glimpse" onClick={scrollTo("glimpse")}>In the wild</a>
            <a href="#pricing" onClick={scrollTo("pricing")}>Pricing</a>
            <a href="#story" onClick={scrollTo("story")}>Story</a>
          </nav>
          <div className="nav-actions">
            <button className="theme-btn nav-hide-sm" type="button" onClick={toggleTheme} aria-label="Switch light or dark theme">◐</button>
            <button className="btn btn-ghost" type="button" onClick={onSignIn}>Sign in</button>
            {/* Not nav-hide-sm: this is the primary conversion action, and hiding it
                below 820px stripped it from the sticky bar on exactly the phones
                most of these visitors are holding. Only the theme toggle folds. */}
            <button className="btn btn-primary" type="button" onClick={onStart}>Start your company</button>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="hero" id="top">
        <div className="wrap hero-in">
          <div className="hero-grid">
            <div>
              <span className="eyebrow">Warehouse &amp; Fleet · Fort Wayne, IN</span>
              <h1>Tools that work<br />as hard as <span className="amb">you do.</span></h1>
              <p className="hero-sub">Warehouse and fleet software for the crews who run on trucks, materials, and people. Set up in an afternoon. Home by supper.</p>
              <div className="hero-cta">
                <button className="btn btn-primary btn-lg" type="button" onClick={onStart}>Start your company</button>
                <a className="btn hero-ghost btn-lg" href="#glimpse" onClick={scrollTo("glimpse")}>See it in the wild</a>
              </div>
              <div className="hero-meta">
                <span><b>No IT department.</b> No six-figure system.</span>
                <span><b>Works offline.</b>  The yard doesn't always have signal.</span>
              </div>
            </div>
            <div className="truss-art">
              <svg viewBox="0 0 260 150" className="truss-draw" role="img" aria-label="Steadwerk truss mark">
                <path className="mk-stroke" d="M20 40 L70 130 L110 60 L150 130 L190 60 L230 130 L240 40" fill="none" strokeWidth="7" strokeLinecap="square" strokeLinejoin="miter" />
                <path d="M20 40 L240 40" fill="none" stroke="rgba(237,230,218,.28)" strokeWidth="2" strokeDasharray="4 6" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* ── STRIP ── */}
      <section className="strip">
        <div className="wrap strip-in reveal">
          <div>
            <span className="eyebrow">The part that steals your evenings</span>
            <h2 style={{ marginTop: 16 }}>Steadwerk carries the counting, so the crew can carry the work.</h2>
          </div>
          <div className="steal-list">
            <div className="steal"><span className="n">01</span><span className="t">The counting. Then the <b>re-counting</b>.</span></div>
            <div className="steal"><span className="n">02</span><span className="t">The <b>"where's Truck 3"</b> phone calls.</span></div>
            <div className="steal"><span className="n">03</span><span className="t">The materials <b>nobody logged</b>.</span></div>
            <div className="steal"><span className="n">04</span><span className="t">The jobs <b>nobody closed out</b>.</span></div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="band" id="features">
        <div className="wrap">
          <div className="band-head reveal">
            <span className="eyebrow">What it does</span>
            <h2>Every truck, every roll, tracked.</h2>
            <p>One system for the yard, the fleet, and the office. Built for small trades, service, and distribution companies that run on what's on the shelf and out on the road.</p>
          </div>
          <div className="ledger reveal">
            <div className="cell"><span className="code">INV</span><h3>Inventory</h3><div className="lead">Every roll, every box, counted once.</div><p>FIFO batches and live low-stock signals that read from green to red across the warehouse in half a second.</p></div>
            <div className="cell"><span className="code">JOB</span><h3>Jobs</h3><div className="lead">Draft to closed-out, one thread.</div><p>Build the job, pull the materials to it, complete it, and the close-out report writes itself.</p></div>
            <div className="cell"><span className="code">FLT</span><h3>Fleet</h3><div className="lead">"Where's Truck 3?" On the screen.</div><p>Trucks, trailers, mileage, oil, and services are tracked, not guessed at from the cab of another one.</p></div>
            <div className="cell"><span className="code">MNT</span><h3>Maintenance</h3><div className="lead">Flag it from the cab.</div><p>Crews report a problem the moment it starts. Managers see it before it becomes a breakdown.</p></div>
            <div className="cell"><span className="code">RPT</span><h3>Reports</h3><div className="lead">Job complete. Report's ready.</div><p>Costed from the batches actually used on the job, never a price typed in twice, never a guess.</p></div>
            <div className="cell"><span className="code">CRW</span><h3>Crew &amp; access</h3><div className="lead">Everyone sees their part.</div><p>Per-role access so the yard, the office, and the books each get the view that fits the work they do.</p></div>
          </div>
        </div>
      </section>

      {/* ── PRODUCT GLIMPSE ── */}
      <section className="glass" id="glimpse">
        <div className="wrap band">
          <div className="band-head reveal">
            <span className="eyebrow">In the wild · Inventory</span>
            <h2>Low stock reads from across the yard.</h2>
            <p>Green is good. Amber wants a hand on it. Red says stop. The same signal a foreman would give on every screen, updated as the crew pulls.</p>
          </div>
          <div className="mock reveal">
            <div className="mock-bar">
              <span className="ttl">
                <svg width="18" height="18" viewBox="0 0 40 40" aria-hidden="true"><path className="mk-stroke" d="M4 8 L12 32 L20 12 L28 32 L36 8" fill="none" strokeWidth="5" strokeLinecap="square" /></svg>
                Bay A · Roofing
              </span>
              <span className="meta">SYNCED · 06:04 AM</span>
            </div>
            <div className="tbl-scroll">
              <table className="inv">
                <thead>
                  <tr><th>Item</th><th>Location</th><th className="num">On hand</th><th className="num">Reorder</th><th>Status</th></tr>
                </thead>
                <tbody>
                  <tr><td className="item">Weathered Wood Architectural Shingle</td><td className="loc">A-3</td><td className="num tnum">142 bd</td><td className="num tnum">40</td><td><span className="pill ok">In stock</span></td></tr>
                  <tr><td className="item">Ice &amp; Water Shield, 3 ft</td><td className="loc">B-1</td><td className="num tnum">6 rl</td><td className="num tnum">8</td><td><span className="pill low">Low</span></td></tr>
                  <tr><td className="item">Ridge Cap, Amber</td><td className="loc">A-1</td><td className="num tnum">0 bx</td><td className="num tnum">12</td><td><span className="pill out">Out</span></td></tr>
                  <tr><td className="item">Drip Edge, 10 ft White</td><td className="loc">C-2</td><td className="num tnum">88 pc</td><td className="num tnum">30</td><td><span className="pill ok">In stock</span></td></tr>
                  <tr><td className="item">Roofing Nails, 1¼" Coil</td><td className="loc">D-4</td><td className="num tnum">19 bx</td><td className="num tnum">20</td><td><span className="pill low">Low</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <p className="cap reveal">// pulled to jobs in real time · costs derive from the batch actually consumed</p>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="band" id="how">
        <div className="wrap">
          <div className="band-head reveal">
            <span className="eyebrow">The raising · Three steps</span>
            <h2>Set up in an afternoon.</h2>
          </div>
          <div className="steps reveal">
            <div className="step"><span className="idx">STEP 01</span><h3>Raise the frame</h3><p>Add your yard, your trucks, and your crew. Enter what you've got on the shelf, or bring it in from where it already lives.</p></div>
            <div className="step"><span className="idx">STEP 02</span><h3>Run the day</h3><p>Pull materials to jobs, track the fleet, flag maintenance from the office desk or the cab of a truck with no signal.</p></div>
            <div className="step"><span className="idx">STEP 03</span><h3>Home by supper</h3><p>Jobs close themselves out with a costed report. The counting's done before you've hung up your coat.</p></div>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="band glass" id="pricing">
        <div className="wrap">
          <div className="band-head reveal">
            <span className="eyebrow">The rate sheet</span>
            <h2>One price. Ten people. No quote to sit through.</h2>
            <p>Most systems for this make you book a call to hear a number. Here it is.</p>
          </div>
          <div className="rates reveal">
            <div className="rate lead-rate">
              <span className="code">BASE</span>
              <div className="fig">
                <span className="amt">${BASE_PRICE}</span>
                <span className="per">/ month</span>
              </div>
              <div className="what">Everything, for up to {BASE_SEATS} people.</div>
              <p>Inventory, jobs, fleet, maintenance, costed reports, and per-role access for the whole crew. This isn't a starter tier. It's the whole thing.</p>
              <div className="rate-cta">
                <button className="btn btn-primary btn-lg" type="button" onClick={onStart}>Start your company</button>
                <span className="rate-note">// {TRIAL_DAYS} days free · cancel anytime · no setup fee</span>
              </div>
            </div>
            <div className="rate">
              <span className="code">CREW PACK</span>
              <div className="fig">
                <span className="amt">${PACK_PRICE}</span>
                <span className="per">once, per pack</span>
              </div>
              <div className="what">Another {PACK_SEATS} people, whenever you need them.</div>
              <ul className="rate-list">
                <li>Buy a pack from your Billing tab in two clicks.</li>
                <li>You pay the ${PACK_PRICE} once. It's not another subscription.</li>
                <li>The seats stay yours for as long as you're with us.</li>
              </ul>
              <p>Hire five in the spring and it costs you ${PACK_PRICE}, one time. Your monthly bill is still ${BASE_PRICE}.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──
          Native <details> so it works before React hydrates, keyboard-navigates
          for free, and stays open to Ctrl+F. Every answer here is checked against
          what the product actually does — the offline answer in particular is
          scoped to queued writes, which is what offlineSync.js really provides. */}
      <section className="band" id="faq">
        <div className="wrap">
          <div className="band-head reveal">
            <span className="eyebrow">Straight answers</span>
            <h2>The questions you'd ask on the phone.</h2>
          </div>
          <div className="faq reveal">
            <details>
              <summary>What does it cost, all in?</summary>
              <div className="ans">
                <b>${BASE_PRICE} a month</b> covers up to {BASE_SEATS} people and every feature. Nothing gets held back for a bigger plan. Past {BASE_SEATS}, another {PACK_SEATS} people cost <b>${PACK_PRICE} one time</b>, not another monthly line. No setup fee, no per-job fee, no onboarding charge.
              </div>
            </details>
            <details>
              <summary>Is there a free trial?</summary>
              <div className="ans">
                Yes, <b>{TRIAL_DAYS} days</b>. We take card details at signup so nothing stops working the day the trial ends, but you aren't charged until it does. Cancel before then and you pay nothing.
              </div>
            </details>
            <details>
              <summary>How long does setup actually take?</summary>
              <div className="ans">
                An afternoon. Add your yard, your trucks, and your crew, then enter what's on the shelf or bring it in from where it already lives. You don't need an IT person, a consultant, or a training week.
              </div>
            </details>
            <details>
              <summary>What happens when the yard has no signal?</summary>
              <div className="ans">
                The app still opens, and anything your crew records is <b>held on the device and synced the moment signal comes back</b>. Nobody loses a pull because they were behind a building. Live figures do need a connection. We'd rather tell you honestly that you're offline than show you a stale count you might order against.
              </div>
            </details>
            <details>
              <summary>Can I cancel?</summary>
              <div className="ans">
                Any time, from your own Billing tab. It opens the Stripe portal, where you change or cancel the subscription yourself. It's month to month. No contract, no notice period, and nobody you have to get past on the phone.
              </div>
            </details>
            <details>
              <summary>Who can see my company's data?</summary>
              <div className="ans">
                Only your company. Every record is scoped to the company that owns it and enforced at the database, not just hidden in the interface. Inside your company you set per-role access, so the yard, the office, and the books each see the part that fits their work.
              </div>
            </details>
            <details>
              <summary>Is this only for roofers?</summary>
              <div className="ans">
                It was built in a roofing yard, which is why the inventory and job costing are specific instead of generic. But it fits any crew running on trucks, materials, and people. Trades, service, and distribution companies all work the same way underneath.
              </div>
            </details>
            <details>
              <summary>What if I already track this in spreadsheets?</summary>
              <div className="ans">
                Then you already have the data, and bringing it in is the first afternoon's work. The difference isn't the counting. It's that the count updates itself when a crew pulls material, and the job's cost comes from the batches actually used instead of a price somebody typed in twice.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* ── STORY ── */}
      <section className="story" id="story">
        <div className="wrap story-in">
          <div className="reveal">
            <span className="eyebrow">The story</span>
            <h2>Raised the old way. Built for a smarter one.</h2>
            <p>Steadwerk started with a kid raised in the old way. Amish roots taught that work is done right or done again, that you show up before the sun and don't complain. But he kept asking a question the old way couldn't answer: <b style={{ color: "var(--on-dark)", fontWeight: 600 }}>What if the tools worked as hard as we do?</b></p>
            <p>Not to replace the work, but to carry the part of it that steals your evenings. So Steadwerk was born in Fort Wayne, Indiana: warehouse and fleet software with a work ethic, so the work runs steady, and the people who do it get home for supper.</p>
          </div>
          <div className="reveal">
            <div className="quote">
              "Raised to work hard. Built so you work smart."
              <span className="by">· Steadwerk, Fort Wayne IN</span>
            </div>
            <div className="story-facts" style={{ marginTop: 26 }}>
              <div className="fact"><span className="k">Built for</span><span className="v">Trades · service · distribution</span></div>
              <div className="fact"><span className="k">Needs</span><span className="v">No IT team, no six-figure system</span></div>
              <div className="fact"><span className="k">Promise</span><span className="v">Work runs steady</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="cta-band" id="start">
        <div className="wrap reveal">
          <h2>Save an hour every morning.</h2>
          <p>Start your company on Steadwerk today. Set up this afternoon; the yard runs steady by tomorrow.</p>
          <div className="cta-actions">
            <button className="btn btn-primary btn-lg" type="button" onClick={onStart}>Start your company</button>
            <button className="btn btn-ghost btn-lg" type="button" onClick={onSignIn}>Sign in</button>
          </div>
          <p className="cta-note">{TRIAL_DAYS} days free, then ${BASE_PRICE}/month for up to {BASE_SEATS} people. Cancel any time.</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="tb">
        <div className="wrap tb-in">
          <div>
            <div className="brand">
              <Badge size={30} />
              <span className="wm">STEADWERK</span>
            </div>
            <p className="tag">Tools that work as hard as you do. Warehouse &amp; fleet software from a small shop in Fort Wayne, Indiana.</p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li><a href="#features" onClick={scrollTo("features")}>Inventory</a></li>
              <li><a href="#features" onClick={scrollTo("features")}>Fleet</a></li>
              <li><a href="#features" onClick={scrollTo("features")}>Jobs &amp; reports</a></li>
              <li><a href="#glimpse" onClick={scrollTo("glimpse")}>In the wild</a></li>
              <li><a href="#pricing" onClick={scrollTo("pricing")}>Pricing</a></li>
              <li><a href="#faq" onClick={scrollTo("faq")}>FAQ</a></li>
            </ul>
          </div>
          <div>
            <h4>Company</h4>
            <ul>
              <li><a href="#story" onClick={scrollTo("story")}>Our story</a></li>
              <li><button type="button" onClick={onStart}>Start your company</button></li>
              <li><button type="button" onClick={onSignIn}>Sign in</button></li>
              <li><button type="button" onClick={onShowTerms}>Terms &amp; Conditions</button></li>
              <li><a href="mailto:help@steadwerk.com">help@steadwerk.com</a></li>
            </ul>
          </div>
        </div>
        <div className="tb-rule">
          <div className="wrap tb-foot">
            <span>STEADWERK · "THE RAISING" · WORK RUNS STEADY.</span>
            <span>© {new Date().getFullYear()} STEADWERK · FORT WAYNE, IN</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
