// src/data/trainingVideos.js
//
// The training library, in one place, because it is rendered twice:
//
//   src/views/TrainingPage.jsx — public, off the landing page's Help button.
//                                Scoped .sw-training styling, own page chrome.
//   src/views/TrainingView.jsx — inside the portal, off the sidebar. Uses the
//                                app's tokens and sits in the normal app shell.
//
// The two look nothing alike on purpose: one is marketing chrome, the other is
// the product. What must NOT diverge is which videos exist, so only that lives
// here. Add a clip once and both surfaces pick it up.
//
// `src` is a path under public/, which Vite copies to dist/ verbatim — a file at
// public/steadwerk-foo.mp4 resolves at /steadwerk-foo.mp4. Self-hosting is not a
// preference: the CSP in public/_headers is default-src 'self' with no media-src,
// so a YouTube or Vimeo embed is blocked outright. `poster` is optional; without
// one each surface falls back to its own built-in still.

export const TRAINING_VIDEOS = [
  {
    id: "full-tour",
    eyebrow: "The full tour",
    title: "Build a job to a costed report",
    blurb:
      "The whole loop, start to finish. Build the job, approve it, pull the materials, return what came back, and read the costed report that falls out the other end.",
    src: "/steadwerk-demo.mp4",
  },
];

export default TRAINING_VIDEOS;
