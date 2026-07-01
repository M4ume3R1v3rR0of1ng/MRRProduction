// src/views/DashboardView.jsx
import { useState, useEffect } from "react"; 
import { C, displayName } from "../utils/helpers";
import { Bdg, Btn, Modal } from "../components/UIPrimitives"; 
import TeamChatBox from "../components/TeamChatBox";
import { supabase } from "../utils/supabase"; 
import { translations } from "../utils/translations";

export default function DashboardView({
  inv,
  vehs,
  reqs,
  jobs,
  users,
  user,
  perms,
  onNav,
  tot,
  jSC,
  setJobs, 
  lang = "en"
}) {
  const t = translations[lang] || translations.en;
  const low = inv.filter((i) => tot(i) <= i.alrt);
  const pendingReqs = reqs.filter((r) => r.status === "pending");
  
  const myJobs = jobs.filter((j) => (j.assignedto === user.id || j.assignedTo === user.id) && j.status !== "completed");
  const newJobs = myJobs.filter((j) => j.newforassigned || j.newForAssigned);

  const [newJobAlert, setNewJobAlert] = useState(null);

  useEffect(() => {
    if (newJobs.length > 0 && !newJobAlert) {
      setNewJobAlert(newJobs[0]); 
    }
  }, [jobs, newJobs, newJobAlert]);

  const acknowledgeJob = async () => {
    if (!newJobAlert) return;
    try {
      const { error } = await supabase
        .from("jobs")
        .update({ newforassigned: false, newForAssigned: false })
        .eq("id", newJobAlert.id);

      if (error) throw error;

      if (setJobs) {
        setJobs((p) =>
          p.map((j) => (j.id === newJobAlert.id ? { ...j, newforassigned: false, newForAssigned: false } : j))
        );
      }
      setNewJobAlert(null);
    } catch (err) {
      console.error("Failed to dismiss supervisor project warning banner:", err);
    }
  };
  
  // Reusable Metric Card Primitive
  const SC = ({ label, value, color, icon, onClick, sub }) => (
    <div
      onClick={onClick}
      style={{
        background: C.w,
        borderRadius: 12,
        padding: 14,
        cursor: onClick ? "pointer" : "default",
        borderLeft: `5px solid ${color}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
        flex: 1,
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>{label}</div>
      {sub && (
        <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );

  // Reusable Large Quick Action Card Primitive
  const QuickActionCard = ({ title, subtitle, icon, color, onClick }) => (
    <div
      onClick={onClick}
      style={{
        background: C.w,
        borderRadius: 12,
        padding: "16px 20px",
        cursor: "pointer",
        boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
        border: "1px solid #e2e8f0",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flex: "1 1 220px",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 6px 16px rgba(15, 23, 42, 0.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(15, 23, 42, 0.05)";
      }}
    >
      <div style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        background: `${color}15`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 22,
        flexShrink: 0
      }}>
        {icon}
      </div>
      <div style={{ textAlign: "left" }}>
        <div style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>{title}</div>
        <div style={{ color: C.sub, fontSize: 11, marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t.goodMorning : hour < 17 ? t.goodAfternoon : t.goodEvening;

  // ── 🔨 LAYOUT 1: FIELD WORKER PORTAL ──
  const renderFieldDashboard = () => {
    const myVehicle = vehs.find((v) => v.assigned_to_id === user.id || v.assigned_to === user.name);
    const myOpenTickets = reqs.filter((r) => r.submitted_by === user.name && r.status === "pending");

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SC label={t.myAssignedJobs} value={myJobs.length} color={C.tl} icon="📋" onClick={() => onNav("pull")} />
          <SC label={t.activeBuilds} value={myJobs.filter((j) => j.status === "active").length} color={C.am} icon="🔄" onClick={() => onNav("pull")} />
          <SC label={t.myOpenTickets} value={myOpenTickets.length} color={C.pu} icon="🔧" onClick={() => onNav("requests")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>📅 {t.activeAgenda}</h3>
              {myJobs.length === 0 ? (
                <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>{t.noJobs}</p>
              ) : (
                myJobs.map((j) => (
                  <div key={j.id} style={{ padding: "10px", background: C.lg, borderRadius: 8, marginBottom: 6, fontSize: 12, borderLeft: `3px solid ${C.tl}` }}>
                    <div style={{ fontWeight: 700, color: C.navy }}>{j.title || j.name}</div>
                    <div style={{ color: C.sub, fontSize: 10, marginTop: 2 }}>📍 {j.addr || j.address}</div>
                  </div>
                ))
              )}
            </div>

            <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>🚛 {t.assignedTruck}</h3>
              {myVehicle ? (
                <div style={{ background: C.w, padding: 16, borderRadius: 12, boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, textTransform: "uppercase", marginBottom: 4 }}>
                    {t.assignedTruck}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>
                    {myVehicle.make} {myVehicle.model}
                  </div>
                  <div style={{ fontSize: 13, color: C.blue, fontWeight: 700, marginTop: 2 }}>
                    Plate ID: {myVehicle.plates || "No Plate Registered"}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: C.sub, fontStyle: "italic", padding: "12px 0" }}>
                  {t.noTruck}
                </div>
              )}
            </div>
          </div>
          <TeamChatBox user={user} limit={30} />
        </div>
      </div>
    );
  };

  // ── 🏭 LAYOUT 2: WAREHOUSE FULFILLMENT HUB ──
  const renderWarehouseDashboard = () => {
    const pendingPulls = jobs.filter((j) => j.status === "approved" || j.status === "draft");

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SC label={t.lowStockWatch} value={low.length} color={low.length > 0 ? C.rd : C.gr} icon="🚨" onClick={() => onNav("inventory")} />
          <SC label={t.stagedOrders} value={pendingPulls.length} color={C.blue} icon="📦" onClick={() => onNav("pull")} />
          <SC label={t.myOpenTickets} value={pendingReqs.length} color={C.pu} icon="🔧" onClick={() => onNav("requests")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>🚨 {t.lowStockWatch}</h3>
              {low.length === 0 ? (
                <p style={{ color: C.gr, fontSize: 12, margin: 0 }}>✅ {t.allStockSafe}</p>
              ) : (
                low.slice(0, 4).map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(242, 119, 119, 0.15)", borderRadius: 8, marginBottom: 6, fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: C.navy }}>{item.name}</span>
                    <span style={{ color: C.rd, fontWeight: 800 }}>{tot(item)} {item.unit}</span>
                  </div>
                ))
              )}
            </div>

            <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>📦 {t.stagedOrders}</h3>
              {pendingPulls.slice(0, 4).map((p) => (
                <div key={p.id} onClick={() => onNav("pull")} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: C.lg, borderRadius: 7, marginBottom: 6, fontSize: 12, cursor: "pointer" }}>
                  <span style={{ fontWeight: 700, color: C.navy }}>{p.title || p.name}</span>
                  <Bdg color={p.status === "approved" ? "blue" : "gray"}>{p.status.toUpperCase()}</Bdg>
                </div>
              ))}
            </div>
          </div>
          <TeamChatBox user={user} limit={30} />
        </div>
      </div>
    );
  };

  // ── 📊 LAYOUT 3: MANAGEMENT COMMAND CENTRE ──
  const renderManagerDashboard = () => {
    const activeJobsList = jobs.filter((j) => j.status === "active");
    const deadlinedTrucks = vehs.filter((v) => v.status === "maintenance" || v.status === "down");
    const totalInventoryCost = inv.reduce((sum, item) => sum + tot(item) * (item.cost || 0), 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SC label={t.activeProjects} value={activeJobsList.length} color={C.am} icon="🔄" onClick={() => onNav("pull")} />
          <SC label={t.fleetDisruptions} value={deadlinedTrucks.length} color={deadlinedTrucks.length > 0 ? C.rd : C.gr} icon="🚛" onClick={() => onNav("fleet")} />
          <SC label={t.holdingValuation} value={`$${Math.round(totalInventoryCost).toLocaleString()}`} color={C.blue} icon="💰" onClick={() => onNav("reports")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>📋 {t.masterPipeline}</h3>
              {jobs.filter((j) => j.status !== "completed").slice(0, 4).map((j) => {
                const sup = users.find((u) => u.id === j.assignedto || u.id === j.assignedTo);
                const st = jSC[j.status] || { c: "gray", l: j.status };
                return (
                  <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: C.lg, borderRadius: 7, marginBottom: 6, fontSize: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: C.navy }}>{j.title || j.name}</div>
                      <div style={{ color: C.sub, fontSize: 10 }}>{j.po || t.noPO}{sup ? ` · ${sup.full_name || sup.name}` : ""}</div>
                    </div>
                    <Bdg color={st.c}>{st.l}</Bdg>
                  </div>
                );
              })}
            </div>
          </div>
          <TeamChatBox user={user} limit={30} />
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Upper Welcome Context Row */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>
          {greeting}, {displayName(user)}! 👋
        </h1>
        <p style={{ margin: "3px 0 0", color: C.sub, fontSize: 12 }}>
          Saint Joe Road Warehouse ·{" "}
          {new Date().toLocaleDateString(lang === "es" ? "es-ES" : "en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      {/* Dynamic Security & Alert Banners */}
      {user.role === "field" && newJobs.length > 0 && (
        <div
          onClick={() => onNav("pull")}
          style={{ background: C.tB, border: `2px solid ${C.tl}`, borderRadius: 10, padding: "12px 16px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        >
          <div style={{ fontWeight: 700, color: C.tl, fontSize: 13 }}>
            🎉 {newJobs.length} {t.newAssignments}
          </div>
          <Btn v="teal" sz="sm">{t.view} →</Btn>
        </div>
      )}
      {perms.maint_manage && pendingReqs.length > 0 && (
        <div
          onClick={() => onNav("requests")}
          style={{ background: C.pB, border: `2px solid ${C.pu}`, borderRadius: 10, padding: "12px 16px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        >
          <div style={{ fontWeight: 700, color: C.pu, fontSize: 13 }}>
            🔔 {pendingReqs.length} {t.pendingMaint}
          </div>
          <Btn v="purple" sz="sm">{t.view} →</Btn>
        </div>
      )}
      {low.length > 0 && (
        <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.am, fontWeight: 600 }}>
          ⚠️ {low.length} {t.lowStockAlert}
        </div>
      )}

      {/* Quick Action Grid Panel */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20, width: "100%" }}>
        <QuickActionCard 
          title={t.pull} 
          subtitle={lang === "es" ? "Preparar materiales para cargar" : "Stage materials for loading"} 
          icon="📦" 
          color="#3b82f6" 
          onClick={() => onNav("pull")} 
        />
        <QuickActionCard 
          title={t.requests} 
          subtitle={lang === "es" ? "Enviar registro de mantenimiento" : "Submit vehicle maintenance"} 
          icon="🔧" 
          color="#a855f7" 
          onClick={() => onNav("requests")} 
        />
        <QuickActionCard 
          title={t.myAssignedJobs} 
          subtitle={lang === "es" ? "Ver lista de trabajos asignados" : "Check assigned work lists"} 
          icon="📋" 
          color="#14b8a6" 
          onClick={() => onNav("pull")} 
        />
        <QuickActionCard 
          title={t.fleet} 
          subtitle={lang === "es" ? "Reportar herramientas o vehículos dañados" : "Flag down tools or fleet assets"} 
          icon="⚠️" 
          color="#f43f5e" 
          onClick={() => onNav("fleet")} 
        />
      </div>

      {/* Core Evaluation Router Branch */}
      {(() => {
        if (perms.settings_manage || user.role === "manager" || user.role === "admin" || user.role === "coordinator") {
          return renderManagerDashboard();
        }
        if (perms.inv_view && (user.role === "warehouse" || user.role === "inventory")) {
          return renderWarehouseDashboard();
        }
        return renderFieldDashboard();
      })()}
      
      {/* Live Assignment Modal Overlay */}
      {newJobAlert && (
        <Modal title={`🚨 ${t.newAssignments}`} onClose={() => {}} disableCloseButton>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>🏗️</div>
            <h3 style={{ margin: "0 0 6px 0", color: C.navy, fontWeight: 900, fontSize: 16 }}>
              {newJobAlert.title || newJobAlert.name || "Untitled Production Contract"}
            </h3>
            <p style={{ margin: "0 0 14px 0", color: C.sub, fontSize: 13 }}>
              PO Tracker Number: <strong>{newJobAlert.po || "—"}</strong>
            </p>
            
            <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, textAlign: "left", fontSize: 12, border: `1px solid ${C.bd}`, marginBottom: 16 }}>
              <strong>📍 {lang === "es" ? "Dirección de Despacho" : "Dispatch Address"}:</strong> {newJobAlert.addr || newJobAlert.address || "No Location Specified"}
              {newJobAlert.notes && (
                <div style={{ marginTop: 8, borderTop: `1px dashed ${C.bd}`, paddingTop: 8 }}>
                  <strong>📝 {lang === "es" ? "Instrucciones para la Cuadrilla" : "Crew Instructions"}:</strong> {newJobAlert.notes}
                </div>
              )}
            </div>

            <Btn v="teal" onClick={acknowledgeJob} style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
              {lang === "es" ? "Entendido, Abrir Lista de Materiales →" : "Got It, Open Job Materials Checklist →"}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}