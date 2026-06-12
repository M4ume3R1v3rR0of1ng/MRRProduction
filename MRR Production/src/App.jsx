// src/App.jsx
import { useState, useEffect, useMemo } from "react";
import { supabase } from "./utils/supabase";
import OmniSearch from "./components/OmniSearch";
import SyncIndicator from "./components/SyncIndicator";
import { processOfflineQueue } from "./utils/offlineSync";
import { useNotify } from "./context/NotificationContext";
// Centralized Stateless Calculation & Helper Utilities
import {
  C,
  uid,
  fd,
  ft,
  fm,
  tot,
  newestPrice,
  oilSt,
  predDays,
  detSt,
  compressImg,
  doFifo,
} from "./utils/helpers";

import { storage } from "./utils/storage";
// Automated Document and External Sync Engines
import {
  DEFAULT_ROLE_PERMS,
  getEffectivePerms,
} from "./database/permissions";
import { SEED_U, SEED_W, SEED_I, SEED_V, SEED_JOBS } from "./data/seeds";

import { RoleBdg } from "./components/UIPrimitives";

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

// Time-based Session Management Wrapper
import IdleTimeoutWrapper from "./components/IdleTimeoutWrapper";

const jSC = {
  draft: { c: "gray", l: "Draft", icon: "📝" },
  approved: { c: "blue", l: "Approved", icon: "✅" },
  active: { c: "amber", l: "Active", icon: "🔄" },
  completed: { c: "green", l: "Completed", icon: "🏁" },
  closed: { c: "purple", l: "Closed", icon: "🔒" },
};

