// src/components/JobHandoff.jsx
//
// The card shown after a job moves down the pipeline: built, pulled, completed,
// closed. One component for all four so the hand-off reads the same every time.
//
// WHY THIS EXISTS AT ALL
//
// Every one of those four steps moves a job to a different screen or a different
// filter, and the job vanishes from where you were standing the instant you press
// the button. A toast said "Job completed" and faded after four seconds, which
// answers the wrong question — the one people actually have is "where did it go?".
// So this names the destination, and the button takes you there and leaves the
// card glowing until you touch it.
//
// The action is optional on purpose. A site supervisor can complete a job but
// cannot open Build Jobs, so for them the card explains where the paperwork went
// and offers nothing to press. A button that navigates somewhere they are not
// permitted is worse than no button.
import { C } from "../utils/helpers";
import { TrussMark } from "../components/SteadwerkMark";

export default function JobHandoff({
  job,
  title,
  message,
  actionLabel,
  onGo,
  onClose,
  closeLabel = "Stay here",
}) {
  if (!job) return null;

  return (
    <div
      className="mrr-backdrop"
      style={{ position: "fixed", inset: 0, background: "var(--c-backdrop)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-5)" }}
    >
      <div
        className="mrr-modal"
        role="dialog"
        aria-modal="true"
        style={{ background: C.w, borderRadius: "var(--radius-2xl)", width: "100%", maxWidth: 420, boxShadow: "var(--shadow-lg)", overflow: "hidden", textAlign: "center" }}
      >
        <div style={{ background: "var(--brand-accent, var(--c-amber))", padding: "var(--space-7)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <TrussMark size={34} color="var(--brand-accent-ink, var(--c-shell))" />
          <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xl)", fontWeight: "var(--weight-black)", color: "var(--brand-accent-ink, var(--c-shell))" }}>
            {title}
          </div>
        </div>

        <div style={{ padding: "var(--space-8)" }}>
          <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, fontSize: "var(--text-lg)", marginBottom: 2 }}>
            {job.title || job.name}
          </div>
          <div style={{ color: C.sub, fontSize: "var(--text-base)", marginBottom: 4 }}>
            PO {job.po || "—"}{job.addr ? ` · ${job.addr}` : ""}
          </div>
          <div style={{ color: C.sub, fontSize: "var(--text-base)", lineHeight: 1.6, marginBottom: "var(--space-7)" }}>
            {message}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {onGo && actionLabel && (
              <button
                className="mrr-btn"
                autoFocus
                onClick={onGo}
                style={{ padding: "12px", background: C.teal, color: "var(--c-on-accent)", border: "none", borderRadius: "var(--radius-lg)", fontWeight: "var(--weight-extrabold)", fontSize: "var(--text-md)", cursor: "pointer" }}
              >
                {actionLabel}
              </button>
            )}
            <button
              className="mrr-btn"
              onClick={onClose}
              style={{ padding: "10px", background: onGo ? "transparent" : C.subtle, color: onGo ? C.sub : C.barnwood, border: "none", borderRadius: "var(--radius-lg)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", cursor: "pointer" }}
            >
              {closeLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
