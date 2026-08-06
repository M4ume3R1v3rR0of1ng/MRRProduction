// src/utils/people.js
//
// Turning a stored person id into a name someone recognises.
//
// Three separate faults used to collapse into the single word "Unknown", spread
// across the batch ledger, the item detail dialog and the batch correction dialog,
// each with its own copy of `users.find(u => u.id === id)?.name || "Unknown"`:
//
//   1. WRONG FIELD. Profiles store the name in `full_name`. Reading only `.name`
//      found the right person and then discarded the answer, because `.name` is
//      null on nearly every profile row.
//
//   2. LEGACY IDS. This app predates Supabase Auth. Batches written in that era
//      recorded ids from the old roster ('u1', 'u2', …) — see mkB in data/seeds.
//      Profiles are UUIDs now, so those rows match nobody and never will. Back
//      when `users` came from SEED_U they resolved fine; the move to real auth
//      silently turned years of history anonymous.
//
//   3. GENUINELY UNRECOGNISED. An id belonging to nobody on the roster.
//
// Only the third is unknown. The other two are answerable, and saying "unknown"
// to all three teaches people to ignore the column.
//
// ── The multi-tenant rule ──
//
// The legacy path resolves through the EMAIL on the old roster, matched against
// the CURRENT company's people. It never trusts the old roster's name directly.
// That distinction is the whole safety argument: SEED_U is Maumee River's staff,
// and printing "Sam" for another company's 'u1' row would put one tenant's
// employee names on another tenant's screen. That exact class of leak is why the
// seed fallback was removed from useAppData. If nobody in this company has that
// email, nothing resolves and the row stays unrecognised, which is correct.
import { SEED_U } from "../data/seeds";

const LEGACY_EMAIL_BY_ID = new Map(
  SEED_U.filter((u) => u?.id && u?.email).map((u) => [u.id, u.email.toLowerCase()]),
);

const nameFrom = (u) =>
  (u && (u.full_name || u.name || u.email)) || null;

/**
 * The name to STAMP onto a row being written now.
 *
 * curUser is assembled in useAppData as { id, email, name: prof.full_name, ... },
 * so `name` is already the full name there, while a raw profiles row uses
 * full_name. Both shapes reach these call sites, hence both are checked.
 */
export const displayNameOf = (user) =>
  (user && (user.name || user.full_name || user.email)) || null;

/**
 * Build a resolver bound to one company's roster.
 *
 * Returns (id, stampedName) => { kind, name, id } where kind is one of:
 *   "absent"  nothing was recorded on the row
 *   "system"  written automatically, not by a person
 *   "member"  resolved against the current roster
 *   "legacy"  a pre-Auth id, resolved by email to a current person
 *   "nameless" resolved to a person who has no name on file
 *   "stamped" not on the roster, but the row recorded a name when it was written
 *   "unknown" belongs to nobody here and the row recorded no name
 *
 * `stampedName` is the row's own copy of the name (batch.byName). The live lookup
 * is tried FIRST so a person who has since changed their name shows the current
 * one; the stamp is the safety net for when no lookup can succeed, which is a
 * real state: "Remove" in User Management hard-deletes the membership, and if it
 * was that person's last one it deletes the profile and auth account outright.
 * At that point nothing in the database can name them, so the row has to.
 */
export function makePersonResolver(users = []) {
  const list = (users || []).filter(Boolean);
  const byId = new Map(list.map((u) => [u.id, u]));
  const byEmail = new Map(
    list.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]),
  );

  return (id, stampedName) => {
    const stamped = typeof stampedName === "string" && stampedName.trim() ? stampedName.trim() : null;

    if (!id) return stamped ? { kind: "stamped", name: stamped, id: null } : { kind: "absent", name: null, id: null };
    if (id === "system") return { kind: "system", name: null, id };

    const direct = byId.get(id);
    if (direct) {
      const name = nameFrom(direct);
      if (name) return { kind: "member", name, id };
      return stamped ? { kind: "stamped", name: stamped, id } : { kind: "nameless", name: null, id };
    }

    const email = LEGACY_EMAIL_BY_ID.get(id);
    const viaEmail = email ? byEmail.get(email) : null;
    if (viaEmail) {
      const name = nameFrom(viaEmail);
      if (name) return { kind: "legacy", name, id };
    }

    if (stamped) return { kind: "stamped", name: stamped, id };
    return { kind: "unknown", name: null, id };
  };
}

// English defaults, so the two inventory dialogs that never took a `lang` prop can
// render sensible copy without threading translations through them.
const FALLBACK = {
  personAbsent: "Not recorded",
  personSystem: "System (automatic)",
  personNameless: "Name not set",
  personUnknown: "Unrecognized",
};

/**
 * Display text for a resolved person.
 *
 * Deliberately does NOT claim to know why an id failed to resolve. The first
 * version of this said "no longer a member", which was a guess presented as a
 * fact — and it was wrong for exactly the case that matters most here, a
 * still-employed person whose old batches carry a pre-Auth id. Showing the raw id
 * instead makes it diagnosable rather than accusatory.
 */
export function personLabel(person, t = {}) {
  const copy = { ...FALLBACK, ...t };
  switch (person?.kind) {
    case "member":
    case "legacy":
    case "stamped":
      return person.name;
    case "system":
      return copy.personSystem;
    case "absent":
      return copy.personAbsent;
    case "nameless":
      return copy.personNameless;
    default:
      return person?.id ? `${copy.personUnknown} (${person.id})` : copy.personUnknown;
  }
}

// Convenience for the many call sites that only want a string.
export const resolvePersonName = (users, id, t, stampedName) =>
  personLabel(makePersonResolver(users)(id, stampedName), t);

// A batch carries both the id and, on rows written from this version onward, the
// name that was current when it was written.
export const resolveBatchPerson = (users, batch, t) =>
  resolvePersonName(users, batch?.by, t, batch?.byName);
