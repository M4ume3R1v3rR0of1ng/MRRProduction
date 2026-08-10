// src/utils/trainingMedia.js
//
// Company-uploaded training clips and photos.
//
// The bundled library in src/data/trainingVideos.js is Steadwerk's own product training
// and ships in the build: a file in public/ plus an entry in that module, which means a
// code change and a deploy per clip. That is correct for product training and useless for
// "here is how WE tarp a roof", so this is the other half: per-company media an admin
// uploads at runtime, stored in the training-media bucket and listed in training_media.
//
// The two render in the same list, bundled first. Nothing here can edit or remove the
// bundled clips.

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
      error: "That file type is not supported. Use MP4 or WebM for video, or JPG, PNG or WebP for a photo.",
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

// Storage object path. Tenant prefix first, because that is what the RLS policies in
// supabase/05_storage.sql and 26 key on. The random suffix stops two people uploading
// "training.mp4" in the same second from colliding.
export function mediaObjectPath(companyId, file) {
  if (!companyId) throw new Error("mediaObjectPath: companyId is required (tenant-scoped storage).");
  const dot = String(file?.name || "").lastIndexOf(".");
  const ext = dot > -1 ? String(file.name).slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
  const rand = Math.random().toString(36).slice(2, 10);
  return `${companyId}/${Date.now()}_${rand}.${ext}`;
}

// A title is required; everything else is optional. Falling back to the filename would
// fill the library with "VID_20260810_113045.mp4" as headings.
export function validateMediaForm({ title, file }) {
  if (!String(title || "").trim()) return { ok: false, error: "Give the clip a title so people know what it covers." };
  return validateMediaFile(file);
}

// The row to insert. company_id is set by the database default, not here.
export function mediaRow({ title, blurb, kind, url, sortOrder, user }) {
  return {
    title: String(title).trim().slice(0, 160),
    blurb: String(blurb || "").trim().slice(0, 600) || null,
    kind,
    url,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    created_by: user?.id || null,
    // Denormalised for the same reason the other four tables do it: a deleted account
    // otherwise leaves an orphaned id and no way to say who added the clip.
    created_by_name: user?.full_name || user?.name || user?.email || null,
  };
}

// Bundled clips first, then company uploads by sort order and then upload time, so the
// product tour stays at the top of the page it explains.
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
