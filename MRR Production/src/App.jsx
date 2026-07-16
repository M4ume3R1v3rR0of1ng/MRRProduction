// src/App.jsx
import { useState, useEffect } from "react";
import { supabase } from "./utils/supabase";
import { useAppData } from "./hooks/useAppData";
import OmniSearch from "./components/OmniSearch";
import SyncIndicator from "./components/SyncIndicator";
import { RoleBdg } from "./components/UIPrimitives";
import IdleTimeoutWrapper from "./components/IdleTimeoutWrapper";
import ChatWidget from "./components/ChatWidget";

// Centralized Stateless Calculation & Helper Utilities
import { C, tot, oilSt, predDays, detSt, fd, fm } from "./utils/helpers";

// Full Screen Layout & Sub-Page Views
import LoginScreen from "./views/LoginScreen";
import CompanySwitcher from "./components/CompanySwitcher";
import OwnerConsole from "./views/OwnerConsole";
import BillingView from "./views/BillingView";
import { SteadwerkMark, TrussMark, BRAND } from "./components/SteadwerkMark";
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

// Mascot Branding Asset


const jSC = {
  draft: { c: "gray", l: "Draft", icon: "📝" },
  approved: { c: "blue", l: "Approved", icon: "✅" },
  active: { c: "amber", l: "Active", icon: "🔄" },
  completed: { c: "green", l: "Completed", icon: "🏁" },
  closed: { c: "purple", l: "Closed", icon: "🔒" },
};

export default function App() {
  const [view, setView] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [inventorySearchQuery, setInventorySearchQuery] = useState("");
  // Deep-link from OmniSearch: which record the destination view should open
  const [searchOpenTarget, setSearchOpenTarget] = useState(null); // { view, id }

  // ── 🟢 CONSUME DECOUPLED CUSTOM STATE INFRASTRUCTURE HOOK ──
  const app = useAppData();

  // ── 🧭 BROWSER NATIVE HISTORY POPSTATE INTERCEPTOR ──
  useEffect(() => {
    const handlePopState = (event) => {
      if (event.state && event.state.view) setView(event.state.view);
      else setView("dashboard");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const navigateTo = (nextView) => {
    setView(nextView);
    window.history.pushState({ view: nextView }, "", "");
  };

  const openSearchResult = (targetView, itemId) => {
    setSearchOpenTarget({ view: targetView, id: itemId });
    navigateTo(targetView);
  };
  const searchTargetFor = (v) => (searchOpenTarget?.view === v ? searchOpenTarget.id : null);
  const clearSearchTarget = () => setSearchOpenTarget(null);

  // Clearing curUser alone left the underlying Supabase session (and its token
  // in localStorage) valid and reusable — logout/idle-timeout must actually
  // invalidate it server-side too.
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Sign-out failed:", err);
    } finally {
      app.setCurUser(null);
    }
  };

  const [lang, setLang] = useState("en");
  
  // ── ⏳ HARDENED PROGRESS BAR LOADING FALLBACK ──
  if (app.loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyGroup: "center", justifyContent: "center", minHeight: "100vh", background: C.bg, flexDirection: "column", gap: "var(--space-6)" }}>
        {/* Platform mark, not the Maumee River mascot — this splash renders for every
            company on the platform, before we even know which one. */}
        <div style={{ marginBottom: 4 }}>
          <SteadwerkMark size={88} filled />
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)", width: "100%", maxWidth: "240px" }}>
          {/* External Track Container */}
          <div style={{ width: "100%", height: "6px", backgroundColor: "#cbd5e1", borderRadius: "10px", overflow: "hidden" }}>
            {/* Dynamic Colored Bar Indicator */}
            <div 
              style={{ 
                height: "100%", 
                backgroundColor: C.blue, 
                width: `${app.loadingProgress}%`, 
                transition: "width 0.2s cubic-bezier(0.4, 0, 0.2, 1)", 
                borderRadius: "10px" 
              }} 
            />
          </div>
          
          <div style={{ color: C.navy, fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", letterSpacing: "0.5px", marginTop: 4 }}>
            Syncing System Data Matrix... {app.loadingProgress}%
          </div>
        </div>
      </div>
    );
  }

  // ── 🔒 AUTH CHECK RENDER LAYER ──
  if (!app.curUser) {
    return (
      <LoginScreen
        onLogin={(u) => {
          app.setCurUser(u);
          navigateTo("dashboard");
        }}
        activeLogo={app.activeLogo}
        lang={lang}
        setLang={setLang}
      />
    );
  }

