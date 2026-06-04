// src/utils/logger.js
import { supabase } from "./supabase";

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
    const { error } = await supabase
      .from('audit_logs')
      .insert([payload]);

    if (error) {
      console.error("❌ Supabase Audit Log Database Error:", error.message);
    }
  } catch (err) {
    console.error("❌ Critical Failure inside Logger Utility:", err.message);
  }
};