import { describe, it, expect } from "vitest";
import { parseDataUrl, toImageBlock, toApiContent } from "./chatContent";

const DATA_URL = "data:image/jpeg;base64,AAAABBBB";
const STORED_URL = "https://xyz.supabase.co/storage/v1/object/public/chat-photos/co/u_1.jpg";

describe("parseDataUrl", () => {
  it("splits a data URL into media type and payload", () => {
    expect(parseDataUrl(DATA_URL)).toEqual({ media_type: "image/jpeg", data: "AAAABBBB" });
  });

  it("refuses anything that is not one", () => {
    expect(parseDataUrl(STORED_URL)).toBeNull();
    expect(parseDataUrl("")).toBeNull();
    expect(parseDataUrl(null)).toBeNull();
    // A data URL with no payload is not a photo.
    expect(parseDataUrl("data:image/jpeg;base64,")).toBeNull();
  });
});

// The whole point of the module — see its header.
describe("toImageBlock", () => {
  it("sends a freshly attached photo as base64", () => {
    expect(toImageBlock(DATA_URL)).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAABBBB" },
    });
  });

  it("sends a photo replayed out of history as a url", () => {
    expect(toImageBlock(STORED_URL)).toEqual({
      type: "image",
      source: { type: "url", url: STORED_URL },
    });
  });

  it("is null for anything else, so the message still goes as text", () => {
    expect(toImageBlock(null)).toBeNull();
    expect(toImageBlock("")).toBeNull();
    // Not https: a bucket URL is the only remote shape we hand the API.
    expect(toImageBlock("http://example.com/x.jpg")).toBeNull();
    expect(toImageBlock("/local/path.jpg")).toBeNull();
  });
});

describe("toApiContent", () => {
  // Text-only must stay a bare string, not a one-element array — that is what
  // keeps a conversation without photos identical to how it has always gone up.
  it("collapses a text-only message to a plain string", () => {
    expect(toApiContent({ text: "what is due?" })).toBe("what is due?");
  });

  it("pairs a photo with its text, image first", () => {
    const content = toApiContent({ text: "can you file this?", image: DATA_URL });
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image");
    expect(content[1]).toEqual({ type: "text", text: "can you file this?" });
  });

  it("carries a replayed photo on an edited turn", () => {
    const content = toApiContent({ text: "actually, brakes not tires", image: STORED_URL });
    expect(content[0]).toEqual({ type: "image", source: { type: "url", url: STORED_URL } });
  });

  it("sends a photo with no caption as just the image", () => {
    const content = toApiContent({ text: "", image: DATA_URL });
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("image");
  });

  // An unreadable image with no text leaves nothing to send. An empty array is
  // the honest answer; sendFrom's own guard is what stops it being posted.
  it("returns an empty array when there is nothing usable", () => {
    expect(toApiContent({ text: "", image: "nonsense" })).toEqual([]);
  });
});
