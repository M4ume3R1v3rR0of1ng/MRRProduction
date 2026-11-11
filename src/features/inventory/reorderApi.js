// src/features/inventory/reorderApi.js
//
// The one way the browser talks to netlify/functions/anvil-reorder.js. Shared by the Reorder
// screen and the chat window's "Waiting on you" panel, so both approve through the same
// door, and the server's checks (Pro, inv_edit, company) apply identically to each.
import { getAccessToken } from "@/shared/utils/supabase";

export async function callReorder(payload) {
  const accessToken = await getAccessToken();
  const res = await fetch("/.netlify/functions/anvil-reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.code = data.code;
    throw err;
  }
  return data;
}

/** How many reorders are waiting on a person: needing approval, or approved and not yet sent. */
export function waitingCount(state) {
  return (state?.pending?.length || 0) + (state?.approved?.length || 0);
}
