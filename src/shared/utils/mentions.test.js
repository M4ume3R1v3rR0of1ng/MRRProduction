import { describe, it, expect } from "vitest";
import {
  knownNamesFrom,
  mentionPattern,
  mentionedNames,
  newMentionedNames,
  resolveMentionedUsers,
} from "./mentions";

const users = [
  { id: "u1", full_name: "Jason Smith", email: "jason@example.com", active: true },
  { id: "u2", full_name: "Jason", email: "jay@example.com", active: true },
  { id: "u3", name: "Dana Flores", email: "dana@example.com", active: true },
  { id: "u4", full_name: "Jo", email: "jo@example.com", active: true },
  { id: "u5", full_name: "Joanne", email: "joanne@example.com", active: true },
  { id: "u6", full_name: "Gone Guy", email: "gone@example.com", active: false },
  { id: "u7", full_name: "No Mail", active: true },
];

const names = knownNamesFrom(users);

describe("knownNamesFrom", () => {
  it("reads either name column, since the roster carries both", () => {
    expect(names).toContain("Jason Smith");
    expect(names).toContain("Dana Flores");
  });

  it("sorts longest first so the longer of two overlapping names wins", () => {
    expect(names.indexOf("Jason Smith")).toBeLessThan(names.indexOf("Jason"));
    expect(names.indexOf("Joanne")).toBeLessThan(names.indexOf("Jo"));
  });

  it("includes deactivated staff, whose names still appear on old messages", () => {
    expect(names).toContain("Gone Guy");
  });

  it("de-duplicates and survives a roster full of holes", () => {
    expect(
      knownNamesFrom([
        { id: "a", full_name: "Sam" },
        { id: "b", name: "Sam" },
      ]),
    ).toEqual(["Sam"]);
    expect(knownNamesFrom([null, {}, { full_name: "   " }])).toEqual([]);
    expect(knownNamesFrom()).toEqual([]);
  });
});

describe("mentionPattern", () => {
  it("returns null when there is nobody to match, rather than a regex that matches all", () => {
    expect(mentionPattern([])).toBeNull();
    expect(mentionPattern()).toBeNull();
  });

  it("escapes regex metacharacters in a name", () => {
    const pattern = mentionPattern(["A.B (C)"]);
    expect("hey @A.B (C) there".match(pattern)).toEqual(["@A.B (C)"]);
    // The dot is literal, so it must not match any other character.
    expect("hey @AxB (C) there".match(pattern)).toBeNull();
  });
});

describe("mentionedNames", () => {
  it("finds a plain mention", () => {
    expect(mentionedNames("@Dana Flores can you look", names)).toEqual(["Dana Flores"]);
  });

  it("prefers the longer name when one is a prefix of the other", () => {
    expect(mentionedNames("@Jason Smith please", names)).toEqual(["Jason Smith"]);
    expect(mentionedNames("@Jason please", names)).toEqual(["Jason"]);
  });

  it("does not match a name inside a longer one", () => {
    expect(mentionedNames("@Joanne hi", names)).toEqual(["Joanne"]);
    expect(mentionedNames("@Jo hi", names)).toEqual(["Jo"]);
  });

  it("counts one person once however many times they are named", () => {
    expect(mentionedNames("@Jo and again @Jo", names)).toEqual(["Jo"]);
  });

  it("finds several people in one message", () => {
    const found = mentionedNames("@Jo and @Dana Flores please", names);
    expect(found.sort()).toEqual(["Dana Flores", "Jo"]);
  });

  it("ignores an @ that is not a known name", () => {
    expect(mentionedNames("email me @ bob@example.com", names)).toEqual([]);
    expect(mentionedNames("@Nobody At All", names)).toEqual([]);
  });

  it("stays case sensitive, matching what the bubble highlights", () => {
    expect(mentionedNames("@dana flores", names)).toEqual([]);
  });

  it("handles empty and missing input", () => {
    expect(mentionedNames("", names)).toEqual([]);
    expect(mentionedNames(null, names)).toEqual([]);
    expect(mentionedNames("@Jo", [])).toEqual([]);
  });
});

describe("newMentionedNames", () => {
  it("returns every mention when there is no previous text", () => {
    expect(newMentionedNames("@Jo hi", undefined, names)).toEqual(["Jo"]);
    expect(newMentionedNames("@Jo hi", "", names)).toEqual(["Jo"]);
  });

  it("returns nothing when an edit only fixed a typo", () => {
    expect(newMentionedNames("@Jo can you chekc this", "@Jo can you chek this", names)).toEqual([]);
  });

  it("returns only the name an edit added", () => {
    expect(newMentionedNames("@Jo and @Joanne look", "@Jo look", names)).toEqual(["Joanne"]);
  });

  it("returns nothing when an edit removed a mention", () => {
    expect(newMentionedNames("@Jo look", "@Jo and @Joanne look", names)).toEqual([]);
  });
});

describe("resolveMentionedUsers", () => {
  it("maps matched names back to the people who hold them", () => {
    const got = resolveMentionedUsers(["Dana Flores"], users);
    expect(got.map((u) => u.email)).toEqual(["dana@example.com"]);
  });

  it("drops deactivated staff, who the relay would 403 the whole batch over", () => {
    expect(resolveMentionedUsers(["Gone Guy"], users)).toEqual([]);
    // And the live person in the same message still resolves.
    const mixed = resolveMentionedUsers(["Gone Guy", "Jo"], users);
    expect(mixed.map((u) => u.email)).toEqual(["jo@example.com"]);
  });

  it("drops anyone with no email on file", () => {
    expect(resolveMentionedUsers(["No Mail"], users)).toEqual([]);
  });

  it("drops the author, who is not told about their own message", () => {
    expect(resolveMentionedUsers(["Jo"], users, { excludeUserId: "u4" })).toEqual([]);
  });

  it("de-duplicates by address when two roster rows share one email", () => {
    const dupes = [
      { id: "a", full_name: "Sam", email: "sam@example.com", active: true },
      { id: "b", full_name: "Sam", email: "SAM@example.com", active: true },
    ];
    expect(resolveMentionedUsers(["Sam"], dupes)).toHaveLength(1);
  });

  it("resolves both people when two different staff genuinely share a name", () => {
    const twins = [
      { id: "a", full_name: "Sam", email: "sam1@example.com", active: true },
      { id: "b", full_name: "Sam", email: "sam2@example.com", active: true },
    ];
    expect(resolveMentionedUsers(["Sam"], twins)).toHaveLength(2);
  });

  it("returns nothing for an empty mention list", () => {
    expect(resolveMentionedUsers([], users)).toEqual([]);
  });
});
