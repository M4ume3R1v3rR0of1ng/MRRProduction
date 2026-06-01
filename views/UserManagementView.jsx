// ── Users ─────────────────────────────────────────
import { useState } from 'react';
import { supabase } from '../utils/supabase';
import { C } from '../utils/helpers';
import { PERM_DEFS, PERM_GROUPS, ROLE_COLS, ROLES } from '../database/permissions';
import { Btn, Bdg, RoleBdg, Toggle, Modal, Fld, Sel, Inp } from '../components/UIPrimitives';
import { logAction } from "../utils/logger";

export default function Users({ users, setUsers, currentUser, rolePerms, userOverrides, setUserOverrides }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [editing, setEditing] = useState(null);
  const [permUser, setPermUser] = useState(null);
  const save = () => {
    if (!form.name || !form.email || !form.role) return;
    if (editing) setUsers(p => p.map(u => u.id === editing ? { ...u, ...form } : u));
    else setUsers(p => [...p, { id: uid(), active: true, pass: 'TempPass123!', ...form }]);
    setModal(null); setForm({}); setEditing(null);
  };
  const toggleOverride = (uid, perm, baseVal) => {
    setUserOverrides(p => {
      const uov = { ...(p[uid] || {}) };
      if (uov[perm] === undefined) { uov[perm] = !baseVal; }
      else if (uov[perm] === !baseVal) { delete uov[perm]; }
      else { uov[perm] = !uov[perm]; }
      return { ...p, [uid]: uov };
    });
  };
  const clearOverrides = uid => setUserOverrides(p => { const n = { ...p }; delete n[uid]; return n; });

  const handleUpdatePermissions = async (targetUser, newRole, overrides) => {
  // ... existing saving state / local storage overrides ...

  await logAction(
    user.id, 
    user.email, 
    'PERM_CHANGE', 
    `Modified access profile/role for user: ${targetUser.email}`,
    { targetUserId: targetUser.id, assignedRole: newRole, activeOverrides: overrides }
  );
};

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>👥 User Management</h1>
        <Btn v="primary" onClick={() => { setForm({ role: 'employee' }); setEditing(null); setModal('user'); }}>+ Add User</Btn>
      </div>
      <div style={{ background: C.gL, border: `1px solid ${C.gold}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.navy, lineHeight: 1.7 }}>
        Role permissions are set in <strong>Settings → Role Permissions</strong>. You can also give individual users custom permission overrides here using the 🔒 button.
      </div>
      <div style={{ background: C.w, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: C.lg }}>{['Name', 'Email', 'Role', 'Status', ''].map(h => <th key={h} style={{ padding: '9px 14px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderTop: `1px solid ${C.lg}`, opacity: u.active ? 1 : 0.55 }}>
                <td style={{ padding: '11px 14px', fontWeight: 700, color: C.navy }}>
                  {u.name}
                  {userOverrides[u.id] && Object.keys(userOverrides[u.id]).length > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: C.am, fontWeight: 700 }}>({Object.keys(userOverrides[u.id]).length} override{Object.keys(userOverrides[u.id]).length !== 1 ? 's' : ''})</span>}
                </td>
                <td style={{ padding: '11px 14px', color: C.sub, fontSize: 12 }}>{u.email}</td>
                <td style={{ padding: '11px 14px' }}><RoleBdg role={u.role} /></td>
                <td style={{ padding: '11px 14px' }}><Bdg color={u.active ? 'green' : 'amber'}>{u.active ? 'Active' : 'Inactive'}</Bdg></td>
                <td style={{ padding: '11px 14px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn v="ghost" sz="sm" onClick={() => { setForm({ name: u.name, email: u.email, role: u.role }); setEditing(u.id); setModal('user'); }}>Edit</Btn>
                    {u.id !== currentUser.id && u.role !== 'admin' && <Btn v="ghost" sz="sm" onClick={() => { setPermUser(u); setModal('perms'); }} style={{ color: C.pu }}>🔒 Permissions</Btn>}
                    {u.id !== currentUser.id && <Btn v="ghost" sz="sm" onClick={() => setUsers(p => p.map(x => x.id === u.id ? { ...x, active: !x.active } : x))} style={{ color: u.active ? C.rd : C.gr }}>{u.active ? 'Deactivate' : 'Activate'}</Btn>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal === 'user' && (
        <Modal title={editing ? 'Edit User' : 'Add New User'} onClose={() => setModal(null)}>
          <Fld label="Full Name"><Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label="Email"><Inp type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="user@maumeeriverroofing.com" /></Fld>
          {!editing && <Fld label="Temp Password"><Inp value={form.pass || 'TempPass123!'} onChange={e => setForm({ ...form, pass: e.target.value })} /></Fld>}
          <Fld label="Role">
            <Sel value={form.role || 'field'} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option value="admin"> — Full System Access</option>
              <option value="warehouse">Warehouse Manager</option>
              <option value="coordinator">Production Coordinator</option>
              <option value="manager">Manager</option>
              <option value="field">Site Supervisor (Field)</option>
              <option value="employee">Employee / Field Staff</option>
            </Sel>
          </Fld>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={save} style={{ flex: 1, justifyContent: 'center' }}>{editing ? 'Save Changes' : 'Add User'}</Btn>
          </div>
        </Modal>
      )}

      {modal === 'perms' && permUser && (
        <Modal title={`Custom Permissions — ${permUser.name}`} onClose={() => { setModal(null); setPermUser(null); }} extraWide>
          <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.am, fontWeight: 600 }}>
            ⚠️ Overrides apply <em>on top of</em> the <strong>{ROLES[permUser.role]?.label}</strong> role permissions and only affect <strong>{permUser.name}</strong>.
          </div>
          {userOverrides[permUser.id] && Object.keys(userOverrides[permUser.id]).length > 0 && (
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'flex-end' }}>
              <Btn v="danger" sz="sm" onClick={() => clearOverrides(permUser.id)}>Clear All Overrides</Btn>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: C.lg }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', minWidth: 220 }}>Permission</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', width: 110 }}>Role Default</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', color: C.sub, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', width: 110 }}>This User</th>
              </tr></thead>
              {PERM_GROUPS.map(([groupName, keys]) => (
                <tbody key={groupName}>
                  <tr><td colSpan={3} style={{ padding: '8px 14px', fontWeight: 900, color: C.w, background: C.navy, fontSize: 12 }}>{groupName}</td></tr>
                  {keys.map(key => {
                    const baseVal = (rolePerms[permUser.role] || {})[key] || false;
                    const ovVal = (userOverrides[permUser.id] || {})[key];
                    const effective = ovVal !== undefined ? ovVal : baseVal;
                    const hasOverride = ovVal !== undefined;
                    return (
                      <tr key={key} style={{ borderTop: `1px solid ${C.lg}`, background: hasOverride ? 'rgba(217,119,6,0.07)' : 'transparent' }}>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>
                            {PERM_DEFS[key].label}
                            {hasOverride && <span style={{ marginLeft: 6, fontSize: 10, color: C.am, fontWeight: 700 }}>OVERRIDDEN</span>}
                          </div>
                          <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>{PERM_DEFS[key].desc}</div>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}><div style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={baseVal} disabled={true} /></div></td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}><div style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={effective} onChange={() => toggleOverride(permUser.id, key, baseVal)} /></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
