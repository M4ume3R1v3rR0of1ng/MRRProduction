// Remember which sort a person chose, per view, across navigation and reloads.
//
// THE BUG THIS FIXES
//
// Every list view held its sort in a plain useState. App.jsx lazy-loads views and
// swaps them on navigation, so leaving Inventory for Jobs and coming back
// unmounted the component and threw the choice away. The view remounted on its
// useState default, which is the first option in the dropdown, so it looked like
// the sort "jumped back to the top" every time. Reloading did the same.
//
// Sorting is a preference, not state, and it belongs where the theme and the
// language already live: in localStorage. Same try/catch shape as utils/theme.js,
// because Safari private mode throws on read as well as on write.
//
// WHY IT TAKES THE LIST OF VALID VALUES
//
// A stored value can outlive the option it names. Inventory is the live example:
// its price sorts are gated on perms.inv_pricing_view, so someone can sort by
// price, lose that permission, and come back holding "price_low" for an <option>
// that no longer renders. A <select> whose value matches no option shows blank,
// and the sort comparator falls through to no ordering at all.
//
// So the stored value is never trusted on its own. It is checked against the
// options the view is rendering RIGHT NOW, every render. That also means a
// permission arriving late, or a sort being renamed in a future version,
// degrades to the default instead of to a broken control.
import { useCallback, useState } from "react";

const key = (viewKey) => `sw-sort-${viewKey}`;

/**
 * Decide which sort to actually use. Exported and pure so the rules can be
 * tested without a DOM: this is the part with real behaviour, and the rest of
 * the hook is plumbing.
 *
 * Returns `fallback` for anything not currently on offer, which covers a first
 * visit (null), a sort that has since been renamed or removed, and an option
 * hidden by a permission the person no longer has.
 */
export function resolveSort(stored, validValues, fallback) {
  return validValues.includes(stored) ? stored : fallback;
}

/**
 * @param {string}   viewKey     Stable per-view id, used in the storage key.
 * @param {string[]} validValues The option values currently rendered, in order.
 * @param {string}   fallback    Used when nothing is stored or the stored value
 *                               is no longer offered.
 * @returns {[string, (next: string) => void]}
 */
export function useStickySort(viewKey, validValues, fallback) {
  // Read once on mount. Reading during every render would hit localStorage on
  // every keystroke in the search box that sits next to these dropdowns.
  const [stored, setStored] = useState(() => {
    try {
      return localStorage.getItem(key(viewKey));
    } catch {
      return null; // Private mode. The choice still holds for this session.
    }
  });

  // Derived rather than corrected in an effect. If perms resolve after the first
  // render and drop an option, this falls back on the very next render instead
  // of painting one frame with a blank select.
  const value = resolveSort(stored, validValues, fallback);

  const set = useCallback(
    (next) => {
      setStored(next);
      try {
        localStorage.setItem(key(viewKey), next);
      } catch {
        /* private mode: remembered for this session only */
      }
    },
    [viewKey],
  );

  return [value, set];
}
