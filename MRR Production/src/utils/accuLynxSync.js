// src/utils/accuLynxSync.js

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
  
  // ── 🟢 FIX 3: Clean up payload matching schema specifications exactly ──
  const payload = {
    poNumber: job?.po || 'NO_PO', // Used by backend for search lookup 
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
              quantity: (i.pulled || 0) - (i.returned || 0), // 🟢 CRITICAL SCHEMA FIX: Expected by AccuLynx 
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
    const res = await fetchWithRetry(config.proxyUrl, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({
        ...payload,
        apiKey: config.apiKey // Keeps backup safety lifeline connected
      }), 
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
          syncNote: 'Cost data synchronized onto AccuLynx file record.' 
        } : j));
      }
    } else {
      throw new Error(`HTTP Error Status: ${res.status}`);
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