// src/views/TrainingPage.jsx
//
// Public training / help page, reachable from the Help button in the landing-page
// nav. Styles are scoped under .sw-training so nothing leaks into the app's
// global stylesheet — same containment rule TermsPage follows.
//
// The product tour that used to sit in a #demo band on the landing page now lives
// here as the first entry. That was a deliberate move, not a copy: two players
// pointed at the same file meant the marketing page carried the weight of a video
// element for a visitor who mostly scrolls past it, and it gave us two places to
// update whenever the recording is re-cut. The landing page's "Watch the demo"
// buttons now open this page instead of scrolling.
//
// ADDING A VIDEO
//
// Edit src/data/trainingVideos.js. The list is shared with the in-app view
// (src/views/TrainingView.jsx) so a clip added once shows up in both places.
// Everything on this page is generated from it.
import { useEffect, useRef, useState } from "react";
import { TRAINING_VIDEOS } from "../data/trainingVideos";

const Badge = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect className="mk-rect" x="4" y="4" width="56" height="56" rx="10" />
    <path className="mk-stroke" d="M14 20 L22 44 L32 24 L42 44 L50 20" fill="none" strokeWidth="5" strokeLinecap="square" />
  </svg>
);

const VIDEOS = TRAINING_VIDEOS;

const CSS = `
.sw-training {
  --ground:#F6F3EC; --surface:#FFFFFF; --surface-2:#EDE6DA;
  --ink:#23282D; --ink-soft:#4E565D; --muted:#6E7780;
  --line:rgba(35,40,45,.14); --line-2:rgba(35,40,45,.28);
  --accent:#C97B2D; --accent-deep:#8A5A2B;
  --bar-1:#2F353C; --bar-2:#23282D; --on-dark:#EDE6DA; --on-dark-soft:rgba(237,230,218,.72);
  --shadow:0 18px 44px rgba(35,40,45,.14);

  min-height:100vh; background:var(--ground); color:var(--ink);
  font-family:"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size:16.5px; line-height:1.72; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
@media (prefers-color-scheme: dark) {
  .sw-training {
    --ground:#191D21; --surface:#20242A; --surface-2:#2B3137;
    --ink:#ECE6DA; --ink-soft:#B7BEC5; --muted:#8A929A;
    --line:rgba(237,230,218,.14); --line-2:rgba(237,230,218,.24);
    --accent:#DB9550; --accent-deep:#E7A968;
    --bar-1:#2A2F35; --bar-2:#20242A;
    --shadow:0 18px 44px rgba(0,0,0,.42);
  }
}
.sw-training, .sw-training *, .sw-training *::before, .sw-training *::after { box-sizing:border-box; }
.sw-training .wrap { width:100%; max-width:980px; margin:0 auto; padding:0 24px; }
.sw-training a { color:var(--accent-deep); text-decoration:underline; text-underline-offset:2px; }

.sw-training .mk-rect { fill:var(--accent); }
.sw-training .mk-stroke { stroke:#23282D; }

/* ---- top bar ---- */
.sw-training .bar {
  background:linear-gradient(180deg, var(--bar-1), var(--bar-2));
  color:var(--on-dark); position:sticky; top:0; z-index:20;
  /* Clears the iOS status bar in the installed app. Padding rather than a margin
     so the bar's own gradient fills the notch. 0px everywhere else. */
  padding-top:var(--safe-top);
  border-bottom:1px solid rgba(0,0,0,.28);
}
.sw-training .bar-in { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 24px; }
.sw-training .brand { display:inline-flex; align-items:center; gap:10px; }
.sw-training .wm { font-weight:800; letter-spacing:.16em; font-size:13px; }
.sw-training .back {
  background:transparent; border:1px solid rgba(237,230,218,.34); color:var(--on-dark);
  border-radius:9px; padding:7px 14px; cursor:pointer; font:inherit; font-size:14px; font-weight:600;
}
.sw-training .back:hover { background:rgba(237,230,218,.10); }

/* ---- header ---- */
.sw-training .head { padding:56px 0 34px; }
.sw-training .eyebrow {
  display:inline-block; font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:11.5px; letter-spacing:.18em; text-transform:uppercase; color:var(--accent-deep); margin-bottom:12px;
}
.sw-training h1 { font-size:clamp(30px, 5vw, 46px); line-height:1.12; margin:0 0 14px; letter-spacing:-.02em; }
.sw-training .lede { color:var(--ink-soft); max-width:64ch; margin:0; }

/* ---- one video ---- */
.sw-training .clip { padding:0 0 56px; }
.sw-training .clip + .clip { border-top:1px solid var(--line); padding-top:44px; }
.sw-training .clip-head { margin-bottom:18px; }
.sw-training .clip-head h2 { font-size:clamp(21px, 3vw, 27px); margin:0 0 8px; letter-spacing:-.01em; }
.sw-training .clip-head p { color:var(--ink-soft); margin:0; max-width:70ch; }

/* ---- the player. Carried over from the landing page: there is no poster image
   on disk, so the still is built in CSS from the same lattice and gradient the
   hero uses. That keeps it on brand, costs no asset, and means the thumbnail is
   not whatever frame 1 happens to be. The overlay is a real button, so it is
   focusable and keyboard-operable; the video keeps its native controls for
   everything after the first play. ---- */
.sw-training .vid { position:relative; border-radius:16px; overflow:hidden; border:1px solid var(--line); box-shadow:var(--shadow); background:#000; }
.sw-training .vid video { display:block; width:100%; aspect-ratio:16 / 9; object-fit:contain; background:#000; }
.sw-training .vid-poster {
  position:absolute; inset:0; padding:0; border:0; cursor:pointer; font-family:inherit; color:var(--on-dark);
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px;
  background:
    repeating-linear-gradient(115deg, transparent 0 46px, rgba(201,123,45,.07) 46px 48px),
    radial-gradient(ellipse at 50% 34%, #2F353C 0%, #23282D 55%, #171B1F 100%);
  transition:opacity .42s ease, visibility .42s;
}
.sw-training .vid.playing .vid-poster { opacity:0; visibility:hidden; pointer-events:none; }
.sw-training .vid-play {
  width:74px; height:74px; border-radius:50%; display:grid; place-items:center;
  background:var(--accent); color:#23282D; font-size:23px; padding-left:5px;
  box-shadow:0 10px 34px rgba(0,0,0,.42);
  transition:transform .26s cubic-bezier(.2,.8,.2,1), box-shadow .26s ease;
}
.sw-training .vid-poster:hover .vid-play { transform:scale(1.07); box-shadow:0 14px 40px rgba(0,0,0,.5); }
.sw-training .vid-ttl { font-size:19px; font-weight:800; letter-spacing:-.01em; padding:0 20px; text-align:center; }
.sw-training .vid-meta {
  font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:var(--on-dark-soft);
}

/* ---- more-to-come note ---- */
.sw-training .note {
  border:1px dashed var(--line-2); border-radius:14px; background:var(--surface);
  padding:22px 24px; margin:0 0 64px; color:var(--ink-soft);
}
.sw-training .note b { color:var(--ink); }

@media (prefers-reduced-motion: reduce) {
  .sw-training * { transition:none !important; animation:none !important; }
}
`;

