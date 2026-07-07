// netlify/functions/daily-archive.js
import { createClient } from '@supabase/supabase-js'; // 🟢 FIXED: Using the official real npm package

export const handler = async (event, context) => {
  // Initialize the authenticated admin client instance using your secure environment keys
  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY // Safely overrides standard RLS write boundaries
  );

  // Trigger your Postgres plpgsql routing function
  const { error } = await supabaseAdmin.rpc('archive_old_audit_logs');

  if (error) {
    console.error('Failed to execute daily audit log archive routine:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: error.message }) 
    };
  }

  return { 
    statusCode: 200, 
    body: 'Audit logs older than 30 days archived successfully.' 
  };
};

// Netlify configuration scheduling this cron job to run nightly at midnight
export const config = {
  schedule: "0 0 * * *"
};