// src/features/reports/ReportsView.jsx
import { useState, useEffect } from "react";
import { TrendingUp, Factory, Truck, Lock, AlertTriangle, Trash2, Download } from "lucide-react";
import { supabase, updateRowStrict } from "@/shared/utils/supabase";
import { C, fm, tot, newestPrice, todayLocal } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import {
  Btn,
  Sel,
  Bdg,
  Inp,
  Modal,
  SkeletonTable,
  PageHeader,
  StatTile,
  CardGrid,
  Row,
  Stack,
  Text,
  Muted,
  Table,
  Callout,
  Card,
  Meter,
  TextBtn,
  Tabs,
} from "@/shared/components/UIPrimitives"; // Added Modal wrapper primitives
import { useNotify } from "@/shared/context/NotificationContext";
// One CSV writer for the app. The local copy this replaced wrapped every field
// in quotes and escaped none of them, so an item like 9" Roller Covers shifted
// every column after it. See utils/csvExport.
import { downloadCSV } from "@/shared/utils/csvExport";
import { ACTION_TYPES, logAction } from "@/shared/utils/logger";
import {
  actualMaterialCost,
  materialsVariancePct,
  contractValue,
  grossProfit,
  grossMarginPct,
  materialCostRatioPct,
  summarizeJobs,
} from "./jobCosting";

