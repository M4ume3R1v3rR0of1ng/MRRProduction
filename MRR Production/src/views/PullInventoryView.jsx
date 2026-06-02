// ── Pull Inventory ────────────────────────────────
import { useState } from 'react';
import { C, fd, fm, doFifo, uid } from '../utils/helpers';
import { generatePDF } from '../utils/pdfGenerator';
import { attemptAccuLynxSync } from '../utils/accuLynxSync';
import { Btn, Bdg, Modal, Fld, TA, Inp } from '../components/UIPrimitives';
import { logAction } from "../utils/logger";


export default function PullInventory({ jobs, setJobs, inv, setInv, users, user, perms, activeLogo, acculynxConfig, jSC }) {  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [pullQtys, setPullQtys] = useState({});
  const [retQtys, setRetQtys] = useState({});
  const [syncModal, setSyncModal] = useState(null);
  const isField = user.role === 'field';
  const myJobs = isField ? jobs.filter(j => j.assignedTo === user.id && j.status !== 'draft') : jobs.filter(j => j.status !== 'draft').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  const openJob = j => { setSel(j); if (j.newForAssigned && j.assignedTo === user.id) setJobs(p => p.map(x => x.id === j.id ? { ...x, newForAssigned: false } : x)); };

  const confirmPull = () => {
    if (!sel) return;
    const newInv = [...inv];
    let ok = true;
    const updItems = [...sel.items];
    for (const item of updItems) {
      const qty = parseFloat(pullQtys[item.iid]) ?? item.planned;
      if (qty <= 0) continue;
      const idx = newInv.findIndex(i => i.id === item.iid);
      if (idx < 0) continue;
      const res = doFifo(newInv[idx], qty);
      if (!res) { alert(`Not enough stock for ${item.iname}`); ok = false; break; }
      newInv[idx] = { ...newInv[idx], batches: res.batches };
      const ppu = qty > 0 ? res.cost / qty : 0;
      const ji = updItems.findIndex(i => i.iid === item.iid);
      updItems[ji] = { ...updItems[ji], pulled: qty, priceAtPull: ppu, pullCost: res.cost };
    }
    if (!ok) return;
    setInv(newInv);
    const upd = { ...sel, status: 'active', items: updItems };
    setJobs(p => p.map(j => j.id === sel.id ? upd : j));
    setSel(upd);
    setModal(null); setPullQtys({});
  };

  const confirmReturn = () => {
    if (!sel) return;
    const newInv = [...inv];
    const updItems = sel.items.map(item => {
      const ret = Math.min(parseFloat(retQtys[item.iid]) || 0, item.pulled);
      if (ret > 0) {
        const idx = newInv.findIndex(i => i.id === item.iid);
        if (idx >= 0) {
          const nb = { id: uid(), rcvd: new Date().toISOString().split('T')[0], qty: ret, price: item.priceAtPull, by: user.id, rem: ret };
          newInv[idx] = { ...newInv[idx], batches: [...newInv[idx].batches, nb] };
        }
      }
      return { ...item, returned: ret };
    });
    setInv(newInv);
    const upd = { ...sel, status: 'completed', completedAt: new Date().toISOString(), items: updItems };
    setJobs(p => p.map(j => j.id === sel.id ? upd : j));
    setModal(null); setRetQtys({});
    setTimeout(() => { generatePDF(upd, users, activeLogo); attemptAccuLynxSync(upd, users, acculynxConfig, setJobs); }, 300);
    setSel(null);
  };

  const syncBadge = job => {
    if (!job.syncStatus || job.status !== 'completed') return null;
    if (job.syncStatus === 'synced') return <Bdg color="sky">☁️ AccuLynx Synced</Bdg>;
    if (job.syncStatus === 'failed') return <Bdg color="red">⚠️ Sync Failed</Bdg>;
    if (job.syncStatus === 'manual') return <Bdg color="amber">📋 Configure Sync</Bdg>;
    return null;
  };

  const handlePullMaterials = async (jobId, materialsList) => {
  // ... existing FIFO or material decrement logic ...
  
  await logAction(
    user.id, 
    user.email, 
    'INVENTORY_PULL', 
    `Pulled staging materials for Job #${jobId}`,
    { jobId, materialsPulled: materialsList }
  );
};

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>📋 Pull Inventory</h1>
        <p style={{ margin: '2px 0 0', color: C.sub, fontSize: 12 }}>{isField ? 'Your assigned jobs' : 'All active jobs in pipeline'}</p>
      </div>
      {isField && myJobs.some(j => j.newForAssigned) && <div style={{ background: C.tB, border: `2px solid ${C.tl}`, borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 13, fontWeight: 700, color: C.tl }}>🎉 You have new jobs assigned to you!</div>}
      {myJobs.length === 0 && <div style={{ background: C.w, borderRadius: 12, padding: 40, textAlign: 'center', color: C.sub, fontSize: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>{isField ? 'No jobs assigned yet. Your Production Coordinator will assign jobs here.' : 'No jobs in pipeline yet.'}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {myJobs.map(job => {
          const sup = users.find(u => u.id === job.assignedTo);
          const st = jSC[job.status];
          const isNew = job.newForAssigned && job.assignedTo === user.id;
          const totalCost = job.items.reduce((s, i) => s + (i.pulled - i.returned) * i.priceAtPull, 0);
          return (
            <div key={job.id} style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: `2px solid ${isNew ? C.tl : job.status === 'active' ? C.am : 'transparent'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
                    <Bdg color={st.c}>{st.icon} {st.l}</Bdg>
                    {isNew && <Bdg color="teal">🔔 NEW</Bdg>}
                    <span style={{ fontSize: 12, color: C.sub }}>{job.po}</span>
                    {syncBadge(job)}
                  </div>
                  <div style={{ fontWeight: 800, color: C.navy, fontSize: 15, marginBottom: 2 }}>{job.name}</div>
                  <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>{job.addr}</div>
                  {!isField && sup && <div style={{ fontSize: 11, color: C.blue, fontWeight: 700 }}>👤 {sup.name}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-end' }}>
                  {perms.jobs_pull && job.status === 'approved' && <Btn v="teal" sz="sm" onClick={() => { openJob(job); const q = {}; job.items.forEach(i => { q[i.iid] = i.planned; }); setPullQtys(q); setModal('pull'); setSel(job); }}>🚛 Pull Materials</Btn>}
                  {perms.jobs_complete && job.status === 'active' && <Btn v="gold" sz="sm" onClick={() => { setSel(job); const q = {}; job.items.forEach(i => { q[i.iid] = 0; }); setRetQtys(q); setModal('return'); }}>📦 Return & Complete</Btn>}
                  {job.status === 'completed' && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Btn v="green" sz="sm" onClick={() => generatePDF(job, users, activeLogo)}>📄 PDF</Btn>
                      <Btn v="sky" sz="sm" onClick={() => setSyncModal(job)}>☁️ Sync Status</Btn>
                    </div>
                  )}
                  <Btn v="ghost" sz="sm" onClick={() => openJob(job)}>Details</Btn>
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${C.lg}`, paddingTop: 10, display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {job.items.slice(0, 6).map(item => (
                  <div key={item.iid} style={{ background: item.pulled > 0 ? C.gB : C.lg, borderRadius: 7, padding: '5px 10px', flexShrink: 0, border: item.pulled > 0 ? `1px solid ${C.gr}` : 'none' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, whiteSpace: 'nowrap' }}>{item.iname}</div>
                    <div style={{ fontSize: 10, color: C.sub }}>{item.pulled > 0 ? `${item.pulled - item.returned} used` : `${item.planned} ${item.unit} planned`}</div>
                  </div>
                ))}
                {job.items.length > 6 && <div style={{ background: C.lg, borderRadius: 7, padding: '5px 10px', flexShrink: 0, display: 'flex', alignItems: 'center', fontSize: 10, color: C.sub }}>+{job.items.length - 6} more</div>}
              </div>
              {perms.inv_pricing_view && job.status === 'completed' && totalCost > 0 && <div style={{ marginTop: 8, borderTop: `1px solid ${C.lg}`, paddingTop: 8, display: 'flex', justifyContent: 'flex-end' }}><span style={{ fontWeight: 900, fontSize: 15, color: C.gr }}>Total: {fm(totalCost)}</span></div>}
            </div>
          );
        })}
      </div>

      {modal === 'pull' && sel && (
        <Modal title={`Pull Materials — ${sel.name}`} onClose={() => { setModal(null); setSel(null); setPullQtys({}); }} wide>
          <div style={{ background: C.tB, border: `1.5px solid ${C.tl}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.tl, fontWeight: 600 }}>Adjust quantities if needed. Confirm to deduct from warehouse inventory (FIFO).</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14, fontSize: 13 }}>
            <thead><tr style={{ background: C.lg }}>{['Item', 'Planned', 'Actual to Pull', 'Available'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11 }}>{h}</th>)}</tr></thead>
            <tbody>{sel.items.map(item => {
              const avail = tot(inv.find(i => i.id === item.iid) || { batches: [] });
              const actual = parseFloat(pullQtys[item.iid]) ?? item.planned;
              const short = actual > avail;
              return (
                <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}`, background: short ? C.rB : 'transparent' }}>
                  <td style={{ padding: '9px 10px', fontWeight: 700, color: C.navy }}>{item.iname}</td>
                  <td style={{ padding: '9px 10px' }}>{item.planned} {item.unit}</td>
                  <td style={{ padding: '9px 10px' }}><Inp type="number" value={pullQtys[item.iid] ?? item.planned} min="0" max={avail} onChange={e => setPullQtys(p => ({ ...p, [item.iid]: Math.max(0, parseFloat(e.target.value) || 0) }))} style={{ width: 80, padding: '4px 8px' }} /></td>
                  <td style={{ padding: '9px 10px', color: short ? C.rd : C.gr, fontWeight: 700 }}>{avail} {item.unit}{short && ' ⚠️'}</td>
                </tr>
              );
            })}</tbody>
          </table>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => { setModal(null); setSel(null); setPullQtys({}); }} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="teal" sz="lg" onClick={confirmPull} style={{ flex: 2, justifyContent: 'center' }}>✅ Confirm Pull from Warehouse</Btn>
          </div>
        </Modal>
      )}

      {modal === 'return' && sel && (
        <Modal title={`Return Unused — ${sel.name}`} onClose={() => { setModal(null); setRetQtys({}); }} wide>
          <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.am, fontWeight: 600 }}>Enter quantities being returned. PDF report + AccuLynx sync will trigger on completion.</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14, fontSize: 13 }}>
            <thead><tr style={{ background: C.lg }}>{['Item', 'Pulled', 'Returning', 'Will Be Used'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11 }}>{h}</th>)}</tr></thead>
            <tbody>{sel.items.filter(i => i.pulled > 0).map(item => {
              const ret = Math.min(parseFloat(retQtys[item.iid]) || 0, item.pulled);
              const used = item.pulled - ret;
              return (
                <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}` }}>
                  <td style={{ padding: '9px 10px', fontWeight: 700, color: C.navy }}>{item.iname}</td>
                  <td style={{ padding: '9px 10px' }}>{item.pulled} {item.unit}</td>
                  <td style={{ padding: '9px 10px' }}><Inp type="number" value={retQtys[item.iid] ?? 0} min="0" max={item.pulled} onChange={e => setRetQtys(p => ({ ...p, [item.iid]: Math.min(item.pulled, Math.max(0, parseFloat(e.target.value) || 0)) }))} style={{ width: 80, padding: '4px 8px' }} /></td>
                  <td style={{ padding: '9px 10px', fontWeight: 800, color: used > 0 ? C.navy : C.sub }}>{used} {item.unit}</td>
                </tr>
              );
            })}</tbody>
            {perms.inv_pricing_view && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${C.navy}` }}>
                  <td colSpan={3} style={{ padding: '9px 10px', fontWeight: 700, color: C.navy }}>Estimated Cost</td>
                  <td style={{ padding: '9px 10px', fontWeight: 900, color: C.gr, fontSize: 15 }}>{fm(sel.items.filter(i => i.pulled > 0).reduce((s, i) => { const ret = Math.min(parseFloat(retQtys[i.iid]) || 0, i.pulled); return s + (i.pulled - ret) * i.priceAtPull; }, 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => { setModal(null); setRetQtys({}); }} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="green" sz="lg" onClick={confirmReturn} style={{ flex: 2, justifyContent: 'center' }}>🏁 Complete Job & Generate PDF</Btn>
          </div>
        </Modal>
      )}

      {modal === null && sel && (
        <Modal title={`${sel.po} — ${sel.name}`} onClose={() => setSel(null)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8, marginBottom: 14 }}>
            {[['Status', <Bdg color={jSC[sel.status].c}>{jSC[sel.status].l}</Bdg>], ['PO', sel.po], ['Assigned To', users.find(u => u.id === sel.assignedTo)?.name || '—'], ['Approved', fd(sel.approvedAt)], ['Completed', fd(sel.completedAt)]].map(([k, v]) => (
              <div key={k} style={{ background: C.lg, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: C.lg }}>{['Item', 'Planned', 'Pulled', 'Returned', 'Used', ...(perms.inv_pricing_view ? ['Cost'] : [])].map(h => <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: C.sub, fontWeight: 700 }}>{h}</th>)}</tr></thead>
            <tbody>{sel.items.map(item => (
              <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}` }}>
                <td style={{ padding: '8px 10px', fontWeight: 700, color: C.navy }}>{item.iname}</td>
                <td style={{ padding: '8px 10px' }}>{item.planned}</td>
                <td style={{ padding: '8px 10px', color: item.pulled > 0 ? C.gr : C.sub }}>{item.pulled}</td>
                <td style={{ padding: '8px 10px', color: item.returned > 0 ? C.am : C.sub }}>{item.returned}</td>
                <td style={{ padding: '8px 10px', fontWeight: 700 }}>{item.pulled - item.returned}</td>
                {perms.inv_pricing_view && <td style={{ padding: '8px 10px', color: C.blue, fontWeight: 700 }}>{item.pullCost > 0 ? fm((item.pulled - item.returned) * item.priceAtPull) : '—'}</td>}
              </tr>
            ))}</tbody>
          </table>
          {sel.status === 'completed' && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn v="green" onClick={() => generatePDF(sel, users, activeLogo)}>📄 PDF</Btn>
              <Btn v="sky" onClick={() => setSyncModal(sel)}>☁️ AccuLynx Sync</Btn>
            </div>
          )}
        </Modal>
      )}

      {syncModal && (
        <Modal title={`AccuLynx Sync — ${syncModal.po}`} onClose={() => setSyncModal(null)}>
          <div style={{ marginBottom: 14 }}>
            {syncModal.syncStatus === 'synced' && (
              <div style={{ background: C.sB, border: `1.5px solid ${C.sl}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontWeight: 700, color: C.sl, marginBottom: 4 }}>☁️ Successfully Synced to AccuLynx</div>
                <div style={{ fontSize: 12, color: C.sub }}>{syncModal.syncNote}</div>
                {syncModal.syncedAt && <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>Synced: {ft(syncModal.syncedAt)}</div>}
              </div>
            )}
            {syncModal.syncStatus === 'failed' && (
              <div style={{ background: C.rB, border: `1.5px solid ${C.rd}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontWeight: 700, color: C.rd, marginBottom: 4 }}>⚠️ Sync Failed</div>
                <div style={{ fontSize: 12, color: C.sub }}>{syncModal.syncNote}</div>
              </div>
            )}
            {(syncModal.syncStatus === 'manual' || !syncModal.syncStatus) && (
              <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontWeight: 700, color: C.am, marginBottom: 4 }}>📋 Auto-Sync Not Configured</div>
                <div style={{ fontSize: 12, color: C.navy }}>Configure AccuLynx in Settings → AccuLynx to enable automatic document upload and cost entry.</div>
              </div>
            )}
          </div>
          {syncModal.syncPayload && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', marginBottom: 6 }}>Payload Sent to AccuLynx</div>
              <div style={{ background: '#1A202C', borderRadius: 8, padding: 12, overflowX: 'auto', marginBottom: 12 }}>
                <pre style={{ margin: 0, fontSize: 10, color: '#68D391', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(syncModal.syncPayload, null, 2)}</pre>
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {(syncModal.syncStatus === 'failed' || syncModal.syncStatus === 'manual') && <Btn v="sky" onClick={() => { attemptAccuLynxSync(syncModal, users, acculynxConfig, setJobs); setSyncModal(null); }} style={{ flex: 1, justifyContent: 'center' }}>🔄 Retry Sync</Btn>}
            <Btn v="ghost" onClick={() => setSyncModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Close</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
