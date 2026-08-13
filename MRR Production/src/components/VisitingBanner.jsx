// src/components/VisitingBanner.jsx
//
// Shown only while the platform owner is working inside a company they hold no
// membership in (see supabase/31). Operating in someone else's live data must
// never be a state you can forget you are in — every job you close and every
// batch you adjust from here is real, and it is theirs.
//
// Fixed rather than inline: the app shell is locked to 100vh with its own
// overflow rules, and a banner in the flow would either steal height from the
// layout or get scrolled away exactly when it matters.
import { useState } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { translations } from "../utils/translations";

export default function VisitingBanner({ user, onLogout, lang = "en" }) {
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
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 900,
        background: C.rust,
        color: "var(--c-on-accent)",
        padding: "9px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        flexWrap: "wrap",
        fontSize: "var(--text-base)",
        fontWeight: "var(--weight-bold)",
        boxShadow: "0 -2px 12px rgba(0,0,0,0.28)",
      }}
    >
      <span>
        👁️ {t.visitingBanner.replace("{name}", user.companyName || t.visitingUnknownCompany)}
      </span>
      <button
        onClick={leave}
        disabled={leaving}
        style={{
          background: "var(--c-on-accent)",
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
      </button>
    </div>
  );
}