export default function TrainingPage({ onBack }) {
  const rootRef = useRef(null);
  // Which clips have been started. Keyed by id rather than a single boolean so
  // several videos on the page track their own poster independently.
  const [started, setStarted] = useState({});
  const refs = useRef({});

  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, []);

  const start = (id) => () => {
    setStarted((p) => ({ ...p, [id]: true }));
    const v = refs.current[id];
    // play() rejects under some mobile autoplay policies even from a real tap.
    // The poster is already down by then, so the native controls take over.
    if (v) Promise.resolve(v.play()).catch(() => {});
  };

  return (
    <div className="sw-training" ref={rootRef}>
      <style>{CSS}</style>

      <header className="bar">
        <div className="wrap bar-in">
          <div className="brand">
            <Badge size={28} />
            <span className="wm">STEADWERK</span>
          </div>
          <button className="back" type="button" onClick={onBack}>← Back</button>
        </div>
      </header>

      <div className="wrap">
        <div className="head">
          <span className="eyebrow">Help &amp; training</span>
          <h1>Learn Steadwerk in an afternoon.</h1>
          <p className="lede">
            Short walkthroughs of the parts people ask about most. Nothing here needs a sales call, an
            account, or a login. Watch what you need and get back to work.
          </p>
        </div>

        {VIDEOS.map((clip) => (
          <section className="clip" key={clip.id} id={clip.id}>
            <div className="clip-head">
              <span className="eyebrow">Watch · {clip.eyebrow}</span>
              <h2>{clip.title}</h2>
              <p>{clip.blurb}</p>
            </div>
            <div className={started[clip.id] ? "vid sw-video-half playing" : "vid sw-video-half"}>
              <video
                ref={(el) => { refs.current[clip.id] = el; }}
                controls
                preload="metadata"
                playsInline
                poster={clip.poster || undefined}
                onPlay={() => setStarted((p) => ({ ...p, [clip.id]: true }))}
              >
                <source src={clip.src} type="video/mp4" />
                Your browser can’t play this video.{" "}
                <a href={clip.src}>Download it instead.</a>
              </video>
              <button
                className="vid-poster"
                type="button"
                onClick={start(clip.id)}
                aria-label={`Play: ${clip.title}`}
              >
                <span className="vid-play" aria-hidden="true">▶</span>
                <span className="vid-ttl">{clip.title}</span>
                <span className="vid-meta">{clip.eyebrow}</span>
              </button>
            </div>
          </section>
        ))}

        <p className="note">
          <b>More walkthroughs are on the way.</b> Receiving stock, fleet inspections, and the
          maintenance board are next. If there is something you would rather see covered first,
          say so at <a href="mailto:help@steadwerk.com">help@steadwerk.com</a> and it moves up the list.
        </p>
      </div>
    </div>
  );
}
