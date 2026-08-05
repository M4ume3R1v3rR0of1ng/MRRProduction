// src/components/SyncIndicator.jsx
//
// Connection state only. This used to also count writes waiting in a local
// queue, but nothing ever put one there: queueOfflineAction() was exported and
// never called, so the badge always read "0 changes will sync later" while
// telling crews their work was cached. It wasn't. Every write in the app goes
// straight to Supabase and fails outright without a signal.
//
// So the indicator now says the one thing it can actually stand behind: whether
// the device is on the network. A crew that reads "Offline" and waits is better
// served than one promised a sync that was never coming.
import { useState, useEffect } from "react";
import { C } from "../utils/helpers";
import { translations } from "../utils/translations";

export default function SyncIndicator({ lang = "en" }) {
  const t = translations[lang] || translations.en;
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const updateStatus = () => setIsOnline(navigator.onLine);

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    updateStatus();

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  if (isOnline) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "12px", fontWeight: "var(--weight-bold)", color: C.gr }}>
        <span>🟢</span> {t.chromeConnected}
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        fontSize: "12px",
        fontWeight: "var(--weight-bold)",
        color: C.am,
        background: C.aB || "rgba(245,158,11,0.1)",
        padding: "4px 10px",
        borderRadius: "20px",
      }}
      title={t.chromeOfflineHint}
    >
      <span>🟡</span> {t.chromeOffline}. {t.chromeOfflineWarning}
    </span>
  );
}