// ── TREND COMPONENT 1: JOB PROFITABILITY ──
//
// Revenue comes from jobs.contract_value, which a person enters. It used to be
// `estimatedMaterialCost * 3.2`, which made the margin column a constant: any job
// spending its estimate reported 68.75%, and the trophy threshold was 65%. See
// ./jobCosting for the full account.
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
      setJobs?.((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, contract_value: parsed } : j)),
      );
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
      if (net > most) {
        most = net;
        name = i.iname + " (" + net + " " + (i.unit || "pcs") + ")";
      }
    });
    return name;
  };

  const handleExportExcel = () => {
    if (completedJobs.length === 0) return;
    const headers = [
      "PO Number",
      "Project Name",
      "Material Cost",
      "Materials vs Plan %",
      ...(canSeeRevenue
        ? [
            "Contract Value",
            "Gross Profit (materials only)",
            "Gross Margin %",
            "Material Cost % of Contract",
          ]
        : []),
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
        ...(canSeeRevenue
          ? [
              contractValue(j) ?? "",
              profit === null ? "" : profit.toFixed(2),
              margin === null ? "" : margin.toFixed(1),
              ratio === null ? "" : ratio.toFixed(1),
            ]
          : []),
        topMaterial(j),
      ];
    });
    downloadCSV("mrr-job-profitability-" + todayLocal() + ".csv", headers, rows);
  };

  const notSet = (
    <Text as="span" color={C.sub} style={{ fontStyle: "italic" }}>
      {t.rptNotSet}
    </Text>
  );

  return (
    <Card variant="raised" pad={8}>
      <Row gap={4} justify="space-between" wrap style={{ marginBottom: 16 }}>
        <Text as="h2" size="lg" weight="extrabold" color={C.navy} style={{ margin: 0 }}>
          {t.rptJobProfTitle}
        </Text>
        <Btn v="green" sz="sm" onClick={handleExportExcel}>
          <Download size={13} aria-hidden="true" /> {t.rptExportProfitability}
        </Btn>
      </Row>

      {/* Two disclosures the old report needed and never carried. Neither is
          decoration: without the first, margin reads as whole-job profit; without
          the second, an owner assumes the total covers every job. */}
      <Callout
        tone="warn"
        bordered
        icon={AlertTriangle}
        size="sm"
        color={C.navy}
        style={{ marginBottom: 14, lineHeight: 1.5 }}
      >
        {t.rptMaterialsOnlyNote}
      </Callout>

      {canSeeRevenue && summary.unpricedCount > 0 && (
        <Callout size="sm" color={C.sub} style={{ marginBottom: 14 }}>
          {t.rptUnpricedNote
            .replace("{n}", summary.unpricedCount)
            .replace("{total}", summary.jobCount)}
        </Callout>
      )}

      <Table pad="lg" size="base">
        <thead>
          <tr>
            {[
              t.rptColPO,
              t.rptColProject,
              t.rptColRealizedCost,
              t.rptColMaterialsVsPlan,
              ...(canSeeRevenue
                ? [t.rptColContractValue, t.rptColGrossProfit, t.rptColGrossMargin]
                : []),
              t.rptColPrimaryMaterial,
            ].map((h) => (
              <th key={h}>{h}</th>
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
              <tr key={job.id}>
                <Text as="td" weight="bold">
                  {job.po}
                </Text>
                <td>{job.title || job.name}</td>
                <Text as="td" color={C.navy}>
                  {fm(actualMaterialCost(job))}
                </Text>
                <td>
                  {variance === null ? (
                    notSet
                  ) : (
                    <Bdg color={variance > 10 ? "red" : variance > 0 ? "amber" : "green"}>
                      {variance > 0 ? "+" : ""}
                      {variance.toFixed(1)}%
                    </Bdg>
                  )}
                </td>
                {canSeeRevenue && (
                  <>
                    <Text as="td" color={C.sub}>
                      {editingId === job.id ? (
                        <Row gap={2}>
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
                          <Btn
                            v="primary"
                            sz="sm"
                            onClick={() => saveValue(job)}
                            disabled={savingId === job.id}
                          >
                            {savingId === job.id ? "..." : "✓"}
                          </Btn>
                          <Btn
                            v="ghost"
                            sz="sm"
                            onClick={() => setEditingId(null)}
                            disabled={savingId === job.id}
                          >
                            ✕
                          </Btn>
                        </Row>
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
                    </Text>
                    <Text
                      as="td"
                      weight="bold"
                      color={profit === null ? C.sub : profit < 0 ? C.rd : C.gr}
                    >
                      {profit === null ? notSet : fm(profit)}
                    </Text>
                    <td>
                      {margin === null ? (
                        notSet
                      ) : (
                        <Bdg color={margin < 0 ? "red" : margin < 40 ? "amber" : "green"}>
                          {margin.toFixed(1)}%
                        </Bdg>
                      )}
                    </td>
                  </>
                )}
                <Text as="td" size="sm" weight="semibold" color={C.blue}>
                  {topMaterial(job)}
                </Text>
              </tr>
            );
          })}
          {completedJobs.length === 0 && (
            <tr>
              <Text
                as="td"
                colSpan={canSeeRevenue ? 8 : 5}
                color={C.sub}
                style={{ padding: 24, textAlign: "center" }}
              >
                {t.rptNoCompletedLines}
              </Text>
            </tr>
          )}
        </tbody>
        {completedJobs.length > 0 && (
          <tfoot>
            <tr>
              <Text colSpan={2} as="td" weight="extrabold" color={C.navy}>
                {t.rptTotalsAcross.replace(
                  "{n}",
                  canSeeRevenue ? summary.pricedCount : summary.jobCount,
                )}
              </Text>
              <Text as="td" weight="bold">
                {fm(canSeeRevenue ? summary.materialCostOfPriced : summary.materialCost)}
              </Text>
              <td />
              {canSeeRevenue && (
                <>
                  <Text as="td" weight="bold">
                    {fm(summary.revenue)}
                  </Text>
                  <Text
                    as="td"
                    weight="black"
                    color={
                      summary.grossProfit === null ? C.sub : summary.grossProfit < 0 ? C.rd : C.gr
                    }
                  >
                    {summary.grossProfit === null ? notSet : fm(summary.grossProfit)}
                  </Text>
                  <Text as="td" weight="bold">
                    {summary.grossMarginPct === null
                      ? notSet
                      : summary.grossMarginPct.toFixed(1) + "%"}
                  </Text>
                </>
              )}
              <td />
            </tr>
          </tfoot>
        )}
      </Table>
    </Card>
  );
}

