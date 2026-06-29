// src/utils/accuLynxSync.js

export async function attemptAccuLynxSync(job, users, config, setJobs) {
  // 🟢 FIXED 1: Support both camelCase and snake_case user assignments
  const targetId = job.assignedTo || job.assignedto;
  const sup = users.find(u => u.id === targetId);
  
  // 🟢 FIXED 2: Support all pricing fallbacks (priceAtPull, cost, or price)
  const totalCost = job.items.reduce((s, i) => {
    const itemPrice = i.priceAtPull !== undefined ? i.priceAtPull : (i.cost || i.price || 0);
    return s + (i.pulled - i.returned) * itemPrice;
  }, 0);
  
  // 🟢 FIXED 3: Safeguard missing completed date parameters
  const dateFallback = job.completedAt || new Date().toISOString();
  let cleanDateStr = 'PENDING';
  try {
    cleanDateStr = new Date(dateFallback).toISOString().split('T')[0];
  } catch (e) {
    cleanDateStr = new Date().toISOString().split('T')[0];
  }
  
  // Format the structured API layout required by AccuLynx webhook schemas
  const payload = {
    acculynxJobReference: job.po || 'NO_PO',
    jobName: job.name || job.title || 'Untitled Build',
    address: job.addr || job.address || 'No Location Logged',
    supervisor: sup?.full_name || sup?.name || 'N/A',
    completedDate: dateFallback,
    totalMaterialCost: parseFloat(totalCost.toFixed(2)),
    actions: ['upload_pdf_document', 'add_payment_line_item'],
    documentName: `Material_Cost_Report_${job.po || 'JOB'}_${cleanDateStr}.pdf`,
    paymentDescription: `Material Cost — ${job.name || job.title || 'Job'}`,
    lineItems: (job.items || []).filter(i => (i.pulled - i.returned) > 0).map(i => {
      const itemPrice = i.priceAtPull !== undefined ? i.priceAtPull : (i.cost || i.price || 0);
      return {
        name: i.iname || i.name, 
        category: i.icat || i.category || 'Materials', 
        unit: i.unit || 'units',
        planned: i.planned || 0, 
        pulled: i.pulled || 0, 
        returned: i.returned || 0,
        used: i.pulled - i.returned, 
        unitPrice: itemPrice,
        totalCost: parseFloat(((i.pulled - i.returned) * itemPrice).toFixed(2)),
      };
    }),
  };

  // If sync dashboard config properties are not armed, drop to manual pending state safely
  if (!config || !config.enabled || !config.proxyUrl) {
    if (typeof setJobs === 'function') {
      setJobs(p => p.map(j => j.id === job.id ? { 
        ...j, 
        syncStatus: 'manual', 
        syncPayload: payload, 
        syncNote: 'Configure AccuLynx in Settings to enable auto-sync.' 
      } : j));
    }
    return;
  }

  try {
    const res = await fetch(config.proxyUrl, { 
      method: 'POST', 
      headers: { 
        'Content-Type': 'application/json', 
        // Note: Payload includes apiKey within body; adding header backup for safety
        'Authorization': `Bearer ${config.apiKey || ''}` 
      }, 
      body: JSON.stringify({
        ...payload,
        apiKey: config.apiKey || '' // Ensures your Netlify function captures verification
      }) 
    });

    if (res.ok) {
      if (typeof setJobs === 'function') {
        setJobs(p => p.map(j => j.id === job.id ? { 
          ...j, 
          syncStatus: 'synced', 
          syncedAt: new Date().toISOString(), 
          syncPayload: payload, 
          syncNote: 'PDF uploaded & cost added to AccuLynx.' 
        } : j));
      }
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    if (typeof setJobs === 'function') {
      setJobs(p => p.map(j => j.id === job.id ? { 
        ...j, 
        syncStatus: 'failed', 
        syncPayload: payload, 
        syncNote: err.message 
      } : j));
    }
  }
};