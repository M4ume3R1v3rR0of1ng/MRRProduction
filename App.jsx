// src/App.jsx
import { useState, useEffect, useMemo } from "react";
import { supabase } from "./utils/supabase";

// Centralized Stateless Calculation & Helper Utilities
import { C, uid, fd, ft, fm, tot, newestPrice, oilSt, predDays, detSt, compressImg, doFifo } from "./utils/helpers";

import { storage } from "./utils/storage";
// Automated Document and External Sync Engines
import { PERM_DEFS, PERM_GROUPS, ROLE_COLS, DEFAULT_ROLE_PERMS, getEffectivePerms } from "./database/permissions";
import { SEED_U, SEED_W, SEED_I, SEED_V, SEED_JOBS } from "./data/seeds";

// Shared Reusable UI Layout Elements
import { generatePDF } from "./utils/pdfGenerator";
import { attemptAccuLynxSync } from "./utils/accuLynxSync";

import { Modal, Fld, Inp, TA, Sel, Btn, Bdg, RoleBdg, Toggle, PhotoUpload } from "./components/UIPrimitives";

// Individual Full-Screen Page Views
import LoginScreen from "./views/LoginScreen";
import Sidebar from "./layouts/Sidebar";
import DashboardView from "./views/DashboardView";
import ProfileView from "./views/ProfileView";
import InventoryView from "./views/InventoryView.jsx";
import BuildJobsView from "./views/BuildJobsView";
import PullInventoryView from "./views/PullInventoryView";
import FleetManagementView from "./views/FleetManagementView";
import MaintenanceRequestsView from "./views/MaintenanceRequestsView";
import ReportsView from "./views/ReportsView";
import UserManagementView from "./views/UserManagementView";
import SettingsView from "./views/SettingsView";
import AuditLogView from "./views/AuditLogView";

const jSC = { 
  draft: { c: 'gray', l: 'Draft', icon: '📝' }, 
  approved: { c: 'blue', l: 'Approved', icon: '✅' }, 
  active: { c: 'amber', l: 'Active', icon: '🔄' }, 
  completed: { c: 'green', l: 'Completed', icon: '🏁' }, 
  closed: { c: 'purple', l: 'Closed', icon: '🔒' } 
};

