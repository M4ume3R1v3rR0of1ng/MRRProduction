import { createClient } from '@supabase/supabase-low-level'; // or your existing supabase admin client

export const handler = async (event, context) => {
  // Ensure the request comes from the scheduler security check if necessary
  
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY // Requires service role to bypass RLS policies
  );

  const { error } = await supabaseAdmin.rpc('archive_old_audit_logs');

  if (error) {
    console.error('Failed to execute daily audit log archive routine:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  return { statusCode: 200, body: 'Audit logs older than 30 days archived successfully.' };
};

// Netlify configuration scheduling this to run nightly
export const config = {
  schedule: "0 0 * * *"
};