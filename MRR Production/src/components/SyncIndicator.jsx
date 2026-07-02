// src/components/SyncIndicator.jsx
import { useState, useEffect } from "react";
import { C } from "../utils/helpers";

export default function SyncIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const updateStatus = () => {
      setIsOnline(navigator.onLine);
      // Recalculate how many items are waiting in the queue cache
      const queue = JSON.parse(localStorage.getItem("mrr_offline_queue") || "[]");
      setPendingCount(queue.length);
    };

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    
    // Custom event listener to update count when a form is saved offline
    window.addEventListener("offline_queue_updated", updateStatus);

    updateStatus();

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
      window.removeEventListener("offline_queue_updated", updateStatus);
    };
  }, []);

  if (isOnline) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "12px", fontWeight: "var(--weight-bold)", color: C.gr }}>
        <span>🟢</span> Connected
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
        borderRadius: "20px"
      }}
      title="Changes are safely cached locally on this device"
    >
      <span>🟡</span> Offline — {pendingCount > 0 ? `${pendingCount} changes` : "Changes"} will sync later
    </span>
  );
}