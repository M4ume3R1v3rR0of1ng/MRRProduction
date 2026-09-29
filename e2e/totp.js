// e2e/totp.js
//
// RFC 6238 TOTP, the same 6-digit / 30-second / SHA-1 codes Supabase's TOTP
// factor verifies and any authenticator app shows. Written out here (it's a
// dozen lines on node:crypto) rather than pulling in a dependency the app itself
// never needs, so global-setup.js can enrol a factor and mfa-login.spec.js can
// answer the login prompt the way a phone would.
import crypto from "node:crypto";

const STEP_SECONDS = 30;

function base32Decode(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error(`totp: invalid base32 character "${ch}"`);
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

export function totpCode(secret, step = totpStep()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1_000_000).padStart(6, "0");
}

// Resolves once the clock is into a later 30-second window than `step`. Used so
// the login prompt is never answered with the exact code enrolment already
// spent — whether or not the server rejects a replayed code, the test shouldn't
// depend on it.
export async function waitForStepAfter(step) {
  while (totpStep() <= step) {
    const msLeft = (totpStep() + 1) * STEP_SECONDS * 1000 - Date.now();
    await new Promise((r) => setTimeout(r, msLeft + 250));
  }
}
