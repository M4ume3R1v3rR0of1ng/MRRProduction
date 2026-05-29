// 1. Global UI Color Theme Utility
export const C = {
  blue: '#1B52B8', navy: '#0E2D6B', gold: '#F5A800', gL: '#FFFBEB',
  w: '#fff', bg: '#EEF2FA', lg: '#F1F5F9', bd: '#D1D9E6', sub: '#64748B',
  gr: '#16A34A', gB: '#DCFCE7', rd: '#DC2626', rB: '#FEE2E2',
  am: '#D97706', aB: '#FEF3C7', pu: '#7C3AED', pB: '#EDE9FE',
  tl: '#0D9488', tB: '#CCFBF1', sl: '#0369A1', sB: '#E0F2FE'
};

// 2. Short Unique ID Generator String Macro
export const uid = () => Math.random().toString(36).slice(2, 10);

// 3. Date Formatting Utility (e.g., "May 28, 2026")
export const fd = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

// 4. Timestamp Formatting Utility (e.g., "May 28, 2026, 11:21 AM")
export const ft = d => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

// 5. Currency Display Converter (e.g., $1,250.00)
export const fm = n => '$' + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// 6. Real-time Inventory Summation Loop
export const tot = i => i.batches.reduce((s, b) => s + b.rem, 0);

// 7. Pricing Evaluator Array sorter
export const newestPrice = i => !i.batches.length ? 0 : [...i.batches].sort((a, b) => new Date(b.rcvd) - new Date(a.rcvd))[0].price;

// 8. Odometer Status Evaluator Rules
export const oilSt = v => {
  if (v.type !== 'truck') return null;
  const p = (v.mi - v.lomi) / v.oii;
  return p >= 1 ? 'overdue' : p >= 0.8 ? 'soon' : 'ok';
};

// 9. Canvas Downsampler for Compressed Image Uploads
export function compressImg(file, maxDim, quality, cb) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', quality));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// 10. The Standard First-In-First-Out (FIFO) Inventory Depletion Logic
export const doFifo = (item, qty) => {
  const s = [...item.batches].sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd));
  let r = qty, c = 0;
  const u = s.map(b => {
    if (r <= 0 || b.rem <= 0) return b;
    const t = Math.min(r, b.rem);
    r -= t;
    c += t * b.price;
    return { ...b, rem: b.rem - t };
  });
  return r > 0 ? null : { batches: u, cost: c };
};

// 11. Additional helper functions can be added here as needed for future features or utilities. 
export const predDays = v => {
  if (v.type !== 'truck' || !v.mil || v.mil.length < 2) return null;
  const l = [...v.mil].sort((a, b) => new Date(a.dt) - new Date(b.dt));
  const sp = (new Date(l[l.length - 1].dt) - new Date(l[0].dt)) / 86400000;
  if (sp < 1) return null;
  const d = (l[l.length - 1].mi - l[0].mi) / sp;
  if (d <= 0) return null;
  const lf = v.oii - (v.mi - v.lomi);
  return lf <= 0 ? 0 : Math.round(lf / d);
};

export const displayName = (user) => 
  (user?.name || user?.full_name || '').split(' ')[0] || 'User';

export const detSt = v => {
    if (!v.ldd) return 'overdue';
    const d = (new Date() - new Date(v.ldd)) / 86400000;
  return d >= v.dii ? 'overdue' : d >= v.dii * 0.8 ? 'soon' : 'ok';
};

export const canReceiveSMS = (userProfile) => {
  return (
    userProfile &&
    userProfile.receive_sms_alerts &&
    userProfile.phone_number &&
    userProfile.phone_number.trim().length >= 10
  );
};
/**
 * Dispatches an SMS alert payload over the secure Supabase Edge Function gateway.
 * @param {string} phone - Target recipient cell number.
 * @param {string} textMsg - Text notification body copy.
 */
export const dispatchSMSAlert = async (phone, textMsg) => {
  if (!phone || !textMsg) return;

  // Normalize phone formatting to strict E.164 compliance string
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = `+1${cleanPhone}`; // Enforces standard US country routing prefix
  } else if (!cleanPhone.startsWith('+')) {
    cleanPhone = `+${cleanPhone}`;
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { to: cleanPhone, message: textMsg },
    });

    if (error) {
      console.error("SMS Gateway Relay Error:", error.message);
    } else {
      console.log("SMS notification packet dispatched cleanly:", data);
    }
  } catch (err) {
    console.error("Failed to connect to SMS Edge Function:", err);
  }
};