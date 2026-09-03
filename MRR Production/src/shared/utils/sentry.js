// src/shared/utils/sentry.js
//
// Error reporting, performance tracing, and session replay for the browser
// bundle. Off by default: with no VITE_SENTRY_DSN set, initSentry() returns
// immediately and Sentry.init() never runs, so no code executes and no
// network call is ever made.
//
// Session Replay is ON here — see the privacy policy update in
// src/public/PrivacyPage.jsx ("Companies we rely on" → Sentry) that has to
// stay in sync with this file. Replay records DOM structure, not raw values:
// maskAllText/blockAllMedia are the replayIntegration() DEFAULTS (we do not
// override them), which mask every text node and block every image/video
// before anything is captured. That's what makes it safe to turn on for an
// app whose screens show customer names, addresses, and job pricing — the
// recording shows layout and interaction, not the data in it. Do NOT pass
// maskAllText: false / unmask() on individual elements without re-checking
// the privacy policy first.
import * as Sentry from '@sentry/react';

let initialized = false;

export function initSentry() {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  initialized = true;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    // Every transaction, for now — this app's traffic is small enough (internal
    // warehouse/fleet tool, not a public consumer app) that 100% is unlikely to
    // hit a billing wall. Turn this down if Sentry's transaction volume becomes
    // a real line item.
    tracesSampleRate: 1.0,
    // Trace headers only to this app's own /.netlify/functions/* calls (all
    // relative, same-origin — see src/shared/utils/email.js and friends), not to
    // Supabase, Anthropic, Resend, Stripe, or AccuLynx. Those calls are either
    // server-side only or go through our own functions, so there's nothing for a
    // browser-attached trace header to correlate on the other end, and no reason
    // to send one.
    tracePropagationTargets: [window.location.origin],
    // 10% of ordinary sessions, but 100% of any session that actually hits an
    // error — the second number is what makes replay useful for debugging;
    // the first just gives a baseline of "what does normal look like".
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // sendDefaultPii stays off so the SDK doesn't start attaching cookies/IP-
    // derived data beyond what a stack trace or replay frame already needs.
    sendDefaultPii: false,
  });
}

// Re-exported so callers don't need their own '@sentry/react' import.
// Sentry.captureException() is a documented no-op when init() was never
// called, so this is safe to call unconditionally even with Sentry disabled.
export function captureException(error, hint) {
  Sentry.captureException(error, hint);
}
