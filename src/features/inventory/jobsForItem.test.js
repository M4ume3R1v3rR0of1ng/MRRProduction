import { describe, it, expect } from "vitest";
import { jobsThatPulled } from "./jobsForItem";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const job = (id, status, pulled, completed, returned = 0) => ({
  id,
  po: `PO${id}`,
  title: `Job ${id}`,
  status,
  completed,
  items: [{ iid: "osb", unit: "sheets", pulled, returned }],
});

describe("jobsThatPulled", () => {
  it("lists recent correctable jobs that pulled the item, newest first", () => {
    const jobs = [
      job("a", "completed", 5, "2026-11-20T00:00:00Z", 3),
      job("b", "active", 2, "2026-11-22T00:00:00Z"),
      job("c", "closed", 4, "2026-11-23T00:00:00Z"), // must reopen first
      job("d", "completed", 0, "2026-11-23T00:00:00Z"), // nothing pulled
      job("e", "completed", 1, "2026-06-01T00:00:00Z"), // too old
      job("f", "draft", 1, ""),
    ];
    const out = jobsThatPulled(jobs, "osb", { now: NOW });
    expect(out.map((j) => j.id)).toEqual(["b", "a"]);
    expect(out[1]).toMatchObject({ po: "POa", pulled: 5, returned: 3, unit: "sheets" });
  });

  it("ignores other items", () => {
    expect(jobsThatPulled([job("a", "completed", 5, "2026-11-20")], "nails", { now: NOW })).toEqual(
      [],
    );
  });
});
