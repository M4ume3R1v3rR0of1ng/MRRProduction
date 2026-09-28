// src/shared/data/trainingVideos.js
//
// Hardcoded, build-shipped clips — the kind that needs a code change and a deploy
// to add or edit. Empty since supabase/44_training_media_editable_and_public.sql:
// the one entry that lived here ("The Full Tour") is now a real row in
// public.training_media instead, editable from the portal, and readable logged-out
// by src/public/TrainingPage.jsx the same way src/features/training/TrainingView.jsx
// reads it.
//
// This stays wired up (see orderedMedia in trainingMedia.js, and the `bundled` flag
// both training views branch on) for the day something genuinely needs to ship this
// way again — a video nobody should ever be able to edit or remove at runtime — not
// because anything reads from it today.
//
// `src` is a path under public/, which Vite copies to dist/ verbatim — a file at
// public/steadwerk-foo.mp4 resolves at /steadwerk-foo.mp4. Self-hosting is not a
// preference: the CSP in public/_headers is default-src 'self' with no media-src,
// so a YouTube or Vimeo embed is blocked outright. `poster` is optional; without
// one each surface falls back to its own built-in still.

export const TRAINING_VIDEOS = [];

export default TRAINING_VIDEOS;
