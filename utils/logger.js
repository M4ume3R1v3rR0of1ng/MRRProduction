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
export const logAction = async (...) => {
  console.log("AUDIT ATTEMPT", {
    userId,
    userEmail,
    actionType,
    description
  });

  try {
    const { data, error } = await supabase
      .from('system_logs')
      .insert([...])
      .select();

    console.log("AUDIT RESULT", data, error);

    if (error) {
      console.error("AUDIT ERROR", error);
    }
  } catch (err) {
    console.error("AUDIT EXCEPTION", err);
  }
};