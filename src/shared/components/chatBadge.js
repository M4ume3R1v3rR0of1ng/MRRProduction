// What the number on A.N.V.I.L.'s launcher button says.
//
// The launcher already has a dot for "something new to read" (a briefing or a reminder). The
// number is the other thing: how many things are waiting on THIS person to say yes.
//
//   waiting           reorders needing approval, or approved and not yet sent
//   hasPendingAction  a change A.N.V.I.L. lined up in this window and the person has not
//                     confirmed. Only counted while the window is closed: once it is open the
//                     Confirm bar is on screen, so counting it too would be shouting.

/**
 * @param {{ waiting?: number, hasPendingAction?: boolean, chatOpen?: boolean }} args
 */
export function badgeCount({ waiting = 0, hasPendingAction = false, chatOpen = false }) {
  const n = Number.isFinite(waiting) && waiting > 0 ? Math.floor(waiting) : 0;
  return n + (hasPendingAction && !chatOpen ? 1 : 0);
}

/** @param {number} n */
export function badgeLabel(n) {
  return n > 9 ? "9+" : String(n);
}
