// src/App.jsx
import { useState, useEffect, useMemo } from "react";
import { supabase } from "./utils/supabase";
import OmniSearch from "./components/OmniSearch";
import SyncIndicator from "./components/SyncIndicator";
import { processOfflineQueue } from "./utils/offlineSync";
import { useNotify } from "./context/NotificationContext"; // Ensure your toast context is imported here
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
  PERM_DEFS,
  PERM_GROUPS,
  ROLE_COLS,
  DEFAULT_ROLE_PERMS,
  getEffectivePerms,
} from "./database/permissions";
import { SEED_U, SEED_W, SEED_I, SEED_V, SEED_JOBS } from "./data/seeds";

// Shared Reusable UI Layout Elements
import { generatePDF } from "./utils/pdfGenerator";
import { attemptAccuLynxSync } from "./utils/accuLynxSync";

import {
  Modal,
  Fld,
  Inp,
  TA,
  Sel,
  Btn,
  Bdg,
  RoleBdg,
  Toggle,
  PhotoUpload,
} from "./components/UIPrimitives";

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
  const [users, setUsers] = useState(SEED_U); // Initialized with fallback, overridden by DB mount
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

  // src/App.jsx - Hardened Initialization Block
  useEffect(() => {
    async function load() {
      console.log("🚀 Initializing Maumee River Roofing WMS Boot Sequence...");

      try {
        // 1. READ FROM LOCAL STORAGE CACHE FIRST AS BASELINE
        const [ip, vp, lg, ax] = await Promise.all([
          storage.get("mrr-v7-inv-photos").catch(() => null),
          storage.get("mrr-v7-veh-photos").catch(() => null),
          storage.get("mrr-v7-logos").catch(() => null),
          storage.get("mrr-v7-acculynx").catch(() => null),
        ]);

        if (ip?.value) setInvPhotos(JSON.parse(ip.value));
        if (vp?.value) setVehPhotos(JSON.parse(vp.value));
        if (ax?.value)
          setAccuLynxConfig((p) => ({ ...p, ...JSON.parse(ax.value) }));

        if (lg?.value) {
          try {
            const parsedLogos = JSON.parse(lg.value);
            if (Array.isArray(parsedLogos)) setLogos(parsedLogos);
            else setLogos([]);
          } catch (e) {
            setLogos([]);
          }
        }

        // 2. LAUNCH CONCURRENT, WRAPPED NETWORK TRANSACTIONS
        // Breaking Promise.all's fail-fast rule by handling errors line-by-line
        await Promise.all([
          // -- Inventory Fetch --
          (async () => {
            console.log("📦 Fetching live inventory allocations...");
            const { data, error } = await supabase
              .from("inventory")
              .select("*");
            if (error) {
              console.error("❌ Inventory table error:", error.message);
              setInv(SEED_I); // Graceful seed fallback
            } else if (data && data.length > 0) {
              setInv(data);
              console.log(`✅ Inventory loaded: ${data.length} records.`);
            } else {
              setInv(SEED_I);
            }
          })(),

          // -- Vehicles Fetch --
          (async () => {
            console.log("🚛 Fetching fleet registry entries...");
            const { data, error } = await supabase.from("vehicles").select("*");
            if (error) {
              console.error("❌ Vehicles table error:", error.message);
              setVehs(SEED_V);
            } else if (data && data.length > 0) {
              setVehs(data);
              console.log(`✅ Fleet loaded: ${data.length} vehicles.`);
            } else {
              setVehs(SEED_V);
            }
          })(),

          // -- Jobs Fetch --
          (async () => {
            console.log("🏗️ Fetching active contract pipeline...");
            const { data, error } = await supabase.from("jobs").select("*");
            if (error) {
              console.error("❌ Jobs table error:", error.message);
              setJobs(SEED_JOBS);
            } else if (data && data.length > 0) {
              setJobs(data);
              console.log(`✅ Jobs loaded: ${data.length} pipeline contracts.`);
            } else {
              setJobs(SEED_JOBS);
            }
          })(),

          // -- Maintenance Requests Fetch --
          (async () => {
            console.log("🔧 Fetching maintenance ticketing records...");
            const { data, error } = await supabase
              .from("maintenance_requests")
              .select("*");
            if (error) {
              console.error(
                "❌ Maintenance requests table error:",
                error.message,
              );
              setReqs([]); // Non-critical fallback to empty array
            } else if (data && data.length > 0) {
              setReqs(data.sort((a, b) => new Date(b.at) - new Date(a.at)));
              console.log(
                `✅ Tickets loaded: ${data.length} maintenance files.`,
              );
            } else {
              setReqs([]);
            }
          })(),

          // -- Warehouses Fetch --
          (async () => {
            console.log("🏭 Fetching corporate physical storage map...");
            const { data, error } = await supabase
              .from("warehouses")
              .select("*");
            if (error) {
              console.error("❌ Warehouses table error:", error.message);
              setWH(SEED_W);
            } else if (data && data.length > 0) {
              setWH(data);
              console.log(
                `✅ Facilities loaded: ${data.length} operating branches.`,
              );
            } else {
              setWH(SEED_W);
            }
          })(),

          // -- Profiles User Fetch --
          (async () => {
            console.log("👥 Fetching application user profile maps...");
            const { data, error } = await supabase.from("profiles").select("*");
            if (error) {
              console.error("❌ Profiles authority error:", error.message);
              setUsers(SEED_U);
            } else if (data && data.length > 0) {
              setUsers(data);
              console.log(
                `✅ Users loaded: ${data.length} employee identities parsed.`,
              );
            } else {
              setUsers(SEED_U);
            }
          })(),

          // -- Global Role Permissions Fetch --
          (async () => {
            console.log("🔒 Fetching global access authorization matrix...");
            const { data, error } = await supabase
              .from("role_permissions")
              .select("*");
            if (error) {
              console.error(
                "❌ Role permissions system block error:",
                error.message,
              );
            } else if (data && data.length > 0) {
              const formattedRolePerms = {};
              data.forEach((row) => {
                formattedRolePerms[row.role] = row.permissions;
              });
              setRolePerms((p) => ({ ...p, ...formattedRolePerms }));
              console.log("✅ Custom security roles applied successfully.");
            }
          })(),

          // -- User Permission Overrides Fetch --
          (async () => {
            console.log("🔏 Fetching granular clearance exception list...");
            const { data, error } = await supabase
              .from("user_permission_overrides")
              .select("*");
            if (error) {
              console.error(
                "❌ Personal clearance overrides table error:",
                error.message,
              );
            } else if (data && data.length > 0) {
              const formattedUserOv = {};
              data.forEach((row) => {
                formattedUserOv[row.user_id] = row.overrides;
              });
              setUserOverrides(formattedUserOv);
              console.log(
                `✅ Exception overrides applied for ${data.length} team members.`,
              );
            }
          })(),
        ]);

        console.log("🏁 Core synchronization complete. App ready.");
      } catch (e) {
        // Global boundary fallback to protect the primary runtime context loop
        console.error(
          "🚨 Critical failure during app instantiation sequence:",
          e,
        );
      } finally {
        setLoading(false); // Guarantees the loading block unpins even if network dropouts occur
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!loading)
      storage
        .set("mrr-v7-inv-photos", JSON.stringify(invPhotos))
        .catch(() => {});
  }, [invPhotos, loading]);
  useEffect(() => {
    if (!loading)
      storage
        .set("mrr-v7-veh-photos", JSON.stringify(vehPhotos))
        .catch(() => {});
  }, [vehPhotos, loading]);
  useEffect(() => {
    if (!loading)
      storage.set("mrr-v7-logos", JSON.stringify(logos)).catch(() => {});
  }, [logos, loading]);
  useEffect(() => {
    if (!loading)
      storage
        .set("mrr-v7-roleperms", JSON.stringify(rolePerms))
        .catch(() => {});
  }, [rolePerms, loading]);
  useEffect(() => {
    if (!loading)
      storage
        .set("mrr-v7-userov", JSON.stringify(userOverrides))
        .catch(() => {});
  }, [userOverrides, loading]);
  useEffect(() => {
    if (!loading)
      storage
        .set("mrr-v7-acculynx", JSON.stringify(acculynxConfig))
        .catch(() => {});
  }, [acculynxConfig, loading]);

  const pendingReqCount = useMemo(
    () => reqs.filter((r) => r.status === "pending").length,
    [reqs],
  );
  const lowStockCount = useMemo(
    () => inv.filter((i) => tot(i) <= i.alrt).length,
    [inv],
  );
  const newJobsForMe = useMemo(
    () =>
      curUser
        ? jobs.filter((j) => j.newForAssigned && j.assignedTo === curUser.id)
            .length
        : 0,
    [jobs, curUser],
  );
  // Calculate the active company logo asset safely
  const activeLogo = useMemo(() => {
    if (!logos || !Array.isArray(logos)) return null;
    return logos.find((l) => l.isActive)?.data || null;
  }, [logos]);

  // Compute effective permission matrices using role blocks and active overrides
  const userPerms = useMemo(() => {
    if (!curUser) return {};
    return getEffectivePerms(curUser, rolePerms, userOverrides);
  }, [curUser, rolePerms, userOverrides]);

  // ── AUTOMATED BACKGROUND OFFLINE QUEUE PROCESSOR ──
  useEffect(() => {
    const handleReconnect = () => {
      // Trigger execution manifest matching item uploads automatically
      processOfflineQueue(showToast);
    };

    window.addEventListener("online", handleReconnect);
    
    // Check synchronization queue right away on component boot sequence
    if (navigator.onLine) {
      processOfflineQueue(showToast);
    }

    return () => window.removeEventListener("online", handleReconnect);
  }, [showToast]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: C.bg,
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 44 }}>🏠</div>
        <div style={{ color: C.navy, fontWeight: 700, fontSize: 16 }}>
          Loading Maumee River Roofing...
        </div>
      </div>
    );
  }

  if (!curUser) {
    return (
      <LoginScreen
        onLogin={(u) => {
          setCurUser(u);
          setView("dashboard");
        }}
        activeLogo={activeLogo}
      />
    );
  }

  return (
    <IdleTimeoutWrapper
      isAuthenticated={!!curUser}
      onLogout={() => setCurUser(null)}
    >
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: C.bg,
          fontFamily: "'Segoe UI',system-ui,sans-serif",
        }}
      >
        <Sidebar
          cur={view}
          onNav={setView}
          user={curUser}
          onLogout={() => setCurUser(null)}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          pendingReqs={pendingReqCount}
          lowStock={lowStockCount}
          newJobsForMe={newJobsForMe}
          activeLogo={activeLogo}
          perms={userPerms}
        />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <div
            style={{
              background: C.w,
              padding: "0 20px",
              height: 56,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: `1px solid ${C.lg}`, // Fixed 0px to 1px line separation block
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            }}
          >
            {/* Left Text Metadata Header */}
            <div
              style={{
                fontSize: 12,
                color: C.sub,
                flexShrink: 0,
                marginRight: 24,
              }}
            >
              Maumee River Roofing · Saint Joe Road Warehouse
            </div>

            {/* Centralized OmniSearch Navigation Panel Wrapper */}
            <div
              style={{
                flex: 1,
                maxWidth: "400px",
                display: "flex",
                justifyContent: "flex-start",
                paddingRight: "40px",
              }}
            >
              <OmniSearch
                jobs={jobs}
                inv={inv}
                vehs={vehs}
                onNavigate={setView}
              />
            </div>

            {/* Right Action Alert Badges Panel */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12, // Increased gap slightly to accommodate status indicator badge spacing
                flexShrink: 0,
                marginLeft: 24,
              }}
            >
              {/* ── ✅ INJECTED STATUS INDICATOR PRIMITIVE HERE ── */}
              <SyncIndicator />

              {newJobsForMe > 0 && (
                <div
                  onClick={() => setView("pull")}
                  style={{
                    background: C.tB,
                    color: C.tl,
                    borderRadius: 20,
                    padding: "3px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  🎉 {newJobsForMe} new job{newJobsForMe !== 1 ? "s" : ""}
                </div>
              )}
              {pendingReqCount > 0 && userPerms.maint_manage && (
                <div
                  onClick={() => setView("requests")}
                  style={{
                    background: C.pB,
                    color: C.pu,
                    borderRadius: 20,
                    padding: "3px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  🔧 {pendingReqCount} pending
                </div>
              )}
              {lowStockCount > 0 && userPerms.inv_view && (
                <div
                  onClick={() => setView("inventory")}
                  style={{
                    background: C.aB,
                    color: C.am,
                    borderRadius: 20,
                    padding: "3px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ⚠️ {lowStockCount} low stock
                </div>
              )}
              <RoleBdg role={curUser.role} />
            </div>
          </div>
          
          {/* Main Content Layout Route Multi-view Panel */}
          <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
            {view === "dashboard" && (
              <DashboardView
                inv={inv}
                vehs={vehs}
                reqs={reqs}
                jobs={jobs}
                users={users}
                user={curUser}
                perms={userPerms}
                onNav={setView}
                tot={tot}
                jSC={jSC}
              />
            )}

            {view === "buildjobs" && userPerms.jobs_build && (
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
                acculynxConfig={acculynxConfig}
              />
            )}

            {view === "pull" && (
              <PullInventoryView
                jobs={jobs}
                setJobs={setJobs}
                inv={inv}
                setInv={setInv}
                users={users}
                user={curUser}
                perms={userPerms}
                activeLogo={activeLogo}
                acculynxConfig={acculynxConfig}
                jSC={jSC}
              />
            )}
            {view === "inventory" && userPerms.inv_view && (
              <InventoryView
                inv={inv}
                setInv={setInv}
                users={users}
                user={curUser}
                perms={userPerms}
                invPhotos={invPhotos}
                setInvPhotos={setInvPhotos}
              />
            )}

            {view === "fleet" && userPerms.fleet_view && (
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
            )}

            {view === "requests" &&
              (userPerms.maint_submit || userPerms.maint_manage) && (
                <MaintenanceRequestsView
                  reqs={reqs}
                  setReqs={setReqs}
                  vehs={vehs}
                  users={users}
                  user={curUser}
                  perms={userPerms}
                />
              )}

            {view === "reports" && userPerms.reports_view && (
              <ReportsView
                jobs={jobs}
                users={users}
                user={curUser}
                perms={userPerms}
                inv={inv}
                vehs={vehs}
                reqs={reqs}
              />
            )}

            {view === "users" && userPerms.users_manage && (
              <UserManagementView
                users={users}
                setUsers={setUsers}
                currentUser={curUser}
                rolePerms={rolePerms}
                userOverrides={userOverrides}
                setUserOverrides={setUserOverrides}
              />
            )}
            {view === "settings" && userPerms.settings_manage && (
              <SettingsView
                warehouses={warehouses}
                setWarehouses={setWH}
                logos={logos}
                setLogos={setLogos}
                rolePerms={rolePerms}
                setRolePerms={setRolePerms}
                acculynxConfig={acculynxConfig}
                setAccuLynxConfig={setAccuLynxConfig}
              />
            )}
            {view === "profile" && (
              <ProfileView user={curUser} onUpdateUser={setCurUser} />
            )}
            {view === "logs" && userPerms.users_manage && (
              <AuditLogView perms={userPerms} />
            )}
          </div>
        </div>
      </div>
    </IdleTimeoutWrapper>
  );
}