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
// RECURRING, per month, per pack. This was a one-time charge until supabase/27 moved
// crew packs back onto the subscription; the copy below says "a month" in three places
// and the FAQ in a fourth. Advertising a one-time price against a recurring charge is
// the exact refund request the note above warns about, so if this ever moves again,
// move the words with it.
const PACK_PRICE = 10;
const PACK_SEATS = 5;
// Applies to BOTH cadences. trial_period_days lives on subscription_data in
// create-checkout, not on a price, so it covers whichever of the monthly or
// annual Price ends up in line_items.
const TRIAL_DAYS = 14;
// Discounted 12-month prepay. Must match the STRIPE_ANNUAL_PRICE_ID amount and the
// display prices in LoginScreen's signup toggle.
const ANNUAL_PRICE = 990;
const ANNUAL_SAVINGS_PCT = Math.round((1 - ANNUAL_PRICE / (BASE_PRICE * 12)) * 100);

const CSS = `
.sw-landing {
  --ground:#F6F3EC; --surface:#FFFFFF; --surface-2:#EDE6DA;
  --ink:#23282D; --ink-soft:#515960; --muted:#6E7780;
  --line:rgba(35,40,45,.14); --line-2:rgba(35,40,45,.30);
  --accent:#C97B2D; --accent-deep:#8A5A2B; --good:#4A7A5C; --signal:#D64545;
  --hero-1:#2F353C; --hero-2:#23282D; --hero-3:#171B1F;
  --on-dark:#EDE6DA; --on-dark-soft:rgba(237,230,218,.70);
  --lattice:rgba(201,123,45,.06); --shadow:0 1px 2px rgba(35,40,45,.05), 0 8px 20px rgba(35,40,45,.07), 0 24px 48px rgba(35,40,45,.06); --shadow-lift:0 1px 2px rgba(35,40,45,.05), 0 12px 30px rgba(35,40,45,.11); --nav-shadow:0 6px 20px rgba(35,40,45,.07);

  /* Film grain, generated in-place so it costs no request and no asset. Painted
     over the dark sections at low opacity, it breaks up the flat gradient banding
     that large color fields show on wide screens. */
  --grain:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E");

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
    --lattice:rgba(219,149,80,.07); --shadow:0 1px 2px rgba(0,0,0,.35), 0 10px 24px rgba(0,0,0,.32), 0 28px 56px rgba(0,0,0,.30); --shadow-lift:0 1px 2px rgba(0,0,0,.34), 0 14px 34px rgba(0,0,0,.46); --nav-shadow:0 8px 24px rgba(0,0,0,.38);
  }
}
.sw-landing[data-sw-theme="dark"] {
  --ground:#191D21; --surface:#23282D; --surface-2:#2B3137;
  --ink:#ECE6DA; --ink-soft:#A7AEB5; --muted:#8A929A;
  --line:rgba(237,230,218,.14); --line-2:rgba(237,230,218,.26);
  --accent:#DB9550; --accent-deep:#E7A968; --good:#7AAE8C; --signal:#E06B6B;
  --hero-1:#2A2F35; --hero-2:#20242A; --hero-3:#14171A;
  --lattice:rgba(219,149,80,.07); --shadow:0 1px 2px rgba(0,0,0,.35), 0 10px 24px rgba(0,0,0,.32), 0 28px 56px rgba(0,0,0,.30); --shadow-lift:0 1px 2px rgba(0,0,0,.34), 0 14px 34px rgba(0,0,0,.46); --nav-shadow:0 8px 24px rgba(0,0,0,.38);
}
.sw-landing[data-sw-theme="light"] {
  --ground:#F6F3EC; --surface:#FFFFFF; --surface-2:#EDE6DA;
  --ink:#23282D; --ink-soft:#515960; --muted:#6E7780;
  --line:rgba(35,40,45,.14); --line-2:rgba(35,40,45,.30);
  --accent:#C97B2D; --accent-deep:#8A5A2B; --good:#4A7A5C; --signal:#D64545;
  --hero-1:#2F353C; --hero-2:#23282D; --hero-3:#171B1F;
  --lattice:rgba(201,123,45,.06); --shadow:0 1px 2px rgba(35,40,45,.05), 0 8px 20px rgba(35,40,45,.07), 0 24px 48px rgba(35,40,45,.06); --shadow-lift:0 1px 2px rgba(35,40,45,.05), 0 12px 30px rgba(35,40,45,.11); --nav-shadow:0 6px 20px rgba(35,40,45,.07);
}

.sw-landing, .sw-landing *, .sw-landing *::before, .sw-landing *::after { box-sizing:border-box; }
.sw-landing h1, .sw-landing h2, .sw-landing h3 { font-family:"Space Grotesk", ui-sans-serif, system-ui, sans-serif; font-weight:700; margin:0; line-height:1.05; letter-spacing:-.02em; text-wrap:balance; }
.sw-landing p { margin:0; }
.sw-landing a { color:var(--accent-deep); text-decoration:none; }
.sw-landing a:hover { text-decoration:underline; text-underline-offset:3px; }
.sw-landing :focus-visible { outline:2.5px solid var(--accent); outline-offset:3px; border-radius:2px; }

/* The side insets keep content off the rounded corners and the notch when the
   installed app is held in landscape. Both resolve to 0px on every other device
   and orientation, so this stays the plain 28px gutter it has always been. */
.sw-landing .wrap {
  width:100%; max-width:1120px; margin:0 auto;
  padding:0 calc(28px + var(--safe-right)) 0 calc(28px + var(--safe-left));
}
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
  transition:background .18s ease, color .18s ease, border-color .18s ease, transform .12s ease, box-shadow .22s ease;
  text-decoration:none; line-height:1;
}
.sw-landing .btn:hover { text-decoration:none; }
.sw-landing .btn:active { transform:translateY(1px); }
.sw-landing .btn-primary { background:var(--accent); color:#23282D; box-shadow:0 0 0 0 rgba(0,0,0,0); }
.sw-landing .btn-primary:hover { background:var(--accent-deep); color:#231a10; box-shadow:0 8px 24px color-mix(in srgb, var(--accent) 40%, transparent); }
/* The arrow is a pseudo-element rather than markup so it never lands in the
   accessible name of the button. The flex gap on .btn spaces it. */
.sw-landing .btn-primary::after {
  content:"\\2192"; font-size:15px; line-height:1; opacity:.72; transform:translateX(-2px);
  transition:transform .24s cubic-bezier(.2,.8,.2,1), opacity .24s ease;
}
.sw-landing .btn-primary:hover::after { transform:translateX(3px); opacity:1; }
.sw-landing .btn-play::before {
  content:"\\25B6"; font-size:11px; line-height:1; color:var(--accent);
  transition:transform .24s cubic-bezier(.2,.8,.2,1);
}
.sw-landing .btn-play:hover::before { transform:scale(1.25); }
@media (prefers-reduced-motion: reduce){
  .sw-landing .btn-primary::after, .sw-landing .btn-play::before { transition:none; }
}
.sw-landing .btn-ghost { background:transparent; color:var(--ink); border-color:var(--line-2); }
.sw-landing .btn-ghost:hover { border-color:var(--accent); color:var(--accent-deep); }
.sw-landing .btn-lg { padding:16px 28px; font-size:16.5px; }

.sw-landing .nav {
  position:sticky; top:0; z-index:50;
  /* Installed on an iPhone home screen, the app owns the whole screen and iOS
     paints the clock and battery ON TOP of this bar (see the black-translucent
     status-bar style in index.html). Without this the wordmark renders underneath
     the clock and the CTA underneath the battery.

     It has to be PADDING, not a margin or a top offset: the bar's blurred
     translucent background then extends up behind the status bar, so the clock
     sits on the nav's own ground instead of on whatever section happens to be
     scrolling past underneath it. --safe-top is 0px everywhere else, so desktop
     and ordinary browser tabs are untouched. */
  padding-top:var(--safe-top);
  background:color-mix(in srgb, var(--ground) 88%, transparent);
  backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); border-bottom:1px solid var(--line);
  transition:background .28s ease, box-shadow .28s ease;
}
/* Once the page has moved, the bar tightens and opaques up. Sitting at the very
   top it stays tall and near-transparent so the hero reads as full bleed. */
.sw-landing .nav.is-scrolled {
  background:color-mix(in srgb, var(--ground) 96%, transparent);
  box-shadow:var(--nav-shadow);
}
.sw-landing .nav-in {
  display:flex; align-items:center; justify-content:space-between; height:66px;
  transition:height .3s cubic-bezier(.2,.8,.2,1);
}
.sw-landing .nav.is-scrolled .nav-in { height:56px; }

/* Scroll progress. Written straight to the node's transform from a rAF-throttled
   listener, not through React state, so scrolling does not re-render the page. */
.sw-landing .nav-prog {
  position:absolute; left:0; right:0; bottom:-1px; height:2px; background:var(--accent);
  transform:scaleX(0); transform-origin:left center; will-change:transform;
}
@media (prefers-reduced-motion: reduce){
  .sw-landing .nav, .sw-landing .nav-in { transition:none; }
}
.sw-landing .brand { display:flex; align-items:center; gap:11px; cursor:pointer; }
.sw-landing .brand .wm { font-family:"Space Grotesk", sans-serif; font-weight:700; font-size:19px; letter-spacing:.06em; color:var(--ink); }
.sw-landing .nav-links { display:flex; align-items:center; gap:28px; }
.sw-landing .nav-links a { color:var(--ink-soft); font-size:15px; font-weight:500; position:relative; transition:color .2s ease; }
.sw-landing .nav-links a:hover { color:var(--accent-deep); text-decoration:none; }
.sw-landing .nav-links a.on { color:var(--ink); }
.sw-landing .nav-links a::after {
  content:""; position:absolute; left:0; right:0; bottom:-7px; height:2px; background:var(--accent);
  transform:scaleX(0); transform-origin:left center;
  transition:transform .28s cubic-bezier(.2,.8,.2,1);
}
.sw-landing .nav-links a:hover::after, .sw-landing .nav-links a.on::after { transform:scaleX(1); }
@media (prefers-reduced-motion: reduce){ .sw-landing .nav-links a::after { transition:none; } }
.sw-landing .nav-actions { display:flex; align-items:center; gap:14px; }
.sw-landing .theme-btn {
  background:transparent; border:1px solid var(--line-2); color:var(--ink-soft);
  width:38px; height:38px; border-radius:3px; cursor:pointer; display:grid; place-items:center;
  font-size:15px; transition:border-color .18s, color .18s; flex:0 0 auto;
}
.sw-landing .theme-btn:hover { border-color:var(--accent); color:var(--accent-deep); }

/* ---- sun/moon morph. The crescent is a mask circle parked off the icon in
   light mode; sliding it over the orb bites the moon shape out. Driven purely
   off the same data-sw-theme selectors the palette uses, so the icon can never
   disagree with the colors on screen. transform-box:view-box makes the pixel
   transform-origin below resolve against the 24x24 viewBox. ---- */
.sw-landing .theme-icon { display:block; overflow:visible; }
.sw-landing .theme-icon .tm-cut,
.sw-landing .theme-icon .tm-rays,
.sw-landing .theme-icon .tm-orb { transform-box:view-box; transform-origin:12px 12px; }
.sw-landing .theme-icon .tm-cut { transform:translate(0,0); transition:transform .42s cubic-bezier(.2,.8,.2,1); }
.sw-landing .theme-icon .tm-rays { opacity:1; transform:scale(1); transition:opacity .28s ease, transform .42s cubic-bezier(.2,.8,.2,1); }
.sw-landing .theme-icon .tm-orb { transform:scale(.8); transition:transform .42s cubic-bezier(.2,.8,.2,1); }

@media (prefers-color-scheme: dark) {
  .sw-landing:not([data-sw-theme="light"]) .theme-icon .tm-cut { transform:translate(-7px,-3px); }
  .sw-landing:not([data-sw-theme="light"]) .theme-icon .tm-rays { opacity:0; transform:scale(.35); }
  .sw-landing:not([data-sw-theme="light"]) .theme-icon .tm-orb { transform:scale(1); }
}
.sw-landing[data-sw-theme="dark"] .theme-icon .tm-cut { transform:translate(-7px,-3px); }
.sw-landing[data-sw-theme="dark"] .theme-icon .tm-rays { opacity:0; transform:scale(.35); }
.sw-landing[data-sw-theme="dark"] .theme-icon .tm-orb { transform:scale(1); }
.sw-landing[data-sw-theme="light"] .theme-icon .tm-cut { transform:translate(0,0); }
.sw-landing[data-sw-theme="light"] .theme-icon .tm-rays { opacity:1; transform:scale(1); }
.sw-landing[data-sw-theme="light"] .theme-icon .tm-orb { transform:scale(.8); }
@media (prefers-reduced-motion: reduce){
  .sw-landing .theme-icon .tm-cut,
  .sw-landing .theme-icon .tm-rays,
  .sw-landing .theme-icon .tm-orb { transition:none; }
}

/* ---- mobile nav: below 820px the desktop links and the secondary actions fold
   into a burger-driven sheet. Before this they simply vanished, which left phone
   visitors with no route to pricing, the demo, or sign-in. ---- */
.sw-landing .nav-burger {
  display:none; background:transparent; border:1px solid var(--line-2); border-radius:3px;
  width:38px; height:38px; cursor:pointer; padding:0; place-items:center; flex:0 0 auto;
  transition:border-color .18s ease;
}
.sw-landing .nav-burger:hover { border-color:var(--accent); }
.sw-landing .nav-burger i {
  display:block; width:16px; height:1.5px; background:var(--ink-soft); border-radius:2px;
  transition:transform .26s cubic-bezier(.2,.8,.2,1), opacity .18s ease;
}
.sw-landing .nav-burger i + i { margin-top:4px; }
.sw-landing .nav-burger[aria-expanded="true"] i:nth-child(1) { transform:translateY(5.5px) rotate(45deg); }
.sw-landing .nav-burger[aria-expanded="true"] i:nth-child(2) { opacity:0; }
.sw-landing .nav-burger[aria-expanded="true"] i:nth-child(3) { transform:translateY(-5.5px) rotate(-45deg); }

.sw-landing .nav-sheet {
  display:none; overflow:hidden; max-height:0;
  background:color-mix(in srgb, var(--ground) 96%, transparent);
  backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
  transition:max-height .34s cubic-bezier(.2,.8,.2,1);
}
/* No border-bottom here: the sticky header already carries one, and the sheet
   sits flush inside it, so adding a second draws a doubled 2px rule. */
.sw-landing .nav-sheet.open { max-height:420px; }
.sw-landing .nav-sheet-in { padding:8px 28px 20px; display:flex; flex-direction:column; }
.sw-landing .nav-sheet a {
  color:var(--ink); font-family:"Space Grotesk",sans-serif; font-weight:500; font-size:18px;
  padding:14px 0; border-bottom:1px solid var(--line);
}
.sw-landing .nav-sheet a:hover { color:var(--accent-deep); text-decoration:none; }
.sw-landing .nav-sheet-foot { display:flex; align-items:center; gap:12px; padding-top:18px; }
.sw-landing .nav-sheet-foot .btn { flex:1 1 auto; justify-content:center; }

@media (max-width:820px){
  .sw-landing .nav-links { display:none; }
  .sw-landing .nav-hide-sm { display:none; }
  .sw-landing .nav-burger { display:grid; }
  .sw-landing .nav-sheet { display:block; }
  /* The bar is tight on a phone once the burger is in it. The CTA keeps its
     label and drops the arrow rather than the other way round. */
  .sw-landing .nav-in .btn-primary::after { display:none; }
  .sw-landing .nav-in .btn-primary { padding:12px 16px; font-size:14.5px; }
}

/* Below this the bar genuinely runs out of room: the badge, the STEADWERK
   wordmark, the full CTA label and the burger together need more than a 390px
   phone has once the 28px gutters are taken off. The CTA was wrapping onto two
   lines and shoving the burger into the battery icon.

   The wordmark is what goes. The badge still carries the brand at the top of a
   page that says STEADWERK in the hero anyway, whereas a two-line button in a
   sticky bar looks broken. nowrap makes that non-negotiable rather than relying
   on the label staying short. */
@media (max-width:430px){
  .sw-landing .brand .wm { display:none; }
  .sw-landing .nav-in .btn-primary { white-space:nowrap; padding:11px 14px; font-size:14px; }
  .sw-landing .nav-actions { gap:10px; }
}
@media (prefers-reduced-motion: reduce){
  .sw-landing .nav-sheet, .sw-landing .nav-burger i { transition:none; }
}

.sw-landing .hero {
  position:relative; overflow:hidden; color:var(--on-dark);
  background:
    repeating-linear-gradient(115deg, transparent 0 46px, var(--lattice) 46px 48px),
    radial-gradient(ellipse at 50% -10%, var(--hero-1) 0%, var(--hero-2) 55%, var(--hero-3) 100%);
  border-bottom:1px solid var(--line);
}
/* Grain first, then a pair of soft amber blooms. Both are pointer-events:none
   decoration layers, so the content above them stays fully interactive. */
.sw-landing .hero::before, .sw-landing .story::before {
  content:""; position:absolute; inset:0; pointer-events:none; z-index:0;
  background-image:var(--grain); background-size:160px 160px;
  opacity:.15; mix-blend-mode:overlay;
}
.sw-landing .hero::after {
  content:""; position:absolute; inset:0; pointer-events:none; z-index:0;
  background:
    radial-gradient(46% 56% at 20% 36%, color-mix(in srgb, var(--accent) 15%, transparent) 0%, transparent 68%),
    radial-gradient(40% 48% at 84% 70%, color-mix(in srgb, var(--accent) 9%, transparent) 0%, transparent 72%);
}
.sw-landing .hero-in { padding:clamp(64px,10vw,120px) 0 clamp(56px,8vw,104px); position:relative; z-index:1; }
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

/* Hero entrance. The hero is above the fold, so an IntersectionObserver would
   fire on all of it at once; a plain keyframe with per-child delays is what
   actually reads as a cascade here. */
@keyframes sw-rise { from { opacity:0; transform:translateY(22px); } to { opacity:1; transform:none; } }
.sw-landing .hero-rise > * { animation:sw-rise .85s cubic-bezier(.2,.8,.2,1) both; }
.sw-landing .hero-rise > *:nth-child(1) { animation-delay:.06s; }
.sw-landing .hero-rise > *:nth-child(2) { animation-delay:.14s; }
.sw-landing .hero-rise > *:nth-child(3) { animation-delay:.24s; }
.sw-landing .hero-rise > *:nth-child(4) { animation-delay:.34s; }
.sw-landing .hero-rise > *:nth-child(5) { animation-delay:.44s; }
.sw-landing .truss-art { animation:sw-rise 1s cubic-bezier(.2,.8,.2,1) .3s both; }
@media (prefers-reduced-motion: reduce){
  .sw-landing .hero-rise > *, .sw-landing .truss-art { animation:none; }
}

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

/* ---- the ledger, as a bento. Still one grid with hairline rules between the
   cells (gap:1px over the container's --line background does the ruling, so
   there are no double borders to collapse). Two cells take wider spans and
   carry a visual, which breaks the 3x2 slab into something with a reading
   order. Unit math: 2+1 / 1+1+1 / 3 fills three clean rows. ---- */
.sw-landing .ledger { display:grid; grid-template-columns:repeat(3,1fr); gap:1px; border:1px solid var(--line-2); background:var(--line); }
.sw-landing .cell-wide { grid-column:span 2; }
.sw-landing .cell-full { grid-column:span 3; }
@media (max-width:860px){
  .sw-landing .ledger { grid-template-columns:1fr 1fr; }
  .sw-landing .cell-wide, .sw-landing .cell-full { grid-column:span 2; }
}
@media (max-width:560px){
  .sw-landing .ledger { grid-template-columns:1fr; }
  .sw-landing .cell-wide, .sw-landing .cell-full { grid-column:span 1; }
}
.sw-landing .cell {
  background:var(--surface); padding:30px 28px 32px; display:flex; flex-direction:column; gap:12px;
  position:relative;
}
/* Scoped one level deeper than the .stagger child rule on purpose: that rule
   sets the transition shorthand on every direct child, and at equal specificity
   it comes later and would wipe out the hover transitions. */
.sw-landing .ledger .cell { transition:background .22s ease, box-shadow .22s ease, opacity .6s ease, transform .6s cubic-bezier(.2,.8,.2,1); }
.sw-landing .cell .code { font-family:"IBM Plex Mono",monospace; font-size:12px; font-weight:600; letter-spacing:.12em; color:var(--accent-deep); }
.sw-landing .cell h3 { font-size:20px; transition:color .22s ease; }
.sw-landing .cell .lead { font-family:"Space Grotesk",sans-serif; font-weight:500; font-size:16px; color:var(--ink); }
.sw-landing .cell p { color:var(--ink-soft); font-size:14.5px; line-height:1.6; }
.sw-landing .cell::after {
  content:""; position:absolute; top:0; left:28px; width:26px; height:3px; background:var(--accent);
  transition:width .3s cubic-bezier(.2,.8,.2,1);
}
/* Elevation by shadow rather than transform: the cells sit flush against a 1px
   ruled grid, and translating one up exposes a sliver of the rule underneath. */
/* transition-delay:0s matters here. The stagger rule at the foot of this sheet
   puts a reveal delay of up to 350ms on each cell, and without this reset that
   delay would also apply to the hover, so the card would light up a third of a
   second after the pointer landed on it. */
.sw-landing .ledger .cell:hover { background:color-mix(in srgb, var(--accent) 4%, var(--surface)); box-shadow:var(--shadow-lift); z-index:2; transition-delay:0s; }
.sw-landing .cell:hover::after { width:72px; }
.sw-landing .cell:hover h3 { color:var(--accent-deep); }
@media (prefers-reduced-motion: reduce){
  .sw-landing .cell, .sw-landing .cell h3, .sw-landing .cell::after { transition:none; }
}

/* Mini inventory read-out inside the featured cell. Bars grow once the grid
   scrolls in, which is why the width lives on a custom property. */
.sw-landing .cell-feature { display:grid; grid-template-columns:1fr auto; gap:34px; align-items:center; }
@media (max-width:640px){ .sw-landing .cell-feature { grid-template-columns:1fr; gap:24px; } }
.sw-landing .cell-feature .body { display:flex; flex-direction:column; gap:12px; }
.sw-landing .mini { display:flex; flex-direction:column; gap:12px; min-width:200px; }
.sw-landing .mini-row { display:grid; grid-template-columns:32px 1fr 40px; gap:12px; align-items:center; }
.sw-landing .mini-k { font-family:"IBM Plex Mono",monospace; font-size:11px; letter-spacing:.1em; color:var(--muted); }
.sw-landing .mini-v { font-family:"IBM Plex Mono",monospace; font-size:12px; color:var(--ink-soft); text-align:right; }
.sw-landing .mini-bar { height:6px; border-radius:3px; background:var(--surface-2); overflow:hidden; }
.sw-landing .mini-bar i { display:block; height:100%; width:0; border-radius:3px; transition:width .95s cubic-bezier(.2,.8,.2,1) .4s; }
.sw-landing .stagger.in .mini-bar i { width:var(--w); }
.sw-landing .mini-bar i.ok { background:var(--good); }
.sw-landing .mini-bar i.low { background:var(--accent); }
.sw-landing .mini-bar i.out { background:var(--signal); }
@media (prefers-reduced-motion: reduce){ .sw-landing .mini-bar i { width:var(--w); transition:none; } }

/* Role chips in the full-width crew cell. */
.sw-landing .chips { display:flex; flex-wrap:wrap; gap:8px; }
.sw-landing .chips span {
  font-family:"IBM Plex Mono",monospace; font-size:11.5px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--ink-soft); border:1px solid var(--line-2); border-radius:3px; padding:7px 12px; white-space:nowrap;
}

.sw-landing .glass { background:var(--surface-2); border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
.sw-landing .mock { background:var(--surface); border:1px solid var(--line-2); border-radius:5px; box-shadow:var(--shadow); overflow:hidden; }
.sw-landing .mock-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 18px; border-bottom:1px solid var(--line); background:var(--surface-2); }
.sw-landing .mock-bar .ttl { font-family:"Space Grotesk",sans-serif; font-weight:700; font-size:14.5px; display:flex; align-items:center; gap:9px; }
.sw-landing .mock-bar .meta { font-family:"IBM Plex Mono",monospace; font-size:11.5px; color:var(--muted); letter-spacing:.08em; display:inline-flex; align-items:center; gap:9px; }
.sw-landing .live-dot { width:7px; height:7px; border-radius:50%; background:var(--good); position:relative; flex:0 0 auto; }
.sw-landing .live-dot::after { content:""; position:absolute; inset:0; border-radius:50%; background:var(--good); animation:sw-ping 2.6s ease-out infinite; }
@keyframes sw-ping { 0% { transform:scale(1); opacity:.6; } 70%, 100% { transform:scale(2.8); opacity:0; } }
@media (prefers-reduced-motion: reduce){ .sw-landing .live-dot::after { animation:none; } }
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
/* One row crosses its reorder point a beat after the table scrolls in, so the
   green-to-amber signal the copy above describes actually happens on screen
   instead of being asserted. Held to a single row on purpose. */
@keyframes sw-flash {
  0% { background:color-mix(in srgb, var(--accent) 22%, transparent); }
  100% { background:transparent; }
}
@keyframes sw-pop { 0% { transform:scale(.84); opacity:0; } 100% { transform:scale(1); opacity:1; } }
.sw-landing table.inv tr.pulled td { animation:sw-flash 1.6s ease-out both; }
.sw-landing table.inv tr.pulled .pill { animation:sw-pop .45s cubic-bezier(.2,.8,.2,1) both; }
@media (prefers-reduced-motion: reduce){
  .sw-landing table.inv tr.pulled td, .sw-landing table.inv tr.pulled .pill { animation:none; }
}

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

/* The demo video player moved to src/views/TrainingPage.jsx along with the
   section it lived in. Its .vid / .vid-poster / .vid-play rules went with it,
   scoped under .sw-training there. Nothing on this page renders a video now. */

.sw-landing .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:0; }
@media (max-width:780px){ .sw-landing .steps { grid-template-columns:1fr; } }
.sw-landing .step { padding:30px 30px 34px; border-left:1px solid var(--line-2); }
.sw-landing .step:first-child { border-left:none; padding-left:0; }
@media (max-width:780px){ .sw-landing .step { border-left:none; border-top:1px solid var(--line-2); padding:26px 0; } .sw-landing .step:first-child { border-top:none; } }
.sw-landing .step .idx { font-family:"IBM Plex Mono",monospace; font-size:13px; font-weight:600; color:var(--accent); letter-spacing:.1em; }
.sw-landing .step h3 { font-size:21px; margin:14px 0 10px; }
.sw-landing .step p { color:var(--ink-soft); font-size:15px; }

.sw-landing .story {
  color:var(--on-dark); position:relative; overflow:hidden;
  background:
    repeating-linear-gradient(115deg, transparent 0 46px, var(--lattice) 46px 48px),
    var(--hero-2);
}
.sw-landing .story-in { padding:clamp(64px,9vw,104px) 0; display:grid; grid-template-columns:1fr 1fr; gap:56px; align-items:center; position:relative; z-index:1; }
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

/* ---- staggered reveal. The reveal class alone fades a whole block in as one
   slab, so a six-cell grid arrives in a single move. The stagger class hands the
   animation down to the children instead and walks the delay along with
   nth-child, so the row cascades. The container still carries reveal purely so
   the existing IntersectionObserver picks it up and marks it in. ---- */
.sw-landing .reveal.stagger { opacity:1; transform:none; }
.sw-landing .stagger > * { opacity:0; transform:translateY(16px); transition:opacity .6s ease, transform .6s cubic-bezier(.2,.8,.2,1); }
.sw-landing .stagger.in > * { opacity:1; transform:none; }
.sw-landing .stagger > *:nth-child(1) { transition-delay:0ms; }
.sw-landing .stagger > *:nth-child(2) { transition-delay:70ms; }
.sw-landing .stagger > *:nth-child(3) { transition-delay:140ms; }
.sw-landing .stagger > *:nth-child(4) { transition-delay:210ms; }
.sw-landing .stagger > *:nth-child(5) { transition-delay:280ms; }
.sw-landing .stagger > *:nth-child(6) { transition-delay:350ms; }
.sw-landing .stagger > *:nth-child(7) { transition-delay:420ms; }
.sw-landing .stagger > *:nth-child(8) { transition-delay:490ms; }

@media (prefers-reduced-motion: reduce){
  .sw-landing .reveal { opacity:1; transform:none; transition:none; }
  .sw-landing .stagger > * { opacity:1; transform:none; transition:none; transition-delay:0ms; }
}
`;

