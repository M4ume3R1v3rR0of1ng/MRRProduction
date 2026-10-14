// src/shared/components/chatColors.test.js
//
// The chat bubble's fill and the @mention ink drawn on top of it used to be chosen
// in two different files, with nothing able to notice when they chose the same
// color. They did: mentions in your own messages were leather ink on a leather
// fill, so tagging someone made their name vanish for the person who typed it.
//
// Nothing else in the suite can catch that. A mention rendered in the fill color is
// present in the DOM, has the right text, fires the right email and passes every
// assertion anyone would think to write — it is only invisible to a human. So the
// invariant is asserted directly here.
import { describe, it, expect } from "vitest";
import { bubbleColors, mentionInk, mentionWash } from "./chatColors";

describe("chat bubble and mention colors", () => {
  // The regression. Not "mentionInk(true) equals some specific token" — that would
  // pass again the moment someone changes the fill to match. The thing that must
  // hold is the relationship between the two.
  it("never draws a mention in the color of the bubble it sits on", () => {
    for (const mine of [true, false]) {
      expect(mentionInk(mine)).not.toBe(bubbleColors(mine).fill);
    }
  });

  it("gives a bubble ink that is not its own fill either", () => {
    // The same class of bug one layer out, and it has happened here before: the
    // header of ChatParts.jsx records own-message text once using the surface
    // token, which went dark in dark mode and left dark text on the dark fill.
    for (const mine of [true, false]) {
      expect(bubbleColors(mine).ink).not.toBe(bubbleColors(mine).fill);
    }
  });

  it("falls back to the bubble's own ink on your own messages", () => {
    // Where the accent is the fill there is nothing left for the mention to borrow,
    // so it takes the ink of the words either side of it — legible there by
    // definition, in whichever theme.
    expect(mentionInk(true)).toBe(bubbleColors(true).ink);
  });

  it("keeps the accent for other people's messages, where it reads as a link", () => {
    expect(mentionInk(false)).not.toBe(bubbleColors(false).ink);
  });

  it("builds the wash from the mention's own ink, not a fixed color", () => {
    // A fixed rgba() here was the previous bug in this spot: it was tuned for the
    // light surface and smeared on the dark one.
    for (const mine of [true, false]) {
      expect(mentionWash(mine)).toContain(mentionInk(mine));
      expect(mentionWash(mine)).toContain("transparent");
    }
  });

  it("leans on theme tokens rather than literal colors, so both themes follow", () => {
    // Every value here has to be a var(--…) token. A hex literal would be correct
    // in one theme and wrong in the other, which is how the dark-mode half of these
    // bugs keeps arriving.
    const values = [
      bubbleColors(true).fill,
      bubbleColors(true).ink,
      bubbleColors(false).fill,
      bubbleColors(false).ink,
      mentionInk(true),
      mentionInk(false),
    ];
    for (const v of values) expect(v).toMatch(/^var\(--/);
  });
});
