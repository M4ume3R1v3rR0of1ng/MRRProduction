// src/features/jobs/JobHandoff.jsx
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
import { C } from "@/shared/utils/helpers";
import { TrussMark } from "@/shared/components/SteadwerkMark";
import { Stack, Text, Btn, TextBtn } from "@/shared/components/UIPrimitives";

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
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--c-backdrop)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-5)",
      }}
    >
      <div
        className="mrr-modal"
        role="dialog"
        aria-modal="true"
        style={{
          background: C.w,
          borderRadius: "var(--radius-2xl)",
          width: "100%",
          maxWidth: 420,
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
          textAlign: "center",
        }}
      >
        <Stack
          gap={3}
          align="center"
          style={{ background: "var(--brand-accent, var(--c-amber))", padding: "var(--space-7)" }}
        >
          <TrussMark size={34} color="var(--brand-accent-ink, var(--c-shell))" />
          <Text
            size="xl"
            weight="black"
            color="var(--brand-accent-ink, var(--c-shell))"
            font="display"
          >
            {title}
          </Text>
        </Stack>

        <Stack gap={0} style={{ padding: "var(--space-8)" }}>
          <Text size="lg" weight="extrabold" color={C.navy} style={{ marginBottom: 2 }}>
            {job.title || job.name}
          </Text>
          <Text size="base" color={C.sub} style={{ marginBottom: 4 }}>
            PO {job.po || "—"}
            {job.addr ? ` · ${job.addr}` : ""}
          </Text>
          <Text
            size="base"
            color={C.sub}
            style={{ lineHeight: 1.6, marginBottom: "var(--space-7)" }}
          >
            {message}
          </Text>

          <Stack gap={3}>
            {onGo && actionLabel && (
              <Btn v="teal" sz="lg" block autoFocus onClick={onGo}>
                {actionLabel}
              </Btn>
            )}
            {/* Beside a primary action this is the quiet way out, not a second
                button competing with it. */}
            {onGo ? (
              <TextBtn color={C.sub} onClick={onClose} style={{ padding: 10 }}>
                {closeLabel}
              </TextBtn>
            ) : (
              <Btn v="ghost" block onClick={onClose}>
                {closeLabel}
              </Btn>
            )}
          </Stack>
        </Stack>
      </div>
    </div>
  );
}
