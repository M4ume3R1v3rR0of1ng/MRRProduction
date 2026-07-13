// src/views/ReportsView.jsx
import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";
import { C, fd, fm, tot, newestPrice } from "../utils/helpers";
import { Btn, Sel, Bdg, Modal, LoadingState } from "../components/UIPrimitives"; // Added Modal wrapper primitives
import { useNotify } from "../context/NotificationContext";

// ── 🔄 SHARED NATIVE SPREADSHEET DOWNLOAD ENGINE ──
const triggerNativeDownload = (filename, headers, rows) => {
  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(","))
  ].join("\n");

  try {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error(`Native export stream failed for ${filename}:`, err);
  }
};

// ── 📊 TREND COMPONENT 1: JOB PROFITABILITY & MATERIAL USAGE BY PROJECT ──
function JobProfitabilityReport({ jobs }) {
  const completedJobs = jobs.filter((j) => j.status === "completed" || j.status === "closed");
  
  const handleExportExcel = () => {
    if (completedJobs.length === 0) return;
    const headers = ["PO Number", "Project Name", "Est. Revenue", "Actual Material Cost", "Net Gross Profit", "Gross Margin %", "Top Shipped Material"];
    
    const rows = completedJobs.map((j) => {
      let estCost = 0;
      let actCost = 0;
      let topItemName = "None";
      let maxQty = 0;

      (j.items || j.materials || []).forEach((i) => {
        const fallbackPrice = i.priceAtPull || 0;
        const pulledQty = parseFloat(i.pulled) || 0;
        const returnedQty = parseFloat(i.returned) || 0;
        const netUsed = pulledQty - returnedQty;

        estCost += (parseFloat(i.planned) || 0) * fallbackPrice;
        actCost += netUsed * fallbackPrice;

        if (netUsed > maxQty) {
          maxQty = netUsed;
          topItemName = `${i.iname} (${netUsed} ${i.unit || "pcs"})`;
        }
      });

      const targetRevenue = estCost * 3.2;
      const profit = targetRevenue - actCost;
      const marginPct = targetRevenue > 0 ? ((profit / targetRevenue) * 100).toFixed(1) : "0.0";

      return [
        `"${j.po || ""}"`,
        `"${j.name || ""}"`,
        targetRevenue.toFixed(2),
        actCost.toFixed(2),
        profit.toFixed(2),
        `"${marginPct}%"`,
        `"${topItemName}"`
      ];
    });

    triggerNativeDownload(`mrr-job-profitability-${new Date().toISOString().split("T")[0]}.csv`, headers, rows);
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>📈 Job Profitability & Material Allocation Trends</h2>
        <Btn v="green" sz="sm" onClick={handleExportExcel}>⬇ Export Profitability Excel</Btn>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)" }}>
          <thead>
            <tr style={{ background: C.lg }}>
              {["PO Code", "Project Profile Name", "Estimated Contract Revenue", "Realized Material Cost", "Projected Gross Profit", "Gross Profit Margin", "Primary Material Consumed"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {completedJobs.map((job) => {
              let estCost = 0;
              let actCost = 0;
              let topItemName = "None";
              let maxQty = 0;

              (job.items || job.materials || []).forEach((i) => {
                const price = i.priceAtPull || 0;
                const netUsed = (parseFloat(i.pulled) || 0) - (parseFloat(i.returned) || 0);
                estCost += (parseFloat(i.planned) || 0) * price;
                actCost += netUsed * price;

                if (netUsed > maxQty) {
                  maxQty = netUsed;
                  topItemName = `${i.iname} (${netUsed} ${i.unit})`;
                }
              });

              const revenueVal = estCost * 3.2;
              const grossProfit = revenueVal - actCost;
              const marginPercentage = revenueVal > 0 ? ((grossProfit / revenueVal) * 100).toFixed(1) : "0.0";
              const healthyMargin = parseFloat(marginPercentage) >= 65;

              return (
                <tr key={job.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                  <td style={{ padding: "10px 12px", fontWeight: "var(--weight-bold)" }}>{job.po}</td>
                  <td style={{ padding: "10px 12px" }}>{job.name}</td>
                  <td style={{ padding: "10px 12px", color: C.sub }}>{fm(revenueVal)}</td>
                  <td style={{ padding: "10px 12px", color: C.navy }}>{fm(actCost)}</td>
                  <td style={{ padding: "10px 12px", color: C.gr, fontWeight: "var(--weight-bold)" }}>{fm(grossProfit)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <Bdg color={healthyMargin ? "green" : "amber"}>{marginPercentage}% {healthyMargin ? "🏆" : "⚠️"}</Bdg>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: "var(--text-sm)", color: C.blue, fontWeight: "var(--weight-semibold)" }}>{topItemName}</td>
                </tr>
              );
            })}
            {completedJobs.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: C.sub }}>No completed production lines available.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 🏭 TREND COMPONENT 2: INVENTORY STOCK COSTING TRENDS ──
function InventoryCostTrendsReport({ inv }) {
  const [trendFilter, setTrendFilter] = useState("all");

  const materialsTrendList = inv.map((item) => {
    const totalQtyOnHand = tot(item);
    const pricePoints = item.batches?.map((b) => parseFloat(b.price) || 0) || [];
    const averageBatchCost = pricePoints.length > 0 ? pricePoints.reduce((s, p) => s + p, 0) / pricePoints.length : 0;
    const currentPrice = newestPrice(item);
    
    let trendDirection = "Stable";
    let trendColor = "gray";
    if (currentPrice > averageBatchCost * 1.03) { trendDirection = "Inflationary 📈"; trendColor = "red"; }
    else if (currentPrice < averageBatchCost * 0.97) { trendDirection = "Deflationary 📉"; trendColor = "green"; }

    const warehouseAssetCapital = item.batches?.reduce((s, b) => s + (parseFloat(b.rem) || 0) * (parseFloat(b.price) || 0), 0) || 0;

    return { ...item, totalQtyOnHand, averageBatchCost, currentPrice, trendDirection, trendColor, warehouseAssetCapital };
  });

  const filteredTrends = materialsTrendList.filter((item) => {
    if (trendFilter === "rising") return item.trendDirection.includes("Inflationary");
    if (trendFilter === "dropping") return item.trendDirection.includes("Deflationary");
    return true;
  });

  const handleExportInventoryCSV = () => {
    if (filteredTrends.length === 0) return;
    const headers = ["Material Description", "Historical Avg Cost", "Current Market Cost", "Pricing Trend Status", "Capital Asset Value"];
    
    const csvRows = filteredTrends.map((r) => [
      `"${r.name || ""}"`,
      r.averageBatchCost.toFixed(2),
      r.currentPrice.toFixed(2),
      `"${r.trendDirection}"`,
      r.warehouseAssetCapital.toFixed(2)
    ]);

    triggerNativeDownload(`mrr-inventory-cost-trends-${new Date().toISOString().split("T")[0]}.csv`, headers, csvRows);
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: "var(--space-4)" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>🏭 Structural Vendor Material Cost Trends</h2>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 8 }}>
            {[["all", "All Trends"], ["rising", "⚠️ Cost Increasing"], ["dropping", "📉 Savings Traps"]].map(([k, l]) => (
              <Btn key={k} v={trendFilter === k ? "primary" : "ghost"} sz="sm" onClick={() => setTrendFilter(k)}>{l}</Btn>
            ))}
          </div>
        </div>
        <Btn v="green" sz="sm" onClick={handleExportInventoryCSV}>⬇ Export Cost Trends Excel</Btn>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)" }}>
          <thead>
            <tr style={{ background: C.lg }}>
              {["Material Profile Name", "Category Group", "Stock Available", "Historical Mean Cost", "Most Recent Invoice Price", "Price Fluctuation Vector", "FIFO Asset Holding Cost"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredTrends.map((item) => (
              <tr key={item.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                <td style={{ padding: "10px 12px", fontWeight: "var(--weight-semibold)", color: C.navy }}>{item.name}</td>
                <td style={{ padding: "10px 12px", color: C.sub }}>{item.cat}</td>
                <td style={{ padding: "10px 12px", fontWeight: "var(--weight-bold)" }}>{item.totalQtyOnHand} {item.unit}</td>
                <td style={{ padding: "10px 12px" }}>{fm(item.averageBatchCost)}</td>
                <td style={{ padding: "10px 12px", fontWeight: "var(--weight-semibold)" }}>{fm(item.currentPrice)}</td>
                <td style={{ padding: "10px 12px" }}>
                  <Bdg color={item.trendColor}>{item.trendDirection}</Bdg>
                </td>
                <td style={{ padding: "10px 12px", fontWeight: "var(--weight-bold)", color: C.blue }}>{fm(item.warehouseAssetCapital)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 🚛 TREND COMPONENT 3: FLEET MAINTENANCE COSTS ANALYSIS ──
function FleetCostTrendsReport({ vehs, reqs }) {
  // ── 🟢 NEW: ADD HOOK STATES FOR RUNTIME CONDITION DATA LOADING ──
  const [inspections, setInspections] = useState([]);
  const [loadingInspect, setLoadingInspect] = useState(true);
  const [lightboxPic, setLightboxPic] = useState(null);
  const { showToast } = useNotify();

  useEffect(() => {
    async function getHistory() {
      try {
        const { data, error } = await supabase
          .from("vehicle_inspections")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw error;
        setInspections(data || []);
      } catch (err) {
        console.error("Failed syncing condition history reports:", err);
        showToast("Couldn't load inspection history — the list below may be incomplete. Refresh to retry.", "warning");
      } finally {
        setLoadingInspect(false);
      }
    }
    getHistory();
  }, []);

  const fleetMetrics = vehs.map((v) => {
    const closedTickets = reqs.filter((r) => r.vehicle_id === v.id && r.status === "completed");
    const totalRepairInvestment = closedTickets.reduce((sum, r) => sum + (parseFloat(r.cost) || 0), 0);
    
    let vehicleRiskLevel = "Optimal Operating Level";
    let riskColor = "green";
    if (totalRepairInvestment > 2500) { vehicleRiskLevel = "High Cost Center 🚨"; riskColor = "red"; }
    else if (totalRepairInvestment > 800) { vehicleRiskLevel = "Elevated Lifecycle Wear ⚠️"; riskColor = "amber"; }

    const currentMileage = parseFloat(v.current_mileage) || 0;
    const lastOilMileage = parseFloat(v.last_oil_change_mileage) || 0;
    const isOilOverdue = v.oil_status === "overdue" || (currentMileage > 0 && currentMileage >= (lastOilMileage + 5000));
    const isDetailOverdue = v.detail_status === "overdue";

    return { 
      ...v, 
      totalRepairInvestment, 
      serviceLogsCount: closedTickets.length, 
      vehicleRiskLevel, 
      riskColor,
      isOilOverdue,
      isDetailOverdue,
      currentMileage
    };
  }).sort((a, b) => b.totalRepairInvestment - a.totalRepairInvestment);

  const cumulativeFleetExpenditures = fleetMetrics.reduce((sum, v) => sum + v.totalRepairInvestment, 0);

  const handleExportFleetCSV = () => {
    if (fleetMetrics.length === 0) return;
    const headers = ["Vehicle Description", "Plate Code", "Total Maintenance Action Count", "Cumulative Investment", "Asset Cost Warning Profile"];
    
    const csvRows = fleetMetrics.map((v) => [
      `"${v.yr || ""} ${v.make || ""} ${v.name || ""}"`,
      `"${v.plates || v.plate || ""}"`,
      v.serviceLogsCount,
      v.totalRepairInvestment.toFixed(2),
      `"${v.vehicleRiskLevel}"`
    ]);

    triggerNativeDownload(`mrr-fleet-depreciation-ledger-${new Date().toISOString().split("T")[0]}.csv`, headers, csvRows);
  };

const handleDeleteInspection = async (id, vehicleName) => {
  if (!window.confirm(`Delete inspection record for ${vehicleName}?`)) return;
  try {
    const { error } = await supabase
      .from("vehicle_inspections")
      .delete()
      .eq("id", id);
    if (error) throw error;
    setInspections((prev) => prev.filter((log) => log.id !== id));
    showToast("Inspection record deleted.", "success");
  } catch (err) {
    console.error("Failed to delete inspection:", err);
    showToast(`Database Error: Could not delete inspection. ${err.message}`, "error");
  }
};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      {/* UPPER REVENUE METER LEVEL */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-7)" }}>
        
        {/* PANEL A */}
        <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "var(--text-md)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>📊 Expense Burn Footprint</h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "var(--text-xs)", color: C.sub }}>Relative cost breakdown bar chart scaled against a standard \$2,500 lifecycle tier.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            {fleetMetrics.slice(0, 5).map((v) => {
              const barPercent = Math.min(100, (v.totalRepairInvestment / 2500) * 100);
              return (
                <div key={v.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)", marginBottom: 4 }}>
                    <span style={{ fontWeight: "var(--weight-semibold)", color: C.navy }}>{v.make} {v.name}</span>
                    <span style={{ fontWeight: "var(--weight-bold)" }}>{fm(v.totalRepairInvestment)}</span>
                  </div>
                  <div style={{ width: "100%", height: 6, background: C.lg, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${barPercent}%`, height: "100%", background: v.totalRepairInvestment > 2500 ? C.rd : C.blue, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* PANEL B */}
        <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "var(--text-md)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>🚨 Fleet Maintenance Compliance Monitor</h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "var(--text-xs)", color: C.sub }}>Vehicles requiring mechanical interval adjustments or detailing maintenance sweeps.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxHeight: 180, overflowY: "auto" }}>
            {fleetMetrics.filter(v => v.isOilOverdue || v.isDetailOverdue).map((v) => (
              <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.lg, padding: "8px 12px", borderRadius: "var(--radius-md)" }}>
                <div>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy }}>{v.make} {v.name}</div>
                  <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 2 }}>Odo: {v.currentMileage.toLocaleString()} mi</div>
                </div>
                <div style={{ display: "flex", gap: "var(--space-1)" }}>
                  {v.isOilOverdue && <Bdg color="red">🔧 Oil Overdue</Bdg>}
                  {v.isDetailOverdue && <Bdg color="amber">🧹 Detailing</Bdg>}
                </div>
              </div>
            ))}
            {fleetMetrics.filter(v => v.isOilOverdue || v.isDetailOverdue).length === 0 && (
              <div style={{ textAlign: "center", color: C.gr, fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", padding: "20px 0" }}>✨ All system fleet assets are 100% compliant.</div>
            )}
          </div>
        </div>
      </div>

      {/* DETAILED LEDGER GRID */}
      <div style={{ background: C.w, padding: 20, borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>🚛 Operational Fleet Lifecycle & Maintenance Cost Centers</h2>
          <Btn v="green" sz="sm" onClick={handleExportFleetCSV}>⬇ Export Fleet Analytics</Btn>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)" }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {["Vehicle Fleet Identifier", "Classification Asset Class", "Plate ID", "Resolved Work Requests", "Cumulative Maintenance Cost", "Lifecycle Warning Index"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fleetMetrics.map((v) => (
                <tr key={v.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                  <td style={{ padding: "10px 12px", fontWeight: "var(--weight-bold)", color: C.navy }}>
                    {v.name || "Fleet Truck"} <span style={{ fontWeight: "var(--weight-normal)", color: C.sub, fontSize: "var(--text-xs)" }}>{v.yr} {v.make}</span>
                  </td>
                  <td style={{ padding: "10px 12px", textTransform: "capitalize" }}>{v.type}</td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: C.sub }}>{v.plates || v.plate || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{v.serviceLogsCount} resolved repairs</td>
                  <td style={{ padding: "10px 12px", fontWeight: "var(--weight-bold)", color: v.totalRepairInvestment > 0 ? C.navy : C.sub }}>
                    {v.totalRepairInvestment > 0 ? fm(v.totalRepairInvestment) : "—"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <Bdg color={v.riskColor}>{v.vehicleRiskLevel}</Bdg>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "rgba(15, 23, 42, 0.05)" }}>
                <td colSpan={4} style={{ padding: "12px", fontWeight: "var(--weight-extrabold)", color: C.navy }}>Sum Total Fleet Portfolio Capital Maintenance Expenditures</td>
                <td colSpan={2} style={{ padding: "12px", fontWeight: "var(--weight-black)", color: C.navy, fontSize: 15 }}>{fm(cumulativeFleetExpenditures)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── 🟢 NEW: HISTORICAL VEHICLE INSPECTION LOOPS LIST CANVA PIPELINE ── */}
      <div 
        style={{ 
          background: C.w, 
          padding: 20, 
          borderRadius: "var(--radius-xl)", 
          boxShadow: "var(--shadow-sm)",
          border: `1px solid ${C.lg}`
        }}
      >
        <h3 style={{ margin: "0 0 4px 0", fontSize: 15, fontWeight: "var(--weight-extrabold)", color: C.navy }}>📋 Historical Vehicle Inspection Logs</h3>
        <p style={{ margin: "0 0 16px 0", fontSize: "var(--text-sm)", color: C.sub }}>Condition log packages and provider diagnostic sheets uploaded by department managers.</p>
        
        {loadingInspect ? (
          <LoadingState label="Streaming condition metrics ledger..." />
        ) : inspections.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: C.sub, fontSize: "var(--text-base)", background: C.lg, borderRadius: "var(--radius-md)" }}>No inspection files or reports submitted this period.</div>
        ) : (
          /* ── SCROLL CONTAINER BOUNDARY CONTROLLER ── */
          <div 
            style={{ 
              maxHeight: "380px", 
              overflowY: "auto", 
              display: "flex", 
              flexDirection: "column", 
              gap: "var(--space-4)",
              paddingRight: 4,
              scrollbarWidth: "thin"
            }}
          >
            {inspections.map((log) => (
              <div 
                key={log.id} 
                style={{ 
                  background: "#f8fafc", 
                  borderRadius: "var(--radius-lg)", 
                  padding: 14, 
                  borderLeft: `4px solid ${log.photos?.length > 0 ? "#1b52b8" : "#e2e8f0"}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "var(--space-7)",
                  flexWrap: "wrap"
                }}
              >
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, fontSize: "var(--text-base)" }}>{log.vehicle_name}</span>
                    <span style={{ fontSize: "var(--text-xs)", color: C.sub }}>· {new Date(log.created_at).toLocaleDateString()}</span>
                  </div>
                  <p style={{ margin: "0 0 6px 0", fontSize: "var(--text-base)", color: "#334155", lineHeight: 1.4 }}>
                    {log.notes || <span style={{ fontStyle: "italic", color: C.sub }}>No supplementary text or provider notes attached.</span>}
                  </p>
                  <div style={{ fontSize: "var(--text-xs)", color: C.sub, fontWeight: "var(--weight-semibold)" }}>
                    🕵️‍♂️ Inspector: <span style={{ color: C.navy }}>{log.inspector_name}</span>
                  </div>
                </div>

                {/* Picture Array Thumbnails Box */}
                {log.photos && log.photos.length > 0 && (
                  <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    {log.photos.map((pic, idx) => (
                      <img
                        key={idx}
                        src={pic}
                        alt="Inspection thumbnail proof"
                        onClick={() => setLightboxPic(pic)}
                        style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", objectFit: "cover", cursor: "pointer", border: "1px solid #cbd5e1" }}
                        title="Expand Image"
                      />
                    ))}
                  </div>
                )}

                <button
                  onClick={() => handleDeleteInspection(log.id, log.vehicle_name)}
                  style={{
                    background: "none",
                    border: "none",
                    color: C.rd,
                    cursor: "pointer",
                    fontSize: "var(--text-lg)",
                    padding: "4px 8px",
                    display: "flex",
                    alignItems: "center",
                    transition: "opacity 0.2s"
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
                  title="Permanently delete this inspection record"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>


      {/* Lightbox Canvas Overlay Component */}
      {lightboxPic && (
        <Modal title="🔍 Full Resolution Condition Reference" onClose={() => setLightboxPic(null)} wide>
          <div style={{ textAlign: "center", padding: 4 }}>
            <img src={lightboxPic} alt="Condition full view" style={{ maxWidth: "100%", maxHeight: "68vh", borderRadius: "var(--radius-md)", objectFit: "contain", background: "#000" }} />
            <Btn v="primary" style={{ width: "100%", marginTop: 12, justifyContent: "center" }} onClick={() => setLightboxPic(null)}>Close Screen Review</Btn>
          </div>
        </Modal>
      )}

    </div>
  );
}

// ── 🔒 HISTORICAL SYSTEM AUDIT LEDGER ──
function AuditTrailReport() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed fetch must not render as "no history" — that reads as innocence.
  const [loadError, setLoadError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const [actionTypeFilter, setActionTypeFilter] = useState("all");

  useEffect(() => {
    async function getLogs() {
      setLoading(true);
      setLoadError(null);
      try {
        let query = supabase
          .from("audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);
        if (actionTypeFilter !== "all") {
          query = query.eq("action_type", actionTypeFilter);
        }
        const { data, error } = await query;
        if (error) throw error;
        setLogs(data || []);
      } catch (err) {
        console.error("Failed fetching audit files:", err);
        setLoadError(err.message || "Request failed");
        setLogs([]);
      } finally {
        setLoading(false);
      }
    }
    getLogs();
  }, [actionTypeFilter, retryTick]);

  const formatFullTimestamp = (rawDateString) => {
    if (!rawDateString) return "—";
    const date = new Date(rawDateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const handleExportAuditExcel = () => {
    if (logs.length === 0) return;
    const headers = ["Timestamp Code", "Operator Email", "Action Flag", "Log Description Narrative"];
    
    const csvRows = logs.map((l) => [
      `"${formatFullTimestamp(l.created_at)}"`,
      `"${l.user_email || ""}"`,
      `"${l.action_type || ""}"`,
      `"${l.description || ""}"`
    ]);

    triggerNativeDownload(`mrr-system-audit-trail-${new Date().toISOString().split("T")[0]}.csv`, headers, csvRows);
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: "var(--space-4)" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>🔒 Historical Operations Audit Trail</h2>
          <div style={{ marginTop: 8 }}>
            <Sel value={actionTypeFilter} onChange={(e) => setActionTypeFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: "var(--text-sm)" }}>
              <option value="all">Filter by Action Type (All)</option>
              <option value="INVENTORY_PULL">INVENTORY_PULL</option>
              <option value="PERM_CHANGE">PERM_CHANGE</option>
              <option value="MAT_RECEIVE">MAT_RECEIVE</option>
              <option value="MAINTENANCE">MAINTENANCE</option>
            </Sel>
          </div>
        </div>
        <Btn v="green" sz="sm" onClick={handleExportAuditExcel}>⬇ Export Audit Excel</Btn>
      </div>
      {loading ? (
        <LoadingState label="Loading audit stream records..." />
      ) : loadError ? (
        <div style={{ background: "#fee2e2", border: "1.5px solid #ef4444", borderRadius: "var(--radius-lg)", padding: "20px", textAlign: "center", color: "#991b1b" }}>
          <div style={{ fontWeight: "var(--weight-bold)", marginBottom: 6 }}>⚠️ Couldn't load the audit history</div>
          <div style={{ fontSize: "var(--text-sm)", marginBottom: 12 }}>The trail is NOT empty — it just couldn't be fetched. ({loadError})</div>
          <Btn v="primary" sz="sm" onClick={() => setRetryTick((t) => t + 1)}>🔄 Retry</Btn>
        </div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
          <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
            <thead>
              <tr style={{ background: C.lg, position: "sticky", top: 0, zIndex: 1 }}>
                {["Timestamp", "User Email", "Action Code", "Audit Narrative Description"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)", background: C.lg }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                  <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: C.sub }}>{formatFullTimestamp(log.created_at)}</td>
                  <td style={{ padding: "8px 12px", fontWeight: "var(--weight-semibold)" }}>{log.user_email}</td>
                  <td><Bdg color={log.action_type === "PERM_CHANGE" ? "purple" : "teal"}>{log.action_type}</Bdg></td>
                  <td style={{ padding: "8px 12px", color: C.navy }}>{log.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── MAIN CORE VIEW INTERFACE CONTAINER ──
export default function Reports({
  jobs = [],
  users = [],
  user,
  perms,
  inv = [],
  vehs = [],
  reqs = [],
}) {
  const [activeTab, setActiveTab] = useState("Jobs");
  const completedJobs = jobs.filter((j) => j.status === "completed" || j.status === "closed");

  const historicalTotalMaterialSpend = completedJobs.reduce(
    (s, j) =>
      s +
      (j.items || j.materials || []).reduce(
        (a, i) =>
          a +
          ((parseFloat(i.pulled) || 0) - (parseFloat(i.returned) || 0)) *
            (parseFloat(i.priceAtPull) || 0),
        0,
      ),
    0,
  );

  const tabOptions = [
    { id: "Jobs", label: "Job Profitability Trends", icon: "📈" },
    { id: "Inventory", label: "Inventory Cost Trends", icon: "🏭" },
    { id: "Fleet", label: "Fleet Maintenance Analysis", icon: "🚛" },
    { id: "Audit", label: "System Audit Ledger", icon: "🔒" },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy }}>📊 Corporate Intelligence Trends & Analytics</h1>
        <p style={{ margin: "3px 0 0", color: C.sub, fontSize: "var(--text-sm)" }}>Saint Joe Road Warehouse · Structural Material Gross Margin Auditing</p>
      </div>

      <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 14, borderLeft: `5px solid ${C.blue}`, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: "var(--text-3xl)", fontWeight: "var(--weight-black)", color: C.blue }}>{jobs.length}</div>
          <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 3 }}>Total Pipelines Tracked</div>
        </div>
        <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 14, borderLeft: `5px solid ${C.gr}`, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: "var(--text-3xl)", fontWeight: "var(--weight-black)", color: C.gr }}>{completedJobs.length}</div>
          <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 3 }}>Finalized Projects Built</div>
        </div>
        {perms.inv_pricing_view && (
          <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 14, borderLeft: `5px solid ${C.gr}`, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.gr }}>{fm(historicalTotalMaterialSpend)}</div>
            <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 3 }}>Total Material Procurement Allocation Value</div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "var(--space-4)", borderBottom: `1px solid ${C.lg}`, paddingBottom: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {tabOptions.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "8px 16px",
                borderRadius: 20,
                border: "none",
                fontSize: "var(--text-base)",
                fontWeight: "var(--weight-bold)",
                cursor: "pointer",
                backgroundColor: active ? "#1b52b8" : "transparent",
                color: active ? "#ffffff" : "#475569",
                transition: "all 0.2s",
              }}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          );
        })}
      </div>

      <div>
        {activeTab === "Jobs" && <JobProfitabilityReport jobs={jobs} />}
        {activeTab === "Inventory" && perms.inv_pricing_view && ( <InventoryCostTrendsReport inv={inv} /> )}
        {activeTab === "Fleet" && perms.inv_pricing_view && ( <FleetCostTrendsReport vehs={vehs} reqs={reqs} /> )}
        {activeTab === "Audit" && perms.users_manage && <AuditTrailReport />}
      </div>
    </div>
  );
}