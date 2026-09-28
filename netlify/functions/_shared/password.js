// netlify/functions/_shared/password.js
//
// Server-side mirror of src/utils/passwordPolicy.js. Kept as its own copy because
// functions are bundled separately from the app and don't import out of src/.
// It matches the character-class rule Supabase Auth applies, so a bad password is
// rejected with a readable message instead of Supabase's alphabet-dump string.

export const PASSWORD_MIN_LENGTH = 8;

/**
 * @returns {string|null} a human-readable problem, or null when the password is fine.
 */
export function validatePassword(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }

  const missing = [];
  if (!/[a-z]/.test(password)) missing.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) missing.push("an uppercase letter");
  if (!/[0-9]/.test(password)) missing.push("a number");

  if (missing.length) {
    return `Password must also include ${missing.join(", ")}.`;
  }
  return null;
}
