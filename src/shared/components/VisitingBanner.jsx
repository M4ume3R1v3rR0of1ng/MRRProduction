// src/shared/components/VisitingBanner.jsx
//
// Shown only while the platform owner is working inside a company they hold no
// membership in (see supabase/31). Operating in someone else's live data must
// never be a state you can forget you are in — every job you close and every
// batch you adjust from here is real, and it is theirs.
//
// Pinned to the bottom of the viewport rather than sitting in the flow: the app
// shell is locked to 100vh with its own overflow rules, and a banner in the
// layout would either steal height from it or get scrolled away exactly when it
// matters.
//
// The `position: fixed` that did that used to live on this component. It now
// lives on the shared bottom banner stack in App.jsx, because this is no longer
// the only thing down there — the role-preview banner can be on at the same
// time, and two separately-fixed bars at bottom:0 draw on top of each other.
// `stacked` says another banner sits below this one, which is what decides
// whether this one pads for the iOS home indicator.
import { useState } from "react";
import { Eye } from "lucide-react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { translations } from "../utils/translations";
import { Btn, Row } from "./UIPrimitives";

export default function VisitingBanner({ user, onLogout, stacked = false, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const [leaving, setLeaving] = useState(false);

  if (!user?.isVisiting) return null;

  // Back to their own company — the first active membership they hold. A platform
  // admin normally has exactly one (Steadwerk). If they somehow have none there is
  // nowhere to return to, and signing out is the only honest exit.
  const leave = async () => {
    setLeaving(true);
    const { data: mine } = await supabase
      .from("memberships")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .limit(1);

    if (!mine?.length) {
      await onLogout?.();
      return;
    }

    const { error } = await supabase.rpc("set_active_company", { target: mine[0].company_id });
    if (error) {
      console.error("Could not leave visited company:", error);
      setLeaving(false);
      return;
    }
    // Same hard reload as CompanySwitcher: nothing from the visited company may
    // survive into the next one.
    window.location.reload();
  };

  return (
    <Row
      justify="center"
      gap={6}
      wrap
      style={{
        background: C.rust,
        color: C.onAccent,
        // Extra bottom padding lifts the text off the iOS home indicator while the
        // banner's own rust background still runs to the physical screen edge.
        // --safe-bottom is 0px everywhere else. Skipped when another banner is
        // stacked below this one — that one is doing the clearing.
        padding: stacked ? "9px 16px" : "9px 16px calc(9px + var(--safe-bottom))",
        fontSize: "var(--text-base)",
        fontWeight: "var(--weight-bold)",
        boxShadow: "0 -2px 12px rgba(0,0,0,0.28)",
      }}
    >
      <Row gap={3}>
        <Eye size={16} aria-hidden="true" />{" "}
        {t.visitingBanner.replace("{name}", user.companyName || t.visitingUnknownCompany)}
      </Row>
      <Btn
        onClick={leave}
        disabled={leaving}
        style={{
          background: C.onAccent,
          color: C.rust,
          border: "none",
          borderRadius: "var(--radius-md)",
          padding: "5px 14px",
          fontWeight: "var(--weight-extrabold)",
          fontSize: "var(--text-2xs)",
          cursor: leaving ? "wait" : "pointer",
        }}
      >
        {leaving ? t.visitingLeaving : t.visitingLeave}
      </Btn>
    </Row>
  );
}
