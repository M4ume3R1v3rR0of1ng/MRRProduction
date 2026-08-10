// src/views/ReportsView.jsx
import { useState, useEffect } from "react";
import { supabase, updateRowStrict } from "../utils/supabase";
import { C, fd, fm, tot, newestPrice, todayLocal } from "../utils/helpers";
import { translations } from "../utils/translations";
import { Btn, Sel, Bdg, Inp, Modal, SkeletonTable } from "../components/UIPrimitives"; // Added Modal wrapper primitives
import { useNotify } from "../context/NotificationContext";
// One CSV writer for the app. The local copy this replaced wrapped every field
// in quotes and escaped none of them, so an item like 9" Roller Covers shifted
// every column after it. See utils/csvExport.
import { downloadCSV } from "../utils/csvExport";
import { ACTION_TYPES, logAction } from "../utils/logger";
import {
  actualMaterialCost,
  materialsVariancePct,
  contractValue,
  grossProfit,
  grossMarginPct,
  materialCostRatioPct,
  summarizeJobs,
} from "../utils/jobCosting";

// ── 📊 TREND COMPONENT 1: JOB PROFITABILITY ──
//
// Revenue comes from jobs.contract_value, which a person enters. It used to be
// `estimatedMaterialCost * 3.2`, which made the margin column a constant: any job
// spending its estimate reported 68.75%, and the trophy threshold was 65%. See
// utils/jobCosting for the full account.
//
// A job with no contract value shows "not set" and is excluded from every
// revenue-derived figure. Its material cost is still shown, because that comes
// from the batches and is known either way.
function JobProfitabilityReport({ jobs, setJobs, user, perms, t }) {
  const completedJobs = jobs.filter((j) => j.status === "completed" || j.status === "closed");
  const canSeeRevenue = !!perms?.jobs_revenue;
  const summary = summarizeJobs(completedJobs);
  const { showToast } = useNotify();

  // Contract values are entered right here rather than only in Edit Job.
  // Backfilling history through a modal means opening, typing, saving and closing
  // once per job; this screen is already the list of exactly which jobs are
  // missing one, so it is the right place to fix them.
  const [editingId, setEditingId] = useState(null);
  const [draftValue, setDraftValue] = useState("");
  const [savingId, setSavingId] = useState(null);

  const beginEdit = (job) => {
    setEditingId(job.id);
    setDraftValue(job.contract_value == null ? "" : String(job.contract_value));
  };

  const saveValue = async (job) => {
    const raw = draftValue.trim();
    // Empty clears it back to unpriced, which has to stay possible: a value
    // entered against the wrong job needs an undo that is not "type 0".
    const parsed = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && (!Number.isFinite(parsed) || parsed < 0)) {
      showToast(t.rptContractValueInvalid, "warning");
      return;
    }
    setSavingId(job.id);
    try {
      const { error } = await updateRowStrict("jobs", job.id, { contract_value: parsed });
      if (error) throw error;
      setJobs?.((prev) => prev.map((j) => (j.id === job.id ? { ...j, contract_value: parsed } : j)));
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "JOB_BUILD_EDIT",
        `Set contract value on "${job.title || job.name}" (PO: ${job.po || "n/a"}) to ${parsed === null ? "not set" : parsed}`,
        { job_id: job.id, po: job.po || null, contract_value: parsed },
        "reports",
      );
      setEditingId(null);
    } catch (err) {
      console.error("Failed to save contract value:", err);
      showToast(`${t.rptContractValueFail} ${err.message}`, "error");
    } finally {
      setSavingId(null);
    }
  };

  const topMaterial = (job) => {
    let name = t.rptNone;
    let most = 0;
    (job.items || job.materials || []).forEach((i) => {
      if (!i) return;
      const net = (parseFloat(i.pulled) || 0) - (parseFloat(i.returned) || 0);
      if (net > most) { most = net; name = i.iname + " (" + net + " " + (i.unit || "pcs") + ")"; }
    });
    return name;
  };

  const handleExportExcel = () => {
    if (completedJobs.length === 0) return;
    const headers = [
      "PO Number", "Project Name", "Material Cost", "Materials vs Plan %",
      ...(canSeeRevenue ? ["Contract Value", "Gross Profit (materials only)", "Gross Margin %", "Material Cost % of Contract"] : []),
      "Top Material",
    ];
    const rows = completedJobs.map((j) => {
      const variance = materialsVariancePct(j);
      const profit = grossProfit(j);
      const margin = grossMarginPct(j);
      const ratio = materialCostRatioPct(j);
      return [
        j.po || "",
        j.title || j.name || "",
        actualMaterialCost(j).toFixed(2),
        // Blank, not 0 — an unplanned job has no baseline to vary from.
        variance === null ? "" : variance.toFixed(1),
        ...(canSeeRevenue ? [
          contractValue(j) ?? "",
          profit === null ? "" : profit.toFixed(2),
          margin === null ? "" : margin.toFixed(1),
          ratio === null ? "" : ratio.toFixed(1),
        ] : []),
        topMaterial(j),
      ];
    });
    downloadCSV("mrr-job-profitability-" + todayLocal() + ".csv", headers, rows);
  };

  const cell = { padding: "10px 12px" };
  const notSet = <span style={{ color: C.sub, fontStyle: "italic" }}>{t.rptNotSet}</span>;

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: "var(--space-4)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>{t.rptJobProfTitle}</h2>
        <Btn v="green" sz="sm" onClick={handleExportExcel}>{t.rptExportProfitability}</Btn>
      </div>

      {/* Two disclosures the old report needed and never carried. Neither is
          decoration: without the first, margin reads as whole-job profit; without
          the second, an owner assumes the total covers every job. */}
      <div style={{ background: C.aB, border: "1.5px solid " + C.am, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.navy, lineHeight: 1.5 }}>
        ⚠️ {t.rptMaterialsOnlyNote}
      </div>

      {canSeeRevenue && summary.unpricedCount > 0 && (
        <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.sub }}>
          {t.rptUnpricedNote.replace("{n}", summary.unpricedCount).replace("{total}", summary.jobCount)}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)" }}>
          <thead>
            <tr style={{ background: C.lg }}>
              {[
                t.rptColPO, t.rptColProject, t.rptColRealizedCost, t.rptColMaterialsVsPlan,
                ...(canSeeRevenue ? [t.rptColContractValue, t.rptColGrossProfit, t.rptColGrossMargin] : []),
                t.rptColPrimaryMaterial,
              ].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {completedJobs.map((job) => {
              const variance = materialsVariancePct(job);
              const revenue = contractValue(job);
              const profit = grossProfit(job);
              const margin = grossMarginPct(job);
              return (
                <tr key={job.id} style={{ borderBottom: "1px solid " + C.lg }}>
                  <td style={{ ...cell, fontWeight: "var(--weight-bold)" }}>{job.po}</td>
                  <td style={cell}>{job.title || job.name}</td>
                  <td style={{ ...cell, color: C.navy }}>{fm(actualMaterialCost(job))}</td>
                  <td style={cell}>
                    {variance === null ? notSet : (
                      <Bdg color={variance > 10 ? "red" : variance > 0 ? "amber" : "green"}>
                        {variance > 0 ? "+" : ""}{variance.toFixed(1)}%
                      </Bdg>
                    )}
                  </td>
                  {canSeeRevenue && (
                    <>
                      <td style={{ ...cell, color: C.sub }}>
                        {editingId === job.id ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <Inp
                              type="number"
                              step="0.01"
                              min="0"
                              autoFocus
                              value={draftValue}
                              onChange={(e) => setDraftValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveValue(job);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              style={{ width: 110, padding: "4px 8px" }}
                              disabled={savingId === job.id}
                            />
                            <Btn v="primary" sz="sm" onClick={() => saveValue(job)} disabled={savingId === job.id}>
                              {savingId === job.id ? "..." : "✓"}
                            </Btn>
                            <Btn v="ghost" sz="sm" onClick={() => setEditingId(null)} disabled={savingId === job.id}>✕</Btn>
                          </div>
                        ) : (
                          <button
                            onClick={() => beginEdit(job)}
                            title={t.rptSetContractValue}
                            style={{
                              background: "none",
                              border: revenue === null ? `1px dashed ${C.am}` : "none",
                              borderRadius: "var(--radius-sm)",
                              padding: revenue === null ? "2px 8px" : 0,
                              cursor: "pointer",
                              font: "inherit",
                              color: revenue === null ? C.am : C.navy,
                            }}
                          >
                            {revenue === null ? `+ ${t.rptNotSet}` : fm(revenue)}
                          </button>
                        )}
                      </td>
                      <td style={{ ...cell, color: profit === null ? C.sub : profit < 0 ? C.rd : C.gr, fontWeight: "var(--weight-bold)" }}>
                        {profit === null ? notSet : fm(profit)}
                      </td>
                      <td style={cell}>
                        {margin === null ? notSet : (
                          <Bdg color={margin < 0 ? "red" : margin < 40 ? "amber" : "green"}>{margin.toFixed(1)}%</Bdg>
                        )}
                      </td>
                    </>
                  )}
                  <td style={{ ...cell, fontSize: "var(--text-sm)", color: C.blue, fontWeight: "var(--weight-semibold)" }}>{topMaterial(job)}</td>
                </tr>
              );
            })}
            {completedJobs.length === 0 && (
              <tr><td colSpan={canSeeRevenue ? 8 : 5} style={{ padding: 24, textAlign: "center", color: C.sub }}>{t.rptNoCompletedLines}</td></tr>
            )}
          </tbody>
          {completedJobs.length > 0 && (
            <tfoot>
              <tr style={{ background: "rgba(15, 23, 42, 0.05)" }}>
                <td colSpan={2} style={{ ...cell, fontWeight: "var(--weight-extrabold)", color: C.navy }}>
                  {t.rptTotalsAcross.replace("{n}", canSeeRevenue ? summary.pricedCount : summary.jobCount)}
                </td>
                <td style={{ ...cell, fontWeight: "var(--weight-bold)" }}>
                  {fm(canSeeRevenue ? summary.materialCostOfPriced : summary.materialCost)}
                </td>
                <td style={cell} />
                {canSeeRevenue && (
                  <>
                    <td style={{ ...cell, fontWeight: "var(--weight-bold)" }}>{fm(summary.revenue)}</td>
                    <td style={{ ...cell, fontWeight: "var(--weight-black)", color: summary.grossProfit === null ? C.sub : summary.grossProfit < 0 ? C.rd : C.gr }}>
                      {summary.grossProfit === null ? notSet : fm(summary.grossProfit)}
                    </td>
                    <td style={{ ...cell, fontWeight: "var(--weight-bold)" }}>
                      {summary.grossMarginPct === null ? notSet : summary.grossMarginPct.toFixed(1) + "%"}
                    </td>
                  </>
                )}
                <td style={cell} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── 🏭 TREND COMPONENT 2: INVENTORY STOCK COSTING TRENDS ──
function InventoryCostTrendsReport({ inv, t }) {
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
      r.name || "",
      r.averageBatchCost.toFixed(2),
      r.currentPrice.toFixed(2),
      r.trendDirection,
      r.warehouseAssetCapital.toFixed(2)
    ]);

    downloadCSV(`mrr-inventory-cost-trends-${todayLocal()}.csv`, headers, csvRows);
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: "var(--space-4)" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>{t.rptInvTrendsTitle}</h2>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 8 }}>
            {[["all", t.rptAllTrends], ["rising", t.rptCostIncreasing], ["dropping", t.rptSavingsTraps]].map(([k, l]) => (
              <Btn key={k} v={trendFilter === k ? "primary" : "ghost"} sz="sm" onClick={() => setTrendFilter(k)}>{l}</Btn>
            ))}
          </div>
        </div>
        <Btn v="green" sz="sm" onClick={handleExportInventoryCSV}>{t.rptExportCostTrends}</Btn>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)" }}>
          <thead>
            <tr style={{ background: C.lg }}>
              {[t.rptColMaterialProfile, t.rptColCategoryGroup, t.rptColStockAvailable, t.rptColHistoricalMean, t.rptColRecentInvoice, t.rptColPriceVector, t.rptColFifoAsset].map((h) => (
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
                  <Bdg color={item.trendColor}>{{ "Stable": t.rptStable, "Inflationary 📈": t.rptInflationary, "Deflationary 📉": t.rptDeflationary }[item.trendDirection] || item.trendDirection}</Bdg>
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
function FleetCostTrendsReport({ vehs, reqs, t, companyId }) {
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
          .eq("company_id", companyId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        setInspections(data || []);
      } catch (err) {
        console.error("Failed syncing condition history reports:", err);
        showToast(t.rptInspLoadFail, "warning");
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
      `${v.yr || ""} ${v.make || ""} ${v.name || ""}`.trim(),
      v.plates || v.plate || "",
      v.serviceLogsCount,
      v.totalRepairInvestment.toFixed(2),
      v.vehicleRiskLevel
    ]);

    downloadCSV(`mrr-fleet-depreciation-ledger-${todayLocal()}.csv`, headers, csvRows);
  };

const handleDeleteInspection = async (id, vehicleName) => {
  if (!window.confirm(t.rptDeleteInspConfirm.replace("{name}", vehicleName))) return;
  try {
    const { error } = await supabase
      .from("vehicle_inspections")
      .delete()
      .eq("id", id);
    if (error) throw error;
    setInspections((prev) => prev.filter((log) => log.id !== id));
    showToast(t.rptInspDeleted, "success");
  } catch (err) {
    console.error("Failed to delete inspection:", err);
    showToast(`${t.rptInspDeleteErr} ${err.message}`, "error");
  }
};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      {/* UPPER REVENUE METER LEVEL */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-7)" }}>
        
        {/* PANEL A */}
        <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "var(--text-md)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>{t.rptExpenseBurn}</h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "var(--text-xs)", color: C.sub }}>{t.rptExpenseBurnDesc}</p>
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
          <h3 style={{ margin: "0 0 4px 0", fontSize: "var(--text-md)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>{t.rptComplianceMonitor}</h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "var(--text-xs)", color: C.sub }}>{t.rptComplianceDesc}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxHeight: 180, overflowY: "auto" }}>
            {fleetMetrics.filter(v => v.isOilOverdue || v.isDetailOverdue).map((v) => (
              <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.lg, padding: "8px 12px", borderRadius: "var(--radius-md)" }}>
                <div>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy }}>{v.make} {v.name}</div>
                  <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 2 }}>{t.rptOdo} {v.currentMileage.toLocaleString()} mi</div>
                </div>
                <div style={{ display: "flex", gap: "var(--space-1)" }}>
                  {v.isOilOverdue && <Bdg color="red">{t.rptOilOverdue}</Bdg>}
                  {v.isDetailOverdue && <Bdg color="amber">{t.rptDetailing}</Bdg>}
                </div>
              </div>
            ))}
            {fleetMetrics.filter(v => v.isOilOverdue || v.isDetailOverdue).length === 0 && (
              <div style={{ textAlign: "center", color: C.gr, fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", padding: "20px 0" }}>{t.rptAllCompliant}</div>
            )}
          </div>
        </div>
      </div>

      {/* DETAILED LEDGER GRID */}
      <div style={{ background: C.w, padding: 20, borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>{t.rptFleetLedgerTitle}</h2>
          <Btn v="green" sz="sm" onClick={handleExportFleetCSV}>{t.rptExportFleet}</Btn>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)" }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {[t.rptColVehicleId, t.rptColAssetClass, t.rptColPlateId, t.rptColResolvedRequests, t.rptColCumulativeCost, t.rptColWarningIndex].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fleetMetrics.map((v) => (
                <tr key={v.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                  <td style={{ padding: "10px 12px", fontWeight: "var(--weight-bold)", color: C.navy }}>
                    {v.name || t.rptFleetTruck} <span style={{ fontWeight: "var(--weight-normal)", color: C.sub, fontSize: "var(--text-xs)" }}>{v.yr} {v.make}</span>
                  </td>
                  <td style={{ padding: "10px 12px", textTransform: "capitalize" }}>{v.type}</td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: C.sub }}>{v.plates || v.plate || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{v.serviceLogsCount} {t.rptResolvedRepairs}</td>
                  <td style={{ padding: "10px 12px", fontWeight: "var(--weight-bold)", color: v.totalRepairInvestment > 0 ? C.navy : C.sub }}>
                    {v.totalRepairInvestment > 0 ? fm(v.totalRepairInvestment) : "—"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <Bdg color={v.riskColor}>{{ "Optimal Operating Level": t.rptOptimal, "High Cost Center 🚨": t.rptHighCost, "Elevated Lifecycle Wear ⚠️": t.rptElevatedWear }[v.vehicleRiskLevel] || v.vehicleRiskLevel}</Bdg>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "rgba(15, 23, 42, 0.05)" }}>
                <td colSpan={4} style={{ padding: "12px", fontWeight: "var(--weight-extrabold)", color: C.navy }}>{t.rptSumTotalFleet}</td>
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
        <h3 style={{ margin: "0 0 4px 0", fontSize: 15, fontWeight: "var(--weight-extrabold)", color: C.navy }}>{t.rptInspLogsTitle}</h3>
        <p style={{ margin: "0 0 16px 0", fontSize: "var(--text-sm)", color: C.sub }}>{t.rptInspLogsDesc}</p>

        {loadingInspect ? (
          <SkeletonTable rows={5} cols={["30%", "22%", "18%", "30%"]} label={t.rptStreamingMetrics} />
        ) : inspections.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: C.sub, fontSize: "var(--text-base)", background: C.lg, borderRadius: "var(--radius-md)" }}>{t.rptNoInspections}</div>
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
                  background: "var(--c-subtle)", 
                  borderRadius: "var(--radius-lg)", 
                  padding: 14, 
                  borderLeft: `4px solid ${log.photos?.length > 0 ? "var(--c-slate)" : "var(--c-line)"}`,
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
                  <p style={{ margin: "0 0 6px 0", fontSize: "var(--text-base)", color: "var(--c-barnwood)", lineHeight: 1.4 }}>
                    {log.notes || <span style={{ fontStyle: "italic", color: C.sub }}>{t.rptNoNotes}</span>}
                  </p>
                  <div style={{ fontSize: "var(--text-xs)", color: C.sub, fontWeight: "var(--weight-semibold)" }}>
                    {t.rptInspector} <span style={{ color: C.navy }}>{log.inspector_name}</span>
                  </div>
                </div>

                {/* Picture Array Thumbnails Box */}
                {log.photos && log.photos.length > 0 && (
                  <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    {log.photos.map((pic, idx) => (
                      <img
                        key={idx}
                        src={pic}
                        alt={t.rptInspThumbAlt}
                        onClick={() => setLightboxPic(pic)}
                        style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", objectFit: "cover", cursor: "pointer", border: "1px solid var(--c-line)" }}
                        title={t.rptExpandImage}
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
                  title={t.rptDeleteInspTitle}
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
        <Modal title={t.rptFullResTitle} onClose={() => setLightboxPic(null)} wide>
          <div style={{ textAlign: "center", padding: 4 }}>
            <img src={lightboxPic} alt={t.rptCondFullView} style={{ maxWidth: "100%", maxHeight: "68vh", borderRadius: "var(--radius-md)", objectFit: "contain", background: "#000" }} />
            <Btn v="primary" style={{ width: "100%", marginTop: 12, justifyContent: "center" }} onClick={() => setLightboxPic(null)}>{t.rptCloseReview}</Btn>
          </div>
        </Modal>
      )}

    </div>
  );
}

// ── 🔒 HISTORICAL SYSTEM AUDIT LEDGER ──
function AuditTrailReport({ t, companyId }) {
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
          .eq("company_id", companyId)
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
      formatFullTimestamp(l.created_at),
      l.user_email || "",
      l.action_type || "",
      l.description || ""
    ]);

    downloadCSV(`mrr-system-audit-trail-${todayLocal()}.csv`, headers, csvRows);
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: "var(--space-4)" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>{t.rptAuditTitle}</h2>
          <div style={{ marginTop: 8 }}>
            <Sel value={actionTypeFilter} onChange={(e) => setActionTypeFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: "var(--text-sm)" }}>
              <option value="all">{t.rptFilterActionAll}</option>
              {/* MAT_RECEIVE and MAINTENANCE were offered here and are written
                  nowhere, so both returned an empty table permanently. Single
                  source in utils/logger now. */}
              {ACTION_TYPES.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </Sel>
          </div>
        </div>
        <Btn v="green" sz="sm" onClick={handleExportAuditExcel}>{t.rptExportAudit}</Btn>
      </div>
      {loading ? (
        <SkeletonTable rows={7} cols={["26%", "20%", "16%", "16%", "22%"]} label={t.rptLoadingAudit} />
      ) : loadError ? (
        <div style={{ background: "var(--c-rust-wash)", border: "1.5px solid var(--c-rust)", borderRadius: "var(--radius-lg)", padding: "20px", textAlign: "center", color: "var(--c-rust)" }}>
          <div style={{ fontWeight: "var(--weight-bold)", marginBottom: 6 }}>{t.rptAuditLoadFailTitle}</div>
          <div style={{ fontSize: "var(--text-sm)", marginBottom: 12 }}>{t.rptAuditLoadFailDesc} ({loadError})</div>
          <Btn v="primary" sz="sm" onClick={() => setRetryTick((prev) => prev + 1)}>{t.rptRetry}</Btn>
        </div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
          <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
            <thead>
              <tr style={{ background: C.lg, position: "sticky", top: 0, zIndex: 1 }}>
                {[t.rptColTimestamp, t.rptColUserEmail, t.rptColActionCode, t.rptColAuditNarrative].map((h) => (
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
  setJobs,
  users = [],
  user,
  perms,
  inv = [],
  vehs = [],
  reqs = [],
  lang,
}) {
  const t = translations[lang] || translations.en;
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
    { id: "Jobs", label: t.rptTabJobs, icon: "📈" },
    { id: "Inventory", label: t.rptTabInventory, icon: "🏭" },
    { id: "Fleet", label: t.rptTabFleet, icon: "🚛" },
    { id: "Audit", label: t.rptTabAudit, icon: "🔒" },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy }}>{t.rptTitle}</h1>
        <p style={{ margin: "3px 0 0", color: C.sub, fontSize: "var(--text-sm)" }}>{t.rptSubtitle}</p>
      </div>

      <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 14, borderLeft: `5px solid ${C.blue}`, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: "var(--text-3xl)", fontWeight: "var(--weight-black)", color: C.blue }}>{jobs.length}</div>
          <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 3 }}>{t.rptTotalPipelines}</div>
        </div>
        <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 14, borderLeft: `5px solid ${C.gr}`, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: "var(--text-3xl)", fontWeight: "var(--weight-black)", color: C.gr }}>{completedJobs.length}</div>
          <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 3 }}>{t.rptFinalizedProjects}</div>
        </div>
        {perms.inv_pricing_view && (
          <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 14, borderLeft: `5px solid ${C.gr}`, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.gr }}>{fm(historicalTotalMaterialSpend)}</div>
            <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 3 }}>{t.rptTotalProcurement}</div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "var(--space-4)", borderBottom: `1px solid ${C.lg}`, paddingBottom: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {tabOptions.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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
                backgroundColor: active ? "var(--c-slate)" : "transparent",
                color: active ? "var(--c-on-accent)" : "var(--c-barnwood)",
                transition: "all 0.2s",
              }}
            >
              <span>{tab.icon}</span> {tab.label}
            </button>
          );
        })}
      </div>

      <div>
        {activeTab === "Jobs" && <JobProfitabilityReport jobs={jobs} setJobs={setJobs} user={user} perms={perms} t={t} />}
        {activeTab === "Inventory" && perms.inv_pricing_view && ( <InventoryCostTrendsReport inv={inv} t={t} /> )}
        {activeTab === "Fleet" && perms.inv_pricing_view && ( <FleetCostTrendsReport vehs={vehs} reqs={reqs} t={t} companyId={user?.companyId} /> )}
        {activeTab === "Audit" && perms.users_manage && <AuditTrailReport t={t} companyId={user?.companyId} />}
      </div>
    </div>
  );
}