// src/views/inventory/InventoryCountTab.jsx
//
// The monthly physical count, and the variance it exposes.
//
// This is the only screen in the app where a number comes from outside the system.
// Everything else is derived from inventory.batches, which means everything else
// agrees with itself by construction — an item can read -1 and nothing objects.
// Material that walks off the yard produces no event to derive from. Someone
// walking the racks with a clipboard is the only way to find it.
//
// A count is therefore a two-sided document: what the books EXPECT, computed live
// from receipts and job usage, next to what a person COUNTED. The gap is the bleed.
import { useState, useEffect, useMemo } from "react";
import { supabase, updateRowStrict } from "../../utils/supabase";
import { C, fm } from "../../utils/helpers";
import { resolvePersonName } from "../../utils/people";
import { Btn, Inp, Sel, SkeletonTable } from "../../components/UIPrimitives";
import { logAction } from "../../utils/logger";
import { useNotify } from "../../context/NotificationContext";
import { translations } from "../../utils/translations";
import {
  buildCountLines,
  summarizeCount,
  flaggedLines,
  currentPeriod,
  recentPeriods,
  periodLabel,
  shiftPeriod,
} from "../../utils/inventoryCounts";

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function InventoryCountTab({ inv = [], jobs = [], users = [], user, perms, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const { showToast } = useNotify();

  const [period, setPeriod] = useState(currentPeriod());
  // Every count this company has ever taken. There are twelve a year, so loading
  // the lot is cheaper than the round trips needed to chase one period's
  // predecessor on every period change.
  const [counts, setCounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyVariance, setOnlyVariance] = useState(false);
  // What has been typed but not yet written. Keyed by inventory id. Held apart
  // from the saved row so an unsaved sheet is visibly unsaved.
  const [draft, setDraft] = useState({});
  const [dirty, setDirty] = useState(false);

  const canEdit = !!perms?.inv_edit;
  const canSeeMoney = !!perms?.inv_pricing_view;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const { data, error } = await supabase
          .from("inventory_counts")
          .select("*")
          .order("period", { ascending: false });
        if (error) throw error;
        if (!cancelled) setCounts(data || []);
      } catch (err) {
        console.error("Failed to load inventory counts:", err);
        // An empty sheet and a failed fetch look identical, and one of them means
        // "nobody has ever counted" while the other means "do not trust this".
        if (!cancelled) {
          setLoadError(err.message || "Request failed");
          setCounts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [retryTick]);

  const countRow = useMemo(() => counts.find((c) => c.period === period) || null, [counts, period]);
  const prevRow = useMemo(
    () => counts.find((c) => c.period === shiftPeriod(period, -1)) || null,
    [counts, period],
  );
  const isClosed = countRow?.status === "closed";

  // Typed values, saved plus unsaved, as { [iid]: { counted, at, by } }.
  const entries = useMemo(() => {
    const saved = {};
    for (const e of countRow?.entries || []) {
      if (e && e.iid != null) saved[e.iid] = e;
    }
    return { ...saved, ...draft };
  }, [countRow, draft]);

  // Switching period abandons nothing silently: the draft is period-scoped, so it
  // is cleared deliberately rather than carried onto another month's sheet.
  const changePeriod = (next) => {
    if (dirty && !window.confirm(t.cntDiscardConfirm)) return;
    setDraft({});
    setDirty(false);
    setPeriod(next);
  };

  // A CLOSED count renders the frozen lines it was closed with, never a fresh
  // computation. Next month's opening balance reads from those numbers, so a
  // closed sheet that quietly re-derived itself would rewrite the history every
  // later period was measured against.
  const lines = useMemo(() => {
    if (isClosed) return countRow.lines || [];
    return buildCountLines(inv, jobs, period, { previousLines: prevRow?.lines || [], entries });
  }, [isClosed, countRow, inv, jobs, period, prevRow, entries]);

  const summary = useMemo(() => summarizeCount(lines), [lines]);
  const flagged = useMemo(() => flaggedLines(lines), [lines]);

  const visibleLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) => {
      if (onlyVariance && !(l.variance != null && l.variance !== 0)) return false;
      if (!q) return true;
      return `${l.name} ${l.cat}`.toLowerCase().includes(q);
    });
  }, [lines, search, onlyVariance]);

  const setCounted = (iid, value) => {
    setDraft((p) => ({
      ...p,
      [iid]: { iid, counted: value, at: new Date().toISOString(), by: user?.id || null },
    }));
    setDirty(true);
  };

  const entryArray = () =>
    Object.values(entries)
      .filter((e) => e && e.iid != null && e.counted !== "" && e.counted != null)
      .map((e) => ({ iid: e.iid, counted: parseFloat(e.counted), at: e.at || null, by: e.by || null }))
      .filter((e) => !Number.isNaN(e.counted));

  const saveProgress = async () => {
    if (!canEdit || isClosed) return;
    setSaving(true);
    try {
      const payload = entryArray();
      if (countRow) {
        const { error } = await updateRowStrict("inventory_counts", countRow.id, { entries: payload });
        if (error) throw error;
        setCounts((p) => p.map((c) => (c.id === countRow.id ? { ...c, entries: payload } : c)));
      } else {
        // company_id is stamped by its column DEFAULT active_company_id(), so it
        // is deliberately not sent from the browser. See supabase/02.
        const { data, error } = await supabase
          .from("inventory_counts")
          .insert([{ period, status: "open", entries: payload, opened_by: user?.id || null }])
          .select("*")
          .single();
        if (error) throw error;
        setCounts((p) => [data, ...p]);
      }
      setDraft({});
      setDirty(false);
      showToast(t.cntSaved, "success");
    } catch (err) {
      console.error("Failed to save count progress:", err);
      showToast(`${t.cntSaveFail} ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const closePeriod = async () => {
    if (!canEdit || isClosed) return;
    const uncounted = lines.length - summary.countedCount;
    // Closing with gaps is allowed. A yard that counted 80% of the racks still
    // learns something, and refusing to close would just push people into never
    // closing at all. But the number left uncounted has to be said out loud,
    // because those lines carry into next month's opening from the BOOK, not
    // from a count.
    const msg = uncounted > 0
      ? t.cntCloseConfirmPartial.replace("{n}", uncounted).replace("{period}", periodLabel(period))
      : t.cntCloseConfirm.replace("{period}", periodLabel(period));
    if (!window.confirm(msg)) return;

    setSaving(true);
    try {
      const frozen = buildCountLines(inv, jobs, period, { previousLines: prevRow?.lines || [], entries });
      const stamp = {
        status: "closed",
        entries: entryArray(),
        lines: frozen,
        closed_by: user?.id || null,
        closed_at: new Date().toISOString(),
      };

      let row = countRow;
      if (row) {
        const { error } = await updateRowStrict("inventory_counts", row.id, stamp);
        if (error) throw error;
        row = { ...row, ...stamp };
        setCounts((p) => p.map((c) => (c.id === row.id ? row : c)));
      } else {
        const { data, error } = await supabase
          .from("inventory_counts")
          .insert([{ period, opened_by: user?.id || null, ...stamp }])
          .select("*")
          .single();
        if (error) throw error;
        setCounts((p) => [data, ...p]);
      }

      const s = summarizeCount(frozen);
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Closed the ${periodLabel(period)} inventory count. ${s.countedCount} of ${frozen.length} items counted. Net variance ${s.varianceUnits} units, bleed rate ${s.bleedPct}%.`,
        {
          period,
          counted: s.countedCount,
          total: frozen.length,
          variance_units: s.varianceUnits,
          variance_value: s.varianceValue,
          bleed_pct: s.bleedPct,
        },
        "inventory",
      );

      setDraft({});
      setDirty(false);
      showToast(t.cntClosed, "success");
    } catch (err) {
      console.error("Failed to close the count:", err);
      showToast(`${t.cntCloseFail} ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const headers = ["Item", "Category", "Unit", "Opening", "Opening source", "Received", "Adjusted", "Pulled", "Returned", "Net used", "Expected", "Counted", "Variance", ...(canSeeMoney ? ["Unit price", "Variance value"] : [])];
    const rows = lines.map((l) => [
      csvCell(l.name), csvCell(l.cat), csvCell(l.unit),
      l.opening, csvCell(l.openingSource), l.received, l.adjusted, l.pulled, l.returned, l.used,
      l.expected,
      l.counted == null ? "" : l.counted,
      l.variance == null ? "" : l.variance,
      ...(canSeeMoney ? [l.price, l.variance == null ? "" : (l.variance * l.price).toFixed(2)] : []),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-count-${period}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const periodOptions = useMemo(() => {
    const recent = recentPeriods(currentPeriod(), 18);
    // Any closed period older than the rolling window still has to be reachable.
    const extra = counts.map((c) => c.period).filter((p) => !recent.includes(p));
    return [...new Set([...recent, ...extra])].sort().reverse();
  }, [counts]);

  const tile = (value, label, tone) => (
    <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 14, borderLeft: `5px solid ${tone}`, boxShadow: "var(--shadow-sm)", flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: tone }}>{value}</div>
      <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 3 }}>{label}</div>
    </div>
  );

  if (loading) return <SkeletonTable rows={8} cols={["30%", "14%", "14%", "14%", "14%", "14%"]} label={t.cntLoading} />;

  if (loadError) {
    return (
      <div style={{ background: "var(--c-rust-wash)", border: "1.5px solid var(--c-rust)", borderRadius: "var(--radius-lg)", padding: 24, textAlign: "center", color: "var(--c-rust)" }}>
        <div style={{ fontWeight: "var(--weight-bold)", marginBottom: 6 }}>{t.cntLoadFailTitle}</div>
        <div style={{ fontSize: "var(--text-sm)", marginBottom: 14 }}>{t.cntLoadFailBody} ({loadError})</div>
        <Btn v="primary" sz="sm" onClick={() => setRetryTick((n) => n + 1)}>🔄 {t.cntRetry}</Btn>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "var(--space-4)", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: "var(--weight-black)", color: C.navy }}>
            🧮 {t.cntTitle}
          </h2>
          <p style={{ margin: "4px 0 0", color: C.sub, fontSize: "var(--text-sm)", maxWidth: 620, lineHeight: 1.45 }}>
            {t.cntSubtitle}
          </p>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          <Sel value={period} onChange={(e) => changePeriod(e.target.value)} aria-label={t.cntPeriodAria} style={{ width: "auto" }}>
            {periodOptions.map((p) => {
              const row = counts.find((c) => c.period === p);
              const mark = row ? (row.status === "closed" ? " ✓" : " …") : "";
              return <option key={p} value={p}>{periodLabel(p)}{mark}</option>;
            })}
          </Sel>
          <Btn v="ghost" sz="sm" onClick={exportCsv}>⬇ {t.cntExport}</Btn>
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: 16 }}>
        {tile(`${summary.countedCount}/${summary.total}`, t.cntTileCounted, C.blue)}
        {tile(
          `${summary.varianceUnits > 0 ? "+" : ""}${summary.varianceUnits}`,
          t.cntTileVariance,
          summary.varianceUnits < 0 ? C.rd : summary.varianceUnits > 0 ? C.am : C.gr,
        )}
        {tile(
          `${summary.bleedPct > 0 ? "+" : ""}${summary.bleedPct}%`,
          t.cntTileBleed,
          summary.bleedPct < 0 ? C.rd : C.gr,
        )}
        {canSeeMoney && tile(fm(summary.shrinkValue), t.cntTileValue, summary.shrinkValue < 0 ? C.rd : C.gr)}
      </div>

      {/* The bleed rate is a ratio of two numbers people will be asked to defend,
          so say what they are rather than making it a black box. */}
      <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 16, fontSize: "var(--text-xs)", color: C.sub, lineHeight: 1.6 }}>
        {t.cntFormula}
      </div>

      {isClosed ? (
        <div style={{ background: C.sB, border: `1.5px solid ${C.sl}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 16, fontSize: "var(--text-sm)", color: C.navy }}>
          🔒 <strong>{t.cntClosedBanner.replace("{period}", periodLabel(period))}</strong> {t.cntClosedBannerBody}
        </div>
      ) : (
        <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 16, fontSize: "var(--text-sm)", color: C.navy }}>
          📋 {t.cntOpenBanner}
          {prevRow?.status === "closed"
            ? ` ${t.cntOpeningFromCount.replace("{period}", periodLabel(prevRow.period))}`
            : ` ${t.cntOpeningFromBook}`}
        </div>
      )}

      {flagged.length > 0 && (
        <div style={{ background: C.rB, border: `1.5px solid ${C.rd}`, borderRadius: "var(--radius-lg)", padding: 14, marginBottom: 16 }}>
          <div style={{ fontWeight: "var(--weight-extrabold)", color: C.rd, marginBottom: 8, fontSize: "var(--text-base)" }}>
            ⚠️ {t.cntFlaggedTitle.replace("{n}", flagged.length)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {flagged.slice(0, 8).map((l) => (
              <div key={l.iid} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "var(--text-sm)" }}>
                <span style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{l.name}</span>
                <span style={{ color: C.rd, fontWeight: "var(--weight-bold)", whiteSpace: "nowrap" }}>
                  {l.variance > 0 ? "+" : ""}{l.variance} {l.unit}
                  {canSeeMoney ? ` · ${fm(l.variance * l.price)}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <Inp placeholder={t.cntSearch} value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200, maxWidth: 320 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", color: C.navy, fontWeight: "var(--weight-semibold)", cursor: "pointer" }}>
          <input type="checkbox" checked={onlyVariance} onChange={(e) => setOnlyVariance(e.target.checked)} />
          {t.cntOnlyVariance}
        </label>
        <div style={{ flex: 1 }} />
        {canEdit && !isClosed && (
          <>
            <Btn v={dirty ? "primary" : "ghost"} sz="sm" onClick={saveProgress} disabled={saving || !dirty}>
              {saving ? t.cntSaving : dirty ? t.cntSaveProgress : t.cntAllSaved}
            </Btn>
            <Btn v="gold" sz="sm" onClick={closePeriod} disabled={saving}>
              🔒 {t.cntClosePeriod}
            </Btn>
          </>
        )}
      </div>

      <div style={{ overflowX: "auto", maxHeight: 640, overflowY: "auto", border: `1px solid ${C.lg}`, borderRadius: 8 }}>
        <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 1, background: C.lg }}>
            <tr style={{ borderBottom: `2px solid ${C.bd}` }}>
              {[t.cntColItem, t.cntColOpening, t.cntColReceived, t.cntColUsed, t.cntColExpected, t.cntColCounted, t.cntColVariance, ...(canSeeMoney ? [t.cntColValue] : [])].map((h) => (
                <th key={h} style={{ padding: "10px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-2xs)", textTransform: "uppercase", background: C.lg, whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleLines.map((l) => {
              const v = l.variance;
              const off = v != null && v !== 0;
              return (
                <tr key={l.iid} style={{ borderBottom: `1px solid ${C.lg}`, background: off ? (v < 0 ? C.rB : C.aB) : "transparent" }}>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{l.name}</div>
                    <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>
                      {l.cat}
                      {/* An item whose book balance is already negative is not a
                          counting problem, it is a prior over-pull. Flag it here
                          so the counter knows before they start hunting. */}
                      {l.onHand < 0 && <span style={{ color: C.rd, fontWeight: "var(--weight-bold)" }}> · {t.cntNegativeBook.replace("{n}", l.onHand)}</span>}
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {l.opening}
                    <span style={{ color: C.sub, fontSize: "var(--text-2xs)" }}>
                      {" "}{l.openingSource === "counted" ? t.cntOpeningCounted : t.cntOpeningDerived}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", color: C.gr, whiteSpace: "nowrap" }}>
                    +{l.received}{l.adjusted ? ` (${l.adjusted > 0 ? "+" : ""}${l.adjusted} adj)` : ""}
                  </td>
                  {/* Net of returns, so it can be negative in a month where more
                      came back than went out. Rendering a bare "−" prefix would
                      print "−-3" there. */}
                  <td style={{ padding: "8px 10px", color: C.am, whiteSpace: "nowrap" }}>
                    {l.used < 0 ? `+${Math.abs(l.used)}` : `−${l.used}`}
                  </td>
                  <td style={{ padding: "8px 10px", fontWeight: "var(--weight-bold)", color: C.navy, whiteSpace: "nowrap" }}>
                    {l.expected} {l.unit}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {canEdit && !isClosed ? (
                      <Inp
                        type="number"
                        value={entries[l.iid]?.counted ?? ""}
                        placeholder="—"
                        onChange={(e) => setCounted(l.iid, e.target.value)}
                        style={{ width: 84, padding: "4px 8px" }}
                        aria-label={`${t.cntColCounted} ${l.name}`}
                      />
                    ) : (
                      <span style={{ fontWeight: "var(--weight-bold)" }}>{l.counted == null ? "—" : l.counted}</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", fontWeight: "var(--weight-black)", whiteSpace: "nowrap", color: v == null ? C.sub : v < 0 ? C.rd : v > 0 ? C.am : C.gr }}>
                    {v == null ? "—" : `${v > 0 ? "+" : ""}${v}`}
                  </td>
                  {canSeeMoney && (
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: v == null ? C.sub : v < 0 ? C.rd : C.navy }}>
                      {v == null ? "—" : fm(v * l.price)}
                    </td>
                  )}
                </tr>
              );
            })}
            {visibleLines.length === 0 && (
              <tr>
                <td colSpan={canSeeMoney ? 8 : 7} style={{ padding: 28, textAlign: "center", color: C.sub, fontStyle: "italic" }}>
                  {t.cntNoRows}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dirty && (
        <div style={{ marginTop: 10, fontSize: "var(--text-xs)", color: C.am, fontWeight: "var(--weight-bold)" }}>
          {t.cntUnsaved}
        </div>
      )}
      {isClosed && countRow?.closed_at && (
        <div style={{ marginTop: 10, fontSize: "var(--text-xs)", color: C.sub }}>
          {t.cntClosedOn} {new Date(countRow.closed_at).toLocaleDateString()} ·{" "}
          {resolvePersonName(users, countRow.closed_by, t)}
        </div>
      )}
    </div>
  );
}
