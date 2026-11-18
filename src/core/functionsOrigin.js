// Where the Netlify functions live, as seen from inside the iOS app.
//
// Every call site in this app reaches its backend with a relative URL:
// fetch("/.netlify/functions/chat"). On the web that resolves against the page,
// which IS steadwerk.com, so it works. Inside the iOS app the page is
// capacitor://localhost (see "iosScheme" in capacitor.config.json), so the same
// relative URL resolves to capacitor://localhost/.netlify/functions/chat — the
// app's own bundled files, where no function exists. Every server call failed:
// chat, weather, email, user management, push registration.
//
// The fix lives here, once, rather than at the ~25 call sites: in the iOS build
// only, fetch is wrapped so a relative function path is sent to the production
// origin instead. The functions already answer capacitor://localhost with the
// right CORS header (ALLOWED_ORIGINS in netlify/functions/_shared/tenant.js), so
// nothing on the server changes.
//
// Supabase calls are untouched: they were always absolute URLs.
import { IS_IOS_APP } from "./platform";

// The primary domain, matching ALLOWED_ORIGINS[0] in _shared/tenant.js.
export const FUNCTIONS_ORIGIN = "https://steadwerk.com";

const FUNCTIONS_PATH = "/.netlify/functions/";

/**
 * Pure: the URL a fetch should really go to. Only a string that starts with the
 * relative functions path is rewritten, and only when running in the iOS app;
 * absolute URLs, Request objects and everything on the web pass through as-is.
 *
 * @param {RequestInfo | URL} input
 * @param {boolean} isIosApp
 * @returns {RequestInfo | URL}
 */
export function resolveFunctionsUrl(input, isIosApp) {
  if (!isIosApp) return input;
  if (typeof input === "string" && input.startsWith(FUNCTIONS_PATH)) {
    return FUNCTIONS_ORIGIN + input;
  }
  return input;
}

/** Wrap window.fetch in the iOS build. A no-op on the web. Call once, at startup. */
export function installFunctionsFetch() {
  if (!IS_IOS_APP || typeof window === "undefined" || !window.fetch) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => originalFetch(resolveFunctionsUrl(input, true), init);
}
