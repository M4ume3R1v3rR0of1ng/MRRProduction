// System logger
import { supabase } from "./supabase";

/**
 * Creates an immutable system audit trail record
 * @param {string} userId - The unique identifier of the active user
 * @param {string} userEmail - The email string of the active user
 * @param {string} actionType - Category of action (e.g., 'PERM_CHANGE')
 * @param {string} description - Human-readable details of the mutation
 * @param {object} [metadata] - Optional raw data payload for debugging
 */
export const logAction = async (userId, userEmail, actionType, description, metadata = {}) => {
  try {
    // Expanded payload to track richer metrics for compliance/audits
    const payload = {
      user_id: userId || null, // Allows null if system action or unauthenticated
      user_email: userEmail || null,
      action_type: actionType,
      description: description,
      metadata: {
        ...metadata,
        page_url: window.location.pathname + window.location.hash, // Tracks where the action occurred
        user_agent: navigator.userAgent // Tracks device metadata for security
      },
      created_at: new Date().toISOString()
    };

    // Always log to local console instantly for developer debugging
    console.log(`📝 [AUDIT LOG]: ${actionType}`, payload);

    // Write to database
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