// src/views/TrainingView.jsx
//
// Training & help, inside the portal. Same videos as the public page off the
// landing-page Help button, different chrome.
//
// WHY THIS IS NOT JUST TrainingPage RENDERED IN THE APP
//
// TrainingPage carries a full-page shell: its own sticky brand bar, a "← Back"
// button, and a ~4 kB scoped stylesheet that redeclares colour, type and spacing
// from scratch because it has to survive outside the app's design system. None of
// that belongs inside the portal, where the sidebar is the navigation, the theme
// is already applied, and tokens.css already defines every value that stylesheet
// re-invents. Reusing it here would mean a page inside a page.
//
// So the chrome differs and the DATA is shared: both read
// src/data/trainingVideos.js, which is the only thing that would actually hurt to
// have in two places. Add a clip there and it appears in both.
import { useRef, useState } from "react";
import { C } from "../utils/helpers";
import { translations } from "../utils/translations";
import { TRAINING_VIDEOS } from "../data/trainingVideos";

export default function TrainingView({ lang = "en" }) {
  const t = translations[lang] || translations.en;
  // Which clips have been started, keyed by id so several videos each track
  // their own poster rather than sharing one flag.
  const [started, setStarted] = useState({});
  const refs = useRef({});

  const start = (id) => () => {
    setStarted((p) => ({ ...p, [id]: true }));
    const v = refs.current[id];
    // play() rejects under some mobile autoplay policies even from a real tap.
    // The poster is already down by then, so the native controls take over.
    if (v) Promise.resolve(v.play()).catch(() => {});
  };

  return (
    <div>
      <div style={{ marginBottom: "var(--space-6)" }}>
        <h2
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: "var(--weight-extrabold)",
            color: C.navy,
            margin: 0,
          }}
        >
          {t.trainingTitle}
        </h2>
        <p style={{ color: C.sub, fontSize: "var(--text-sm)", margin: "6px 0 0", maxWidth: "70ch" }}>
          {t.trainingSubtitle}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        {TRAINING_VIDEOS.map((clip) => (
          <div
            key={clip.id}
            style={{
              background: C.w,
              borderRadius: "var(--radius-xl)",
              boxShadow: "var(--shadow-sm)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "var(--space-5) var(--space-5) var(--space-4)" }}>
              <div
                style={{
                  fontSize: "var(--text-2xs)",
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  fontWeight: "var(--weight-extrabold)",
                  color: C.am,
                  marginBottom: 6,
                }}
              >
                {clip.eyebrow}
              </div>
              <div
                style={{
                  fontSize: "var(--text-lg)",
                  fontWeight: "var(--weight-extrabold)",
                  color: C.navy,
                }}
              >
                {clip.title}
              </div>
              <p style={{ color: C.sub, fontSize: "var(--text-sm)", margin: "6px 0 0", maxWidth: "72ch" }}>
                {clip.blurb}
              </p>
            </div>

            {/* The poster is a real button so it is focusable and keyboard
                operable. Once play starts it drops away and the video's native
                controls own everything after that — no custom transport to
                maintain or to get wrong on mobile. */}
            <div style={{ position: "relative", background: "#000" }}>
              <video
                ref={(el) => { refs.current[clip.id] = el; }}
                controls
                preload="metadata"
                playsInline
                poster={clip.poster || undefined}
                onPlay={() => setStarted((p) => ({ ...p, [clip.id]: true }))}
                style={{ display: "block", width: "100%", aspectRatio: "16 / 9", objectFit: "contain", background: "#000" }}
              >
                <source src={clip.src} type="video/mp4" />
                {t.trainingNoVideo}{" "}
                <a href={clip.src} style={{ color: C.am }}>{t.trainingDownload}</a>
              </video>

              {!started[clip.id] && (
                <button
                  type="button"
                  onClick={start(clip.id)}
                  aria-label={`${t.trainingPlay}: ${clip.title}`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 14,
                    font: "inherit",
                    // shellInk, not a literal: this poster is the same "stays dark
                    // in both themes" chrome as the sidebar, and the palette audit
                    // in utils/palette.test.js rejects hardcoded light ink for
                    // exactly the reason it would break here if the gradient ever
                    // stopped being dark.
                    color: C.shellInk,
                    background:
                      "repeating-linear-gradient(115deg, transparent 0 46px, rgba(201,123,45,.07) 46px 48px), radial-gradient(ellipse at 50% 34%, #2F353C 0%, #23282D 55%, #171B1F 100%)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 68,
                      height: 68,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      background: C.am,
                      color: C.onAccent,
                      fontSize: 21,
                      paddingLeft: 5,
                      boxShadow: "0 10px 34px rgba(0,0,0,.42)",
                    }}
                  >
                    ▶
                  </span>
                  <span style={{ fontWeight: "var(--weight-extrabold)", fontSize: "var(--text-md)", padding: "0 20px", textAlign: "center" }}>
                    {clip.title}
                  </span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p
        style={{
          marginTop: "var(--space-6)",
          padding: "var(--space-5)",
          borderRadius: "var(--radius-xl)",
          background: C.lg,
          color: C.sub,
          fontSize: "var(--text-sm)",
        }}
      >
        {t.trainingMoreComing}
      </p>
    </div>
  );
}
