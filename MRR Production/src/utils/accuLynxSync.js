// src/utils/accuLynxSync.js
import { getAccessToken } from './supabase';

async function fetchWithRetry(url, options, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || i === retries) return res;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1))); 
    }
  }
}

export async function attemptAccuLynxSync(job, users, config, setJobs) {
  const totalCost = Array.isArray(job?.items) 
    ? job.items.reduce((s, i) => {
        const itemPrice = i.priceAtPull !== undefined ? i.priceAtPull : (i.cost || i.price || 0);
        return s + (Math.max(0, (i.pulled || 0) - (i.returned || 0))) * itemPrice;
      }, 0)
    : 0;
  
  const payload = {
    poNumber: job?.po || 'NO_PO',
    acculynxJobId: job?.acculynx_job_id || null, // Direct target when the job was linked via the wizard
    paymentDescription: `Material Cost — ${job?.name || job?.title || 'Job'}`, 
    totalMaterialCost: parseFloat(totalCost.toFixed(2)), 
    lineItems: Array.isArray(job?.items)
      ? job.items
          .filter(i => (i.pulled || 0) - (i.returned || 0) > 0) 
          .map(i => {
            const itemPrice = i.priceAtPull !== undefined ? i.priceAtPull : (i.cost || i.price || 0); 
            return {
              name: i.iname || i.name || 'Unknown Material', 
              category: i.icat || i.category || 'Materials', 
              unit: i.unit || 'units', 
              quantity: (i.pulled || 0) - (i.returned || 0), 
              unitPrice: itemPrice, 
              totalCost: parseFloat((((i.pulled || 0) - (i.returned || 0)) * itemPrice).toFixed(2)), 
            };
          })
      : [],
  };

  if (!config || !config.enabled || !config.proxyUrl) {
    if (typeof setJobs === 'function') {
      setJobs(p => p.map(j => j.id === job?.id ? { 
        ...j, 
        syncStatus: 'manual', 
        syncPayload: payload, 
        syncNote: 'Configure AccuLynx in Settings to enable auto-sync.' 
      } : j));
    }
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const accessToken = await getAccessToken();
    const res = await fetchWithRetry(config.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // ── 🟢 FIXED: The key is hidden inside the secure Authorization header ──
        'Authorization': `Bearer ${config.apiKey || ''}`
      },
      body: JSON.stringify({ ...payload, accessToken }), // 🟢 The JSON payload string is now completely clean of keys
      signal: controller.signal
    });
    
    clearTimeout(timeout);

    const responseData = await res.json().catch(() => ({}));

    if (res.ok) {
      if (typeof setJobs === 'function') {
        setJobs(p => p.map(j => j.id === job.id ? { 
          ...j, 
          syncStatus: 'synced', 
          syncedAt: new Date().toISOString(), 
          syncPayload: payload, 
          syncNote: responseData.message || 'Cost data synchronized onto AccuLynx file record.' 
        } : j));
      }
    } else {
      const upstreamError = responseData?.error || responseData?.message || `HTTP ${res.status}`;
      throw new Error(upstreamError);
    }
  } catch (err) {
    clearTimeout(timeout);
    const errorMsg = err.name === 'AbortError' ? 'AccuLynx request timed out' : err.message;
    if (typeof setJobs === 'function') {
      setJobs(p => p.map(j => j.id === job.id ? { 
        ...j, 
        syncStatus: 'failed', 
        syncPayload: payload, 
        syncNote: errorMsg 
      } : j));
    }
  }
}

// ── 🆕 ADDED: Fetch Job Data Helper ──────────────────────────────────────────
export async function fetchAccuLynxJob({ poNumber, acculynxJobId }, config) {
  if (!config?.enabled || !config?.proxyUrl) {
    throw new Error("AccuLynx integration is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const accessToken = await getAccessToken();
    const res = await fetchWithRetry(config.proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Maintained Authorization header parity for flexible/hybrid token architecture
        "Authorization": `Bearer ${config.apiKey || ''}`
      },
      body: JSON.stringify({ action: "getJob", poNumber, acculynxJobId, accessToken }),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    return data.job;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}