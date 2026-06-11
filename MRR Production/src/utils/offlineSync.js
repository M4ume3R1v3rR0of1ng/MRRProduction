// src/utils/offlineSync.js
import { supabase } from "./supabase";

// Intercepts submissions if offline, or sends straight to Supabase if online
export async function queueOfflineAction(tableName, payload, actionType = "INSERT") {
  if (navigator.onLine) {
    if (actionType === "INSERT") return supabase.from(tableName).insert([payload]);
    if (actionType === "UPDATE") return supabase.from(tableName).update(payload).eq("id", payload.id);
  }

  // If device is offline, cache the transaction locally
  const queue = JSON.parse(localStorage.getItem("mrr_offline_queue") || "[]");
  queue.push({
    id: "tx_" + Date.now(),
    tableName,
    payload,
    actionType,
    timestamp: new Date().toISOString()
  });
  
  localStorage.setItem("mrr_offline_queue", JSON.stringify(queue));
  
  // Fire event to notify the UI badge indicator immediately
  window.dispatchEvent(new Event("offline_queue_updated"));
  return { error: null, offline: true };
}

// Background sync processor that triggers the moment the device catches signal again
export async function processOfflineQueue(showToast) {
  const queue = JSON.parse(localStorage.getItem("mrr_offline_queue") || "[]");
  if (queue.length === 0) return;

  console.log(`📡 Signal restored. Syncing ${queue.length} cached offline records...`);
  let successCount = 0;

  for (const item of queue) {
    try {
      let error;
      if (item.actionType === "INSERT") {
        ({ error } = await supabase.from(item.tableName).insert([item.payload]));
      } else if (item.actionType === "UPDATE") {
        ({ error } = await supabase.from(item.tableName).update(item.payload).eq("id", item.payload.id));
      }

      if (!error) successCount++;
    } catch (err) {
      console.error("Failed to sync item:", item, err);
    }
  }

  // Wipe queue or retain failed ones
  localStorage.setItem("mrr_offline_queue", JSON.stringify([]));
  window.dispatchEvent(new Event("offline_queue_updated"));

  if (successCount > 0 && showToast) {
    showToast(`🔄 Connected! ${successCount} offline submissions synced with server.`, "success");
  }
}