export default function App() {
  const [loading, setLoading] = useState(true);
  const [curUser, setCurUser] = useState(null);
  const [view, setView] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [users, setUsers] = useState(SEED_U);
  const [warehouses, setWH] = useState(SEED_W);
  const [inv, setInv] = useState(SEED_I);
  const [vehs, setVehs] = useState(SEED_V);
  const [reqs, setReqs] = useState([]);
  const [jobs, setJobs] = useState(SEED_JOBS);
  const { showToast } = useNotify();

  const [rolePerms, setRolePerms] = useState({
    warehouse: { ...DEFAULT_ROLE_PERMS.warehouse },
    coordinator: { ...DEFAULT_ROLE_PERMS.coordinator },
    manager: { ...DEFAULT_ROLE_PERMS.manager },
    field: { ...DEFAULT_ROLE_PERMS.field },
  });

  const [userOverrides, setUserOverrides] = useState({});
  const [acculynxConfig, setAccuLynxConfig] = useState({
    apiKey: "",
    enabled: false,
    autoSync: true,
    proxyUrl: "",
  });
  const [invPhotos, setInvPhotos] = useState({});
  const [vehPhotos, setVehPhotos] = useState({});
  const [logos, setLogos] = useState([]);

  // ── ✅ FIX STEP 1: MOVE HOOK OUT TO NATIVE COMPONENT LEVEL ──
  useEffect(() => {
    const handlePopState = (event) => {
      if (event.state && event.state.view) {
        setView(event.state.view);
      } else {
        setView("dashboard");
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // ── ✅ FIX STEP 2: SCOPE THE SMART NAVIGATION COMPONENT PROPERLY ──
  const navigateTo = (nextView) => {
    setView(nextView);
    window.history.pushState({ view: nextView }, "", "");
  };

  // src/App.jsx - Hardened Initialization Block
  useEffect(() => {
    async function load() {
      console.log("🚀 Initializing Maumee River Roofing WMS Boot Sequence...");

      try {
        const [ip, vp, lg, ax] = await Promise.all([
          storage.get("mrr-v7-inv-photos").catch(() => null),
          storage.get("mrr-v7-veh-photos").catch(() => null),
          storage.get("mrr-v7-logos").catch(() => null),
          storage.get("mrr-v7-acculynx").catch(() => null),
        ]);

        if (ip?.value) setInvPhotos(JSON.parse(ip.value));
        if (vp?.value) setVehPhotos(JSON.parse(vp.value));
        if (ax?.value) setAccuLynxConfig((p) => ({ ...p, ...JSON.parse(ax.value) }));

        if (lg?.value) {
          try {
            const parsedLogos = JSON.parse(lg.value);
            if (Array.isArray(parsedLogos)) setLogos(parsedLogos);
            else setLogos([]);
          } catch (e) {
            setLogos([]);
          }
        }

        await Promise.all([
          (async () => {
            const { data, error } = await supabase.from("inventory").select("*");
            if (error) setInv(SEED_I);
            else if (data && data.length > 0) setInv(data);
            else setInv(SEED_I);
          })(),
          (async () => {
            const { data, error } = await supabase.from("vehicles").select("*");
            if (error) setVehs(SEED_V);
            else if (data && data.length > 0) setVehs(data);
            else setVehs(SEED_V);
          })(),
          (async () => {
            const { data, error } = await supabase.from("jobs").select("*");
            if (error) setJobs(SEED_JOBS);
            else if (data && data.length > 0) setJobs(data);
            else setJobs(SEED_JOBS);
          })(),
          (async () => {
            const { data, error } = await supabase.from("maintenance_requests").select("*");
            if (error) setReqs([]);
            else if (data && data.length > 0) setReqs(data.sort((a, b) => new Date(b.at) - new Date(a.at)));
            else setReqs([]);
          })(),
          (async () => {
            const { data, error } = await supabase.from("warehouses").select("*");
            if (error) setWH(SEED_W);
            else if (data && data.length > 0) setWH(data);
            else setWH(SEED_W);
          })(),
          (async () => {
            const { data, error } = await supabase.from("profiles").select("*");
            if (error) setUsers(SEED_U);
            else if (data && data.length > 0) setUsers(data);
            else setUsers(SEED_U);
          })(),
          (async () => {
            const { data, error } = await supabase.from("role_permissions").select("*");
            if (data && data.length > 0) {
              const formattedRolePerms = {};
              data.forEach((row) => { formattedRolePerms[row.role] = row.permissions; });
              setRolePerms((p) => ({ ...p, ...formattedRolePerms }));
            }
          })(),
          (async () => {
            const { data, error } = await supabase.from("user_permission_overrides").select("*");
            if (data && data.length > 0) {
              const formattedUserOv = {};
              data.forEach((row) => { formattedUserOv[row.user_id] = row.overrides; });
              setUserOverrides(formattedUserOv);
            }
          })(),
        ]);

        console.log("🏁 Core synchronization complete. App ready.");
      } catch (e) {
        console.error("🚨 Critical failure during app instantiation sequence:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => { if (!loading) storage.set("mrr-v7-inv-photos", JSON.stringify(invPhotos)).catch(() => {}); }, [invPhotos, loading]);
  useEffect(() => { if (!loading) storage.set("mrr-v7-veh-photos", JSON.stringify(vehPhotos)).catch(() => {}); }, [vehPhotos, loading]);
  useEffect(() => { if (!loading) storage.set("mrr-v7-logos", JSON.stringify(logos)).catch(() => {}); }, [logos, loading]);
  useEffect(() => { if (!loading) storage.set("mrr-v7-roleperms", JSON.stringify(rolePerms)).catch(() => {}); }, [rolePerms, loading]);
  useEffect(() => { if (!loading) storage.set("mrr-v7-userov", JSON.stringify(userOverrides)).catch(() => {}); }, [userOverrides, loading]);
  useEffect(() => { if (!loading) storage.set("mrr-v7-acculynx", JSON.stringify(acculynxConfig)).catch(() => {}); }, [acculynxConfig, loading]);

  const pendingReqCount = useMemo(() => reqs.filter((r) => r.status === "pending").length, [reqs]);
  const lowStockCount = useMemo(() => inv.filter((i) => tot(i) <= i.alrt).length, [inv]);
  const newJobsForMe = useMemo(() => curUser ? jobs.filter((j) => j.newForAssigned && j.assignedTo === curUser.id).length : 0, [jobs, curUser]);
  const activeLogo = useMemo(() => {
    if (!logos || !Array.isArray(logos)) return null;
    return logos.find((l) => l.isActive)?.data || null;
  }, [logos]);

  const userPerms = useMemo(() => {
    if (!curUser) return {};
    return getEffectivePerms(curUser, rolePerms, userOverrides);
  }, [curUser, rolePerms, userOverrides]);

  useEffect(() => {
    const handleReconnect = () => { processOfflineQueue(showToast); };
    window.addEventListener("online", handleReconnect);
    if (navigator.onLine) processOfflineQueue(showToast);
    return () => window.removeEventListener("online", handleReconnect);
  }, [showToast]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: C.bg, flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 44 }}>🏠</div>
        <div style={{ color: C.navy, fontWeight: 700, fontSize: 16 }}>Loading Maumee River Roofing...</div>
      </div>
    );
  }

  if (!curUser) {
    return <LoginScreen onLogin={(u) => { setCurUser(u); navigateTo("dashboard"); }} activeLogo={activeLogo} />;
  }

  return (
    <IdleTimeoutWrapper isAuthenticated={!!curUser} onLogout={() => setCurUser(null)}>
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI',system-ui,sans-serif", width: "100vw", overflowX: "hidden" }}>
        
        {/* 📱 MOBILE HEADER BAR */}
        {isMobile && (
          <div style={{ background: "#0f172a", color: "#fff", padding: "0 20px", height: 50, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 4px rgba(0,0,0,0.15)", flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>🏗️ MAUMEE RIVER ROOFING</div>
            <button onClick={() => setMobileMenuOpen((o) => !o)} style={{ background: "transparent", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>
              {mobileMenuOpen ? "✕" : "☰"}
            </button>
          </div>
        )}

        {/* 🗺️ SIDEBAR ROUTER SYSTEM */}
        <div style={{ width: isMobile ? "100%" : collapsed ? 64 : 260, display: isMobile && !mobileMenuOpen ? "none" : "block", position: isMobile ? "fixed" : "relative", top: isMobile ? 50 : 0, left: 0, height: isMobile ? "calc(100vh - 50px)" : "100vh", zIndex: 99, overflowY: "auto", flexShrink: 0 }}>
          <Sidebar
            cur={view}
            onNav={(v) => {
              navigateTo(v); // ✅ Updated path routing pointer trigger
              if (isMobile) setMobileMenuOpen(false);
            }}
            user={curUser}
            onLogout={() => setCurUser(null)}
            collapsed={isMobile ? false : collapsed}
            setCollapsed={setCollapsed}
            pendingReqs={pendingReqCount}
            lowStock={lowStockCount}
            newJobsForMe={newJobsForMe}
            activeLogo={activeLogo}
            perms={userPerms}
          />
        </div>

        {/* 📊 MAIN VIEW CONTAINER TRACK */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, marginTop: isMobile ? 50 : 0 }}>
          {!isMobile && (
            <div style={{ background: C.w, padding: "0 20px", height: 56, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.lg}`, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize: 12, color: C.sub, flexShrink: 0, marginRight: 24 }}>
                Maumee River Roofing · Saint Joe Road Warehouse
              </div>

              <div style={{ flex: 1, maxWidth: "400px", display: "flex", justifyContent: "flex-start", paddingRight: "40px" }}>
                <OmniSearch jobs={jobs} users ={users} reqs={reqs} inv={inv} vehs={vehs} onNavigate={navigateTo} />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, marginLeft: 24 }}>
                <SyncIndicator />
                {newJobsForMe > 0 && (
                  <div onClick={() => navigateTo("pull")} style={{ background: C.tB, color: C.tl, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    🎉 {newJobsForMe} new job{newJobsForMe !== 1 ? "s" : ""}
                  </div>
                )}
                {pendingReqCount > 0 && userPerms.maint_manage && (
                  <div onClick={() => navigateTo("requests")} style={{ background: C.pB, color: C.pu, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    🔧 {pendingReqCount} pending
                  </div>
                )}
                {lowStockCount > 0 && userPerms.inv_view && (
                  <div onClick={() => navigateTo("inventory")} style={{ background: C.aB, color: C.am, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    ⚠️ {lowStockCount} low stock
                  </div>
                )}
                <RoleBdg role={curUser.role} />
              </div>
            </div>
          )}

          {/* Core App View Routers */}
          <div style={{ flex: 1, padding: isMobile ? 16 : 20, overflowY: "auto" }}>
            {view === "dashboard" && <DashboardView inv={inv} vehs={vehs} reqs={reqs} jobs={jobs} users={users} user={curUser} perms={userPerms} onNav={navigateTo} tot={tot} jSC={jSC} />}
            {view === "buildjobs" && userPerms.jobs_build && <BuildJobsView jobs={jobs} setJobs={setJobs} inv={inv} users={users} user={curUser} perms={userPerms} jSC={jSC} view={view} onNav={navigateTo} acculynxConfig={acculynxConfig} />}
            {view === "pull" && <PullInventoryView jobs={jobs} setJobs={setJobs} inv={inv} setInv={setInv} users={users} user={curUser} perms={userPerms} activeLogo={activeLogo} acculynxConfig={acculynxConfig} jSC={jSC} />}
            {view === "inventory" && userPerms.inv_view && <InventoryView inv={inv} setInv={setInv} users={users} user={curUser} perms={userPerms} invPhotos={invPhotos} setInvPhotos={setInvPhotos} />}
            {view === "fleet" && userPerms.fleet_view && <FleetManagementView vehs={vehs} setVehs={setVehs} reqs={reqs} setReqs={setReqs} users={users} user={curUser} perms={userPerms} vehPhotos={vehPhotos} setVehPhotos={setVehPhotos} oilSt={oilSt} detSt={detSt} predDays={predDays} fd={fd} fm={fm} />}
            {view === "requests" && (userPerms.maint_submit || userPerms.maint_manage) && <MaintenanceRequestsView reqs={reqs} setReqs={setReqs} vehs={vehs} users={users} user={curUser} perms={userPerms} />}
            {view === "reports" && userPerms.reports_view && <ReportsView jobs={jobs} users={users} user={curUser} perms={userPerms} inv={inv} vehs={vehs} reqs={reqs} />}
            {view === "users" && userPerms.users_manage && <UserManagementView users={users} setUsers={setUsers} currentUser={curUser} rolePerms={rolePerms} userOverrides={userOverrides} setUserOverrides={setUserOverrides} />}
            {view === "settings" && userPerms.settings_manage && <SettingsView warehouses={warehouses} setWarehouses={setWH} logos={logos} setLogos={setLogos} rolePerms={rolePerms} setRolePerms={setRolePerms} acculynxConfig={acculynxConfig} setAccuLynxConfig={setAccuLynxConfig} />}
            {view === "profile" && <ProfileView user={curUser} onUpdateUser={setCurUser} />}
            {view === "logs" && userPerms.users_manage && <AuditLogView perms={userPerms} />}
          </div>
        </div>
      </div>
    </IdleTimeoutWrapper>
  );
}