// src/utils/lowStockAlerts.js
import { getAccessToken } from "./supabase";

// Email opted-in managers when an item's stock crosses its alert threshold
// downward (was above, now at/below). Crossing-only on purpose: an item that
// is already below threshold shouldn't fire another email on every pull.
//
// changes: [{ item, prevTotal, newTotal }] — item needs name/unit/alrt.
// Failures are reported with a warning toast instead of vanishing.
export async function sendLowStockAlerts(changes, users, showToast) {
  try {
    const crossed = (changes || []).filter((c) => {
      if (!c || !c.item) return false;
      const threshold = parseFloat(c.item.alrt);
      if (isNaN(threshold)) return false;
      return c.prevTotal > threshold && c.newTotal <= threshold;
    });
    if (crossed.length === 0) return;

    // Only notify users who've opted in via Profile → Inventory Alert Preferences.
    const recipients = (users || []).filter(
      (u) =>
        (u.role === "manager" || u.role === "coordinator" || u.role === "warehouse") &&
        u.active &&
        u.receive_email_alerts &&
        u.email,
    );
    if (recipients.length === 0) return;

    const accessToken = await getAccessToken();
    let anyFailed = false;

    await Promise.all(
      crossed.flatMap((c) =>
        recipients.map(async (mgr) => {
          try {
            const res = await fetch("/.netlify/functions/send-alert", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: mgr.email,
                itemName: c.item.name,
                currentStock: c.newTotal,
                unit: c.item.unit,
                alertThreshold: c.item.alrt,
                accessToken,
              }),
            });
            if (!res.ok) anyFailed = true;
          } catch (err) {
            console.error("Low-stock alert email failed:", err);
            anyFailed = true;
          }
        }),
      ),
    );

    if (anyFailed) {
      showToast?.("Some low-stock alert emails could not be sent.", "warning");
    }
  } catch (err) {
    console.error("Low-stock alert dispatch failed:", err);
    showToast?.("Low-stock alert emails could not be sent.", "warning");
  }
}
