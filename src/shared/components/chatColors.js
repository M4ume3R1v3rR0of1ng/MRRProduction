// src/shared/components/chatColors.js
//
// The two color decisions a chat bubble makes, in one place, because they are not
// independent and were treated as if they were.
//
// ── The bug this exists to prevent ──
//
// ChatBubble fills your OWN messages with C.blue. The @mention highlight inside
// the bubble (renderWithMentions in features/dashboard/TeamChatBox.jsx) drew every
// mention in C.blue too. And C.blue IS C.leather — the same token. So in your own
// messages a mention was leather ink on a leather fill: the tagged person's name
// vanished completely, which is what it looks like when the @ "blanks" a name. It
// was only ever legible in other people's bubbles, where the fill is the light
// C.lg, so whoever typed it saw it broken and everyone else saw it fine.
//
// Two files each picking a color with no way to notice they had picked the same
// one is the whole failure. Both read from here now, and mentionInk is defined in
// terms of bubbleColors rather than restating a token, so the two cannot drift
// apart again. The test beside this file asserts the one thing that must hold: a
// mention is never drawn in the color of the surface it sits on.
import { C } from "@/shared/utils/helpers";

// `mine` is your own message: an accent-filled bubble with inverted ink. Everyone
// else's is a light neutral fill with body ink.
export const bubbleColors = (mine) => ({
  fill: mine ? C.blue : C.lg,
  ink: mine ? C.onAccent : C.navy,
});

// The ink an @mention pill uses inside that bubble.
//
// On the light fill the accent reads as a link and is legible against it, which is
// why it is worth keeping. On your own accent-filled bubble the accent IS the fill,
// so the mention falls back to the bubble's own ink — the same ink as the words
// either side of it, which is legible there by definition.
//
// Both tokens invert with the theme, so this holds in light and dark with no second
// branch. A hard-coded hex or a fixed token here is exactly what caused the bug.
export const mentionInk = (mine) => (mine ? bubbleColors(mine).ink : C.blue);

// The wash behind a mention pill: a translucent cut of its own ink, so it contrasts
// with whatever it sits on instead of against one fixed color. Heavier on your own
// bubble because a 10% cut of the ink barely separates from an accent fill.
//
// The old value was a fixed rgba() light blue, which sat on the dark surface as a
// bright smear.
export const mentionWash = (mine) =>
  `color-mix(in srgb, ${mentionInk(mine)} ${mine ? 22 : 10}%, transparent)`;
