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
export const logAction = async (
  userId,
  userEmail,
  actionType,
  description,
  metadata = {}
) => {
  console.log("AUDIT ATTEMPT", {
    userId,
    userEmail,
    actionType,
    description,
  });

  try {
    const { data, error } = await supabase
      .from("system_logs")
      .insert([
        {
          user_id: userId,
          user_email: userEmail,
          action_type: actionType,
          description,
          metadata,
          created_at: new Date().toISOString(),
        },
      ])
      .select();

    console.log("AUDIT RESULT", data, error);

    if (error) {
      console.error("AUDIT ERROR", error);
    }

    return { data, error };
  } catch (err) {
    console.error("AUDIT EXCEPTION", err);
    return { data: null, error: err };
  }
};
