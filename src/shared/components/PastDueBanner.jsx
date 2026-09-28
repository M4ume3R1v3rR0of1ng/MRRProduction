// src/shared/components/PastDueBanner.jsx
//
// A company admin currently only learns their payment failed by going and
// looking at the Billing tab. This surfaces the same "past_due" state wherever
// they are in the app instead.
//
// Deliberately NOT position:fixed like VisitingBanner — this renders inside
// App.jsx's "CORE PANEL" content column (same slot as the app.loadErrors
// banner), which sits below the mobile header's own sticky bar. A fixed banner
// pinned to the viewport top would have drawn over that sticky bar instead of
// stacking above the routed view, covering the company name and the hamburger
// menu on every mobile screen.
//
// Self-contained: reads companies.subscription_status directly (the same
// RLS-scoped query BillingView.jsx already makes), rather than threading a new
// field through useAppData's already-large load pipeline for one banner.
//
// Not rendered on iOS — Billing is sold outside the app there (see App.jsx's
// IS_IOS_APP gate on BillingView) and there is no /billing route to send anyone
// to. Not rendered on the Billing tab itself, since the same notice already
// lives on the Plan card there.
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { translations } from "../utils/translations";
import { IS_IOS_APP } from "../../core/platform";

export default function PastDueBanner({ user, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const location = useLocation();
  const navigate = useNavigate();
  const [pastDue, setPastDue] = useState(false);

  const isAdmin = user?.role === "admin" || user?.isPlatformAdmin;

  useEffect(() => {
    let cancelled = false;
    if (!isAdmin || IS_IOS_APP) {
      setPastDue(false);
      return;
    }
    (async () => {
      const { data } = await supabase.from("companies").select("subscription_status").maybeSingle();
      if (!cancelled) setPastDue(data?.subscription_status === "past_due");
    })();
    return () => {
      cancelled = true;
    };
    // Re-checks on navigation, which is what picks this up right after an admin
    // fixes their card in the portal and gets bounced back into the app.
  }, [isAdmin, location.pathname]);

  if (!pastDue || IS_IOS_APP || location.pathname === "/billing") return null;

  return (
    <div
      style={{
        background: "var(--c-rust-wash)",
        borderBottom: "2px solid var(--c-rust)",
        color: "var(--c-rust)",
        padding: "10px 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        flexShrink: 0,
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-bold)",
      }}
    >
      <span style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
        <AlertTriangle size={15} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
        <span>{t.pastDueBanner}</span>
      </span>
      <button
        onClick={() => navigate("/billing")}
        style={{
          background: C.rust,
          color: "var(--c-on-accent)",
          border: "none",
          borderRadius: "var(--radius-md)",
          padding: "6px 14px",
          cursor: "pointer",
          fontWeight: "var(--weight-bold)",
          fontSize: "var(--text-sm)",
          flexShrink: 0,
        }}
      >
        {t.pastDueBannerAction}
      </button>
    </div>
  );
}
