// ── Maintenance Requests ──────────────────────────
import { useState } from 'react';
import { supabase } from '../utils/supabase';
import { C } from '../utils/helpers';
import { Btn, Bdg, Fld, Inp, Sel, TA, Modal } from '../components/UIPrimitives';

export default function MaintenanceRequestsView({ reqs, setReqs, vehs, users, user, perms }) {
  const [filt, setFilt] = useState('all');
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState({});

  const filtered = reqs.filter(r => {
    if (filt === 'all') return true;
    return r.status === filt;
  });

  const updateStatus = async (id, status, whNotes = '') => {
    const scheduledDate = form.scheduledDate || '';
    const completedAt = status === 'completed' ? new Date().toISOString() : '';

    const { error } = await supabase
      .from('maintenance_requests')
      .update({ status, wh_notes: whNotes, scheduled_date: scheduledDate, completed_at: completedAt })
      .eq('id', id);

    if (error) {
      alert("Error updating request: " + error.message);
      return;
    }

    setReqs(p => p.map(r => r.id === id ? { ...r, status, whNotes, scheduledDate, completedAt } : r));
    setSel(null);
    setForm({});
  };

  const uC = u => u === 'urgent' ? 'red' : u === 'soon' ? 'amber' : 'gray';
  const sC = s => s === 'pending' ? 'amber' : s === 'scheduled' ? 'blue' : 'green';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>🔧 Maintenance Requests</h1>
          <p style={{ margin: '2px 0 0', color: C.sub, fontSize: 12 }}>{reqs.filter(r => r.status === 'pending').length} pending approval</p>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {['all', 'pending', 'scheduled', 'completed'].map(f => (
            <Btn key={f} v={filt === f ? 'primary' : 'ghost'} sz="sm" onClick={() => setFilt(f)} style={{ textTransform: 'capitalize' }}>
              {f}
            </Btn>
          ))}
        </div>
      </div>

      <div style={{ background: C.w, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <p style={{ padding: 20, color: C.sub, fontSize: 14, margin: 0 }}>No maintenance requests found matching this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
              <thead>
                <tr style={{ background: C.lg, borderBottom: `1.5px solid ${C.bd}` }}>
                  <th style={{ padding: '12px 16px', color: C.navy, fontWeight: 700 }}>Vehicle</th>
                  <th style={{ padding: '12px 16px', color: C.navy, fontWeight: 700 }}>Issue Type</th>
                  <th style={{ padding: '12px 16px', color: C.navy, fontWeight: 700 }}>Urgency</th>
                  <th style={{ padding: '12px 16px', color: C.navy, fontWeight: 700 }}>Submitted By</th>
                  <th style={{ padding: '12px 16px', color: C.navy, fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '12px 16px', color: C.navy, fontWeight: 700, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: C.navy }}>{r.vname}</td>
                    <td style={{ padding: '12px 16px' }}>{r.type}</td>
                    <td style={{ padding: '12px 16px' }}><Bdg color={uC(r.urgency)}>{r.urgency}</Bdg></td>
                    <td style={{ padding: '12px 16px', color: C.sub }}>{r.uname}</td>
                    <td style={{ padding: '12px 16px' }}><Bdg color={sC(r.status)}>{r.status}</Bdg></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <Btn v="ghost" sz="sm" onClick={() => setSel(r)}>Review →</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sel && (
        <Modal title={`Review Request — ${sel.vname}`} onClose={() => { setSel(null); setForm({}); }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
            <div>
              <strong>Submitted By:</strong> {sel.uname} on {new Date(sel.at).toLocaleDateString()}
            </div>
            <div>
              <strong>Issue Classification:</strong> {sel.type}
            </div>
            <div>
              <strong>Reported Notes / Description:</strong>
              <div style={{ background: C.lg, padding: 12, borderRadius: 8, marginTop: 4, fontStyle: 'italic' }}>"{sel.notes}"</div>
            </div>

            {sel.status === 'pending' && perms.maint_manage && (
              <div style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6 }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: 14, color: C.navy }}>Warehouse Management Actions</h3>
                <Fld label="Schedule Date (Optional)"><Inp type="date" onChange={e => setForm({ ...form, scheduledDate: e.target.value })} /></Fld>
                <Fld label="Resolution / Scheduling Notes"><TA placeholder="e.g., Booked with auto shop for Tuesday..." onChange={e => setForm({ ...form, whNotes: e.target.value })} /></Fld>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <Btn v="primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => updateStatus(sel.id, 'scheduled', form.whNotes)}>🗓️ Approve & Schedule</Btn>
                  <Btn v="green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => updateStatus(sel.id, 'completed', form.whNotes)}>✅ Resolve Instantly</Btn>
                </div>
              </div>
            )}

            {sel.status === 'scheduled' && perms.maint_manage && (
              <div style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6 }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: 14, color: C.navy }}>Complete Service Logs</h3>
                {sel.whNotes && <div style={{ marginBottom: 10 }}><strong>Schedule Info:</strong> {sel.whNotes}</div>}
                <Fld label="Final Completion Notes"><TA placeholder="e.g., Oil changed, fluids topped off. Invoice #1234." onChange={e => setForm({ ...form, whNotes: e.target.value })} /></Fld>
                <Btn v="green" style={{ width: '100%', justifyContent: 'center' }} onClick={() => updateStatus(sel.id, 'completed', form.whNotes)}>🏁 Complete & Close Request</Btn>
              </div>
            )}

            {sel.status === 'completed' && (
              <div style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6, background: C.gL, padding: 12, borderRadius: 8 }}>
                <strong style={{ color: C.gr }}>✅ Request Closed</strong>
                {sel.whNotes && <div style={{ marginTop: 4 }}><strong>Resolution Notes:</strong> {sel.whNotes}</div>}
                {sel.completedAt && <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>Closed on: {new Date(sel.completedAt).toLocaleString()}</div>}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
