// CSV escaping. These are not style tests: a mis-escaped field shifts every
// column after it, so the export reports real numbers against the wrong row.
import { describe, it, expect } from "vitest";
import { escapeCsvCell, toCsv } from "./csvExport";

describe("escapeCsvCell", () => {
  it("escapes the inch mark that breaks this catalog today", () => {
    // '9" Roller Covers' is live inventory. Hand-wrapping produced
    // `"9" Roller Covers"`, which parsers read as the field `9` plus junk.
    expect(escapeCsvCell('9" Roller Covers')).toBe('"9"" Roller Covers"');
  });

  it("quotes a field containing a comma", () => {
    expect(escapeCsvCell("Toledo, OH")).toBe('"Toledo, OH"');
  });

  it("quotes a field containing a newline", () => {
    expect(escapeCsvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("leaves an ordinary field unquoted", () => {
    // Quoting everything is legal but noisy, and it was hiding the bug above.
    expect(escapeCsvCell("Underlayment")).toBe("Underlayment");
    expect(escapeCsvCell(42)).toBe("42");
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("keeps a zero rather than blanking it", () => {
    // A falsy-but-real number. `value || ""` would have emptied this cell, and a
    // blank variance reads as "not counted" rather than "counted, no difference".
    expect(escapeCsvCell(0)).toBe("0");
  });
});

describe("toCsv", () => {
  it("keeps columns aligned when a value contains a quote", () => {
    const csv = toCsv(["Item", "Price"], [['9" Roller Covers', 3]]);
    expect(csv).toBe('Item,Price\r\n"9"" Roller Covers",3');
    // The row still has exactly two fields once parsed.
    expect(csv.split("\r\n")[1].match(/^"(?:[^"]|"")*",\d+$/)).toBeTruthy();
  });

  it("separates rows with CRLF per RFC 4180", () => {
    expect(toCsv(["A"], [[1], [2]])).toBe("A\r\n1\r\n2");
  });

  it("survives a ragged or empty row without throwing", () => {
    expect(() => toCsv(["A", "B"], [null, []])).not.toThrow();
  });
});
