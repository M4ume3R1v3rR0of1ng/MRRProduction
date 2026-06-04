// src/views/DashboardView.jsx
import { C, displayName } from '../utils/helpers';
import { Bdg, Btn } from '../components/UIPrimitives';
import RecentActivityFeed from '../components/RecentActivityFeed';

export default function DashboardView({ inv, vehs, reqs, jobs, users, user, perms, onNav, tot, jSC }) {
  
  const low = inv.filter(i => tot(i) <= i.alrt);
  const pendingReqs = reqs.filter(r => r.status === 'pending');
  const myJobs = user.role === 'field' ? jobs.filter(j => j.assignedTo === user.id && j.status !== 'completed') : jobs;
  const newJobs = myJobs.filter(j => j.newForAssigned && j.assignedTo === user.id);

  const SC = ({ label, value, color, icon, onClick, sub }) => (
    <div onClick={onClick} style={{ background: C.w, borderRadius: 12, padding: 14, cursor: onClick ? 'pointer' : 'default', borderLeft: `5px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>{greeting}, {displayName(user)}! 👋</h1>
        <p style={{ margin: '3px 0 0', color: C.sub, fontSize: 12 }}>Saint Joe Road Warehouse · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
      </div>
      
      {/* Dynamic Action Banners */}
      {user.role === 'field' && newJobs.length > 0 && (
        <div onClick={() => onNav('pull')} style={{ background: C.tB, border: `2px solid ${C.tl}`, borderRadius: 10, padding: '12px 16px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
          <div style={{ fontWeight: 700, color: C.tl, fontSize: 13 }}>🎉 {newJobs.length} new job{newJobs.length !== 1 ? 's' : ''} assigned to you!</div>
          <Btn v="teal" sz="sm">View →</Btn>
        </div>
      )}
      {perms.maint_manage && pendingReqs.length > 0 && (
        <div onClick={() => onNav('requests')} style={{ background: C.pB, border: `2px solid ${C.pu}`, borderRadius: 10, padding: '12px 16px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
          <div style={{ fontWeight: 700, color: C.pu, fontSize: 13 }}>🔔 {pendingReqs.length} pending maintenance request{pendingReqs.length !== 1 ? 's' : ''}</div>
          <Btn v="purple" sz="sm">View →</Btn>
        </div>
      )}
      {low.length > 0 && <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: C.am, fontWeight: 600 }}>⚠️ {low.length} item(s) at or below low stock threshold.</div>}

      {/* Top Stat Counters Row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {user.role === 'field' ? (
          <>
            <SC label="My Assigned Jobs" value={myJobs.filter(j => j.status !== 'completed').length} color={C.tl} icon="📋" onClick={() => onNav('pull')} />
            <SC label="Active" value={myJobs.filter(j => j.status === 'active').length} color={C.am} icon="🔄" onClick={() => onNav('pull')} />
            <SC label="Completed" value={myJobs.filter(j => j.status === 'completed').length} color={C.gr} icon="🏁" onClick={() => onNav('pull')} />
          </>
        ) : (
          <>
            <SC label="Draft Jobs" value={jobs.filter(j => j.status === 'draft').length} color={C.sub} icon="📝" onClick={perms.jobs_build ? () => onNav('buildjobs') : undefined} />
            <SC label="Approved" value={jobs.filter(j => j.status === 'approved').length} color={C.blue} icon="✅" onClick={() => onNav('pull')} />
            <SC label="Active" value={jobs.filter(j => j.status === 'active').length} color={C.am} icon="🔄" onClick={() => onNav('pull')} />
            <SC label="Low Stock" value={low.length} color={low.length > 0 ? C.rd : C.gr} icon={low.length > 0 ? '🚨' : '✅'} onClick={perms.inv_view ? () => onNav('inventory') : undefined} />
            <SC label="Pending Requests" value={pendingReqs.length} color={pendingReqs.length > 0 ? C.pu : C.gr} icon="🔧" onClick={() => onNav('requests')} />
          </>
        )}
      </div>

      {/* Primary Responsive Layout Grid Setup */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, alignItems: 'start' }}>
        
        {/* Left Column: Metrics and Pipelines */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          
          {/* Job Pipeline Panel */}
          <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 800, color: C.navy }}>📋 Job Pipeline</h3>
            {jobs.filter(j => user.role === 'field' ? j.assignedTo === user.id : true).filter(j => j.status !== 'completed').slice(0, 5).map(j => {
              const sup = users.find(u => u.id === j.assignedTo);
              const st = jSC[j.status];
              return (
                <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: C.lg, borderRadius: 7, marginBottom: 6, fontSize: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: C.navy }}>{j.name}</div>
                    <div style={{ color: C.sub, fontSize: 10 }}>{j.po}{sup ? ` · ${sup.name}` : ''}</div>
                  </div>
                  <Bdg color={st.c}>{st.l}</Bdg>
                </div>
              );
            })}
            {jobs.filter(j => j.status !== 'completed').length === 0 && <p style={{ color: C.gr, fontSize: 12, margin: 0 }}>✅ No active jobs.</p>}
          </div>

          {/* Low Stock Watchlist Panel */}
          <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 800, color: C.navy }}>🚨 Low Stock Items</h3>
            {low.length === 0 ? (
              <p style={{ color: C.gr, fontSize: 12, margin: 0 }}>✅ All items well stocked!</p>
            ) : (
              low.slice(0, 5).map(item => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(242, 119, 119, 0.32)', borderRadius: 10, marginBottom: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: C.navy }}>{item.name}</span>
                  <span style={{ color: C.rd, fontWeight: 800, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                    {tot(item)} <span style={{ fontSize: '10px', fontWeight: 600, color: '#71717a', marginLeft: '2px' }}>{item.unit}</span>
                  </span>
                </div>
              ))
            )}
          </div>

        </div>

        {/* Right Column: Dynamic Activity Feed Sidebar */}
        <div>
          <RecentActivityFeed limit={5} />
        </div>

      </div>
    </div>
  );
}