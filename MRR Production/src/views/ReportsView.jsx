// ── Reports ───────────────────────────────────────

import { useState } from 'react';
import { C, fd, fm } from '../utils/helpers';
import { Btn, Sel, Bdg } from '../components/UIPrimitives';
import { generatePDF } from '../utils/pdfGenerator';

export default function Reports({ jobs, users, user, perms }) {
  const [filt, setFilt] = useState('all');
  const shown = jobs.filter(j => filt === 'all' || j.status === filt).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const completedJobs = jobs.filter(j => j.status === 'completed');
  const totalCost = completedJobs.reduce((s, j) => s + j.items.reduce((a, i) => a + (i.pulled - i.returned) * i.priceAtPull, 0), 0);
  const cards = [{ label: 'Total Jobs', value: jobs.length, color: C.blue }, { label: 'Completed', value: completedJobs.length, color: C.gr }, { label: 'Active', value: jobs.filter(j => j.status === 'active').length, color: C.am }];
  const jSC = {
    draft: { c: 'gray', l: 'Draft' },
    approved: { c: 'blue', l: 'Approved' },
    active: { c: 'amber', l: 'Active' },
    completed: { c: 'green', l: 'Completed' },
    closed: { c: 'purple', l: 'Closed' }
}; 

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}><h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>📊 Reports</h1></div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {cards.map(sc => (
          <div key={sc.label} style={{ background: C.w, borderRadius: 12, padding: 14, borderLeft: `5px solid ${sc.color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: sc.color }}>{sc.value}</div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>{sc.label}</div>
          </div>
        ))}
        {perms.inv_pricing_view && <div style={{ background: C.w, borderRadius: 12, padding: 14, borderLeft: `5px solid ${C.gr}`, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', flex: 1, minWidth: 120 }}><div style={{ fontSize: 18, fontWeight: 900, color: C.gr }}>{fm(totalCost)}</div><div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>Total Materials (Completed)</div></div>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>{[['all', 'All Jobs'], ['draft', 'Draft'], ['approved', 'Approved'], ['active', 'Active'], ['completed', 'Completed']].map(([k, l]) => (<Btn key={k} v={filt === k ? 'primary' : 'ghost'} sz="sm" onClick={() => setFilt(k)}>{l}</Btn>))}</div>
      <div style={{ background: C.w, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: C.lg }}>{['Job Name', 'PO', 'Site Supervisor', 'Status', 'Items', ...(perms.inv_pricing_view ? ['Material Cost'] : []), ''].map(h => (<th key={h} style={{ padding: '9px 12px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>))}</tr></thead>
          <tbody>
            {shown.map(job => {
              const sup = users.find(u => u.id === job.assignedTo);
              const st = jSC[job.status];
              const cost = job.items.reduce((s, i) => s + (i.pulled - i.returned) * i.priceAtPull, 0);
              return (
                <tr key={job.id} style={{ borderTop: `1px solid ${C.lg}` }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: C.navy }}>{job.name}<div style={{ fontSize: 11, color: C.sub, fontWeight: 400 }}>{job.addr}</div></td>
                  <td style={{ padding: '10px 12px', color: C.sub }}>{job.po}</td>
                  <td style={{ padding: '10px 12px', color: C.sub }}>{sup?.name || '—'}</td>
                  <td style={{ padding: '10px 12px' }}><Bdg color={st.c}>{st.l}</Bdg></td>
                  <td style={{ padding: '10px 12px' }}>{job.items.length}</td>
                  {perms.inv_pricing_view && <td style={{ padding: '10px 12px', fontWeight: 700, color: cost > 0 ? C.gr : C.sub }}>{cost > 0 ? fm(cost) : '—'}</td>}
                  <td style={{ padding: '10px 12px' }}>{job.status === 'completed' && <Btn v="ghost" sz="sm" onClick={() => generatePDF(job, users)}>📄 PDF</Btn>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: C.sub, fontSize: 13 }}>No jobs found.</div>}
      </div>
    </div>
  );
}
