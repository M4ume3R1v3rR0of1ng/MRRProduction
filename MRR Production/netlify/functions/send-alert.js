const { Resend } = require('resend');

// This code runs securely on Netlify's servers, NOT in the browser!
exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // 1. Initialize Resend using your hidden environment variable
    const resend = new Resend(process.env.RESEND_API_KEY);
    
    // 2. Parse the email details sent from your React frontend
    const { email, itemName, currentStock, unit, alertThreshold } = JSON.parse(event.body);

    // 3. Trigger the actual email send
    const data = await resend.emails.send({
      from: 'Warehouse Alerts <alerts@maumeeriverroofing.com>', // Or your verified Resend domain
      to: email,
      subject: `⚠️ Low Stock Alert — ${itemName}`,
      html: `
        <h2>Inventory Item Running Low</h2>
        <p><strong>Item:</strong> ${itemName}</p>
        <p><strong>Current Stock:</strong> ${currentStock} ${unit}</p>
        <p><strong>Alert Threshold:</strong> ${alertThreshold} ${unit}</p>
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