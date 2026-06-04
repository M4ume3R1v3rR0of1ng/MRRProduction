import { createClient } from '@supabase/supabase-js';

// Pulls your credentials securely from your Netlify / local environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase credentials missing! Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your local .env file or Netlify settings.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);