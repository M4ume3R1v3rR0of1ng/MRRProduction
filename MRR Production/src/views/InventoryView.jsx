// src/views/InventoryView.jsx
import { useState, useMemo, useEffect } from "react";
import { supabase, updateRowStrict } from "../utils/supabase";
import { C, fm, tot, newestPrice } from "../utils/helpers";
import { Btn, Inp, Sel } from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { useNotify } from "../context/NotificationContext";
import { translations } from "../utils/translations";
import { uploadPhotoToBucket } from "../utils/storageBucketUpload";
import JobTemplatesModal from "./inventory/JobTemplatesModal";
import BulkReceiveModal from "./inventory/BulkReceiveModal";
import ItemDetailModal from "./inventory/ItemDetailModal";
import ItemFormModal from "./inventory/ItemFormModal";
import ReceiveBatchModal from "./inventory/ReceiveBatchModal";
import AdjustStockModal from "./inventory/AdjustStockModal";
import BatchCorrectionModal from "./inventory/BatchCorrectionModal";


export default function InventoryView({
  inv = [],
  setInv,
  jobs = [],
  setJobs,
  users,
  user,
  perms,
  inventorySearchQuery,
  setInventorySearchQuery,
  lang = "en",
}) {
  const t = translations[lang] || translations.en;
  const [saving, setSaving] = useState(false);
  const [srch, setSrch] = useState(inventorySearchQuery);
  const [cat, setCat] = useState("All");
  const [sortBy, setSortBy] = useState("name_az");
  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  // Which batch the correction dialog is opened on. Sibling of `sel`; the
  // dialog owns its own form state, the parent owns the selection.
  const [batchSel, setBatchSel] = useState(null);
  useEffect(() => {
    setSrch(inventorySearchQuery);
  }, [inventorySearchQuery]);
  
  const { showToast } = useNotify();


  // Fix 8: Memoize categories array computation so it only evaluates if inv updates
  const cats = useMemo(() => {
    const rawCats = inv.map((i) => i?.cat).filter(Boolean);
    return ["All", ...new Set(rawCats)].sort();
  }, [inv]);

  // Fix 3 & 8: Memoize filtered inventory grid search with comprehensive null-protection fallbacks
  const filtered = useMemo(() => {
    const sorters = {
      name_az: (a, b) => (a?.name || "").localeCompare(b?.name || "", undefined, { numeric: true }),
      name_za: (a, b) => (b?.name || "").localeCompare(a?.name || "", undefined, { numeric: true }),
      cat_az: (a, b) => (a?.cat || "").localeCompare(b?.cat || ""),
      stock_low: (a, b) => tot(a) - tot(b),
      stock_high: (a, b) => tot(b) - tot(a),
      price_low: (a, b) => newestPrice(a) - newestPrice(b),
      price_high: (a, b) => newestPrice(b) - newestPrice(a),
    };
    return inv
      .filter(
        (i) =>
          (i?.name || "").toLowerCase().includes(srch.toLowerCase()) &&
          (cat === "All" || i?.cat === cat),
      )
      .sort(sorters[sortBy] || sorters.name_az);
  }, [inv, srch, cat, sortBy]);

  // Fix 3 & 8: Memoize bulk filtering to avoid redundant rendering computations

  // Reorder signalling uses vivid traffic-light colors ON PURPOSE — not the muted
  // barnwood brand tokens (C.rd is rust, C.am is brown, C.gr is sage). A low item has to
  // jump off the screen so it's obvious what needs ordering; functional clarity beats
  // brand harmony for this one signal. Scoped to inventory, so nothing else reskins.
  const STOCK_RED = "var(--c-rust)";
  const STOCK_YELLOW = "var(--c-warn)";
  const STOCK_GREEN = "var(--c-pasture)";

  const toggleSpecial = async (item, e) => {
    e.stopPropagation();
    if (!perms.inv_edit) return;
    const special = !item.special;
    try {
      const { error } = await updateRowStrict("inventory", item.id, { special });
      if (error) throw error;
      setInv((p) => p.map((i) => (i.id === item.id ? { ...i, special } : i)));
      setSel((p) => (p && p.id === item.id ? { ...p, special } : p));
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `${special ? "Marked" : "Unmarked"} "${item.name}" as special`,
        { item_id: item.id, special },
        "inventory",
      );
    } catch (err) {
      showToast(`Failed to update special status: ${err.message}`, "error");
    }
  };

  const setPhoto = async (id, data) => {
    try {
      const photo_url = data ? await uploadPhotoToBucket("inventory-photos", user.companyId, id, data) : null;
      const { error } = await updateRowStrict("inventory", id, { photo_url });
      if (error) throw error;
      setInv((p) => p.map((i) => (i.id === id ? { ...i, photo_url } : i)));
      setSel((p) => (p && p.id === id ? { ...p, photo_url } : p));
    } catch (err) {
      showToast(`Failed to save item photo: ${err.message}`, "error");
    }
  };

  // Current batches for one item straight from the database. Local state can
  // be hours old (it loads once at sign-in), so batch mutations must build on
  // this instead of the in-memory copy or they erase other devices' changes.
  const fetchLiveBatches = async (itemId) => {
    const { data, error } = await supabase
      .from("inventory")
      .select("batches")
      .eq("id", itemId)
      .single();
    if (error) throw error;
    return data?.batches || [];
  };


  // Every dialog reports what changed rather than being handed a setter. This is
  // the single place that folds a result into both the catalog list and the item
  // currently open behind the dialog, so the two cannot drift apart.
  const patchItem = (id, changes) => {
    setInv((p) => p.map((i) => (i.id === id ? { ...i, ...changes } : i)));
    setSel((p) => (p && p.id === id ? { ...p, ...changes } : p));
  };
  const patchBatches = (id, batches) => patchItem(id, { batches });

  const deleteItem = async () => {
    if (!sel || !window.confirm(`Permanently delete ${sel.name} from inventory?`)) return;
    const { error } = await supabase.from("inventory").delete().eq("id", sel.id);
    if (error) { showToast(`Database Error: ${error.message}`, "error"); return; }
    setInv((p) => p.filter((i) => i.id !== sel.id));
    await logAction(user?.id ?? null, user?.email ?? null, "INV_MUTATION", `Permanently purged catalog blueprint item: "${sel.name}"`, { item_id: sel.id });
    setModal(null);
  };

  return (
    
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: "var(--space-4)" }}>
        <div>
          {/* ── 🟢 FIXED: TRANSLATED CORE MAIN HEADER TERMINALS ── */}
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy }}>
            📦 {t.inventory || "Inventory"}
          </h1>
          <p style={{ margin: "2px 0 0", color: C.sub, fontSize: "var(--text-sm)" }}>
            {inv.length} {lang === "es" ? "posiciones de catálogo registradas" : "catalog positions registered"} ·{" "}
            {lang === "es" ? "Niveles de stock en tiempo real" : "Real-time stock level counts"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {perms.inv_bulk_receive && (
            <Btn v="gold" onClick={() => setModal("bulk")}>
              {/* ── 🟢 FIXED: TRANSLATED ACTION BUTTONS ── */}
              📦 {lang === "es" ? "Recibir Pedido en Bloque" : "Receive Bulk Order"}
            </Btn>
          )}
          {perms.inv_edit && (
            <Btn v="outline" onClick={() => setModal("tpl")}>
              🧰 {lang === "es" ? "Plantillas" : "Templates"}
            </Btn>
          )}
          {perms.inv_edit && (
            <Btn v="primary" onClick={() => setModal("add")}>
              {/* ── 🟢 FIXED: TRANSLATED ACTION BUTTONS ── */}
              + {lang === "es" ? "Agregar Artículo" : "Add Item"}
            </Btn>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: 14, flexWrap: "wrap" }}>
        <Inp 
          /* ── 🟢 FIXED: TRANSLATED SEARCH INPUT PLACEHOLDER ── */
          placeholder={t.searchInventory || "🔍 Search items..."} 
          value={srch} 
          onChange={(e) => {
            setSrch(e.target.value);
            if (typeof setInventorySearchQuery === "function") {
              setInventorySearchQuery(e.target.value);
            }
          }} 
          style={{ flex: 1, minWidth: 160, maxWidth: 300 }} 
        />
    <Sel value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: "auto" }}>
      {cats.map((c) => (<option key={c} value={c}>{c}</option>))}
    </Sel>
    <Sel value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort inventory" style={{ width: "auto" }}>
      <option value="name_az">↕ Name — A to Z</option>
      <option value="name_za">↕ Name — Z to A</option>
      <option value="cat_az">↕ Category — A to Z</option>
      <option value="stock_low">↕ Stock — Low to High</option>
      <option value="stock_high">↕ Stock — High to Low</option>
      {perms.inv_pricing_view && <option value="price_low">↕ Price — Low to High</option>}
      {perms.inv_pricing_view && <option value="price_high">↕ Price — High to Low</option>}
    </Sel>
  </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: "var(--space-5)" }}>
        {filtered.map((item) => {
          const stock = tot(item);
          const photo = item.photo_url;
          
          // Traffic light: RED = order now (out, or at/below the reorder point),
          // YELLOW = getting close, GREEN = healthy. `critical` drives the 🚨 flag.
          const getStockStatusMeta = (currentStock, alertThreshold) => {
            const t = alertThreshold || 0;
            if (currentStock <= 0) return { dot: "🔴", label: "Out of Stock", color: STOCK_RED, critical: true };
            if (currentStock <= t) return { dot: "🔴", label: "Reorder Now", color: STOCK_RED, critical: true };
            if (currentStock <= t * 1.5) return { dot: "🟡", label: "Getting Low", color: STOCK_YELLOW, critical: false };
            return { dot: "🟢", label: "In Stock", color: STOCK_GREEN, critical: false };
          };

          const stockStatus = getStockStatusMeta(stock, item.alrt);

          return (
            
            <div
              key={item.id}
              className="mrr-card-click"
              onClick={() => { setSel(item); setModal("detail"); }}
              style={{
                background: C.w,
                borderRadius: "var(--radius-xl)",
                overflow: "hidden",
                boxShadow: "var(--shadow-sm)",
                border: item.special ? `2px solid ${C.gold}` : `2px solid ${stockStatus.color}`, // Dynamic border accent tracking stock state
                cursor: "pointer",
                position: "relative",
              }}
            >
              {(perms.inv_edit || item.special) && (
                <button
                  onClick={(e) => toggleSpecial(item, e)}
                  disabled={!perms.inv_edit}
                  title={item.special ? "Remove from Special" : "Mark as Special"}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    zIndex: 2,
                    width: 26,
                    height: 26,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(0,0,0,0.45)",
                    border: "none",
                    borderRadius: "50%",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                    color: C.w,
                    cursor: perms.inv_edit ? "pointer" : "default",
                  }}
                >
                  {item.special ? "⭐" : "☆"}
                </button>
              )}
              {photo ? (
                <div style={{ height: 110, overflow: "hidden", background: C.lg, position: "relative" }}>
                  <img src={photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.65)", color: C.w, borderRadius: 20, fontSize: "var(--text-2xs)", padding: "2px 8px", fontWeight: "var(--weight-bold)" }}>
                    {stockStatus.dot} {stockStatus.label}
                  </div>
                </div>
              ) : (
                <div style={{ height: 6, background: stockStatus.color }} />
              )}
              
              <div style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyGroup: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {!photo && (
                      <div style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-extrabold)", color: stockStatus.color, textTransform: "uppercase", marginBottom: 2 }}>
                        {stockStatus.dot} {stockStatus.label}
                      </div>
                    )}
                    <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, fontSize: "var(--text-base)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: C.sub }}>{item.cat}</div>
                  </div>
                  {stockStatus.critical && <span style={{ fontSize: 15, marginLeft: 4 }}>🚨</span>}
                </div>
                
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "var(--text-3xl)", fontWeight: "var(--weight-black)", color: stockStatus.color }}>{stock}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: C.sub }}>{item.unit} available</div>
                  </div>
                  {perms.inv_pricing_view ? (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.blue }}>{fm(newestPrice(item))}</div>
                      <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>per {item.unit?.replace(/s$/, "") || "unit"}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "var(--text-xs)", color: C.sub }}>Pricing restricted</div>
                  )}
                </div>
                
                {!photo && (
                  <div style={{ marginTop: 8, height: 4, background: C.lg, borderRadius: 2 }}>
                    <div style={{ height: "100%", background: stockStatus.color, borderRadius: 2, width: `${Math.min(100, (stock / (item.alrt * 3 || 1)) * 100)}%` }} />
                  </div>
                )}
                
                <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                  <span>Min Alert: {item.alrt} {item.unit}</span>
                  <span>{(item.batches || []).length} batch{(item.batches || []).length !== 1 ? "es" : ""}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 🧰 JOB MATERIAL TEMPLATES MANAGER ── */}
      {modal === "tpl" && <JobTemplatesModal inv={inv} onClose={() => setModal(null)} />}

      {modal === "bulk" && perms.inv_bulk_receive && (
        <BulkReceiveModal inv={inv} setInv={setInv} users={users} user={user} perms={perms} onClose={() => setModal(null)} />
      )}

      {modal === "detail" && sel && (
        <ItemDetailModal
          item={sel}
          users={users}
          perms={perms}
          onSetPhoto={setPhoto}
          onEdit={() => setModal("edit")}
          onReceive={() => setModal("rcv")}
          onAdjust={() => setModal("adjust")}
          onDelete={deleteItem}
          onCorrectBatch={(b) => { setBatchSel(b); setModal("batch"); }}
          onClose={() => setModal(null)}
        />
      )}

      {(modal === "add" || (modal === "edit" && sel)) && (
        <ItemFormModal
          item={modal === "edit" ? sel : null}
          user={user}
          perms={perms}
          fetchLiveBatches={fetchLiveBatches}
          onCreated={(record) => setInv((p) => [...p, record])}
          onSaved={patchItem}
          onClose={() => setModal(modal === "edit" ? "detail" : null)}
        />
      )}

      {modal === "rcv" && sel && (
        <ReceiveBatchModal
          item={sel}
          user={user}
          users={users}
          perms={perms}
          fetchLiveBatches={fetchLiveBatches}
          onReceived={patchBatches}
          onClose={() => setModal("detail")}
        />
      )}

      {modal === "adjust" && sel && (
        <AdjustStockModal
          item={sel}
          user={user}
          users={users}
          fetchLiveBatches={fetchLiveBatches}
          onAdjusted={patchBatches}
          onClose={() => setModal("detail")}
        />
      )}

      {modal === "batch" && sel && batchSel && (
        <BatchCorrectionModal
          item={sel}
          batch={batchSel}
          jobs={jobs}
          users={users}
          user={user}
          perms={perms}
          fetchLiveBatches={fetchLiveBatches}
          onCorrected={patchBatches}
          onJobRecosted={(jobId, next) => setJobs?.((p) => p.map((x) => (x.id === jobId ? { ...x, ...next } : x)))}
          onClose={() => { setBatchSel(null); setModal("detail"); }}
        />
      )}

    </div>
  );
}