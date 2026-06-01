// src/utils/accuLynxSync.js

export async function attemptAccuLynxSync(job, users, config, setJobs) {
  const sup = users.find(u => u.id === job.assignedTo);
  const totalCost = job.items.reduce((s, i) => s + (i.pulled - i.returned) * i.priceAtPull, 0);
  
  // Format the structured API layout required by AccuLynx webhook schemas
  const payload = {
    acculynxJobReference: job.po,
    jobName: job.name,
    address: job.addr,
    supervisor: sup?.name || 'N/A',
    completedDate: job.completedAt,
    totalMaterialCost: parseFloat(totalCost.toFixed(2)),
    actions: ['upload_pdf_document', 'add_payment_line_item'],
    documentName: `Material_Cost_Report_${job.po}_${new Date(job.completedAt).toISOString().split('T')[0]}.pdf`,
    paymentDescription: `Material Cost — ${job.name}`,
    lineItems: job.items.filter(i => i.pulled - i.returned > 0).map(i => ({
      name: i.iname, category: i.icat, unit: i.unit,
      planned: i.planned, pulled: i.pulled, returned: i.returned,
      used: i.pulled - i.returned, unitPrice: i.priceAtPull,
      totalCost: parseFloat(((i.pulled - i.returned) * i.priceAtPull).toFixed(2)),
    })),
  };

  // If sync dashboard config properties are not armed, drop to manual pending state safely
  if (!config.enabled || !config.proxyUrl) {
    setJobs(p => p.map(j => j.id === job.id ? { 
      ...j, 
      syncStatus: 'manual', 
      syncPayload: payload, 
      syncNote: 'Configure AccuLynx in Settings to enable auto-sync.' 
    } : j));
    return;
  }

  try {
    const res = await fetch(config.proxyUrl, { 
      method: 'POST', 
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${config.apiKey}` 
      }, 
      body: JSON.stringify(payload) 
    });

    if (res.ok) {
      setJobs(p => p.map(j => j.id === job.id ? { 
        ...j, 
        syncStatus: 'synced', 
        syncedAt: new Date().toISOString(), 
        syncPayload: payload, 
        syncNote: 'PDF uploaded & cost added to AccuLynx.' 
      } : j));
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    setJobs(p => p.map(j => j.id === job.id ? { 
      ...j, 
      syncStatus: 'failed', 
      syncPayload: payload, 
      syncNote: err.message 
    } : j));
  }
};