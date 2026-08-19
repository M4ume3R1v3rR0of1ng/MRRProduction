// Which shell is this bundle running inside.
//
// `npm run build` produces the web app. `npm run build:ios` produces the bundle
// that gets wrapped by Capacitor and submitted to the App Store. They are the
// same code with one difference, and it is not cosmetic: it is what keeps the
// app inside App Store Review Guideline 3.1.1.
//
// ── WHY THE iOS BUILD IS DIFFERENT ──────────────────────────────────────────
//
// Apple requires that anything a user can BUY inside an iOS app be sold through
// In-App Purchase, at 15-30%. Steadwerk bills $99/month through Stripe. If the
// iOS app can take a subscription, Apple either rejects it or takes the cut, and
// neither outcome is survivable on this product.
//
// The way out is that Steadwerk is B2B. Apple's rules carve out services sold to
// organizations rather than to consumers, and the shape that reliably passes is a
// SIGN-IN-ONLY CLIENT: the app contains no pricing, no signup, no checkout, and
// no upgrade prompt. A company owner buys on the web; their crew signs in to an
// account that already exists. Every comparable contractor app on the App Store
// ships this way.
//
// So on iOS, three things are cut:
//
//   1. The marketing landing page      — it publishes the $99/mo and $990/yr rates
//   2. The "start a company" signup tab — it posts to create-checkout
//   3. The Billing view                 — it buys seat packs and opens Stripe
//
// ── BEFORE YOU ADD ANYTHING ─────────────────────────────────────────────────
//
// If you add a new screen that shows a price, sells a seat, or links anywhere a
// person can pay, it has to be gated on this flag too. A single "upgrade" button
// that reaches Stripe is enough to fail review, and a rejection costs days.
//
// ── HOW THE VALUE GETS SET ──────────────────────────────────────────────────
//
// Vite replaces import.meta.env.* with a string literal at build time, so this
// collapses to `const IS_IOS_APP = true` (or false) before minification and the
// dead branches are dropped rather than merely hidden. Nothing is decided at
// runtime, and there is no way to flip it from the client.
//
// VITE_APP_PLATFORM comes from .env.ios, loaded by `vite build --mode ios`.
export const IS_IOS_APP = import.meta.env.VITE_APP_PLATFORM === "ios";
