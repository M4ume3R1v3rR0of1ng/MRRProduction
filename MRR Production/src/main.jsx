import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { NotificationProvider } from "./context/NotificationContext";
import ErrorBoundary from "./components/ErrorBoundary"; // Imported boundary class
import { registerSW } from "virtual:pwa-register";
import { applyTheme, readTheme } from "./utils/theme";
import "./tokens.css";

// Stamp the theme before the first render so no view ever paints in the wrong
// palette. The usual trick is an inline <script> in index.html, but the CSP is
// script-src 'self' with no unsafe-inline, so that would be blocked. tokens.css
// carries a small pre-hydration guard for the gap before this module runs.
applyTheme(readTheme());

// Pick up a new deploy without anyone pressing refresh.
//
// The plugin runs in autoUpdate mode, which is only half the story. autoUpdate
// governs what happens once a new service worker is FOUND (skip waiting, claim
// clients, reload the tab); it does nothing to go looking for one. The browser
// checks /sw.js on navigation only, so a tab parked on the dashboard all shift
// never finds out a deploy happened. Polling the registration is what closes
// that gap.
//
// This also has to come from the virtual module rather than the standalone
// registerSW.js the plugin injects when nothing imports it: that generated file
// is a bare navigator.serviceWorker.register() with no update listener, so the
// new worker would take over in the background while the open page kept running
// the old bundle until a manual reload. Importing here swaps injectRegister
// 'auto' over to the real client, which owns the reload.
const UPDATE_CHECK_MS = 60_000;

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(() => {
      // Offline, update() rejects; an unhandled rejection every minute would
      // bury anything real in the console.
      if (navigator.onLine) registration.update().catch(() => {});
    }, UPDATE_CHECK_MS);
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <ErrorBoundary>
    <NotificationProvider>
      <App />
    </NotificationProvider>
  </ErrorBoundary>,
);
