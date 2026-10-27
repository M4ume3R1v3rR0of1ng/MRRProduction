import { describe, it, expect } from "vitest";
import {
  mediaKind,
  validateMediaFile,
  validateMediaForm,
  mediaObjectPath,
  mediaRow,
  canEditMedia,
  orderedMedia,
  formatBytes,
  MAX_VIDEO_BYTES,
  MAX_IMAGE_BYTES,
} from "./trainingMedia";

const file = (type, size, name = "clip.mp4") => ({ type, size, name });

describe("mediaKind", () => {
  it("recognises the video and image types we accept", () => {
    expect(mediaKind(file("video/mp4", 10))).toBe("video");
    expect(mediaKind(file("video/webm", 10))).toBe("video");
    expect(mediaKind(file("image/jpeg", 10))).toBe("photo");
    expect(mediaKind(file("image/png", 10))).toBe("photo");
    expect(mediaKind(file("image/webp", 10))).toBe("photo");
  });

  it("rejects quicktime, which most browsers cannot play", () => {
    expect(mediaKind(file("video/quicktime", 10))).toBeNull();
  });

  it("is case insensitive and safe on junk input", () => {
    expect(mediaKind(file("VIDEO/MP4", 10))).toBe("video");
    expect(mediaKind({})).toBeNull();
    expect(mediaKind(null)).toBeNull();
  });
});

describe("validateMediaFile", () => {
  it("accepts a normal clip", () => {
    expect(validateMediaFile(file("video/mp4", 5_000_000))).toEqual({
      ok: true,
      kind: "video",
      error: null,
    });
  });

  it("rejects an unsupported type with an actionable message", () => {
    const res = validateMediaFile(file("application/pdf", 100));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/MP4 or WebM/);
  });

  it("holds video and images to different ceilings", () => {
    expect(validateMediaFile(file("video/mp4", MAX_VIDEO_BYTES)).ok).toBe(true);
    expect(validateMediaFile(file("video/mp4", MAX_VIDEO_BYTES + 1)).ok).toBe(false);
    expect(validateMediaFile(file("image/png", MAX_IMAGE_BYTES + 1)).ok).toBe(false);
    // An image well under the video ceiling is still too big for an image.
    expect(validateMediaFile(file("image/png", 20 * 1024 * 1024)).ok).toBe(false);
  });

  it("names the actual size and the limit when it rejects", () => {
    const res = validateMediaFile(file("video/mp4", 150 * 1024 * 1024));
    expect(res.error).toMatch(/150 MB/);
    expect(res.error).toMatch(/100 MB/);
  });

  it("rejects an empty file", () => {
    expect(validateMediaFile(file("video/mp4", 0)).ok).toBe(false);
  });

  it("rejects nothing selected", () => {
    expect(validateMediaFile(null).ok).toBe(false);
  });
});

