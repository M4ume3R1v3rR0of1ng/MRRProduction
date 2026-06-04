import { C } from '../utils/helpers';
import { ROLES } from '../database/permissions';
import { logAction } from '../utils/logger';

export default function Sidebar({ cur, onNav, user, onLogout, collapsed, setCollapsed, pendingReqs, lowStock, newJobsForMe, activeLogo, perms }) {
  const navItems = [
    { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
    ...(perms.jobs_build ? [{ id: 'buildjobs', icon: '🏗️', label: 'Build Jobs' }] : []),
    { id: 'pull', icon: '📋', label: 'Pull Inventory', badge: newJobsForMe, badgeColor: C.tl },
    ...(perms.inv_view ? [{ id: 'inventory', icon: '📦', label: 'Inventory', badge: lowStock }] : []),
    ...(perms.fleet_view ? [{ id: 'fleet', icon: '🚛', label: 'Fleet' }] : []),
    ...((perms.maint_submit || perms.maint_manage) ? [{ id: 'requests', icon: '🔧', label: 'Maintenance', badge: perms.maint_manage ? pendingReqs : 0, badgeColor: C.pu }] : []),
    ...(perms.reports_view ? [{ id: 'reports', icon: '📊', label: 'Reports' }] : []),
    ...(perms.users_manage ? [{ id: 'users', icon: '👥', label: 'Users' }] : []),
    ...(perms.users_manage ? [{ id: 'logs', icon: '📜', label: 'Audit Logs' }] : []),
    ...(perms.settings_manage ? [{ id: 'settings', icon: '⚙️', label: 'Settings' }] : []),
  ];
  const rColor = r => r === 'warehouse' ? C.pu : r === 'coordinator' ? C.tl : r === 'field' ? C.gr : r === 'employee' ? C.sub : C.gold;
  
  const handleSignOut = async () => {
    try {
      await logAction(user.id, user.email, 'LOGOUT', 'User signed out of session');
    } catch (err) {
      console.error("Failed to log logout action:", err);
    }
    onLogout(); 
  };

    return (
      <div style={{ width: collapsed ? 60 : 215, background: C.navy, minHeight: '100vh', display: 'flex', flexDirection: 'column', transition: 'width 0.2s', flexShrink: 0 }}>
        {/* Sidebar Header/Logo Wrapper */}
        <div style={{ padding: collapsed ? '12px 0' : '12px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.1)', justifyContent: collapsed ? 'center' : 'flex-start', minHeight: 62 }}>
          <div style={{ width: 36, height: 36, background: activeLogo ? 'transparent' : C.gold, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            {activeLogo ? <img src={activeLogo} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 19 }}>🏠</span>}
          </div>
          {!collapsed && <div><div style={{ fontSize: 11, fontWeight: 900, color: C.gold, lineHeight: 1.1 }}>MAUMEE RIVER</div><div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.5px' }}>ROOFING</div></div>}
        </div>
  
        {/* Main Navigation Links */}
        <nav style={{ flex: 1, padding: '10px 6px' }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => onNav(item.id)} style={{ width: '100%', padding: collapsed ? '11px' : '9px 10px', background: cur === item.id ? 'rgba(245,168,0,0.2)' : 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, color: cur === item.id ? C.gold : 'rgba(255,255,255,0.65)', justifyContent: collapsed ? 'center' : 'flex-start', position: 'relative' }}>
              <span style={{ fontSize: 17 }}>{item.icon}</span>
              {!collapsed && <span style={{ fontSize: 13, fontWeight: cur === item.id ? 700 : 500, flex: 1, textAlign: 'left' }}>{item.label}</span>}
              {(item.badge || 0) > 0 && !collapsed && <span style={{ background: item.badgeColor || C.rd, color: C.w, borderRadius: 20, fontSize: 10, padding: '1px 6px', fontWeight: 800 }}>{item.badge}</span>}
              {(item.badge || 0) > 0 && collapsed && <span style={{ position: 'absolute', top: 6, right: 8, width: 8, height: 8, background: item.badgeColor || C.rd, borderRadius: '50%' }} />}
            </button>
          ))}
        </nav>
        {/* Sidebar Collapse Toggle Button */}
      <button onClick={() => setCollapsed(!collapsed)} style={{ padding: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 16, textAlign: 'center' }}>{collapsed ? '▶' : '◀'}</button>
      
      {/* Restored Clean Footer Panel inside the Sidebar Wrapper */}
      <div style={{ padding: '10px 6px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <div 
          onClick={() => onNav('profile')}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: 8, borderRadius: 7, background: cur === 'profile' ? 'rgba(245,168,0,0.15)' : 'rgba(255,255,255,0.06)', border: cur === 'profile' ? `1px solid ${C.gold}` : '1px solid transparent', marginBottom: 6, cursor: 'pointer', transition: 'background 0.2s' }}
          title="Click to manage profile settings"
        >          
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: rColor(user.role), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: C.w, flexShrink: 0 }}>
            {user.name ? user.name[0] : (user.full_name ? user.full_name[0] : 'U')}
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.w, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name || user.full_name || 'Active User'}
              </div>
              <div style={{ fontSize: 9, color: rColor(user.role), textTransform: 'capitalize', fontWeight: 600 }}>
                {ROLES[user.role]?.label || user.role || 'Employee'}
              </div>
            </div>
          )}
        </div>
        
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 4px' }}>
            <button onClick={onLogout} style={{ width: '100%', padding: 5, background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600 }}>
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}