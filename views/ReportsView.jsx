// src/views/ReportsView.jsx
import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { C, fd, fm, tot, newestPrice } from '../utils/helpers';
import { Btn, Sel, Bdg } from '../components/UIPrimitives';
import { generatePDF } from '../utils/pdfGenerator';
import { downloadCSV } from '../utils/csvExport';

// ── 1. JOB FINANCIAL VARIANCE REPORT ──
function JobCostReport({ jobs }) {
  const closedJobs = jobs.filter(j => j.status === 'completed' || j.status === 'closed');
  
  const handleExportExcel = () => {
    const csvRows = closedJobs.map(j => {
      let plannedCost = 0;
      let actualCost = 0;
      
      j.items?.forEach(i => {
        // Planned estimate uses the fallback price known at pull or newest batch baseline
        const fallbackPrice = i.priceAtPull || 0;
        plannedCost += (parseFloat(i.planned) || 0) * fallbackPrice;
        actualCost += ((parseFloat(i.pulled) || 0) - (parseFloat(i.returned) || 0)) * fallbackPrice;
      });

      return {
        'PO Number': j.po,
        'Project Name': j.name,
        'Items Planned': j.items?.length || 0,
        'Estimated Planned Cost': fm(plannedCost),
        'Actual Material Cost': fm(actualCost),
        'Variance': fm(plannedCost - actualCost),
        'Status': j.status.toUpperCase()
      };
    });
    downloadCSV('job-financial-variance.csv', csvRows);
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.navy }}>📋 Job Cost & Variance Report</h2>
        <Btn v="green" sz="sm" onClick={handleExportExcel}>⬇ Export Job Excel</Btn>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.lg }}>
              {['PO', 'Job Name', 'Estimated Cost', 'Actual Cost', 'Variance', 'Status'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: C.sub, fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {closedJobs.map(job => {
              let estCost = 0;
              let actCost = 0;
              
              job.items?.forEach(i => {
                const price = i.priceAtPull || 0;
                estCost += (parseFloat(i.planned) || 0) * price;
                actCost += ((parseFloat(i.pulled) || 0) - (parseFloat(i.returned) || 0)) * price;
              });

              const variance = estCost - actCost;

              return (
                <tr key={job.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{job.po}</td>
                  <td style={{ padding: '10px 12px' }}>{job.name}</td>
                  <td style={{ padding: '10px 12px', color: C.sub }}>{fm(estCost)}</td>
                  <td style={{ padding: '10px 12px', color: C.gr, fontWeight: 700 }}>{fm(actCost)}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: variance >= 0 ? C.blue : C.rd }}>
                    {variance >= 0 ? `+${fm(variance)}` : fm(variance)}
                  </td>
                  <td><Bdg color={job.status === 'completed' ? 'green' : 'purple'}>{job.status}</Bdg></td>
                </tr>
              );
            })}
            {closedJobs.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.sub }}>No finalized project ledger entries found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 2. INVENTORY STOCK LEVELS & VALUATION ──
