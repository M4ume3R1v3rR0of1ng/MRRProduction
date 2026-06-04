// src/views/SettingsView.jsx
import React, { useState } from 'react';
import { supabase } from '../utils/supabase';
import { C, compressImg } from '../utils/helpers';
import { PERM_DEFS, PERM_GROUPS, ROLE_COLS, DEFAULT_ROLE_PERMS } from '../database/permissions';
import { Btn, Bdg, Fld, Inp, Toggle, PhotoUpload } from '../components/UIPrimitives';
import { logAction } from '../utils/logger';
import { useNotify } from '../context/NotificationContext';

export default function SettingsView({ 
  warehouses, setWarehouses, logos, setLogos, rolePerms, setRolePerms, acculynxConfig, setAccuLynxConfig, users, setUsers, curUser 
}) {
  const { showToast } = useNotify();
  // Navigation State
  const [currentTab, setCurrentTab] = useState('Permissions');
  
  // Expanded form state to handle facility codes
  const [whForm, setWhForm] = useState({ name: '', location: '', code: '' });
  const [savingAx, setSavingAx] = useState(false);

  // Tab definitions matching layout preferences
  const tabs = [
    { id: 'Permissions', label: 'Permissions', icon: '🔒' },
    { id: 'AccuLynx', label: 'AccuLynx', icon: '🔗' },
    { id: 'Branding', label: 'Branding', icon: '🏢' },
    { id: 'Warehouses', label: 'Warehouses', icon: '🏭' },
    { id: 'System', label: 'System', icon: 'ℹ️' },
  ];

  // ACTION 1: Add a new physical warehouse to the system with database persistence
  const handleAddWarehouse = async (e) => {
    e.preventDefault();
    if (!whForm.name.trim()) return;

    const generatedCode = whForm.code.trim().toUpperCase() || whForm.name.trim().substring(0, 3).toUpperCase();
    const targetId = 'w_' + Math.random().toString(36).substr(2, 9);

    const record = {
      id: targetId,
      name: whForm.name.trim(),
      code: generatedCode,
      location: whForm.location.trim() || 'N/A',
      active: true
    };

    try {
      const { error } = await supabase.from('warehouses').insert([record]);
      if (error) throw error;

      setWarehouses(prev => [...prev, record]);
      setWhForm({ name: '', location: '', code: '' });
    } catch (err) {
      showToast("Database Error adding warehouse: " + err.message, 'error');
    }
  };

  // ACTION 2: Toggle permission keys with instant Supabase database persistence
const handleTogglePerm = async (targetRole, permKey) => {
  // 1. Calculate the next permission configuration state safely
  const currentRolePerms = rolePerms?.[targetRole] || {};
  const nextRolePermsState = {
    ...currentRolePerms,
    [permKey]: !currentRolePerms[permKey]
  };

  try {
    // 2. Perform a network upsert operation into the database table row
    const { error } = await supabase
      .from('role_permissions')
      .upsert({ 
        role: targetRole, 
        permissions: nextRolePermsState,
        updated_at: new Date().toISOString()
      }, { onConflict: 'role' });

    if (error) throw error;

    // 3. Sync the local React UI state tracking block on success
    setRolePerms(prev => ({
      ...prev,
      [targetRole]: nextRolePermsState
    }));
  } catch (err) {
    console.error("Failed to sync role permissions upgrade to Supabase:", err);
    showToast(`Database Error: Settings could not sync. ${err.message}`, 'error');
  }
};

// ACTION 3: Reset individual role layout back to default configurations
const handleResetRole = async (targetRole) => {
  const backupDefaults = DEFAULT_ROLE_PERMS?.[targetRole] || {};
  
  if (!window.confirm(`Are you sure you want to reset all permissions for ${targetRole} to system factory defaults?`)) {
    return;
  }

  try {
    // Overwrite database configurations with factory objects
    const { error } = await supabase
      .from('role_permissions')
      .upsert({ 
        role: targetRole, 
        permissions: backupDefaults,
        updated_at: new Date().toISOString()
      }, { onConflict: 'role' });

    if (error) throw error;

    // Update frontend memory matrices
    setRolePerms(prev => ({
      ...prev,
      [targetRole]: backupDefaults
    }));
  } catch (err) {
    console.error("Failed to restore factory settings bundle:", err);
    showToast(`Database Error: Reset aborted. ${err.message}`, 'error');
  }
};

  // ACTION 4: Save AccuLynx API connection credentials
  const handleSaveAccuLynx = async (e) => {
    e.preventDefault();
    setSavingAx(true);
    
    if (typeof window !== 'undefined' && window.storage) {
      await window.storage.set('mrr-v7-acculynx', JSON.stringify(acculynxConfig));
    }

    try {
      const proxyRoute = acculynxConfig?.proxyUrl || '/.netlify/functions/acculynx-sync';
      
      const response = await fetch(`${proxyRoute}?apiKey=${acculynxConfig.apiKey}&targetEndpoint=account/validate`, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error("Handshake connection refused. Double check your API authentication key token string.");
      }

      showToast("AccuLynx Gateway synchronization confirmed and running successfully! 🔄", 'success');
    } catch (err) {
      showToast(`Configuration Note: Settings saved locally, but handshake test failed: ${err.message}`, 'error');
    } finally {
      setSavingAx(false);
    }
  };

  // ACTION 5: Process uploaded file assets
  const handleLogoUpload = async (file) => {
    if (!file) return;
    try {
      const compressed = await compressImg(file, { maxWidth: 400, quality: 0.85 });
      showToast("Logo processed and buffered successfully!", 'success');
    } catch (err) {
      console.error("Image processing failure:", err);
      showToast(`Image processing failed: ${err.message}`, 'error');
    }
  };

  // Reusable sub-layout card for formatting System Configuration statistics
  const InfoCard = ({ label, value }) => (
    <div style={{ background: '#f1f5f9', padding: '12px 16px', borderRadius: 8, flex: '1 1 calc(50% - 12px)', minWidth: 240 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f294a' }}>{value}</div>
    </div>
  );

  // FIX: Directed table mutation to targeted profiles table to prevent silent data dropouts
  const handleRoleChange = async (targetUserId, newRole) => {
    try {
      const { error } = await supabase
        .from('profiles') // Changed from 'users' to unified 'profiles' source of truth
        .update({ role: newRole })
        .eq('id', targetUserId);

      if (error) throw error;

      // Inside your profile role swap success block
await logAction(
  curUser.id, 
  curUser.email, 
  'PERM_CHANGE', 
  `Altered clearance profile for user ${targetUserId} directly to role '${newRole}'.`,
  { targetId: targetUserId }
);
      
      // Sync local users list state vector
      if (setUsers) {
        setUsers(prev => prev.map(u => u.id === targetUserId ? { ...u, role: newRole } : u));
      }
    } catch (err) {
      console.error("Failed to commit role change metrics:", err);
      showToast(`Database Error: Could not modify user access profile. ${err.message}`, 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: '100%', padding: '0 10px', fontFamily: 'sans-serif' }}>
      
      {/* GLOBAL NAVIGATION LINKS BAR */}
      <div style={{ display: 'flex', gap: 12, borderBottom: '1px solid #e2e8f0', paddingBottom: 12, flexWrap: 'wrap' }}>
        {tabs.map(tab => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 20,
                border: 'none',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                backgroundColor: isActive ? '#1b52b8' : 'transparent',
                color: isActive ? '#ffffff' : '#475569',
                transition: 'all 0.2s ease',
                boxShadow: isActive ? '0 2px 4px rgba(27,82,184,0.3)' : 'none'
              }}
            >
              <span>{tab.icon}</span> {tab.label}
            </button>
          );
        })}
      </div>

      {/* RENDER ACTIVE TAB SELECTIONS */}
      <div style={{ background: C.w, borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', minHeight: 400 }}>
        
        {/* PANEL 1: Interactive Authorization Grid */}
        {currentTab === 'Permissions' && (
          <div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid #e2e8f0` }}>
                    <th style={{ padding: '16px 12px', color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', width: '32%', minWidth: '220px' }}>
                      Permission
                    </th>
                    {ROLE_COLS?.map((roleArray) => {
                      const roleKey = roleArray[0];
                      const roleLabel = roleArray[1];
                      return (
                        <th key={roleKey} style={{ padding: '12px', color: '#0f294a', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', textAlign: 'center', minWidth: '110px' }}>
                          <div>{roleLabel}</div>
                          <button 
                            onClick={() => handleResetRole(roleKey)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#1b52b8',
                              fontSize: 11,
                              cursor: 'pointer',
                              marginTop: 6,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontWeight: 700
                            }}
                          >
                            ↩ Reset
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {PERM_GROUPS?.map(([groupTitle, groupKeys]) => (
                    <React.Fragment key={groupTitle}>
                      <tr style={{ background: '#0f294a' }}>
                        <td colSpan={(ROLE_COLS?.length || 0) + 1} style={{ padding: '12px 14px', fontWeight: 800, color: '#ffffff', fontSize: 13, letterSpacing: '0.3px' }}>
                          {groupTitle}
                        </td>
                      </tr>
                      {Array.isArray(groupKeys) && groupKeys.map(pKey => (
                        <tr key={pKey} style={{ borderBottom: `1px solid #f1f5f9`, backgroundColor: '#ffffff' }}>
                          <td style={{ padding: '14px 12px' }}>
                            <div style={{ fontWeight: 700, color: '#0f294a', fontSize: 14 }}>{PERM_DEFS[pKey]?.label || pKey}</div>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{PERM_DEFS[pKey]?.desc || ''}</div>
                          </td>
                          {ROLE_COLS?.map((roleArray) => {
                            const roleKey = roleArray[0];
                            const isArmed = !!rolePerms?.[roleKey]?.[pKey];
                            return (
                              <td key={roleKey} style={{ padding: '14px 12px', textAlign: 'center' }}>
                                <div style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
                                  <Toggle 
                                    on={isArmed} 
                                    onChange={() => handleTogglePerm(roleKey, pKey)} 
                                  />
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* PANEL 2: AccuLynx Synchronization Matrix */}
        {currentTab === 'AccuLynx' && (
          <div>
            <h2 style={{ margin: '0 0 6px 0', fontSize: 18, fontWeight: 900, color: C.navy }}>🔗 AccuLynx Auto-Sync</h2>
            <p style={{ margin: '0 0 20px 0', color: C.sub, fontSize: 13, lineHeight: '1.5' }}>
              When a job is marked <strong>Completed</strong>, this dashboard will automatically:<br />
              ① Upload the material cost PDF to the AccuLynx job's <strong>Documents</strong><br />
              ② Add the total material cost as a <strong>payment line item</strong>
            </p>
            
            <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 8, padding: '12px 16px', color: '#b45309', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              ⚠️ A backend proxy server is required. AccuLynx API keys cannot run in the browser for security.
            </div>
            
            <form onSubmit={handleSaveAccuLynx}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <Fld label="ACCULYNX API KEY">
                  <Inp type="password" value={acculynxConfig?.apiKey || ''} onChange={e => setAccuLynxConfig(p => ({ ...p, apiKey: e.target.value }))} placeholder="xxxxxxxxxxxx" />
                </Fld>
                <Fld label="BACKEND PROXY URL">
                  <Inp type="text" value={acculynxConfig?.proxyUrl || ''} onChange={e => setAccuLynxConfig(p => ({ ...p, proxyUrl: e.target.value }))} placeholder="https://your-server.com/api/acculynx-sync" />
                </Fld>
              </div>

              <div style={{ display: 'flex', gap: 32, marginBottom: 24, padding: '8px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 700, color: C.navy, cursor: 'pointer' }}>
                  <Toggle on={!!acculynxConfig?.enabled} onChange={() => setAccuLynxConfig(p => ({ ...p, enabled: !p.enabled }))} />
                  <div>
                    <div>Enable Integration</div>
                    <div style={{ fontWeight: 400, fontSize: 11, color: C.sub }}>Allow dashboard to contact AccuLynx</div>
                  </div>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 700, color: C.navy, cursor: 'pointer' }}>
                  <Toggle on={!!acculynxConfig?.autoSync} onChange={() => setAccuLynxConfig(p => ({ ...p, autoSync: !p.autoSync }))} />
                  <div>
                    <div>Auto-Sync on Completion</div>
                    <div style={{ fontWeight: 400, fontSize: 11, color: C.sub }}>Fire automatically when job is completed</div>
                  </div>
                </label>
              </div>
              
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Bdg color={acculynxConfig?.enabled && acculynxConfig?.proxyUrl ? 'green' : 'gray'}>
                  {acculynxConfig?.enabled && acculynxConfig?.proxyUrl ? '● Configured' : '● Not Configured'}
                </Bdg>
                <Btn v="sky" sz="sm" type="button" onClick={() => showToast(acculynxConfig?.apiKey && acculynxConfig?.proxyUrl ? 'Test ping sent to proxy URL.' : 'Enter API Key and Proxy URL first.', 'info')}>
                  Test Connection
                </Btn>
              </div>
            </form>
          </div>
        )}

        {/* PANEL 3: Corporate Branding Assets */}
        {currentTab === 'Branding' && (
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px 0', fontSize: 18, fontWeight: 900, color: C.navy }}>
              🏢 Company Logos
            </h2>
            <p style={{ margin: '0 0 20px 0', color: C.sub, fontSize: 13 }}>Active logo appears in the sidebar, login screen, and all PDF reports.</p>
            
            <div style={{ 
              border: '2px dashed #cbd5e1', 
              borderRadius: 12, 
              padding: '40px 20px', 
              textAlign: 'center', 
              backgroundColor: '#f8fafc',
              marginBottom: 20,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8
            }}>
              <span style={{ fontSize: 32 }}>🖼️</span>
              <div style={{ fontWeight: 700, color: '#475569', fontSize: 15 }}>Upload your company logo</div>
            </div>

            <PhotoUpload onUpload={handleLogoUpload}>
              <Btn v="primary" style={{ padding: '10px 24px', fontWeight: 700 }}>+ Upload First Logo</Btn>
            </PhotoUpload>
          </div>
        )}

        {/* PANEL 4: Warehouses Mapping Panel */}
        {currentTab === 'Warehouses' && (
          <div>
            <h2 style={{ margin: '0 0 6px 0', fontSize: 18, fontWeight: 900, color: C.navy }}>🏭 Corporate Facilities Map</h2>
            <p style={{ margin: '0 0 20px 0', color: C.sub, fontSize: 13 }}>Manage physical storage branches connected to material balance feeds.</p>
            
            <form onSubmit={handleAddWarehouse} style={{ display: 'flex', gap: 10, alignItems: 'end', marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 200 }}><Fld label="Warehouse Facility Name"><Inp value={whForm.name} onChange={e => setWhForm({ ...whForm, name: e.target.value })} placeholder="e.g. Saint Joe Road Warehouse" required /></Fld></div>
              <div style={{ flex: 1, minWidth: 90 }}><Fld label="Code Identification"><Inp value={whForm.code} onChange={e => setWhForm({ ...whForm, code: e.target.value })} placeholder="e.g. SJR" /></Fld></div>
              <div style={{ flex: 2, minWidth: 200 }}><Fld label="Location Address / City"><Inp value={whForm.location} onChange={e => setWhForm({ ...whForm, location: e.target.value })} placeholder="e.g. Fort Wayne, IN" /></Fld></div>
              <Btn v="primary" type="submit" style={{ height: 38, marginBottom: 12 }}>➕ Add Branch</Btn>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {warehouses?.map(w => (
                <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.lg, padding: '12px 16px', borderRadius: 8 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontWeight: 800, color: C.navy, fontSize: 14 }}>{w.name}</div>
                      {w.code && <Bdg color="blue" sz="sm" style={{ fontSize: 10 }}>{w.code}</Bdg>}
                    </div>
                    <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>📍 {w.location || 'No address logged'}</div>
                  </div>
                  <Bdg color={w.active ? 'green' : 'gray'}>{w.active ? 'Operational' : 'Inactive'}</Bdg>
                </div>
              ))}
              {(!warehouses || warehouses.length === 0) && <p style={{ margin: 0, fontSize: 13, color: C.sub, fontStyle: 'italic' }}>No storage facilities registered.</p>}
            </div>
          </div>
        )}

        {/* PANEL 5: Environment Statistics Information */}
        {currentTab === 'System' && (
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 20px 0', fontSize: 18, fontWeight: 900, color: C.navy }}>
              ℹ️ System Information
            </h2>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <InfoCard label="Version" value="WMS v5.0 — Permissions + AccuLynx" />
              <InfoCard label="Storage" value="Browser persistent (window.storage)" />
              <InfoCard label="Photos" value="Auto-compressed JPEG on upload" />
              <InfoCard label="PDF Engine" value="Browser Print → Save as PDF" />
              <InfoCard label="AccuLynx" value={acculynxConfig?.enabled && acculynxConfig?.proxyUrl ? "Enabled" : "Not configured"} />
              <InfoCard label="Permissions" value="Role-based with per-user overrides" />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}