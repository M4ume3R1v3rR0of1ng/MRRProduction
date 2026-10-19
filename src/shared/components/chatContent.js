// src/shared/components/chatContent.js
//
// Turning one chat message into the content blocks the Anthropic API wants.
//
// WHY THIS IS NOT INSIDE ChatWidget
//
// Same reason anvil.js is its own module: this is pure, it has a branch worth
// pinning, and reaching it through ChatWidget means standing up React and a
// Supabase client to test fifteen lines of string handling.
//
// THE BRANCH WORTH PINNING
//
// A message's `image` is one of two different things, and which one depends on
// whether the message has been through a page reload:
//
//   • the data URL compressImg just produced, for a photo being sent now;
//   • the chat-photos storage URL it was persisted as (supabase/55), for a
//     turn replayed out of history.
//
// Both have to reach the model, by different source types, or re-asking an
// edited question silently loses its photo — which is the bug that showed up
// the moment photos started surviving a reload at all.

// data:image/jpeg;base64,XXXX -> { media_type: "image/jpeg", data: "XXXX" }
export function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;
  return { media_type: match[1], data: match[2] };
}

/**
 * One image block, or null if `image` is neither of the two shapes above.
 *
 * Returning null rather than throwing is deliberate: an unrecognised image is
 * a message that goes out as text, not a send that fails.
 */
export function toImageBlock(image) {
  const parsed = parseDataUrl(image);
  if (parsed) return { type: "image", source: { type: "base64", ...parsed } };
  // The chat-photos bucket is public, same as the other five, so the API can
  // fetch it directly.
  if (typeof image === "string" && image.startsWith("https://")) {
    return { type: "image", source: { type: "url", url: image } };
  }
  return null;
}

/**
 * A message as `messages[]` content: a bare string when all it has is text,
 * an array of blocks when there is a photo too.
 *
 * The string shortcut is not cosmetic — it keeps a text-only conversation
 * byte-identical to what it was before images existed.
 */
export function toApiContent(msg) {
  const blocks = [];
  if (msg.image) {
    const block = toImageBlock(msg.image);
    if (block) blocks.push(block);
  }
  if (msg.text) blocks.push({ type: "text", text: msg.text });
  return blocks.length === 1 && blocks[0].type === "text" ? blocks[0].text : blocks;
}
