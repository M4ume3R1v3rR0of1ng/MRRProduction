// src/shared/components/RolePreviewBanner.jsx
//
// Shown only while a role preview is running (core/rolePreview.js). Same reason
// VisitingBanner exists: a state that changes what the whole app looks like must
// not be one you can forget you are in.
//
// It carries the way out as well as the warning, which is the point. The picker
// itself lives in the sidebar, and the sidebar is collapsible on desktop and
// behind a hamburger on mobile — so on a phone, mid-recording, this button is
// the only exit on screen.
//
// Plum rather than rust: rust is the visiting banner's colour, and the two can
// be on screen at once (the platform owner previewing a role inside a tenant
// they hold no membership in). Two identical red bars reads as one problem
// reported twice.
import { Glasses } from "lucide-react";
import { C } from "../utils/helpers";
import { translations } from "../utils/translations";
import { Btn, Row, roleLabel } from "./UIPrimitives";

export default function RolePreviewBanner({ previewRole, onExit, stacked = false, lang = "en" }) {
  const t = translations[lang] || translations.en;

  if (!previewRole) return null;

  return (
    <Row
      justify="center"
      gap={6}
      wrap
      style={{
        background: C.plum,
        color: C.onAccent,
        // Only the bottom-most bar in the stack lifts its text off the iOS home
        // indicator; above the visiting banner there is nothing down there to
        // clear. --safe-bottom is 0px everywhere that isn't an installed app.
        padding: stacked ? "9px 16px" : "9px 16px calc(9px + var(--safe-bottom))",
        fontSize: "var(--text-base)",
        fontWeight: "var(--weight-bold)",
        boxShadow: "0 -2px 12px rgba(0,0,0,0.28)",
      }}
    >
      <Row gap={3}>
        <Glasses size={16} aria-hidden="true" />{" "}
        {t.rolePreviewBanner.replace("{role}", roleLabel(previewRole, lang))}
      </Row>
      <Btn
        onClick={onExit}
        style={{
          background: C.onAccent,
          color: C.plum,
          border: "none",
          borderRadius: "var(--radius-md)",
          padding: "5px 14px",
          fontWeight: "var(--weight-extrabold)",
          fontSize: "var(--text-2xs)",
        }}
      >
        {t.rolePreviewExit}
      </Btn>
    </Row>
  );
}
