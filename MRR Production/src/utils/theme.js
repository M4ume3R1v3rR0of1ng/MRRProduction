// src/utils/theme.js
//
// Light/dark control for the app shell.
//
// The palette itself lives in tokens.css as two sets of --c-* variables. All this
// module does is decide which set is active by stamping data-theme on <html>.
// Nothing here knows a single color.
//
// Three preferences, not two. "system" is the default and is a real stored state,
// distinct from having picked light: someone on system follows their OS when it
// flips at sunset, someone who picked light stays light. Collapsing the two would
// silently convert every first-time visitor into an explicit light user.

const KEY = "sw-theme";

// Matches --c-shell in each palette. The browser chrome should agree with the
// sidebar, which is the top-most band of the app on mobile.
const THEME_COLOR = { light: "#23282D", dark: "#16191D" };

const prefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

export const readTheme = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system"; // Safari private mode throws on read, not just on write.
  }
};

export const resolveTheme = (pref) => (pref === "system" ? (prefersDark() ? "dark" : "light") : pref);

// Stamps the resolved theme and keeps the address-bar color in step. Safe to call
// repeatedly; it is also what the OS-change listener re-runs.
export const applyTheme = (pref) => {
  const resolved = resolveTheme(pref);
  if (typeof document === "undefined") return resolved;
  document.documentElement.setAttribute("data-theme", resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[resolved]);
  return resolved;
};

export const saveTheme = (pref) => {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* private mode: the choice holds for this session only */
  }
  return applyTheme(pref);
};

// Order the toggle cycles through. System first because it is the default.
export const THEME_CYCLE = ["system", "light", "dark"];

export const nextTheme = (pref) => THEME_CYCLE[(THEME_CYCLE.indexOf(pref) + 1) % THEME_CYCLE.length];