describe("validateMediaForm", () => {
  it("requires a title rather than falling back to the filename", () => {
    const res = validateMediaForm({ title: "   ", file: file("video/mp4", 10) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/title/i);
  });

  it("still checks the file once the title is there", () => {
    expect(validateMediaForm({ title: "Tarping", file: file("application/zip", 10) }).ok).toBe(
      false,
    );
    expect(validateMediaForm({ title: "Tarping", file: file("video/mp4", 10) }).ok).toBe(true);
  });
});

describe("mediaObjectPath", () => {
  it("puts the company first, which is what the storage write policy keys on", () => {
    expect(mediaObjectPath("co1", file("video/mp4", 1, "Tarp Demo.mp4"))).toMatch(/^co1\//);
  });

  it("keeps the extension and sanitises it", () => {
    expect(mediaObjectPath("co1", file("video/mp4", 1, "a.MP4"))).toMatch(/\.mp4$/);
    expect(mediaObjectPath("co1", file("video/mp4", 1, "noext"))).toMatch(/\.bin$/);
  });

  it("does not collide for two uploads of the same name", () => {
    const a = mediaObjectPath("co1", file("video/mp4", 1, "x.mp4"));
    const b = mediaObjectPath("co1", file("video/mp4", 1, "x.mp4"));
    expect(a).not.toBe(b);
  });

  it("refuses to build an unscoped path", () => {
    expect(() => mediaObjectPath("", file("video/mp4", 1))).toThrow(/companyId/);
  });
});

describe("mediaRow", () => {
  it("trims and caps free text, and blank blurb becomes null", () => {
    const row = mediaRow({ title: "  Tarping  ", blurb: "   ", kind: "video", url: "u", user: {} });
    expect(row.title).toBe("Tarping");
    expect(row.blurb).toBeNull();
  });

  it("denormalises the uploader name so a deleted account stays attributable", () => {
    const row = mediaRow({
      title: "T",
      kind: "video",
      url: "u",
      user: { id: "u1", full_name: "Dana Reed" },
    });
    expect(row).toMatchObject({ created_by: "u1", created_by_name: "Dana Reed" });
  });

  it("falls back through name and email when full_name is absent", () => {
    expect(
      mediaRow({ title: "T", kind: "video", url: "u", user: { id: "u1", name: "Dana" } })
        .created_by_name,
    ).toBe("Dana");
    expect(
      mediaRow({ title: "T", kind: "video", url: "u", user: { id: "u1", email: "d@e.com" } })
        .created_by_name,
    ).toBe("d@e.com");
  });

  // The bug supabase/60 fixed: 45's default made every upload private to whichever
  // tenant the Owner was working inside, so "the shared library" reached one company.
  // There is no caller-supplied tier any more and no way to write a hidden row.
  it("always publishes the clip to every company", () => {
    expect(mediaRow({ title: "T", kind: "video", url: "u", user: {} }).is_global).toBe(true);
  });

  it("ignores a caller trying to hide a clip", () => {
    expect(
      mediaRow({ title: "T", kind: "video", url: "u", user: {}, isGlobal: false }).is_global,
    ).toBe(true);
  });
});

describe("canEditMedia", () => {
  const owner = { isPlatformAdmin: true };
  const admin = { isCompanyAdmin: true, companyId: "c1" };

  it("lets a platform admin edit any clip", () => {
    expect(canEditMedia({ id: "a", is_global: true }, owner)).toBe(true);
    expect(canEditMedia({ id: "a", is_global: true, company_id: "c2" }, owner)).toBe(true);
  });

  // 56's reach, which supabase/60 left in place: any clip the company can SEE. 60 made
  // that every clip, so a company admin now reaches another company's upload too — the
  // consequence of one shared library, and the thing to revisit when write permissions
  // are narrowed.
  it("lets a company admin edit any clip, whoever uploaded it", () => {
    expect(canEditMedia({ id: "a", is_global: true, company_id: "c1" }, admin)).toBe(true);
    expect(canEditMedia({ id: "a", is_global: true, company_id: "steadwerk" }, admin)).toBe(true);
    expect(canEditMedia({ id: "a", is_global: true, company_id: "c2" }, admin)).toBe(true);
  });

  it("refuses a bundled clip to everyone, platform admin included", () => {
    expect(canEditMedia({ id: "a", bundled: true }, owner)).toBe(false);
    expect(canEditMedia({ id: "a", bundled: true, is_global: true }, admin)).toBe(false);
  });

  it("refuses everyone else", () => {
    expect(canEditMedia({ id: "a", is_global: true }, { companyId: "c1" })).toBe(false);
    expect(canEditMedia({ id: "a", is_global: true }, {})).toBe(false);
  });

  it("survives junk input", () => {
    expect(canEditMedia(null, owner)).toBe(false);
    expect(canEditMedia({ id: "a", is_global: true })).toBe(false);
  });

  it("does not take a truthy non-true flag as an admin of either kind", () => {
    // TrainingView derives both flags with ===, so keep these strict: a stray "false"
    // string or a 1 must not open the library up.
    expect(canEditMedia({ id: "a" }, { isPlatformAdmin: "yes" })).toBe(false);
    expect(canEditMedia({ id: "a" }, { isPlatformAdmin: 1 })).toBe(false);
    expect(canEditMedia({ id: "a" }, { isCompanyAdmin: "admin" })).toBe(false);
    expect(canEditMedia({ id: "a" }, { isCompanyAdmin: 1 })).toBe(false);
  });
});

describe("orderedMedia", () => {
  it("keeps the bundled product tour above company uploads", () => {
    const out = orderedMedia(
      [{ id: "full-tour", title: "Tour" }],
      [{ id: "x", title: "Ours", sort_order: 0 }],
    );
    expect(out.map((m) => m.title)).toEqual(["Tour", "Ours"]);
    expect(out[0].bundled).toBe(true);
    expect(out[1].bundled).toBe(false);
  });

  it("marks bundled clips as video so they render with the player", () => {
    expect(orderedMedia([{ id: "a" }], [])[0].kind).toBe("video");
  });

  it("sorts uploads by sort order, then by upload time", () => {
    const out = orderedMedia(
      [],
      [
        { id: "b", sort_order: 1, created_at: "2026-01-01" },
        { id: "c", sort_order: 0, created_at: "2026-02-01" },
        { id: "a", sort_order: 0, created_at: "2026-01-01" },
      ],
    );
    expect(out.map((m) => m.id)).toEqual(["a", "c", "b"]);
  });

  it("survives empty input", () => {
    expect(orderedMedia()).toEqual([]);
  });
});

describe("formatBytes", () => {
  it("scales the unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB");
  });
});