function InventoryValuationReport({ inv }) {
  const [stockFilter, setStockFilter] = useState('all');

  const rows = inv.map(item => {
    const qtyOnHand = tot(item); // Safely evaluating stock levels utilizing defensive utilities
    const totalVal = item.batches?.reduce((s, b) => s + ((parseFloat(b.rem) || 0) * (parseFloat(b.price) || 0)), 0) || 0;
    const isLow = qtyOnHand <= (parseFloat(item.alrt) || 0);
    return { ...item, qtyOnHand, totalVal, isLow };
  });

  const filteredRows = rows.filter(r => {
    if (stockFilter === 'low') return r.isLow;
    if (stockFilter === 'excess') return r.qtyOnHand > (parseFloat(r.alrt) * 3);
    return true;
  }).sort((a, b) => b.totalVal - a.totalVal);

  const grandTotalValue = rows.reduce((s, r) => s + r.totalVal, 0);

  const handleExportInventoryCSV = () => {
    const data = filteredRows.map(r => ({
      'Material Name': r.name,
      'Category Group': r.cat,
      'Current Qty On Hand': r.qtyOnHand,
      'Unit Type': r.unit,
      'Total FIFO Capital Value': r.totalVal,
      'Stock Alert Status': r.isLow ? 'REORDER' : 'GOOD'
    }));
    downloadCSV('inventory-valuation-levels.csv', data);
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.navy }}>🏭 Stock Allocations & Financial Value</h2>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {[['all', 'All Items'], ['low', '🚨 Low Stock Alert'], ['excess', '📦 Excess Stock']].map(([k, l]) => (
              <Btn key={k} v={stockFilter === k ? 'primary' : 'ghost'} sz="sm" onClick={() => setStockFilter(k)}>{l}</Btn>
            ))}
          </div>
        </div>
        <Btn v="green" sz="sm" onClick={handleExportInventoryCSV}>⬇ Export Inventory Excel</Btn>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.lg }}>
              {['Material Item Name', 'Category', 'Quantity Available', 'Latest Batch Cost', 'Total Asset Value', 'Status'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: C.sub, fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(item => (
              <tr key={item.id} style={{ borderBottom: `1px solid ${C.lg}`, background: item.isLow ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600, color: C.navy }}>{item.name}</td>
                <td style={{ padding: '10px 12px', color: C.sub }}>{item.cat}</td>
                <td style={{ padding: '10px 12px', fontWeight: 700 }}>{item.qtyOnHand} {item.unit}</td>
                <td style={{ padding: '10px 12px' }}>{fm(newestPrice(item))}</td>
                <td style={{ padding: '10px 12px', fontWeight: 700, color: C.blue }}>{fm(item.totalVal)}</td>
                <td>
                  <Bdg color={item.isLow ? 'red' : 'green'}>{item.isLow ? 'LOW STOCK' : 'WELL STOCKED'}</Bdg>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: C.sB }}>
              <td colSpan={4} style={{ padding: '12px', fontWeight: 800, color: C.navy }}>Total Portfolio Warehouse Capitalization</td>
              <td colSpan={2} style={{ padding: '12px', fontWeight: 900, color: C.blue, fontSize: 15 }}>{fm(grandTotalValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── 3. FLEET COST & TICKETING SUB REPORT ──
function FleetCostReport({ vehs, reqs }) {
  const fleetData = vehs.map(v => {
    const matchingTickets = reqs.filter(r => r.vid === v.id && r.status === 'completed');
    const aggregateCost = matchingTickets.reduce((sum, r) => sum + (parseFloat(r.cost) || 0), 0);
    return { ...v, aggregateCost, ticketCount: matchingTickets.length };
  }).sort((a, b) => b.aggregateCost - a.aggregateCost);

  const totalFleetInvestment = fleetData.reduce((sum, v) => sum + v.aggregateCost, 0);

  const handleExportFleetCSV = () => {
    const data = fleetData.map(v => ({
      'Vehicle Description': `${v.yr} ${v.make} ${v.name}`,
      'Asset Class': v.type.toUpperCase(),
      'License Plate': v.plate,
      'Closed Tickets Count': v.ticketCount,
      'Cumulative Capital Maintenance Cost': fm(v.aggregateCost)
    }));
    downloadCSV('fleet-maintenance-ledger.csv', data);
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.navy }}>🚛 Fleet Maintenance Ledger</h2>
        <Btn v="green" sz="sm" onClick={handleExportFleetCSV}>⬇ Export Fleet Excel</Btn>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.lg }}>
              {['Vehicle Asset identifier', 'Classification', 'Plate Code', 'Completed Maintenance', 'Cumulative Investment'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: C.sub, fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fleetData.map(v => (
              <tr key={v.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                <td style={{ padding: '10px 12px', fontWeight: 700, color: C.navy }}>{v.name} <span style={{ fontWeight: 400, color: C.sub, fontSize: 11 }}>{v.yr} {v.make}</span></td>
                <td style={{ padding: '10px 12px', textTransform: 'capitalize' }}>{v.type}</td>
                <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: C.sub }}>{v.plate}</td>
                <td style={{ padding: '10px 12px' }}>{v.ticketCount} resolved repairs</td>
                <td style={{ padding: '10px 12px', fontWeight: 700, color: v.aggregateCost > 0 ? C.rd : C.sub }}>
                  {v.aggregateCost > 0 ? fm(v.aggregateCost) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'rgba(239, 68, 68, 0.05)' }}>
              <td colSpan={4} style={{ padding: '12px', fontWeight: 800, color: C.navy }}>Total Fleet Maintenance Expenditures</td>
              <td style={{ padding: '12px', fontWeight: 900, color: C.rd, fontSize: 15 }}>{fm(totalFleetInvestment)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── 4. HISTORICAL SYSTEM AUDIT LEDGER ──
function AuditTrailReport() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionTypeFilter, setActionTypeFilter] = useState('all');

  useEffect(() => {
    async function getLogs() {
      setLoading(true);
      try {
        let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
        if (actionTypeFilter !== 'all') {
          query = query.eq('action_type', actionTypeFilter);
        }
        const { data, error } = await query;
        if (error) throw error;
        setLogs(data || []);
      } catch (err) {
        console.error('Failed fetching audit files:', err);
      } finally {
        setLoading(false);
      }
    }
    getLogs();
  }, [actionTypeFilter]);

  const handleExportAuditExcel = () => {
    const data = logs.map(l => ({
      'Timestamp Code': fd(l.created_at),
      'Operator Email': l.user_email,
      'Action Flag': l.action_type,
      'Log Description Narrative': l.description
    }));
    downloadCSV('system-audit-trail.csv', data);
  };

  return (
    <div style={{ background: C.w, padding: 20, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.navy }}>🔒 Historical Operations Audit Trail</h2>
          <div style={{ marginTop: 8 }}>
            <Sel value={actionTypeFilter} onChange={e => setActionTypeFilter(e.target.value)} style={{ padding: '4px 8px', fontSize: 12 }}>
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
        <div style={{ padding: 24, textAlign: 'center', color: C.sub }}>Loading audit stream records...</div>
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.lg, position: 'sticky', top: 0, zIndex: 1 }}>
                {['Timestamp', 'User Email', 'Action Code', 'Audit Narrative Description'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: C.sub, fontWeight: 700, background: C.lg }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: C.sub }}>{fd(log.created_at)}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{log.user_email}</td>
                  <td><Bdg color={log.action_type === 'PERM_CHANGE' ? 'purple' : 'teal'}>{log.action_type}</Bdg></td>
                  <td style={{ padding: '8px 12px', color: C.navy }}>{log.description}</td>
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
export default function Reports({ jobs = [], users = [], user, perms, inv = [], vehs = [], reqs = [] }) {
  const [activeTab, setActiveTab] = useState('Jobs');
  const completedJobs = jobs.filter(j => j.status === 'completed');
  
  // Calculate total material spend using actual quantities pulled vs returned
  const historicalTotalMaterialSpend = completedJobs.reduce((s, j) => s + j.items.reduce((a, i) => a + ((parseFloat(i.pulled) || 0) - (parseFloat(i.returned) || 0)) * (parseFloat(i.priceAtPull) || 0), 0), 0);

  const tabOptions = [
    { id: 'Jobs', label: 'Job Financials', icon: '📋' },
    { id: 'Inventory', label: 'Inventory Assets', icon: '🏭' },
    { id: 'Fleet', label: 'Fleet Costing', icon: '🚛' },
    { id: 'Audit', label: 'System Audit Ledger', icon: '🔒' }
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>📊 Corporate Intelligence Reporting</h1>
        <p style={{ margin: '3px 0 0', color: C.sub, fontSize: 12 }}>Saint Joe Road Warehouse · Analytical Material & Asset Auditing</p>
      </div>

      {/* KPI Stats Highlights Block */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ background: C.w, borderRadius: 12, padding: 14, borderLeft: `5px solid ${C.blue}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.blue }}>{jobs.length}</div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>Total Contracts Managed</div>
        </div>
        <div style={{ background: C.w, borderRadius: 12, padding: 14, borderLeft: `5px solid ${C.gr}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.gr }}>{completedJobs.length}</div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>Completed Projects</div>
        </div>
        {perms.inv_pricing_view && (
          <div style={{ background: C.w, borderRadius: 12, padding: 14, borderLeft: `5px solid ${C.gr}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.gr }}>{fm(historicalTotalMaterialSpend)}</div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>Total Realized Material Cost (Completed)</div>
          </div>
        )}
      </div>

      {/* Primary Module Level Selection Tab List */}
      <div style={{ display: 'flex', gap: 10, borderBottom: `1px solid ${C.lg}`, paddingBottom: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabOptions.map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 20,
                border: 'none',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                backgroundColor: active ? '#1b52b8' : 'transparent',
                color: active ? '#ffffff' : '#475569',
                transition: 'all 0.2s'
              }}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          );
        })}
      </div>

      {/* RENDER CONDITIONAL ISOLATED TARGET MODULE REPORT VIEW */}
      <div>
        {activeTab === 'Jobs' && <JobCostReport jobs={jobs} />}
        {activeTab === 'Inventory' && perms.inv_pricing_view && <InventoryValuationReport inv={inv} />}
        {activeTab === 'Fleet' && perms.inv_pricing_view && <FleetCostReport vehs={vehs} reqs={reqs} />}
        {activeTab === 'Audit' && perms.users_manage && <AuditTrailReport />}
      </div>
    </div>
  );
}