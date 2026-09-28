import { describe, it, expect } from "vitest";
import { extractText } from "../chat.js";

// What gets persisted to chat_messages.text (supabase/41) for the newest
// incoming turn — see the "Persist this turn" block in rawHandler.
describe("extractText", () => {
  it("passes a plain string straight through", () => {
    expect(extractText("How's Truck 12 doing?")).toBe("How's Truck 12 doing?");
  });

  it("joins text blocks and drops image blocks", () => {
    const content = [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "..." } },
      { type: "text", text: "What's wrong with this?" },
    ];
    expect(extractText(content)).toBe("What's wrong with this?");
  });

  it("falls back to a placeholder for an image with no caption", () => {
    const content = [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "..." } },
    ];
    expect(extractText(content)).toBe("[Photo attached]");
  });

  it("returns empty string for nothing at all", () => {
    expect(extractText(undefined)).toBe("");
    expect(extractText([])).toBe("");
  });
});