// ── TREND COMPONENT 2: INVENTORY STOCK COSTING TRENDS ──
function InventoryCostTrendsReport({ inv, t }) {
  const [trendFilter, setTrendFilter] = useState("all");

  const materialsTrendList = inv.map((item) => {
    const totalQtyOnHand = tot(item);
    const pricePoints = item.batches?.map((b) => parseFloat(b.price) || 0) || [];
    const averageBatchCost =
      pricePoints.length > 0 ? pricePoints.reduce((s, p) => s + p, 0) / pricePoints.length : 0;
    const currentPrice = newestPrice(item);

    let trendDirection = "Stable";
    let trendColor = "gray";
    if (currentPrice > averageBatchCost * 1.03) {
      trendDirection = "Inflationary 📈";
      trendColor = "red";
    } else if (currentPrice < averageBatchCost * 0.97) {
      trendDirection = "Deflationary 📉";
      trendColor = "green";
    }

    const warehouseAssetCapital =
      item.batches?.reduce(
        (s, b) => s + (parseFloat(b.rem) || 0) * (parseFloat(b.price) || 0),
        0,
      ) || 0;

    return {
      ...item,
      totalQtyOnHand,
      averageBatchCost,
      currentPrice,
      trendDirection,
      trendColor,
      warehouseAssetCapital,
    };
  });

  const filteredTrends = materialsTrendList.filter((item) => {
    if (trendFilter === "rising") return item.trendDirection.includes("Inflationary");
    if (trendFilter === "dropping") return item.trendDirection.includes("Deflationary");
    return true;
  });

  const handleExportInventoryCSV = () => {
    if (filteredTrends.length === 0) return;
    const headers = [
      "Material Description",
      "Historical Avg Cost",
      "Current Market Cost",
      "Pricing Trend Status",
      "Capital Asset Value",
    ];

    const csvRows = filteredTrends.map((r) => [
      r.name || "",
      r.averageBatchCost.toFixed(2),
      r.currentPrice.toFixed(2),
      r.trendDirection,
      r.warehouseAssetCapital.toFixed(2),
    ]);

    downloadCSV(`mrr-inventory-cost-trends-${todayLocal()}.csv`, headers, csvRows);
  };

  return (
    <Card variant="raised" pad={8}>
      <Row gap={4} justify="space-between" wrap style={{ marginBottom: 16 }}>
        <div>
          <Text as="h2" size="lg" weight="extrabold" color={C.navy} style={{ margin: 0 }}>
            {t.rptInvTrendsTitle}
          </Text>
          <Row gap={2} align="stretch" style={{ marginTop: 8 }}>
            {[
              ["all", t.rptAllTrends],
              ["rising", t.rptCostIncreasing],
              ["dropping", t.rptSavingsTraps],
            ].map(([k, l]) => (
              <Btn
                key={k}
                v={trendFilter === k ? "primary" : "ghost"}
                sz="sm"
                onClick={() => setTrendFilter(k)}
              >
                {l}
              </Btn>
            ))}
          </Row>
        </div>
        <Btn v="green" sz="sm" onClick={handleExportInventoryCSV}>
          <Download size={13} aria-hidden="true" /> {t.rptExportCostTrends}
        </Btn>
      </Row>

      <Table pad="lg" size="base">
        <thead>
          <tr>
            {[
              t.rptColMaterialProfile,
              t.rptColCategoryGroup,
              t.rptColStockAvailable,
              t.rptColHistoricalMean,
              t.rptColRecentInvoice,
              t.rptColPriceVector,
              t.rptColFifoAsset,
            ].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredTrends.map((item) => (
            <tr key={item.id}>
              <Text as="td" weight="semibold" color={C.navy}>
                {item.name}
              </Text>
              <Text as="td" color={C.sub}>
                {item.cat}
              </Text>
              <Text as="td" weight="bold">
                {item.totalQtyOnHand} {item.unit}
              </Text>
              <td>{fm(item.averageBatchCost)}</td>
              <Text as="td" weight="semibold">
                {fm(item.currentPrice)}
              </Text>
              <td>
                <Bdg color={item.trendColor}>
                  {{
                    Stable: t.rptStable,
                    "Inflationary 📈": t.rptInflationary,
                    "Deflationary 📉": t.rptDeflationary,
                  }[item.trendDirection] || item.trendDirection}
                </Bdg>
              </td>
              <Text as="td" weight="bold" color={C.blue}>
                {fm(item.warehouseAssetCapital)}
              </Text>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

// ── TREND COMPONENT 3: FLEET MAINTENANCE COSTS ANALYSIS ──
function FleetCostTrendsReport({ vehs, reqs, t, companyId }) {
  // ── ADD HOOK STATES FOR RUNTIME CONDITION DATA LOADING ──
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

  const fleetMetrics = vehs
    .map((v) => {
      // maintenance_requests has a vehicle_id column, but nothing ever writes it —
      // MaintenanceRequestsView's ticket insert (and every other create path) only
      // sets `vid`. Matching on vehicle_id here silently matched zero rows, so
      // every vehicle showed 0 resolved repairs no matter how much real service
      // history existed.
      const closedTickets = reqs.filter((r) => r.vid === v.id && r.status === "completed");
      const totalRepairInvestment = closedTickets.reduce(
        (sum, r) => sum + (parseFloat(r.cost) || 0),
        0,
      );

      let vehicleRiskLevel = "Optimal Operating Level";
      let riskColor = "green";
      if (totalRepairInvestment > 2500) {
        vehicleRiskLevel = "High Cost Center 🚨";
        riskColor = "red";
      } else if (totalRepairInvestment > 800) {
        vehicleRiskLevel = "Elevated Lifecycle Wear ⚠️";
        riskColor = "amber";
      }

      const currentMileage = parseFloat(v.current_mileage) || 0;
      const lastOilMileage = parseFloat(v.last_oil_change_mileage) || 0;
      const isOilOverdue =
        v.oil_status === "overdue" ||
        (currentMileage > 0 && currentMileage >= lastOilMileage + 5000);
      const isDetailOverdue = v.detail_status === "overdue";

      return {
        ...v,
        totalRepairInvestment,
        serviceLogsCount: closedTickets.length,
        vehicleRiskLevel,
        riskColor,
        isOilOverdue,
        isDetailOverdue,
        currentMileage,
      };
    })
    .sort((a, b) => b.totalRepairInvestment - a.totalRepairInvestment);

  const cumulativeFleetExpenditures = fleetMetrics.reduce(
    (sum, v) => sum + v.totalRepairInvestment,
    0,
  );

  const handleExportFleetCSV = () => {
    if (fleetMetrics.length === 0) return;
    const headers = [
      "Vehicle Description",
      "Plate Code",
      "Total Maintenance Action Count",
      "Cumulative Investment",
      "Asset Cost Warning Profile",
    ];

    const csvRows = fleetMetrics.map((v) => [
      `${v.yr || ""} ${v.make || ""} ${v.name || ""}`.trim(),
      v.plates || v.plate || "",
      v.serviceLogsCount,
      v.totalRepairInvestment.toFixed(2),
      v.vehicleRiskLevel,
    ]);

    downloadCSV(`mrr-fleet-depreciation-ledger-${todayLocal()}.csv`, headers, csvRows);
  };

  const handleDeleteInspection = async (id, vehicleName) => {
    if (!window.confirm(t.rptDeleteInspConfirm.replace("{name}", vehicleName))) return;
    try {
      const { error } = await supabase.from("vehicle_inspections").delete().eq("id", id);
      if (error) throw error;
      setInspections((prev) => prev.filter((log) => log.id !== id));
      showToast(t.rptInspDeleted, "success");
    } catch (err) {
      console.error("Failed to delete inspection:", err);
      showToast(`${t.rptInspDeleteErr} ${err.message}`, "error");
    }
  };

  return (
    <Stack gap={8}>
      {/* UPPER REVENUE METER LEVEL */}
      <CardGrid minWidth={320} fit gap="var(--space-7)">
        {/* PANEL A */}
        <Card variant="raised" pad={8}>
          <Text as="h3" size="md" weight="extrabold" color={C.navy} style={{ margin: "0 0 4px 0" }}>
            {t.rptExpenseBurn}
          </Text>
          <Muted as="p" style={{ margin: "0 0 16px 0" }}>
            {t.rptExpenseBurnDesc}
          </Muted>
          <Stack>
            {fleetMetrics.slice(0, 5).map((v) => {
              const barPercent = Math.min(100, (v.totalRepairInvestment / 2500) * 100);
              return (
                <div key={v.id}>
                  <Row
                    gap={0}
                    align="stretch"
                    justify="space-between"
                    style={{ fontSize: "var(--text-sm)", marginBottom: 4 }}
                  >
                    <Text as="span" weight="semibold" color={C.navy}>
                      {v.make} {v.name}
                    </Text>
                    <Text as="span" weight="bold">
                      {fm(v.totalRepairInvestment)}
                    </Text>
                  </Row>
                  <Meter
                    value={barPercent / 100}
                    color={v.totalRepairInvestment > 2500 ? C.rd : C.blue}
                  />
                </div>
              );
            })}
          </Stack>
        </Card>

        {/* PANEL B */}
        <Card variant="raised" pad={8}>
          <Text as="h3" size="md" weight="extrabold" color={C.navy} style={{ margin: "0 0 4px 0" }}>
            {t.rptComplianceMonitor}
          </Text>
          <Muted as="p" style={{ margin: "0 0 12px 0" }}>
            {t.rptComplianceDesc}
          </Muted>
          <Stack gap={3} style={{ maxHeight: 180, overflowY: "auto" }}>
            {fleetMetrics
              .filter((v) => v.isOilOverdue || v.isDetailOverdue)
              .map((v) => (
                <Row
                  key={v.id}
                  gap={0}
                  justify="space-between"
                  style={{
                    background: C.lg,
                    padding: "8px 12px",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <div>
                    <Text size="sm" weight="bold" color={C.navy}>
                      {v.make} {v.name}
                    </Text>
                    <Muted size="2xs" style={{ marginTop: 2 }}>
                      {t.rptOdo} {v.currentMileage.toLocaleString()} mi
                    </Muted>
                  </div>
                  <Row gap={1} align="stretch">
                    {v.isOilOverdue && <Bdg color="red">{t.rptOilOverdue}</Bdg>}
                    {v.isDetailOverdue && <Bdg color="amber">{t.rptDetailing}</Bdg>}
                  </Row>
                </Row>
              ))}
            {fleetMetrics.filter((v) => v.isOilOverdue || v.isDetailOverdue).length === 0 && (
              <Text
                size="sm"
                weight="bold"
                color={C.gr}
                style={{ textAlign: "center", padding: "20px 0" }}
              >
                {t.rptAllCompliant}
              </Text>
            )}
          </Stack>
        </Card>
      </CardGrid>

      {/* DETAILED LEDGER GRID */}
      <Card variant="raised" pad={8}>
        <Row gap={0} justify="space-between" style={{ marginBottom: 16 }}>
          <Text as="h2" size="lg" weight="extrabold" color={C.navy} style={{ margin: 0 }}>
            {t.rptFleetLedgerTitle}
          </Text>
          <Btn v="green" sz="sm" onClick={handleExportFleetCSV}>
            <Download size={13} aria-hidden="true" /> {t.rptExportFleet}
          </Btn>
        </Row>

        <Table pad="lg" size="base">
          <thead>
            <tr>
              {[
                t.rptColVehicleId,
                t.rptColAssetClass,
                t.rptColPlateId,
                t.rptColResolvedRequests,
                t.rptColCumulativeCost,
                t.rptColWarningIndex,
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fleetMetrics.map((v) => (
              <tr key={v.id}>
                <Text as="td" weight="bold" color={C.navy}>
                  {v.name || t.rptFleetTruck}{" "}
                  <Text as="span" size="xs" weight="normal" color={C.sub}>
                    {v.yr} {v.make}
                  </Text>
                </Text>
                <td style={{ textTransform: "capitalize" }}>{v.type}</td>
                <Text as="td" color={C.sub} style={{ fontFamily: "monospace" }}>
                  {v.plates || v.plate || "—"}
                </Text>
                <td>
                  {v.serviceLogsCount} {t.rptResolvedRepairs}
                </td>
                <Text as="td" weight="bold" color={v.totalRepairInvestment > 0 ? C.navy : C.sub}>
                  {v.totalRepairInvestment > 0 ? fm(v.totalRepairInvestment) : "—"}
                </Text>
                <td>
                  <Bdg color={v.riskColor}>
                    {{
                      "Optimal Operating Level": t.rptOptimal,
                      "High Cost Center 🚨": t.rptHighCost,
                      "Elevated Lifecycle Wear ⚠️": t.rptElevatedWear,
                    }[v.vehicleRiskLevel] || v.vehicleRiskLevel}
                  </Bdg>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <Text colSpan={4} as="td" weight="extrabold" color={C.navy}>
                {t.rptSumTotalFleet}
              </Text>
              <Text colSpan={2} as="td" weight="black" color={C.navy} style={{ fontSize: 15 }}>
                {fm(cumulativeFleetExpenditures)}
              </Text>
            </tr>
          </tfoot>
        </Table>
      </Card>

      {/* ── HISTORICAL VEHICLE INSPECTION LOOPS LIST CANVA PIPELINE ── */}
      <Card variant="raised" pad={8} style={{ border: `1px solid ${C.lg}` }}>
        <Text
          as="h3"
          weight="extrabold"
          color={C.navy}
          style={{ margin: "0 0 4px 0", fontSize: 15 }}
        >
          {t.rptInspLogsTitle}
        </Text>
        <Muted as="p" size="sm" style={{ margin: "0 0 16px 0" }}>
          {t.rptInspLogsDesc}
        </Muted>

        {loadingInspect ? (
          <SkeletonTable
            rows={5}
            cols={["30%", "22%", "18%", "30%"]}
            label={t.rptStreamingMetrics}
          />
        ) : inspections.length === 0 ? (
          <Callout pad={9} size="base" color={C.sub} style={{ textAlign: "center" }}>
            {t.rptNoInspections}
          </Callout>
        ) : (
          /* ── SCROLL CONTAINER BOUNDARY CONTROLLER ── */
          <Stack
            gap={4}
            style={{
              maxHeight: "380px",
              overflowY: "auto",
              paddingRight: 4,
              scrollbarWidth: "thin",
            }}
          >
            {inspections.map((log) => (
              <Callout
                key={log.id}
                pad={6}
                style={{
                  borderRadius: "var(--radius-lg)",
                  borderLeft: `4px solid ${log.photos?.length > 0 ? "var(--c-slate)" : "var(--c-line)"}`,
                }}
              >
                <Row gap={7} align="flex-start" justify="space-between" wrap>
                  <Stack gap={0} style={{ flex: 1, minWidth: 240 }}>
                    <Row wrap style={{ marginBottom: 4 }}>
                      <Text as="span" size="base" weight="extrabold" color={C.navy}>
                        {log.vehicle_name}
                      </Text>
                      <Muted as="span">· {new Date(log.created_at).toLocaleDateString()}</Muted>
                    </Row>
                    <Text
                      as="p"
                      size="base"
                      color="var(--c-barnwood)"
                      style={{ margin: "0 0 6px 0", lineHeight: 1.4 }}
                    >
                      {log.notes || (
                        <Text as="span" color={C.sub} style={{ fontStyle: "italic" }}>
                          {t.rptNoNotes}
                        </Text>
                      )}
                    </Text>
                    <Text size="xs" weight="semibold" color={C.sub}>
                      {t.rptInspector}{" "}
                      <Text as="span" color={C.navy}>
                        {log.inspector_name}
                      </Text>
                    </Text>
                  </Stack>

                  {/* Picture Array Thumbnails Box */}
                  {log.photos && log.photos.length > 0 && (
                    <Row gap={2} align="stretch" wrap>
                      {log.photos.map((pic, idx) => (
                        <img
                          key={idx}
                          src={pic}
                          alt={t.rptInspThumbAlt}
                          onClick={() => setLightboxPic(pic)}
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: "var(--radius-sm)",
                            objectFit: "cover",
                            cursor: "pointer",
                            border: "1px solid var(--c-line)",
                          }}
                          title={t.rptExpandImage}
                        />
                      ))}
                    </Row>
                  )}

                  <TextBtn
                    onClick={() => handleDeleteInspection(log.id, log.vehicle_name)}
                    color={C.rd}
                    title={t.rptDeleteInspTitle}
                    aria-label={t.rptDeleteInspTitle}
                    style={{ padding: "4px 8px", display: "flex" }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </TextBtn>
                </Row>
              </Callout>
            ))}
          </Stack>
        )}
      </Card>

      {/* Lightbox Canvas Overlay Component */}
      {lightboxPic && (
        <Modal title={t.rptFullResTitle} onClose={() => setLightboxPic(null)} wide>
          <Stack gap={0} align="center" style={{ padding: 4 }}>
            <img
              src={lightboxPic}
              alt={t.rptCondFullView}
              style={{
                maxWidth: "100%",
                maxHeight: "68vh",
                borderRadius: "var(--radius-md)",
                objectFit: "contain",
                background: C.mediaBackdrop,
              }}
            />
            <Btn
              v="primary"
              style={{ width: "100%", marginTop: 12, justifyContent: "center" }}
              onClick={() => setLightboxPic(null)}
            >
              {t.rptCloseReview}
            </Btn>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}

// ── HISTORICAL SYSTEM AUDIT LEDGER ──
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
    const headers = [
      "Timestamp Code",
      "Operator Email",
      "Action Flag",
      "Log Description Narrative",
    ];

    const csvRows = logs.map((l) => [
      formatFullTimestamp(l.created_at),
      l.user_email || "",
      l.action_type || "",
      l.description || "",
    ]);

    downloadCSV(`mrr-system-audit-trail-${todayLocal()}.csv`, headers, csvRows);
  };

  return (
    <Card variant="raised" pad={8}>
      <Row gap={4} justify="space-between" wrap style={{ marginBottom: 16 }}>
        <div>
          <Text as="h2" size="lg" weight="extrabold" color={C.navy} style={{ margin: 0 }}>
            {t.rptAuditTitle}
          </Text>
          <Stack gap={0} style={{ marginTop: 8 }}>
            <Sel
              value={actionTypeFilter}
              onChange={(e) => setActionTypeFilter(e.target.value)}
              style={{ padding: "4px 8px", fontSize: "var(--text-sm)" }}
            >
              <option value="all">{t.rptFilterActionAll}</option>
              {/* MAT_RECEIVE and MAINTENANCE were offered here and are written
                  nowhere, so both returned an empty table permanently. Single
                  source in utils/logger now. */}
              {ACTION_TYPES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Sel>
          </Stack>
        </div>
        <Btn v="green" sz="sm" onClick={handleExportAuditExcel}>
          <Download size={13} aria-hidden="true" /> {t.rptExportAudit}
        </Btn>
      </Row>
      {loading ? (
        <SkeletonTable
          rows={7}
          cols={["26%", "20%", "16%", "16%", "22%"]}
          label={t.rptLoadingAudit}
        />
      ) : loadError ? (
        <Callout
          tone="danger"
          bordered
          pad={8}
          color="var(--c-rust)"
          style={{ borderRadius: "var(--radius-lg)", textAlign: "center" }}
        >
          <Text weight="bold" style={{ marginBottom: 6 }}>
            {t.rptAuditLoadFailTitle}
          </Text>
          <Text size="sm" style={{ marginBottom: 12 }}>
            {t.rptAuditLoadFailDesc} ({loadError})
          </Text>
          <Btn v="primary" sz="sm" onClick={() => setRetryTick((prev) => prev + 1)}>
            {t.rptRetry}
          </Btn>
        </Callout>
      ) : (
        <Table pad="md" maxHeight={400}>
          <thead className="mrr-thead-sticky">
            <tr>
              {[
                t.rptColTimestamp,
                t.rptColUserEmail,
                t.rptColActionCode,
                t.rptColAuditNarrative,
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <Text as="td" color={C.sub} style={{ whiteSpace: "nowrap" }}>
                  {formatFullTimestamp(log.created_at)}
                </Text>
                <Text as="td" weight="semibold">
                  {log.user_email}
                </Text>
                <td>
                  <Bdg color={log.action_type === "PERM_CHANGE" ? "purple" : "teal"}>
                    {log.action_type}
                  </Bdg>
                </td>
                <Text as="td" color={C.navy}>
                  {log.description}
                </Text>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ── MAIN CORE VIEW INTERFACE CONTAINER ──
export default function Reports({
  jobs = [],
  setJobs,
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
    { id: "Jobs", label: t.rptTabJobs, icon: TrendingUp },
    { id: "Inventory", label: t.rptTabInventory, icon: Factory },
    { id: "Fleet", label: t.rptTabFleet, icon: Truck },
    { id: "Audit", label: t.rptTabAudit, icon: Lock },
  ];

  return (
    <div>
      <PageHeader title={t.rptTitle} subtitle={t.rptSubtitle} />

      <Row gap={5} align="stretch" wrap style={{ marginBottom: 20 }}>
        <StatTile
          variant="borderLeft"
          color={C.blue}
          value={jobs.length}
          label={t.rptTotalPipelines}
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
        />
        <StatTile
          variant="borderLeft"
          color={C.gr}
          value={completedJobs.length}
          label={t.rptFinalizedProjects}
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
        />
        {perms.inv_pricing_view && (
          <StatTile
            variant="borderLeft"
            color={C.gr}
            value={fm(historicalTotalMaterialSpend)}
            label={t.rptTotalProcurement}
            style={{ minWidth: 200 }}
          />
        )}
      </Row>

      <Tabs
        tabs={tabOptions}
        value={activeTab}
        onChange={setActiveTab}
        style={{ marginBottom: 20 }}
      />

      <div>
        {activeTab === "Jobs" && (
          <JobProfitabilityReport jobs={jobs} setJobs={setJobs} user={user} perms={perms} t={t} />
        )}
        {activeTab === "Inventory" && perms.inv_pricing_view && (
          <InventoryCostTrendsReport inv={inv} t={t} />
        )}
        {activeTab === "Fleet" && perms.inv_pricing_view && (
          <FleetCostTrendsReport vehs={vehs} reqs={reqs} t={t} companyId={user?.companyId} />
        )}
        {activeTab === "Audit" && perms.users_manage && (
          <AuditTrailReport t={t} companyId={user?.companyId} />
        )}
      </div>
    </div>
  );
}
