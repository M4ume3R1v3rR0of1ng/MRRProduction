// src/features/training/trainingMedia.js
//
// The runtime half of the training library.
//
// The bundled library in src/shared/data/trainingVideos.js is Steadwerk's own product
// training and ships in the build: a file in public/ plus an entry in that module, which
// means a code change and a deploy per clip (empty today — see that file). This is the
// other half: media uploaded at runtime, stored in the training-media bucket and listed
// in training_media.
//
// ONE LIBRARY, READ BY EVERY COMPANY (see supabase/60_training_media_one_shared_library.sql)
//
// Every company reads every clip, logged in or not, including companies that sign up
// later. There is no per-company tier any more.
//
// 45 and 56 ran a second, private tier here, which is why is_global exists at all. It
// is gone: 45's default (is_global false) quietly made every upload private to
// whichever tenant the uploader happened to be working inside — the Owner included —
// so the shared library was shared with exactly one company. 60 publishes every row
// and holds the column true in a trigger, so nothing can be hidden again.
//
// WHO MAY WRITE IS UNCHANGED, AND WIDER THAN IT LOOKS
//
// 60 deliberately left 56's write rule alone: a platform admin (Owner) anywhere, and a
// company's own Admin for any clip their company can SEE. Every company can now see
// every clip, so that second branch reaches the whole library — any company's Admin can
// edit or remove any clip, and it lands for every other company. See canEditMedia and
// point 2 of 60's header; narrowing this is a decision still to be made.
//
// What a company's Admin also does is ASSIGN clips to their own crew with their own due
// dates — their company's row, not a change to the clip. That lives in
// ./trainingAssignments and supabase/48, and is untouched by any of this.
//
// Both tiers (bundled, uploaded) render in the same list, bundled first. Nothing here
// can edit or remove the bundled clips.

// Kept in step with the bucket limits in supabase/26_training_media.sql. The Supabase
// plan also enforces a global per-request upload ceiling that can be LOWER than these;
// when it is, the upload fails at the API rather than here, so the error path has to stay
// readable either way.
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

// mp4 and webm only. The CSP change that lets these play at all names one origin, not a
// codec list, so the narrow set here is what keeps a .mov nobody can play out of the
// library. quicktime is excluded on purpose: Safari plays it, Chrome and Firefox mostly
// do not, and a training video half the crew cannot watch is worse than a rejected upload.
export const VIDEO_TYPES = ["video/mp4", "video/webm"];
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function mediaKind(file) {
  const type = String(file?.type || "").toLowerCase();
  if (VIDEO_TYPES.includes(type)) return "video";
  if (IMAGE_TYPES.includes(type)) return "photo";
  return null;
}

export function maxBytesFor(kind) {
  return kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// Pure: is this file something we will accept, and if not, why not in words someone can
// act on. Returns { ok, kind, error }.
export function validateMediaFile(file) {
  if (!file) return { ok: false, kind: null, error: "Choose a file to upload." };

  const kind = mediaKind(file);
  if (!kind) {
    return {
      ok: false,
      kind: null,
      error:
        "That file type is not supported. Use MP4 or WebM for video, or JPG, PNG or WebP for a photo.",
    };
  }

  const max = maxBytesFor(kind);
  if (file.size > max) {
    return {
      ok: false,
      kind,
      error: `That ${kind} is ${formatBytes(file.size)}. The limit is ${formatBytes(max)}. Trim it or export at a lower resolution.`,
    };
  }

  if (file.size === 0) {
    return { ok: false, kind, error: "That file is empty." };
  }

  return { ok: true, kind, error: null };
}

// Storage object path. The company prefix is no longer a permission boundary — only a
// platform admin writes to this bucket at all after supabase/60, and the folder-scoped
// write policies 45 introduced are gone with the tier they served. It stays because
// every object already in the bucket carries it, so changing the shape now would split
// the library across two conventions for no gain, and because it still answers "which
// session uploaded this" when reading the bucket directly. The random suffix stops two
// uploads named "training.mp4" in the same second from colliding.
export function mediaObjectPath(companyId, file) {
  if (!companyId)
    throw new Error("mediaObjectPath: companyId is required (tenant-scoped storage).");
  const dot = String(file?.name || "").lastIndexOf(".");
  const ext =
    dot > -1
      ? String(file.name)
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
      : "bin";
  const rand = Math.random().toString(36).slice(2, 10);
  return `${companyId}/${Date.now()}_${rand}.${ext}`;
}

// A title is required; everything else is optional. Falling back to the filename would
// fill the library with "VID_20260810_113045.mp4" as headings.
export function validateMediaForm({ title, file }) {
  if (!String(title || "").trim())
    return { ok: false, error: "Give the clip a title so people know what it covers." };
  return validateMediaFile(file);
}

// The row to insert. company_id is set by the database default, not here — it is the
// "Added by" byline, not a visibility gate.
//
// is_global is always true and is not a parameter. There is one library and every
// company reads it, so a clip written any other way is a clip nobody can see; that is
// the bug supabase/60 fixed, and its guard trigger refuses a false row outright rather
// than trusting this function to be the only writer.
export function mediaRow({ title, blurb, kind, url, sortOrder, user }) {
  return {
    title: String(title).trim().slice(0, 160),
    blurb:
      String(blurb || "")
        .trim()
        .slice(0, 600) || null,
    kind,
    url,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    is_global: true,
    created_by: user?.id || null,
    // Denormalised for the same reason the other four tables do it: a deleted account
    // otherwise leaves an orphaned id and no way to say who added the clip.
    created_by_name: user?.full_name || user?.name || user?.email || null,
  };
}

// Who may edit or remove a clip. Three rules, in the order they apply:
//
//   1. Nobody touches a bundled clip. It ships in the build, so there is no row to
//      change and no file to delete.
//   2. A platform admin (Owner) may edit or remove any clip.
//   3. A company Admin may edit or remove any clip their company can SEE (supabase/56).
//
// Rule 3 used to mean "their own company's private clips, plus Steadwerk's global
// ones". After supabase/60 there is one library and every company sees all of it, so
// rule 3 now reaches EVERY clip: an edit or a delete by any company's Admin lands for
// every other company and on the logged-out /training page, and a delete clears every
// company's assignments and read receipts for it. 60 left that reach in place on
// purpose — the UI warns before an edit, and narrowing it is a decision still to be
// made. companyId is no longer consulted, because there is no row a company can see
// but not write; it stays in the signature so the caller does not have to change when
// that decision lands.
//
// This decides which BUTTONS appear. The row-write policies in supabase/56, still
// live, are what actually enforce it; a hidden button stops nobody.
export function canEditMedia(clip, { isPlatformAdmin = false, isCompanyAdmin = false } = {}) {
  if (!clip || clip.bundled) return false;
  return isPlatformAdmin === true || isCompanyAdmin === true;
}

// Bundled clips first, then the uploaded library by sort order and then upload time, so
// the product tour stays at the top of the page it explains.
export function orderedMedia(bundled = [], uploaded = []) {
  const mine = [...uploaded].sort((a, b) => {
    const s = (a?.sort_order ?? 0) - (b?.sort_order ?? 0);
    if (s !== 0) return s;
    return String(a?.created_at || "").localeCompare(String(b?.created_at || ""));
  });
  return [
    ...bundled.map((clip) => ({ ...clip, kind: "video", bundled: true })),
    ...mine.map((row) => ({ ...row, bundled: false })),
  ];
}
