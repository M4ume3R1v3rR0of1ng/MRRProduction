const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// This code runs securely on Netlify's servers, NOT in the browser!
exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // 2. Parse the email details sent from your React frontend
    const { email, itemName, currentStock, unit, alertThreshold, accessToken } = JSON.parse(event.body);

    // Require a verified, active Supabase session — this previously accepted
    // any unauthenticated request and sent from a verified company domain.
    if (!accessToken) {
      return { statusCode: 401, body: JSON.stringify({ error: "Not authenticated" }) };
    }
    const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      return { statusCode: 401, body: JSON.stringify({ error: "Not authenticated" }) };
    }
    const { data: profile } = await admin.from("profiles").select("active").eq("id", authData.user.id).single();
    if (!profile || profile.active === false) {
      return { statusCode: 403, body: JSON.stringify({ error: "Account inactive" }) };
    }

    // 1. Initialize Resend using your hidden environment variable
    const resend = new Resend(process.env.RESEND_API_KEY);

    // 3. Trigger the actual email send
    const safeItemName = escapeHtml(itemName);
    const data = await resend.emails.send({
      from: 'Warehouse Alerts <alerts@maumeeriverroofing.com>', // Or your verified Resend domain
      to: email,
      subject: `⚠️ Low Stock Alert — ${itemName}`,
      html: `
        <h2>Inventory Item Running Low</h2>
        <p><strong>Item:</strong> ${safeItemName}</p>
        <p><strong>Current Stock:</strong> ${escapeHtml(currentStock)} ${escapeHtml(unit)}</p>
        <p><strong>Alert Threshold:</strong> ${escapeHtml(alertThreshold)} ${escapeHtml(unit)}</p>
        <p>Please log into the WMS portal to place a reorder.</p>
      `
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, data })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};