const Badge = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect className="mk-rect" x="4" y="4" width="56" height="56" rx="10" />
    <path className="mk-stroke" d="M14 20 L22 44 L32 24 L42 44 L50 20" fill="none" strokeWidth="5" strokeLinecap="square" />
  </svg>
);

// Where the visitor's landing-page theme choice is remembered. Deliberately its
// own key: this page themes itself off its own wrapper and must not read or
// write whatever the signed-in app uses.
const THEME_KEY = "sw-landing-theme";

const readStoredTheme = () => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null; // Safari private mode throws on access, not just on write.
  }
};

// Sun in light, crescent in dark. Every instance needs its own mask id, or the
// second copy in the mobile sheet resolves url(#...) to the first one's mask.
const ThemeIcon = ({ id }) => (
  <svg className="theme-icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
    {/* userSpaceOnUse rather than the default bounding-box region: the crescent
        cut travels outside the orb's own box, and a region derived from that box
        would clip the part of the bite that does the work. */}
    <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <rect x="0" y="0" width="24" height="24" fill="#fff" />
      <circle className="tm-cut" cx="24" cy="10" r="7" fill="#000" />
    </mask>
    <circle className="tm-orb" cx="12" cy="12" r="7.5" fill="currentColor" mask={`url(#${id})`} />
    <g className="tm-rays" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <line x1="12" y1="1.4" x2="12" y2="3.4" />
      <line x1="12" y1="20.6" x2="12" y2="22.6" />
      <line x1="1.4" y1="12" x2="3.4" y2="12" />
      <line x1="20.6" y1="12" x2="22.6" y2="12" />
      <line x1="4.5" y1="4.5" x2="5.9" y2="5.9" />
      <line x1="18.1" y1="18.1" x2="19.5" y2="19.5" />
      <line x1="19.5" y1="4.5" x2="18.1" y2="5.9" />
      <line x1="5.9" y1="18.1" x2="4.5" y2="19.5" />
    </g>
  </svg>
);

