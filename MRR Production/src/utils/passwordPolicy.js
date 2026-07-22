// src/utils/passwordPolicy.js
//
// Supabase Auth enforces a character-class policy on every password it accepts
// (lowercase + uppercase + digit, on top of the minimum length). Our forms only
// ever checked the length, so an all-lowercase temporary password sailed past
// the client and came back as a raw Supabase string:
//
//   "Password should contain at least one character of each: abcdef…, 0123456789."
//
// which surfaced as a "Database Error" and read like the feature was broken.
// Check the same rule here, before the round trip, and say it in plain English.

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_HINT =
  "At least 8 characters, with an uppercase letter, a lowercase letter, and a number";

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