return (
<IdleTimeoutWrapper 
      isAuthenticated={!!app.curUser} 
      onLogout={handleLogout}
      timeout={1800000}
    >    {/* ── 🟢 1. LOCK THE ROOT CONTAINER VIEWPORT TO SCREEN HEIGHT ── */}
    <div style={{
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      height: "100vh", // Force the layout wrapper to freeze at exactly screen height
      maxHeight: "100vh",
      background: C.bg,
      fontFamily: "var(--font-sans)",
      width: "100vw",
      overflow: "hidden" // Prevents the whole browser page from ever scrolling
    }}>
        
        {/* 📱 MOBILE HEADER NAVIGATION BAR */}
        {isMobile && (
          <div style={{ background: C.navy, color: BRAND.homespun, padding: "0 20px", height: 50, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 4px rgba(0,0,0,0.15)", flexShrink: 0 }}>
            {/* The TENANT's name, not the platform's. This header sits inside their
                portal — hardcoding "MAUMEE RIVER ROOFING" here would have greeted
                every other company by your company's name. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", color: "#EDE6DA" }}>
              <TrussMark size={20} />
              {app.company?.name || app.curUser?.companyName || "Steadwerk"}
            </div>
            <button onClick={() => setMobileMenuOpen((o) => !o)} style={{ background: "transparent", border: "none", color: "#EDE6DA", fontSize: "var(--text-3xl)", cursor: "pointer", lineHeight: 1 }}>
              {mobileMenuOpen ? "✕" : "☰"}
            </button>
          </div>
        )}

        {/* 🗺️ CONTAINER ROUTER NAVIGATION DRAWER LAYOUT */}
        {/* (Added height constraint to sidebar element) */}
        <div style={{ width: isMobile ? "100%" : collapsed ? 64 : 260, display: isMobile && !mobileMenuOpen ? "none" : "block", position: isMobile ? "fixed" : "relative", top: isMobile ? 50 : 0, left: 0, height: isMobile ? "calc(100vh - 50px)" : "100vh", zIndex: 99, overflowY: "auto", flexShrink: 0 }}>
          <Sidebar
            cur={view}
            onNav={(v) => {
              navigateTo(v);
              if (isMobile) setMobileMenuOpen(false);
            }}
            user={app.curUser}
            onLogout={handleLogout}
            collapsed={isMobile ? false : collapsed}
            setCollapsed={setCollapsed}
            companyName={app.company?.name || app.curUser?.companyName || null}
            isPlatformAdmin={app.curUser?.isPlatformAdmin}
            pendingReqs={app.pendingReqCount}
            lowStock={app.lowStockCount}
            newJobsForMe={app.newJobsForMe}
            jobsAwaitingClose={app.jobsAwaitingCloseCount}
            chatUnread={app.chatUnread}
            activeLogo={app.activeLogo}
            perms={app.userPerms} 
            lang={lang}
            setLang={setLang}
          />
        </div>

        {/* 📊 CORE PANEL FRAMEWORK METER BODY */}
        <div style={{ 
          flex: 1, 
          display: "flex", 
          flexDirection: "column", 
          minWidth: 0, 
          height: "100%", // Inherit frozen screen layout constraints
          marginTop: isMobile ? 50 : 0,
          overflow: "hidden"
        }}>
          {app.loadErrors.length > 0 && (
            <div style={{ background: "#fee2e2", borderBottom: "2px solid #ef4444", color: "#991b1b", padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", flexShrink: 0, fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)" }}>
              <span>
                ⚠️ Live data failed to load: {app.loadErrors.join(", ")}. Those sections are shown empty rather than with possibly-wrong data — don't make changes until this clears.
              </span>
              <button
                onClick={() => app.reload()}
                style={{ background: "#991b1b", color: "#fff", border: "none", borderRadius: "var(--radius-md)", padding: "6px 14px", cursor: "pointer", fontWeight: "var(--weight-bold)", fontSize: "var(--text-sm)", flexShrink: 0 }}
              >
                🔄 Retry
              </button>
            </div>
          )}
          {!isMobile && (
            <div style={{ background: C.w, padding: "0 20px", height: 56, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)", flexShrink: 0 }}>
              <div style={{ fontSize: "var(--text-sm)", color: C.sub, flexShrink: 0, marginRight: 24 }}>
                Maumee River Roofing · Saint Joe Road Warehouse
              </div>

              <div style={{ flex: 1, maxWidth: "400px", display: "flex", justifyContent: "flex-start", paddingRight: "40px" }}>
                <OmniSearch
                  jobs={app.jobs}
                  users={app.users}
                  reqs={app.reqs}
                  inv={app.inv}
                  vehs={app.vehs}
                  perms={app.userPerms}
                  onNavigate={navigateTo}
                  onOpenItem={openSearchResult}
                  onInventorySearch={setInventorySearchQuery}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", flexShrink: 0, marginLeft: 24 }}>
                <SyncIndicator />
                {app.newJobsForMe > 0 && (
                  <div onClick={() => navigateTo("pull")} style={{ background: C.tB, color: C.tl, borderRadius: 20, padding: "3px 10px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", cursor: "pointer" }}>
                    🎉 {app.newJobsForMe} new job{app.newJobsForMe !== 1 ? "s" : ""}
                  </div>
                )}
                {app.pendingReqCount > 0 && app.userPerms.maint_manage && (
                  <div onClick={() => navigateTo("requests")} style={{ background: C.pB, color: C.pu, borderRadius: 20, padding: "3px 10px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", cursor: "pointer" }}>
                    🔧 {app.pendingReqCount} pending
                  </div>
                )}
                {app.lowStockCount > 0 && app.userPerms.inv_view && (
                  <div onClick={() => navigateTo("inventory")} style={{ background: C.aB, color: C.am, borderRadius: 20, padding: "3px 10px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", cursor: "pointer" }}>
                    ⚠️ {app.lowStockCount} low stock
                  </div>
                )}
                {app.jobsAwaitingCloseCount > 0 && app.userPerms.jobs_close && (
                  <div onClick={() => navigateTo("buildjobs")} style={{ background: C.tB, color: C.tl, borderRadius: 20, padding: "3px 10px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", cursor: "pointer" }}>
                    🧾 {app.jobsAwaitingCloseCount} awaiting close
                  </div>
                )}
                <CompanySwitcher user={app.curUser} />
                <RoleBdg role={app.curUser.role} />
              </div>
            </div>
          )}

          {/* ── 🟢 2. CENTRAL DISPATCH PANEL CARDS SCROLL INSIDE THIS CANVAS ONLY ── */}
          <div 
            className="global-app-scrollbar" // Connects with custom slim styling markers
            style={{ 
              flex: 1, 
              padding: isMobile ? 16 : 20, 
              overflowY: "auto", // Confines scroll mechanics strictly to the open sub-view card
              background: C.bg 
            }}
          >
            {view === "dashboard" && (
              <DashboardView inv={app.inv} vehs={app.vehs} reqs={app.reqs} jobs={app.jobs} jobTrailers={app.jobTrailers} users={app.users} user={app.curUser} perms={app.userPerms} onNav={navigateTo} tot={tot} jSC={jSC} lang={lang} setLang={setLang} onMarkChatRead={app.markChatRead} setJobs={app.setJobs} setReqs={app.setReqs} />
            )}
            {view === "buildjobs" && (app.userPerms.jobs_build || app.userPerms.jobs_close) && (
              <BuildJobsView jobs={app.jobs} setJobs={app.setJobs} inv={app.inv} vehs={app.vehs} jobTrailers={app.jobTrailers} setJobTrailers={app.setJobTrailers} users={app.users} user={app.curUser} perms={app.userPerms} jSC={jSC} view={view} onNav={navigateTo} acculynxConfig={app.acculynxConfig} lang={lang} setLang={setLang} openItemId={searchTargetFor("buildjobs")} onOpenItemHandled={clearSearchTarget} activeLogo={app.activeLogo}/>
            )}
            {view === "pull" && (
              <PullInventoryView jobs={app.jobs} setJobs={app.setJobs} inv={app.inv} setInv={app.setInv} vehs={app.vehs} jobTrailers={app.jobTrailers} setJobTrailers={app.setJobTrailers} users={app.users} user={app.curUser} perms={app.userPerms} activeLogo={app.activeLogo} acculynxConfig={app.acculynxConfig} jSC={jSC} lang={lang} setLang={setLang} openItemId={searchTargetFor("pull")} onOpenItemHandled={clearSearchTarget} />
            )}
            {view === "inventory" && app.userPerms.inv_view && (
              <InventoryView inv={app.inv} setInv={app.setInv} jobs={app.jobs} setJobs={app.setJobs} users={app.users} user={app.curUser} perms={app.userPerms} inventorySearchQuery={inventorySearchQuery} setInventorySearchQuery={setInventorySearchQuery} lang={lang} setLang={setLang} />
            )}
            {view === "fleet" && app.userPerms.fleet_view && (
              <FleetManagementView vehs={app.vehs} setVehs={app.setVehs} reqs={app.reqs} setReqs={app.setReqs} jobs={app.jobs} setJobs={app.setJobs} jobTrailers={app.jobTrailers} setJobTrailers={app.setJobTrailers} jSC={jSC} users={app.users} user={app.curUser} perms={app.userPerms} oilSt={oilSt} detSt={detSt} predDays={predDays} fd={fd} fm={fm} inventorySearchQuery={inventorySearchQuery} setInventorySearchQuery={setInventorySearchQuery} lang={lang} setLang={setLang} openItemId={searchTargetFor("fleet")} onOpenItemHandled={clearSearchTarget} />
            )}
            {view === "requests" && (app.userPerms.maint_submit || app.userPerms.maint_manage) && (
              <MaintenanceRequestsView reqs={app.reqs} setReqs={app.setReqs} vehs={app.vehs} users={app.users} user={app.curUser} perms={app.userPerms} lang={lang} setLang={setLang} openItemId={searchTargetFor("requests")} onOpenItemHandled={clearSearchTarget} />
            )}
            {view === "reports" && app.userPerms.reports_view && (
              <ReportsView jobs={app.jobs} users={app.users} user={app.curUser} perms={app.userPerms} inv={app.inv} vehs={app.vehs} reqs={app.reqs} lang={lang} setLang={setLang} />
            )}
            {view === "users" && app.userPerms.users_manage && (
              <UserManagementView users={app.users} setUsers={app.setUsers} currentUser={app.curUser} rolePerms={app.rolePerms} userOverrides={app.userOverrides} setUserOverrides={app.setUserOverrides} lang={lang} setLang={setLang} openItemId={searchTargetFor("users")} onOpenItemHandled={clearSearchTarget} />
            )}
            {view === "settings" && app.userPerms.settings_manage && (
              <SettingsView warehouses={app.warehouses} setWarehouses={app.setWH} logos={app.logos} setLogos={app.setLogos} rolePerms={app.rolePerms} setRolePerms={app.setRolePerms} acculynxConfig={app.acculynxConfig} setAccuLynxConfig={app.setAccuLynxConfig} />
            )}
            {view === "logs" && app.userPerms.users_manage && (
              <AuditLogView perms={app.userPerms} inv={app.inv} users={app.users} />
            )}
            {view === "owner" && app.curUser.isPlatformAdmin && (
              <OwnerConsole user={app.curUser} />
            )}
            {view === "billing" && (app.curUser.role === "admin" || app.curUser.isPlatformAdmin) && (
              <BillingView user={app.curUser} />
            )}
            {view === "profile" && (
              <ProfileView
                user={app.curUser}
                onUpdateUser={(updated) => {
                  app.setCurUser(updated);
                  app.setUsers((p) => p.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
                }}
              />
            )}
          </div>

        </div>
      </div>
      <ChatWidget user={app.curUser} />
    </IdleTimeoutWrapper>
  );
}