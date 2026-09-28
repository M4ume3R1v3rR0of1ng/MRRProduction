// src/shared/utils/pushRegistration.js
//
// Registers this device for APNs push (oil-due heads-up / urgent alerts, see
// netlify/functions/send-maintenance-push-notices.js) and routes a tapped
// notification back into the app.
//
// Same IS_IOS_APP-gated, dynamically-imported shape as capturePhoto() in
// photoCapture.js: the plugin only exists in the iOS build, and the dynamic
// import lets Rollup drop it from the web bundle entirely rather than
// shipping dead code (and an unusable permission prompt) to every browser.
import { IS_IOS_APP } from "@/core/platform";
import { getAccessToken } from "./supabase";

const registerEndpoint = "/.netlify/functions/register-push-token";

async function sendTokenToServer(token) {
  const accessToken = await getAccessToken();
  const response = await fetch(registerEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform: "ios", accessToken }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Proxy gateway returned error code: ${response.status}`);
  }
}

// Guards against registering listeners twice across repeated logins/remounts
// in the same session — addListener would otherwise stack duplicate
// handlers, firing onNotificationTap once per accumulated login.
let listenersAttached = false;

/**
 * Ask for push permission, register this device, and wire up delivery. A
 * no-op outside the iOS build.
 *
 * @param {{ onNotificationTap?: (data: Record<string, unknown>) => void }} [opts]
 *   onNotificationTap fires with the notification's `data` payload (e.g.
 *   { type: "oil_due", vehicleId }) when the user taps a delivered push.
 */
export async function registerForPushNotifications({ onNotificationTap } = {}) {
  if (!IS_IOS_APP) return;

  const { PushNotifications } = await import("@capacitor/push-notifications");

  try {
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") return;

    if (!listenersAttached) {
      listenersAttached = true;

      PushNotifications.addListener("registration", (token) => {
        sendTokenToServer(token.value).catch((err) => {
          console.error("pushRegistration: failed to register device token:", err.message);
        });
      });

      // iOS gives no error code here, only message text — there's nothing to
      // branch on, so this is purely a diagnostic log, not a user-facing toast.
      PushNotifications.addListener("registrationError", (err) => {
        console.error("pushRegistration: APNs registration failed:", err?.error || err);
      });

      if (onNotificationTap) {
        PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          onNotificationTap(action?.notification?.data || {});
        });
      }
    }

    await PushNotifications.register();
  } catch (err) {
    console.error("pushRegistration: setup failed:", err?.message || err);
  }
}
