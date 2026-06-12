// src/views/DashboardView.jsx
import { C, displayName } from "../utils/helpers";
import { Bdg, Btn } from "../components/UIPrimitives";
import RecentActivityFeed from "../components/RecentActivityFeed";

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
}) {
  const low = inv.filter((i) => tot(i) <= i.alrt);
  const pendingReqs = reqs.filter((r) => r.status === "pending");
  const myJobs = jobs.filter((j) => j.assignedTo === user.id && j.status !== "completed");
  const newJobs = myJobs.filter((j) => j.newForAssigned);

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

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // ── 🔨 LAYOUT 1: FIELD WORKER PORTAL ──
  const renderFieldDashboard = () => {
    const myVehicle = vehs.find((v) => v.assigned_to_id === user.id || v.assigned_to === user.name);
    const myOpenTickets = reqs.filter((r) => r.submitted_by === user.name && r.status === "pending");

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SC label="My Assigned Jobs" value={myJobs.length} color={C.tl} icon="📋" onClick={() => onNav("pull")} />
          <SC label="Active Builds" value={myJobs.filter((j) => j.status === "active").length} color={C.am} icon="🔄" onClick={() => onNav("pull")} />
          <SC label="My Open Tickets" value={myOpenTickets.length} color={C.pu} icon="🔧" onClick={() => onNav("requests")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Today's Agenda Panel */}
            <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>📅 My Active Agenda</h3>
              {myJobs.length === 0 ? (
                <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>No upcoming roof builds assigned to you today.</p>
              ) : (
                myJobs.map((j) => (
                  <div key={j.id} style={{ padding: "10px", background: C.lg, borderRadius: 8, marginBottom: 6, fontSize: 12, borderLeft: `3px solid ${C.tl}` }}>
                    <div style={{ fontWeight: 700, color: C.navy }}>{j.name}</div>
                    <div style={{ color: C.sub, fontSize: 10, marginTop: 2 }}>📍 {j.address}</div>
                  </div>
                ))
              )}
            </div>

            {/* Assigned Truck Panel */}
            <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>🚛 Assigned Fleet Truck</h3>
              {myVehicle ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px", background: C.lg, borderRadius: 8, fontSize: 12 }}>
                  <span style={{ fontSize: 28 }}>🛻</span>
                  <div>
                    <div style={{ fontWeight: 700, color: C.navy }}>{myVehicle.make} {myVehicle.model}</div>
                    <div style={{ color: C.sub, fontSize: 11, marginTop: 1 }}>Plate ID: <strong style={{ color: C.navy }}>{myVehicle.plates}</strong></div>
                  </div>
                </div>
              ) : (
                <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>No company vehicle checked out to you at this branch.</p>
              )}
            </div>
          </div>
          <RecentActivityFeed limit={5} />
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
          <SC label="Low Stock Targets" value={low.length} color={low.length > 0 ? C.rd : C.gr} icon="🚨" onClick={() => onNav("inventory")} />
          <SC label="Pending Order Pulls" value={pendingPulls.length} color={C.blue} icon="📦" onClick={() => onNav("pull")} />
          <SC label="Active Tickets" value={pendingReqs.length} color={C.pu} icon="🔧" onClick={() => onNav("requests")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Critical Watchlist */}
            <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>🚨 Low Stock Watchlist</h3>
              {low.length === 0 ? (
                <p style={{ color: C.gr, fontSize: 12, margin: 0 }}>✅ All material quantities safe.</p>
              ) : (
                low.slice(0, 4).map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(242, 119, 119, 0.15)", borderRadius: 8, marginBottom: 6, fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: C.navy }}>{item.name}</span>
                    <span style={{ color: C.rd, fontWeight: 800 }}>{tot(item)} {item.unit}</span>
                  </div>
                ))
              )}
            </div>

            {/* Pending Loads Pull Panel */}
            <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>📦 Staged Loading Orders</h3>
              {pendingPulls.slice(0, 4).map((p) => (
                <div key={p.id} onClick={() => onNav("pull")} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: C.lg, borderRadius: 7, marginBottom: 6, fontSize: 12, cursor: "pointer" }}>
                  <span style={{ fontWeight: 700, color: C.navy }}>{p.name}</span>
                  <Bdg color={p.status === "approved" ? "blue" : "gray"}>{p.status.toUpperCase()}</Bdg>
                </div>
              ))}
            </div>
          </div>
          <RecentActivityFeed limit={5} />
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
          <SC label="Active Projects" value={activeJobsList.length} color={C.am} icon="🔄" onClick={() => onNav("pull")} />
          <SC label="Fleet Disruptions" value={deadlinedTrucks.length} color={deadlinedTrucks.length > 0 ? C.rd : C.gr} icon="🚛" onClick={() => onNav("fleet")} />
          <SC label="Holding Valuation" value={`$${Math.round(totalInventoryCost).toLocaleString()}`} color={C.blue} icon="💰" onClick={() => onNav("reports")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Global Job Pipeline */}
            <div style={{ background: C.w, borderRadius: 12, padding: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>📋 Master Contract Pipeline</h3>
              {jobs.filter((j) => j.status !== "completed").slice(0, 4).map((j) => {
                const sup = users.find((u) => u.id === j.assignedTo);
                const st = jSC[j.status] || { c: "gray", l: j.status };
                return (
                  <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: C.lg, borderRadius: 7, marginBottom: 6, fontSize: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: C.navy }}>{j.name}</div>
                      <div style={{ color: C.sub, fontSize: 10 }}>{j.po || "No PO"}{sup ? ` · ${sup.full_name || sup.name}` : ""}</div>
                    </div>
                    <Bdg color={st.c}>{st.l}</Bdg>
                  </div>
                );
              })}
            </div>
          </div>
          <RecentActivityFeed limit={5} />
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Upper Meta Welcome Context Row */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>
          {greeting}, {displayName(user)}! 👋
        </h1>
        <p style={{ margin: "3px 0 0", color: C.sub, fontSize: 12 }}>
          Saint Joe Road Warehouse ·{" "}
          {new Date().toLocaleDateString("en-US", {
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
            🎉 {newJobs.length} new job{newJobs.length !== 1 ? "s" : ""} assigned to you!
          </div>
          <Btn v="teal" sz="sm">View →</Btn>
        </div>
      )}
      {perms.maint_manage && pendingReqs.length > 0 && (
        <div
          onClick={() => onNav("requests")}
          style={{ background: C.pB, border: `2px solid ${C.pu}`, borderRadius: 10, padding: "12px 16px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        >
          <div style={{ fontWeight: 700, color: C.pu, fontSize: 13 }}>
            🔔 {pendingReqs.length} pending maintenance request{pendingReqs.length !== 1 ? "s" : ""}
          </div>
          <Btn v="purple" sz="sm">View →</Btn>
        </div>
      )}
      {low.length > 0 && (
        <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.am, fontWeight: 600 }}>
          ⚠️ {low.length} item(s) at or below low stock threshold.
        </div>
      )}

      {/* ── 🎛️ CORE EVALUATION ROUTER BRANCH ── */}
      {(() => {
        if (perms.settings_manage || user.role === "manager" || user.role === "admin" || user.role === "coordinator") {
          return renderManagerDashboard();
        }
        if (perms.inv_view && (user.role === "warehouse" || user.role === "inventory")) {
          return renderWarehouseDashboard();
        }
        return renderFieldDashboard();
      })()}
    </div>
  );
}