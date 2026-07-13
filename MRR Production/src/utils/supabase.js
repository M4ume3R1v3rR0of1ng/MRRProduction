import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Update that fails loudly when no row matched. A bare .update().eq() reports
// success on zero rows (row deleted elsewhere, bad/seed id, or filtered by
// RLS), which lets the UI toast "saved" while nothing was written.
export async function updateRowStrict(table, id, fields) {
  const { data, error } = await supabase
    .from(table)
    .update(fields)
    .eq("id", id)
    .select("id");
  if (error) return { error };
  if (!data || data.length === 0) {
    return { error: new Error("This record no longer exists in the database — it may have been deleted by someone else. Refresh the page and try again.") };
  }
  return { error: null };
}

// Current user's Supabase session token, sent to Netlify functions so they can
// verify the caller server-side instead of trusting an unauthenticated request.
export async function getAccessToken() {
  const { data: { session } = {} } = await supabase.auth.getSession();
  return session?.access_token || null;
}