export default function App() {
  const [loading, setLoading] = useState(true);
  const [curUser, setCurUser] = useState(null);
  const [view, setView] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [users, setUsers] = useState(SEED_U);
  const [warehouses, setWH] = useState(SEED_W);
  const [inv, setInv] = useState(SEED_I);
  const [vehs, setVehs] = useState(SEED_V);
  const [reqs, setReqs] = useState([]);
  const [jobs, setJobs] = useState(SEED_JOBS);
  
  const [rolePerms, setRolePerms] = useState({ 
    warehouse: { ...DEFAULT_ROLE_PERMS.warehouse }, 
    coordinator: { ...DEFAULT_ROLE_PERMS.coordinator }, 
    manager: { ...DEFAULT_ROLE_PERMS.manager }, 
    field: { ...DEFAULT_ROLE_PERMS.field } 
  });
  
  const [userOverrides, setUserOverrides] = useState({});
  const [acculynxConfig, setAccuLynxConfig] = useState({ apiKey: '', enabled: false, autoSync: true, proxyUrl: '' });
  const [invPhotos, setInvPhotos] = useState({});
  const [vehPhotos, setVehPhotos] = useState({});
  const [logos, setLogos] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const [
          { data: dbInv, error: invErr },
          { data: dbVehs, error: vehErr },
          { data: dbJobs, error: jobErr },
          { data: dbReqs, error: reqErr },
          { data: dbWH, error: whErr },
          ip, vp, lg, rp, uo, ax
        ] = await Promise.all([
          supabase.from('inventory').select('*'),
          supabase.from('vehicles').select('*'),
          supabase.from('jobs').select('*'),
          supabase.from('maintenance_requests').select('*'),
          supabase.from('warehouses').select('*'),
          storage.get('mrr-v7-inv-photos').catch(() => null),
          storage.get('mrr-v7-veh-photos').catch(() => null),
          storage.get('mrr-v7-logos').catch(() => null),
          storage.get('mrr-v7-roleperms').catch(() => null),
          storage.get('mrr-v7-userov').catch(() => null),
          storage.get('mrr-v7-acculynx').catch(() => null),
        ]);

        if (invErr) console.error("Inventory load error:", invErr.message);
        else if (dbInv && dbInv.length > 0) setInv(dbInv);

        if (vehErr) console.error("Vehicles load error:", vehErr.message);
        else if (dbVehs && dbVehs.length > 0) setVehs(dbVehs);

        if (jobErr) console.error("Jobs load error:", jobErr.message);
        else if (dbJobs && dbJobs.length > 0) setJobs(dbJobs);

        if (reqErr) console.error("Requests load error:", reqErr.message);
        else if (dbReqs && dbReqs.length > 0) setReqs(dbReqs.sort((a, b) => new Date(b.at) - new Date(a.at)));

        if (whErr) console.error("Warehouses load error:", whErr.message);
        else if (dbWH && dbWH.length > 0) setWH(dbWH);

        if (ip?.value) setInvPhotos(JSON.parse(ip.value));
        if (vp?.value) setVehPhotos(JSON.parse(vp.value));
        if (lg?.value) setLogos(JSON.parse(lg.value));
        if (rp?.value) {
          const saved = JSON.parse(rp.value);
          setRolePerms(p => Object.fromEntries(Object.keys(p).map(r => [r, { ...p[r], ...(saved[r] || {}) }])));
        }
        if (uo?.value) setUserOverrides(JSON.parse(uo.value));
        if (ax?.value) setAccuLynxConfig(p => ({ ...p, ...JSON.parse(ax.value) }));
        
      } catch (e) {
        console.error("Critical dashboard loading error:", e);
      }
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => { if (!loading) storage.set('mrr-v7-inv-photos', JSON.stringify(invPhotos)).catch(() => {}); }, [invPhotos, loading]);
  useEffect(() => { if (!loading) storage.set('mrr-v7-veh-photos', JSON.stringify(vehPhotos)).catch(() => {}); }, [vehPhotos, loading]);
  useEffect(() => { if (!loading) storage.set('mrr-v7-logos', JSON.stringify(logos)).catch(() => {}); }, [logos, loading]);
  useEffect(() => { if (!loading) storage.set('mrr-v7-roleperms', JSON.stringify(rolePerms)).catch(() => {}); }, [rolePerms, loading]);
  useEffect(() => { if (!loading) storage.set('mrr-v7-userov', JSON.stringify(userOverrides)).catch(() => {}); }, [userOverrides, loading]);
  useEffect(() => { if (!loading) storage.set('mrr-v7-acculynx', JSON.stringify(acculynxConfig)).catch(() => {}); }, [acculynxConfig, loading]);

  const pendingReqCount = useMemo(() => reqs.filter(r => r.status === 'pending').length, [reqs]);
  const lowStockCount = useMemo(() => inv.filter(i => tot(i) <= i.alrt).length, [inv]);
  const newJobsForMe = useMemo(() => curUser ? jobs.filter(j => j.newForAssigned && j.assignedTo === curUser.id).length : 0, [jobs, curUser]);
  const activeLogo = useMemo(() => logos.find(l => l.isActive)?.data || null, [logos]);
  const userPerms = useMemo(() => { if (!curUser) return {}; return getEffectivePerms(curUser, rolePerms, userOverrides); }, [curUser, rolePerms, userOverrides]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: C.bg, flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 44 }}>🏠</div>
        <div style={{ color: C.navy, fontWeight: 700, fontSize: 16 }}>Loading Maumee River Roofing...</div>
      </div>
    );
  }

  if (!curUser) {
    return <LoginScreen onLogin={u => { setCurUser(u); setView('dashboard'); }} activeLogo={activeLogo} />;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg, fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <Sidebar cur={view} onNav={setView} user={curUser} onLogout={() => setCurUser(null)} collapsed={collapsed} setCollapsed={setCollapsed} pendingReqs={pendingReqCount} lowStock={lowStockCount} newJobsForMe={newJobsForMe} activeLogo={activeLogo} perms={userPerms} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ background: C.w, padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.lg}`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: C.sub }}>Maumee River Roofing · Saint Joe Road Warehouse</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {newJobsForMe > 0 && <div onClick={() => setView('pull')} style={{ background: C.tB, color: C.tl, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🎉 {newJobsForMe} new job{newJobsForMe !== 1 ? 's' : ''}</div>}
            {pendingReqCount > 0 && userPerms.maint_manage && <div onClick={() => setView('requests')} style={{ background: C.pB, color: C.pu, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🔧 {pendingReqCount} pending</div>}
            {lowStockCount > 0 && userPerms.inv_view && <div onClick={() => setView('inventory')} style={{ background: C.aB, color: C.am, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>⚠️ {lowStockCount} low stock</div>}
            <RoleBdg role={curUser.role} />
          </div>
        </div>
        <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
          {view === 'dashboard' && <DashboardView inv={inv} vehs={vehs} reqs={reqs} jobs={jobs} users={users} user={curUser} perms={userPerms} onNav={setView} tot={tot} jSC={jSC} />}

{view === 'buildjobs' && userPerms.jobs_build && (
  <BuildJobsView 
    jobs={jobs} 
    setJobs={setJobs} 
    inv={inv} 
    users={users} 
    user={curUser} 
    perms={userPerms} 
    jSC={jSC}
    view={view}      
    onNav={setView}   
  />
)}        

          {view === 'pull' && <PullInventoryView jobs={jobs} setJobs={setJobs} inv={inv} setInv={setInv} users={users} user={curUser} perms={userPerms} activeLogo={activeLogo} acculynxConfig={acculynxConfig} jSC={jSC}/>}
          {view === 'inventory' && userPerms.inv_view && <InventoryView inv={inv} setInv={setInv} users={users} user={curUser} perms={userPerms} invPhotos={invPhotos} setInvPhotos={setInvPhotos} />}
{view === 'fleet' && userPerms.fleet_view && (
  <FleetManagementView 
    vehs={vehs} 
    setVehs={setVehs} 
    reqs={reqs} 
    setReqs={setReqs} 
    users={users} 
    user={curUser} 
    perms={userPerms} 
    vehPhotos={vehPhotos} 
    setVehPhotos={setVehPhotos}
    oilSt={oilSt}
    detSt={detSt}
    predDays={predDays}
    fd={fd}   
    fm={fm}   
  />
)}          {view === 'requests' && (userPerms.maint_submit || userPerms.maint_manage) && <MaintenanceRequestsView reqs={reqs} setReqs={setReqs} vehs={vehs} users={users} user={curUser} perms={userPerms} />}
          {view === 'reports' && userPerms.reports_view && <ReportsView jobs={jobs} users={users} user={curUser} perms={userPerms} />}
          {view === 'users' && userPerms.users_manage && <UserManagementView users={users} setUsers={setUsers} currentUser={curUser} rolePerms={rolePerms} userOverrides={userOverrides} setUserOverrides={setUserOverrides} />}
          {view === 'settings' && userPerms.settings_manage && <SettingsView warehouses={warehouses} setWarehouses={setWH} logos={logos} setLogos={setLogos} rolePerms={rolePerms} setRolePerms={setRolePerms} acculynxConfig={acculynxConfig} setAccuLynxConfig={setAccuLynxConfig} />}
          {view === 'profile' && <ProfileView user={curUser} onUpdateUser={setCurUser} />}
          {view === 'logs' && userPerms.users_manage && <AuditLogView perms={userPerms} />}
        </div>
      </div>
    </div>
  );
}