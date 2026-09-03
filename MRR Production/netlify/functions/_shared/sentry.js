// netlify/functions/_shared/sentry.js
//
// Error reporting for the Netlify functions. Off by default: with no
// SENTRY_DSN set, ensureInit() never calls Sentry.init(), so every export
// below is a silent no-op and nothing is ever sent anywhere.
//
// Every function in this directory already catches its own errors and turns
// them into a JSON response — see the try/catch in send-alert.js for the
// pattern repeated across all of them. That means withSentry() usually will
// NOT see a thrown exception; the function already swallowed it. So instead of
// only catching, the wrapper also inspects what the handler actually
// returned: a statusCode >= 500 means something broke (400/402/403 are
// deliberate business responses, not bugs), so that gets reported too, using
// the message the function's own catch block already produced. It won't carry
// the original stack trace — that was lost the moment the function's own catch
// block turned it into a string — but the message, function name and status
// code are enough to find and fix the failure in the Sentry UI.
//
// Deliberately conservative about what leaves this server: no request bodies,
// no headers (Authorization bearer tokens, cookies), no automatic PII
// collection. See the disclosures in src/public/PrivacyPage.jsx before
// changing that — Sentry becoming a new sub-processor is documented there.

import * as Sentry from "@sentry/node";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  initialized = true;
  Sentry.init({
    dsn,
    environment: process.env.CONTEXT || process.env.NODE_ENV || "production",
    // Error events only — no tracing/performance sampling.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

// Wrap a function's exported handler: withSentry("send-alert", handler).
// `name` tags every event so a failure in the Sentry UI reads as
// "send-alert", not "handler".
export function withSentry(name, handler) {
  return async (event, context) => {
    ensureInit();
    try {
      const result = await handler(event, context);
      if (initialized && result && result.statusCode >= 500) {
        await reportResult(name, result);
      }
      return result;
    } catch (err) {
      if (initialized) await reportException(name, err);
      throw err;
    }
  };
}

async function reportException(name, err) {
  Sentry.withScope((scope) => {
    scope.setTag("function", name);
    Sentry.captureException(err);
  });
  // Netlify (AWS Lambda underneath) can freeze the process the instant the
  // handler settles, so the send has to happen before we return/rethrow —
  // fire-and-forget here would frequently mean never-sent.
  await Sentry.flush(2000).catch(() => {});
}

async function reportResult(name, result) {
  let message = `HTTP ${result.statusCode}`;
  try {
    const parsed = JSON.parse(result.body || "{}");
    if (parsed?.error) message = String(parsed.error);
  } catch {
    // Body wasn't JSON (a couple of early guards return plain text) — the
    // generic "HTTP 5xx" message above is still useful as a signal.
  }
  Sentry.withScope((scope) => {
    scope.setTag("function", name);
    scope.setTag("statusCode", String(result.statusCode));
    Sentry.captureException(new Error(message));
  });
  await Sentry.flush(2000).catch(() => {});
}
