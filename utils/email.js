const RESEND_KEY = import.meta.env.VITE_RESEND_KEY;

export const sendEmail = async ({ to, subject, html }) => {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'MRR System <noreply@maumeeriverroofing.com>',
        to,
        subject,
        html,
      }),
    });
    return await res.json();
  } catch (err) {
    console.error('Email send failed:', err);
  }
};