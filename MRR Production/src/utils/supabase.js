import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Current user's Supabase session token, sent to Netlify functions so they can
// verify the caller server-side instead of trusting an unauthenticated request.
export async function getAccessToken() {
  const { data: { session } = {} } = await supabase.auth.getSession();
  return session?.access_token || null;
}