export default function LandingPage({ onSignIn, onStart, onShowTerms, onShowTraining }) {
  const [theme, setTheme] = useState(readStoredTheme); // null = follow OS preference
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState("");
  const [pulled, setPulled] = useState(false);
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).toUpperCase(),
  );
  const rootRef = useRef(null);
  const progRef = useRef(null);
  const mockRef = useRef(null);

  // Close the mobile sheet on Escape, and on any resize back up to the desktop
  // breakpoint — otherwise a sheet left open while rotating a tablet stays
  // stuck behind the desktop nav with no visible control to dismiss it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    const onResize = () => { if (window.innerWidth > 820) setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

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

  // Scroll progress and the shrink state. The progress bar is written straight
  // to the DOM node rather than held in state, because routing every scroll
  // frame through React would re-render the whole page. setScrolled only ever
  // gets a changed value at the threshold, so React bails out of the rest.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const doc = document.documentElement;
      const span = doc.scrollHeight - window.innerHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, window.scrollY / span)) : 0;
      if (progRef.current) progRef.current.style.transform = `scaleX(${p})`;
      setScrolled(window.scrollY > 12);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Which nav link is lit. The rootMargin narrows the viewport to a band just
  // under the sticky bar, so "active" means "the section you are reading" rather
  // than "any section touching the screen".
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    const ids = ["features", "glimpse", "pricing", "story"];
    const els = ids.map((id) => root.querySelector(`#${id}`)).filter(Boolean);
    if (!els.length) return;
    const seen = {};
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => { seen[en.target.id] = en.isIntersecting; });
        setActive(ids.find((id) => seen[id]) || "");
      },
      { rootMargin: "-72px 0px -58% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // The mock's clock. Minute resolution, so a 20s tick is plenty and costs
  // nothing next to a per-second interval.
  useEffect(() => {
    const t = setInterval(
      () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).toUpperCase()),
      20000,
    );
    return () => clearInterval(t);
  }, []);

  // One inventory row crosses its reorder point shortly after the table lands.
  // Skipped entirely under reduced motion, which leaves the table at its resting
  // in-stock values rather than jumping them.
  useEffect(() => {
    const el = mockRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          io.disconnect();
          timer = setTimeout(() => setPulled(true), 1500);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer); };
  }, []);

  const scrollTo = (id) => (e) => {
    e.preventDefault();
    setMenuOpen(false);
    const el = rootRef.current?.querySelector(`#${id}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const toggleTheme = () =>
    setTheme((t) => {
      const osDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const current = t || (osDark ? "dark" : "light");
      const next = current === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: this visit only */ }
      return next;
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
      <header className={scrolled ? "nav is-scrolled" : "nav"}>
        <div className="wrap nav-in">
          <a className="brand" href="#top" onClick={scrollTop} aria-label="Steadwerk home">
            <Badge size={34} />
            <span className="wm">STEADWERK</span>
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a href="#features" className={active === "features" ? "on" : undefined} aria-current={active === "features" ? "true" : undefined} onClick={scrollTo("features")}>What it does</a>
            <a href="#glimpse" className={active === "glimpse" ? "on" : undefined} aria-current={active === "glimpse" ? "true" : undefined} onClick={scrollTo("glimpse")}>In the wild</a>
            <a href="#pricing" className={active === "pricing" ? "on" : undefined} aria-current={active === "pricing" ? "true" : undefined} onClick={scrollTo("pricing")}>Pricing</a>
            <a href="#story" className={active === "story" ? "on" : undefined} aria-current={active === "story" ? "true" : undefined} onClick={scrollTo("story")}>Story</a>
          </nav>
          <div className="nav-actions">
            <button className="theme-btn nav-hide-sm" type="button" onClick={toggleTheme} aria-label="Switch light or dark theme"><ThemeIcon id="sw-tm-nav" /></button>
            {/* Help sits with the actions rather than the section links because it
                leaves the page, while every nav-link scrolls within it. Mixing the
                two reads as a jump to an anchor that isn't there. */}
            <button className="btn btn-ghost nav-hide-sm" type="button" onClick={onShowTraining}>Help</button>
            <button className="btn btn-ghost nav-hide-sm" type="button" onClick={onSignIn}>Sign in</button>
            {/* Not nav-hide-sm: this is the primary conversion action, and hiding it
                below 820px stripped it from the sticky bar on exactly the phones
                most of these visitors are holding. Everything else folds into the
                sheet below; only this stays put. */}
            <button className="btn btn-primary" type="button" onClick={onStart}>Start your company</button>
            <button
              className="nav-burger"
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="sw-nav-sheet"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              <i /><i /><i />
            </button>
          </div>
        </div>
        <div id="sw-nav-sheet" className={menuOpen ? "nav-sheet open" : "nav-sheet"}>
          <div className="nav-sheet-in">
            <a href="#features" onClick={scrollTo("features")}>What it does</a>
            <a href="#glimpse" onClick={scrollTo("glimpse")}>In the wild</a>
            {/* Was an anchor to the #demo band. The tour lives on the training
                page now, so this leaves the page instead of scrolling — and the
                sheet has to close itself first, which an anchor would not do. */}
            <a
              href="#help"
              onClick={(e) => { e.preventDefault(); setMenuOpen(false); onShowTraining?.(); }}
            >
              Help &amp; training
            </a>
            <a href="#pricing" onClick={scrollTo("pricing")}>Pricing</a>
            <a href="#story" onClick={scrollTo("story")}>Story</a>
            <div className="nav-sheet-foot">
              <button className="theme-btn" type="button" onClick={toggleTheme} aria-label="Switch light or dark theme"><ThemeIcon id="sw-tm-sheet" /></button>
              <button className="btn btn-ghost" type="button" onClick={() => { setMenuOpen(false); onSignIn(); }}>Sign in</button>
            </div>
          </div>
        </div>
        <div className="nav-prog" ref={progRef} aria-hidden="true" />
      </header>

      {/* ── HERO ── */}
      <section className="hero" id="top">
        <div className="wrap hero-in">
          <div className="hero-grid">
            <div className="hero-rise">
              <span className="eyebrow">Warehouse &amp; Fleet · Fort Wayne, IN</span>
              <h1>Tools that work<br />as hard as <span className="amb">you do.</span></h1>
              <p className="hero-sub">Warehouse and fleet software for the crews who run on trucks, materials, and people. Set up in an afternoon. Home by supper.</p>
              <div className="hero-cta">
                <button className="btn btn-primary btn-lg" type="button" onClick={onStart}>Start your company</button>
                {/* Still the same recording, just no longer a band on this page.
                    Kept as the secondary hero action because it is the strongest
                    thing to offer someone not ready to click Start. */}
                <a
                  className="btn hero-ghost btn-play btn-lg"
                  href="#help"
                  onClick={(e) => { e.preventDefault(); onShowTraining?.(); }}
                >
                  Watch the demo
                </a>
              </div>
              <div className="hero-meta">
                <span><b>No IT department.</b> No six-figure system.</span>
                <span><b>Mobile friendly.</b>  Works on your phone and tablet.</span>
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
        <div className="wrap strip-in">
          <div className="reveal">
            <span className="eyebrow">The part that steals your evenings</span>
            <h2 style={{ marginTop: 16 }}>Steadwerk carries the counting, so the crew can carry the work.</h2>
          </div>
          <div className="steal-list reveal stagger">
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
          <div className="ledger reveal stagger">
            <div className="cell cell-wide cell-feature">
              <div className="body">
                <span className="code">INV</span>
                <h3>Inventory</h3>
                <div className="lead">Every roll, every box, counted once.</div>
                <p>FIFO batches and live low-stock signals that read from green to red across the warehouse in half a second.</p>
              </div>
              <div className="mini" aria-hidden="true">
                <div className="mini-row"><span className="mini-k">A-3</span><span className="mini-bar"><i className="ok" style={{ "--w": "84%" }} /></span><span className="mini-v tnum">142</span></div>
                <div className="mini-row"><span className="mini-k">B-1</span><span className="mini-bar"><i className="low" style={{ "--w": "34%" }} /></span><span className="mini-v tnum">6</span></div>
                <div className="mini-row"><span className="mini-k">A-1</span><span className="mini-bar"><i className="out" style={{ "--w": "5%" }} /></span><span className="mini-v tnum">0</span></div>
              </div>
            </div>
            <div className="cell"><span className="code">JOB</span><h3>Jobs</h3><div className="lead">Draft to closed-out, one thread.</div><p>Build the job, pull the materials to it, complete it, and the close-out report writes itself.</p></div>
            <div className="cell"><span className="code">FLT</span><h3>Fleet</h3><div className="lead">"Where's Truck 3?" On the screen.</div><p>Trucks, trailers, mileage, oil, and services are tracked, not guessed at from the cab of another one.</p></div>
            <div className="cell"><span className="code">MNT</span><h3>Maintenance</h3><div className="lead">Flag it from the cab.</div><p>Crews report a problem the moment it starts. Managers see it before it becomes a breakdown.</p></div>
            <div className="cell"><span className="code">RPT</span><h3>Reports</h3><div className="lead">Job complete. Report's ready.</div><p>Costed from the batches actually used on the job, never a price typed in twice, never a guess.</p></div>
            <div className="cell cell-full cell-feature">
              <div className="body">
                <span className="code">CRW</span>
                <h3>Crew &amp; access</h3>
                <div className="lead">Everyone sees their part.</div>
                <p>Per-role access so the yard, the office, and the books each get the view that fits the work they do.</p>
              </div>
              <div className="chips" aria-hidden="true">
                <span>Owner</span><span>Manager</span><span>Yard</span><span>Office</span><span>Books</span>
              </div>
            </div>
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
          <div className="mock reveal" ref={mockRef}>
            <div className="mock-bar">
              <span className="ttl">
                <svg width="18" height="18" viewBox="0 0 40 40" aria-hidden="true"><path className="mk-stroke" d="M4 8 L12 32 L20 12 L28 32 L36 8" fill="none" strokeWidth="5" strokeLinecap="square" /></svg>
                Bay A · Roofing
              </span>
              <span className="meta"><span className="live-dot" aria-hidden="true" />SYNCED · {clock}</span>
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
                  {/* The row that moves. A crew pulls to a job, it crosses the
                      reorder point of 30, and the signal turns from green to amber. */}
                  <tr className={pulled ? "pulled" : undefined}>
                    <td className="item">Drip Edge, 10 ft White</td>
                    <td className="loc">C-2</td>
                    <td className="num tnum">{pulled ? "24 pc" : "88 pc"}</td>
                    <td className="num tnum">30</td>
                    <td>{pulled ? <span className="pill low">Low</span> : <span className="pill ok">In stock</span>}</td>
                  </tr>
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
          <div className="steps reveal stagger">
            <div className="step"><span className="idx">STEP 01</span><h3>Raise the frame</h3><p>Add your yard, your trucks, and your crew. Enter what you've got on the shelf, or bring it in from where it already lives.</p></div>
            <div className="step"><span className="idx">STEP 02</span><h3>Run the day</h3><p>Pull materials to jobs, track the fleet, flag maintenance from the office desk or the cab of a truck.</p></div>
            <div className="step"><span className="idx">STEP 03</span><h3>Home by supper</h3><p>Jobs close themselves out with a costed report. The counting's done before you've hung up your coat.</p></div>
          </div>
        </div>
      </section>

      {/* The demo video used to sit here as a #demo band. It moved to
          src/views/TrainingPage.jsx so there is one player to maintain rather
          than two pointed at the same file, and so cold traffic does not carry a
          video element it mostly scrolls past. Every "Watch the demo" control on
          this page now opens that page via onShowTraining. */}

      {/* ── PRICING ── */}
      <section className="band glass" id="pricing">
        <div className="wrap">
          <div className="band-head reveal">
            <span className="eyebrow">The rate sheet</span>
            <h2>One price. Ten people. No quote to sit through.</h2>
            <p>Most systems for this make you book a call to hear a number. Here it is.</p>
          </div>
          <div className="rates reveal stagger">
            <div className="rate lead-rate">
              <span className="code">BASE</span>
              <div className="fig">
                <span className="amt">${BASE_PRICE}</span>
                <span className="per">/ month</span>
              </div>
              <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--good)", margin: "2px 0 6px" }}>
                or ${ANNUAL_PRICE}/year · save {ANNUAL_SAVINGS_PCT}%
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
                <span className="per">/ month, per pack</span>
              </div>
              <div className="what">Another {PACK_SEATS} people, for as long as you need them.</div>
              <ul className="rate-list">
                <li>Add or drop a pack from your Billing tab in two clicks.</li>
                <li>Prorated both ways, so a pack you hold a week costs a week.</li>
                <li>Drop it the month the season ends and the charge stops.</li>
              </ul>
              <p>Hire five for the busy season and it's ${PACK_PRICE} a month while you need them. Let them go in the autumn and your bill goes back to ${BASE_PRICE}.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──
          Native <details> so it works before React hydrates, keyboard-navigates
          for free, and stays open to Ctrl+F. Every answer here is checked against
          what the product actually does. Nothing here may claim the app works
          without a connection: offline write queuing was removed, and every write
          now goes straight to Supabase. */}
      <section className="band" id="faq">
        <div className="wrap">
          <div className="band-head reveal">
            <span className="eyebrow">Straight answers</span>
            <h2>The questions you'd ask on the phone.</h2>
          </div>
          <div className="faq reveal stagger">
            <details>
              <summary>What does it cost, all in?</summary>
              <div className="ans">
                <b>${BASE_PRICE} a month</b> covers up to {BASE_SEATS} people and every feature. Nothing gets held back for a bigger plan. Past {BASE_SEATS}, another {PACK_SEATS} people cost <b>${PACK_PRICE} a month</b>, and you can drop the pack again when the season turns. No setup fee, no per-job fee, no onboarding charge.
              </div>
            </details>
            <details>
              <summary>Is there a free trial?</summary>
              <div className="ans">
                Yes, <b>{TRIAL_DAYS} days</b>, on both monthly and yearly. We take card details at signup so nothing stops working the day the trial ends, but you aren't charged until it does. Cancel before then and you pay nothing.
              </div>
            </details>
            <details>
              <summary>How long does setup actually take?</summary>
              <div className="ans">
                An afternoon. Add your yard, your trucks, and your crew, then enter what's on the shelf or bring it in from where it already lives. You don't need an IT person, a consultant, or a training week.
              </div>
            </details>
            <details>
              <summary>What happens when you are away from your desk?</summary>
              <div className="ans">
                The site is accessible on your mobile device. All features are mobile friendly and works the same way on a phone or tablet as it does on a desktop. 
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
