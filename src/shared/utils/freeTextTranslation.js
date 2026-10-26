// src/shared/utils/freeTextTranslation.js
//
// The browser half of netlify/functions/translate.js: ask for a typed note in
// the reader's language, and remember the answer.
//
// translations.js covers every label we ship. This covers the sentences we
// don't — a maintenance description, a resolution note — which are typed by a
// person and so cannot live in a dictionary.
//
// WHY THE CACHE EARNS ITS KEEP
//
// A maintenance queue is read over and over: open a ticket, close it, open the
// one below it, come back. Without a cache the same five notes bill a model
// call every time someone scrolls past them. Keyed by the text itself rather
// than by a row id, so a note that is edited is re-translated and one that is
// quoted on two screens is translated once.
//
// sessionStorage, not localStorage: a translation is a reading aid, not a
// record, and it should not outlive the tab that asked for it.

import { getAccessToken } from "./supabase";

const CACHE_PREFIX = "sw_tx_";
export const TRANSLATABLE_LANGS = ["en", "es"];

/**
 * djb2. Short, stable, and no dependency — this names a cache slot, it is not
 * used for anything that cares about collisions being hard to produce.
 * @param {string} s
 */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * @param {string} target
 * @param {string} text
 */
export function cacheKey(target, text) {
  return `${CACHE_PREFIX}${target}:${text.length}:${hash(text)}`;
}

/**
 * @param {string} target
 * @param {string} text
 * @returns {{translation: string, sourceLang: string | null} | null}
 */
export function readCache(target, text) {
  try {
    const raw = sessionStorage.getItem(cacheKey(target, text));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.translation === "string" ? parsed : null;
  } catch {
    // Private mode, disabled storage, or a half-written entry. Costs a refetch.
    return null;
  }
}

/**
 * @param {string} target
 * @param {string} text
 * @param {{translation: string, sourceLang: string | null}} result
 */
export function writeCache(target, text, result) {
  try {
    sessionStorage.setItem(cacheKey(target, text), JSON.stringify(result));
  } catch {
    // Quota or disabled storage. The feature still works, it just pays again.
  }
}

/**
 * Translate a batch into `target`, serving whatever is already cached and
 * asking the server only for the rest. Results come back in the order given.
 *
 * @param {string[]} texts
 * @param {string} target "en" or "es"
 * @returns {Promise<{translation: string, sourceLang: string | null}[]>}
 */
export async function translateTexts(texts, target) {
  if (!TRANSLATABLE_LANGS.includes(target)) {
    throw new Error(`Unsupported language: ${target}`);
  }

  const results = texts.map((text) => (text?.trim() ? readCache(target, text.trim()) : null));
  const missing = [];
  texts.forEach((text, i) => {
    if (text?.trim() && !results[i]) missing.push({ i, text: text.trim() });
  });

  if (missing.length > 0) {
    const accessToken = await getAccessToken();
    const res = await fetch("/.netlify/functions/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, target, texts: missing.map((m) => m.text) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Error ${res.status}`);

    const fresh = Array.isArray(json.results) ? json.results : [];
    missing.forEach((m, n) => {
      const result = fresh[n];
      if (!result || typeof result.translation !== "string") return;
      results[m.i] = result;
      writeCache(target, m.text, result);
    });
  }

  // A slot the server never answered for falls back to the original, flagged as
  // untranslated — the same shape a no-op translation has, so the UI has one
  // case to handle instead of two.
  return texts.map((text, i) => results[i] || { translation: text || "", sourceLang: null });
}

/**
 * Single-text convenience over the batch call above.
 * @param {string} text
 * @param {string} target
 */
export async function translateText(text, target) {
  const [result] = await translateTexts([text], target);
  return result;
}

/**
 * Whether showing a translation would tell the reader anything. A note already
 * in their language, or one the server could not place, is left alone — the
 * toggle for it is hidden rather than offering a no-op.
 *
 * @param {{translation: string, sourceLang: string | null} | null} result
 * @param {string} original
 */
export function isUseful(result, original) {
  if (!result || result.sourceLang === null) return false;
  return result.translation.trim() !== (original || "").trim();
}
