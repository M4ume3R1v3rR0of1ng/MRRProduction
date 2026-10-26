import { describe, it, expect, beforeEach, vi } from "vitest";

// getAccessToken reaches for a live Supabase session, which no suite has.
vi.mock("./supabase", () => ({ getAccessToken: vi.fn(async () => "token") }));

import { cacheKey, readCache, writeCache, translateTexts, isUseful } from "./freeTextTranslation";

// The suites run in node, where there is no sessionStorage. A Map behind the
// same three methods is enough, and it lets a case prove the cache was hit by
// counting fetches rather than by inspecting storage.
function installStorage() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

beforeEach(() => {
  installStorage();
  vi.restoreAllMocks();
});

describe("cacheKey", () => {
  it("is stable for the same text and target", () => {
    expect(cacheKey("es", "brakes grinding")).toBe(cacheKey("es", "brakes grinding"));
  });

  it("separates the two directions", () => {
    // Otherwise translating a note to Spanish would poison the English read of it.
    expect(cacheKey("es", "brakes grinding")).not.toBe(cacheKey("en", "brakes grinding"));
  });

  it("separates different texts", () => {
    expect(cacheKey("es", "brakes grinding")).not.toBe(cacheKey("es", "ac blowing warm"));
  });
});

describe("readCache / writeCache", () => {
  it("round-trips a result", () => {
    writeCache("es", "ac out", { translation: "aire no funciona", sourceLang: "en" });
    expect(readCache("es", "ac out")).toEqual({
      translation: "aire no funciona",
      sourceLang: "en",
    });
  });

  it("returns nothing for a miss or a corrupt entry", () => {
    expect(readCache("es", "never seen")).toBeNull();
    sessionStorage.setItem(cacheKey("es", "half written"), "{not json");
    expect(readCache("es", "half written")).toBeNull();
  });

  it("survives storage being unavailable", () => {
    globalThis.sessionStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readCache("es", "anything")).toBeNull();
    expect(() =>
      writeCache("es", "anything", { translation: "x", sourceLang: "en" }),
    ).not.toThrow();
  });
});

describe("translateTexts", () => {
  const ok = (results) =>
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results }) }));

  it("asks the server once and caches the answer", async () => {
    const fetchMock = ok([{ translation: "los frenos rechinan", sourceLang: "en" }]);
    globalThis.fetch = fetchMock;

    const first = await translateTexts(["brakes grinding"], "es");
    expect(first[0].translation).toBe("los frenos rechinan");

    const second = await translateTexts(["brakes grinding"], "es");
    expect(second[0].translation).toBe("los frenos rechinan");
    // The point of the cache: a queue read twice does not bill twice.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requests only the texts it does not already have, and puts them back in place", async () => {
    writeCache("es", "ac out", { translation: "aire no funciona", sourceLang: "en" });
    const fetchMock = ok([{ translation: "los frenos rechinan", sourceLang: "en" }]);
    globalThis.fetch = fetchMock;

    const results = await translateTexts(["ac out", "brakes grinding"], "es");

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.texts).toEqual(["brakes grinding"]);
    expect(results.map((r) => r.translation)).toEqual(["aire no funciona", "los frenos rechinan"]);
  });

  it("does not call the server when everything is blank or cached", async () => {
    const fetchMock = ok([]);
    globalThis.fetch = fetchMock;
    const results = await translateTexts(["", "   "], "es");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(results).toEqual([
      { translation: "", sourceLang: null },
      { translation: "   ", sourceLang: null },
    ]);
  });

  it("leaves a slot the server did not answer for untranslated", async () => {
    globalThis.fetch = ok([]);
    const [only] = await translateTexts(["brakes grinding"], "es");
    expect(only).toEqual({ translation: "brakes grinding", sourceLang: null });
  });

  it("surfaces the server's error message", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: "Rate limit exceeded" }),
    }));
    await expect(translateTexts(["brakes grinding"], "es")).rejects.toThrow("Rate limit exceeded");
  });

  it("refuses a language the app does not speak", async () => {
    globalThis.fetch = vi.fn();
    await expect(translateTexts(["brakes grinding"], "fr")).rejects.toThrow("Unsupported");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("isUseful", () => {
  it("is true only when the translation says something different", () => {
    expect(
      isUseful({ translation: "los frenos rechinan", sourceLang: "en" }, "brakes grinding"),
    ).toBe(true);
  });

  it("is false for a note already in the reader's language", () => {
    // No point offering to translate "brakes grinding" into English.
    expect(isUseful({ translation: "brakes grinding", sourceLang: "en" }, "brakes grinding")).toBe(
      false,
    );
  });

  it("is false when the server could not place the text", () => {
    expect(isUseful({ translation: "brakes grinding", sourceLang: null }, "brakes grinding")).toBe(
      false,
    );
    expect(isUseful(null, "brakes grinding")).toBe(false);
  });
});
