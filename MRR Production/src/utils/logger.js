// src/utils/logger.js
import { supabase } from "./supabase";

/**
 * Every action_type this app actually writes, gathered from the logAction call
 * sites. Both audit screens build their filter dropdown from this.
 *
 * They used to hardcode their own lists, and both were wrong in the same way:
 * they offered types nothing has ever written (INVENTORY_ADJUST, MAT_RECEIVE,
 * MAINTENANCE), so choosing one returned an empty table forever — which reads as
 * "this never happens here" rather than "this filter is broken". They also
 * omitted types that ARE written, so those events were unreachable by filter.
 *
 * If you add a logAction call with a new type, add it here.
 */
export const ACTION_TYPES = [
  "LOGIN",
  "LOGOUT",
  "INVENTORY_PULL",
  "INV_MUTATION",
  "JOB_BUILD_CREATE",
  "JOB_BUILD_EDIT",
  "JOB_BUILD_CLOSE",
  "JOB_BUILD_REOPEN",
  "JOB_BUILD_DRAFT",
  "JOB_BUILD_DELETE",
  "FLEET_STATUS_CHANGE",
  "FLEET_MAINTENANCE",
  "MAINTENANCE_REQUEST_CREATE",
  "USER_MANAGEMENT",
  "PERM_CHANGE",
];

/**
 * Commits a highly detailed, device-aware audit event to Supabase.
 *
 * @param {string} userId - UUID of the executing employee profile
 * @param {string} userEmail - Corporate email string of the operator
 * @param {string} actionType - System state index matching feed color highlights
 * @param {string} description - Human-readable operational narrative
 * @param {object} metadata - Optional entity IDs, snapshot data, or tracking states
 * @param {string} [currentView] - Optional active state layout view passed from App.jsx state
 */
export const logAction = async (userId, userEmail, actionType, description, metadata = {}, currentView = null) => {
  try {
    const payload = {
      user_id: userId || null, 
      user_email: userEmail || null,
      action_type: actionType,
      description: description,
      metadata: {
        ...metadata,
        // FIX: Prioritize the state-driven application view string over the static '/' route
        active_view: currentView || 'system_core',
        page_url: window.location.pathname + window.location.hash, 
        user_agent: navigator.userAgent 
      },
      created_at: new Date().toISOString()
    };

    // Continuous developer feedback
    console.log(`📝 [AUDIT LOG]: ${actionType}`, payload);

    // Write packet straight to the immutable database block
    let { error } = await supabase
      .from('audit_logs')
      .insert([payload]);

    // One immediate retry — a transient network blip shouldn't cost the trail
    if (error) {
      ({ error } = await supabase.from('audit_logs').insert([payload]));
    }

    if (error) {
      console.error("❌ Supabase Audit Log Database Error:", error.message);
      reportAuditFailure(error.message);
    }
  } catch (err) {
    console.error("❌ Critical Failure inside Logger Utility:", err.message);
    reportAuditFailure(err.message);
  }
};

// The audit log is the recovery net when data goes missing — if it stops
// recording, someone must find out the day it breaks, not the day it's needed.
// Surfaced once per session as a toast via NotificationProvider's listener.
let auditFailureAnnounced = false;
function reportAuditFailure(message) {
  if (auditFailureAnnounced || typeof window === 'undefined') return;
  auditFailureAnnounced = true;
  window.dispatchEvent(new CustomEvent('mrr-audit-log-failure', { detail: message }));
}