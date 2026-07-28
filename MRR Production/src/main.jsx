import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { NotificationProvider } from "./context/NotificationContext";
import ErrorBoundary from "./components/ErrorBoundary"; // Imported boundary class
import { applyTheme, readTheme } from "./utils/theme";
import "./tokens.css";

// Stamp the theme before the first render so no view ever paints in the wrong
// palette. The usual trick is an inline <script> in index.html, but the CSP is
// script-src 'self' with no unsafe-inline, so that would be blocked. tokens.css
// carries a small pre-hydration guard for the gap before this module runs.
applyTheme(readTheme());

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <ErrorBoundary>
    <NotificationProvider>
      <App />
    </NotificationProvider>
  </ErrorBoundary>,
);
