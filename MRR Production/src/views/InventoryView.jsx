// src/views/InventoryView.jsx
import { useState, useMemo, useEffect } from "react";
import { supabase } from "../utils/supabase";
import { C, uid, fd, fm, tot, newestPrice } from "../utils/helpers";
import {
  Btn,
  Bdg,
  Fld,
  Inp,
  Sel,
  Modal,
  PhotoUpload,
} from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { useNotify } from "../context/NotificationContext";
import { translations } from "../utils/translations";


export default function InventoryView({ 
  inv = [], 
  setInv, 
  users, 
  user, 
  perms, 
  inventorySearchQuery, 
  setInventorySearchQuery, 
  lang = "en",
  invPhotos = [], 
  setInvPhotos
}) {
  const t = translations[lang] || translations.en;
  const [saving, setSaving] = useState(false);
  const [srch, setSrch] = useState(inventorySearchQuery);
  const [cat, setCat] = useState("All");
  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState({});
  const [bulkItems, setBulkItems] = useState([]);
  const [bulkMeta, setBulkMeta] = useState({
    date: new Date().toISOString().split("T")[0],
    po: "",
    vendor: "",
  });
  useEffect(() => {
    setSrch(inventorySearchQuery);
  }, [inventorySearchQuery]);
  
  const [bulkSrch, setBulkSrch] = useState("");
  const { showToast } = useNotify();

  // Fix 8: Memoize categories array computation so it only evaluates if inv updates
  const cats = useMemo(() => {
    const rawCats = inv.map((i) => i?.cat).filter(Boolean);
    return ["All", ...new Set(rawCats)].sort();
  }, [inv]);

  // Fix 3 & 8: Memoize filtered inventory grid search with comprehensive null-protection fallbacks
  const filtered = useMemo(() => {
    return inv.filter(
      (i) =>
        (i?.name || "").toLowerCase().includes(srch.toLowerCase()) &&
        (cat === "All" || i?.cat === cat),
    );
  }, [inv, srch, cat]);

  // Fix 3 & 8: Memoize bulk filtering to avoid redundant rendering computations
  const bulkFiltered = useMemo(() => {
    return inv.filter(
      (i) =>
        (i?.name || "").toLowerCase().includes(bulkSrch.toLowerCase()) &&
        !bulkItems.find((b) => b.iid === i.id),
    );
  }, [inv, bulkSrch, bulkItems]);

  const sClr = (i) => {
    const s = tot(i);
    if (s <= i.alrt) return C.rd;
    if (s <= i.alrt * 1.5) return C.am;
    return C.gr;
  };

  const setPhoto = (id, data) =>
    setInvPhotos((p) =>
      data
        ? { ...p, [id]: data }
        : Object.fromEntries(Object.entries(p).filter(([k]) => k !== id)),
    );

  const addItem = async () => {
    if (!form.name || !form.cat || !form.unit) {
      showToast("Please fill out all required item fields.", "warning");
      return;
    }

    setSaving(true);
    const record = {
      id: "i_" + uid(),
      name: form.name.trim(),
      cat: form.cat,
      unit: form.unit,
      alrt: parseInt(form.alrt) || 5,
      batches: [],
    };

    try {
      const { error } = await supabase.from("inventory").insert([record]);
      if (error) throw error;

      setInv((p) => [...p, record]);

     // Fix 2: Null safety cascade checks applied on log definitions
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Created new catalog material item: "${record.name}"`,
        { item_id: record.id, category: record.cat, unit: record.unit },
        
        // ── 🟢 FIXED: ADDED THE 6TH PARAMETER STRATEGIC MODULE TAG ──
        "inventory" 
      );

      showToast("Catalog item added successfully.", "success");
      setModal(null);
      setForm({});
    } catch (err) {
      console.error(err);
      showToast(`Database Error adding item: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const editItem = async () => {
    if (!sel) return;
    setSaving(true);
    const updatedFields = {
      name: form.name?.trim(),
      cat: form.cat,
      unit: form.unit,
      alrt: parseInt(form.alrt) || sel.alrt,
    };

    try {
      const { error } = await supabase
        .from("inventory")
        .update(updatedFields)
        .eq("id", sel.id);

      if (error) throw error;

      setInv((p) =>
        p.map((i) => (i.id === sel.id ? { ...i, ...updatedFields } : i)),
      );

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Modified catalog specifications for item: "${sel.name}"`,
        { item_id: sel.id, changes: updatedFields },
        
        // ── 🟢 FIXED: ADDED THE 6TH PARAMETER STRATEGIC MODULE TAG ──
        "inventory"
      );

      showToast("Changes saved successfully.", "success");
      setModal(null);
      setForm({});
    } catch (err) {
      console.error(err);
      showToast(`Database Error modifying catalog record: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const rcvBatch = async () => {
    if (!form.qty || !form.price || !form.date || !sel) return;
    setSaving(true);

    const b = {
      id: "b_" + uid(),
      rcvd: form.date,
      qty: parseFloat(form.qty),
      price: parseFloat(form.price) || newestPrice(sel),
      by: user?.id || "system",
      rem: parseFloat(form.qty),
    };

    // Fix 4: Safeguard against non-iterable batches array states using a defensive fallback array
    const updatedBatches = [...(sel.batches || []), b];

    try {
      const { error } = await supabase
        .from("inventory")
        .update({ batches: updatedBatches })
        .eq("id", sel.id);

      if (error) throw error;

      setInv((p) =>
        p.map((i) => (i.id === sel.id ? { ...i, batches: updatedBatches } : i)),
      );
      const updatedItem = { ...sel, batches: updatedBatches };

      if (tot(updatedItem) <= updatedItem.alrt) {
        const managers = users.filter(
          (u) =>
            (u.role === "manager" ||
              u.role === "coordinator" ||
              u.role === "warehouse") &&
            u.active,
        );
        managers.forEach((mgr) => {
          if (mgr.email) {
            fetch("/.netlify/functions/send-alert", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: mgr.email,
                itemName: updatedItem.name,
                currentStock: tot(updatedItem),
                unit: updatedItem.unit,
                alertThreshold: updatedItem.alrt,
              }),
            }).catch((err) => console.error("Email processing error:", err));
          }
        });
      }

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Received new inbound batch stack for material: "${sel.name}"`,
        { item_id: sel.id, quantity_added: b.qty, unit_cost: b.price },
      );

      showToast("Batch successfully received.", "success");
      setModal(null);
      setForm({});
    } catch (err) {
      console.error(err);
      showToast(`Database Error posting receipt batch: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const addToBulk = (item) =>
    setBulkItems((p) => [
      ...p,
      {
        iid: item.id,
        iname: item.name,
        unit: item.unit,
        qty: "",
        price: newestPrice(item) ? String(newestPrice(item)) : "",
      },
    ]);

  const removeBulk = (iid) =>
    setBulkItems((p) => p.filter((b) => b.iid !== iid));

  const updateBulk = (iid, field, val) =>
    setBulkItems((p) =>
      p.map((b) => (b.iid === iid ? { ...b, [field]: val } : b)),
    );

  const bulkTotal = useMemo(() => {
    return bulkItems.reduce(
      (s, b) => s + (parseFloat(b.qty) || 0) * (parseFloat(b.price) || 0),
      0,
    );
  }, [bulkItems]);

  const confirmBulk = async () => {
    if (!bulkMeta.date) {
      showToast("Please set a received date.", "info");
      return;
    }
    const valid = bulkItems.filter((b) => parseFloat(b.qty) > 0);
    if (valid.length === 0) {
      showToast("Add at least one item with a quantity > 0.", "info");
      return;
    }

    setSaving(true);

    const stateSnapshot = inv.map((item) => {
      const bi = valid.find((b) => b.iid === item.id);
      if (!bi) return item;
      const nb = {
        id: "b_" + uid(),
        rcvd: bulkMeta.date,
        qty: parseFloat(bi.qty),
        price: parseFloat(bi.price) || 0,
        by: user?.id || "system",
        rem: parseFloat(bi.qty),
        ref: bulkMeta.po || "",
        vendor: bulkMeta.vendor || "",
      };
      // Fix 4: Safeguard nested batch appends as well against undefined structures
      return { ...item, batches: [...(item.batches || []), nb] };
    });

    try {
      await Promise.all(
        valid.map((bi) => {
          const matchingItem = inv.find((i) => i.id === bi.iid);
          const nb = {
            id: "b_" + uid(),
            rcvd: bulkMeta.date,
            qty: parseFloat(bi.qty),
            price: parseFloat(bi.price) || 0,
            by: user?.id || "system",
            rem: parseFloat(bi.qty),
            ref: bulkMeta.po || "",
            vendor: bulkMeta.vendor || "",
          };
          return supabase
            .from("inventory")
            .update({ batches: [...(matchingItem?.batches || []), nb] })
            .eq("id", bi.iid);
        }),
      );

      setInv(stateSnapshot);

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Processed bulk purchase order delivery into warehouse roster`,
        {
          purchase_order: bulkMeta.po || "N/A",
          vendor: bulkMeta.vendor || "N/A",
          item_count: valid.length,
          total_manifest_value: bulkTotal,
        },
      );

      showToast("Bulk delivery received successfully.", "success");
      setModal(null);
      setBulkItems([]);
      setBulkMeta({
        date: new Date().toISOString().split("T")[0],
        po: "",
        vendor: "",
      });
      setBulkSrch("");
    } catch (err) {
      console.error(err);
      showToast(`Error logging batch payload operations: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          {/* ── 🟢 FIXED: TRANSLATED CORE MAIN HEADER TERMINALS ── */}
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>
            📦 {t.inventory || "Inventory"}
          </h1>
          <p style={{ margin: "2px 0 0", color: C.sub, fontSize: 12 }}>
            {inv.length} {lang === "es" ? "posiciones de catálogo registradas" : "catalog positions registered"} ·{" "}
            {lang === "es" ? "Niveles de stock en tiempo real" : "Real-time stock level counts"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {perms.inv_bulk_receive && (
            <Btn v="gold" onClick={() => { setBulkItems([]); setBulkMeta({ date: new Date().toISOString().split("T")[0], po: "", vendor: "" }); setBulkSrch(""); setModal("bulk"); }}>
              {/* ── 🟢 FIXED: TRANSLATED ACTION BUTTONS ── */}
              📦 {lang === "es" ? "Recibir Pedido en Bloque" : "Receive Bulk Order"}
            </Btn>
          )}
          {perms.inv_edit && (
            <Btn v="primary" onClick={() => { setModal("add"); setForm({ unit: "rolls", alrt: "10" }); }}>
              {/* ── 🟢 FIXED: TRANSLATED ACTION BUTTONS ── */}
              + {lang === "es" ? "Agregar Artículo" : "Add Item"}
            </Btn>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
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
  </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
        {filtered.map((item) => {
          const stock = tot(item);
          const photo = invPhotos[item.id];
          
          // Added User Interface Color Optimization Mapping
          const getStockStatusMeta = (currentStock, alertThreshold) => {
            if (currentStock <= 0) {
              return { dot: "🔴", label: "Out of Stock", color: C.rd };
            }
            if (currentStock <= alertThreshold) {
              return { dot: "🟡", label: "Low Stock", color: C.am };
            }
            return { dot: "🟢", label: "In Stock", color: C.gr };
          };

          const stockStatus = getStockStatusMeta(stock, item.alrt);

          return (
            
            <div
              key={item.id}
              onClick={() => { setSel(item); setForm({ name: item.name, cat: item.cat, unit: item.unit, alrt: item.alrt }); setModal("detail"); }}
              style={{
                background: C.w,
                borderRadius: 12,
                overflow: "hidden",
                boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
                border: `2px solid ${stockStatus.color}`, // Dynamic border accent tracking stock state
                cursor: "pointer",
              }}
            >
              {photo ? (
                <div style={{ height: 110, overflow: "hidden", background: C.lg, position: "relative" }}>
                  <img src={photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.65)", color: C.w, borderRadius: 20, fontSize: 10, padding: "2px 8px", fontWeight: 700 }}>
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
                      <div style={{ fontSize: 10, fontWeight: 800, color: stockStatus.color, textTransform: "uppercase", marginBottom: 2 }}>
                        {stockStatus.dot} {stockStatus.label}
                      </div>
                    )}
                    <div style={{ fontWeight: 800, color: C.navy, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: C.sub }}>{item.cat}</div>
                  </div>
                  {stockStatus.color === C.rd && <span style={{ fontSize: 15, marginLeft: 4 }}>🚨</span>}
                </div>
                
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: stockStatus.color }}>{stock}</div>
                    <div style={{ fontSize: 11, color: C.sub }}>{item.unit} available</div>
                  </div>
                  {perms.inv_pricing_view ? (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.blue }}>{fm(newestPrice(item))}</div>
                      <div style={{ fontSize: 10, color: C.sub }}>per {item.unit?.replace(/s$/, "") || "unit"}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: C.sub }}>Pricing restricted</div>
                  )}
                </div>
                
                {!photo && (
                  <div style={{ marginTop: 8, height: 4, background: C.lg, borderRadius: 2 }}>
                    <div style={{ height: "100%", background: stockStatus.color, borderRadius: 2, width: `${Math.min(100, (stock / (item.alrt * 3 || 1)) * 100)}%` }} />
                  </div>
                )}
                
                <div style={{ fontSize: 10, color: C.sub, marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                  <span>Min Alert: {item.alrt} {item.unit}</span>
                  <span>{(item.batches || []).length} batch{(item.batches || []).length !== 1 ? "es" : ""}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modal === "detail" && sel && (
        <Modal title={sel.name} onClose={() => setModal(null)} wide>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Product Photo</div>
              <PhotoUpload current={invPhotos[sel.id] || null} onUpload={(data) => setPhoto(sel.id, data)} label="Upload product photo" previewHeight={180} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Item Details</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  ["Total Stock", `${tot(sel)} ${sel.unit}`],
                  ["Category", sel.cat],
                  ["Unit", sel.unit],
                  ...(perms.inv_pricing_view
                    ? [
                        ["Current Price", fm(newestPrice(sel))],
                        ["Low Alert", `${sel.alrt} ${sel.unit}`],
                      ]
                    : [["Low Alert", `${sel.alrt} ${sel.unit}`]]),
                  ["Batches", (sel.batches || []).length],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: C.lg, borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: "uppercase" }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {perms.inv_edit && (
                  <Btn v="outline" sz="sm" onClick={() => { setForm({ name: sel.name, cat: sel.cat, unit: sel.unit, alrt: sel.alrt }); setModal("edit"); }}>✏️ Edit Specifications</Btn>
                )}
                {perms.inv_receive && (
                  <Btn v="primary" sz="sm" onClick={() => { setForm({ date: new Date().toISOString().split("T")[0], qty: "", price: "" }); setModal("rcv"); }}>+ Receive Batch</Btn>
                )}
                {perms.inv_edit && (
                  <Btn v="danger" sz="sm" onClick={async () => {
                    if (window.confirm(`Permanently delete ${sel.name} from inventory?`)) {
                      const { error } = await supabase.from("inventory").delete().eq("id", sel.id);
                      if (error) showToast(`Database Error: ${error.message}`, "error");
                      else {
                        setInv((p) => p.filter((i) => i.id !== sel.id));
                        await logAction(user?.id ?? null, user?.email ?? null, "INV_MUTATION", `Permanently purged catalog blueprint item: "${sel.name}"`, { item_id: sel.id });
                        setModal(null);
                      }
                    }
                  }}>🗑️ Delete Product</Btn>
                )}
              </div>
            </div>
          </div>
          
          <h4 style={{ margin: "0 0 8px", color: C.navy, fontSize: 12, textTransform: "uppercase" }}>Batch History (FIFO)</h4>
          {[...(sel.batches || [])]
            .sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd))
            .map((b, i) => (
              <div key={b.id} style={{ padding: "10px 14px", background: i === 0 && b.rem > 0 ? "rgba(27,82,184,0.08)" : C.lg, borderRadius: 8, border: i === 0 && b.rem > 0 ? `1.5px solid ${C.blue}` : "none", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>
                      {i === 0 && b.rem > 0 && <span style={{ color: C.blue }}>▶ ACTIVE · </span>}
                      {fd(b.rcvd)}{b.vendor && <span style={{ color: C.sub }}> · {b.vendor}</span>}{b.ref && <span style={{ color: C.tl }}> · {b.ref}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: C.sub }}>By: {users.find((u) => u.id === b.by)?.name || "Unknown"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, color: b.rem === 0 ? C.sub : C.gr, fontSize: 12 }}>{b.rem}/{b.qty} remaining</div>
                    {perms.inv_pricing_view && <div style={{ fontSize: 11, color: C.blue, fontWeight: 700 }}>{fm(b.price)} ea.</div>}
                  </div>
                </div>
              </div>
            ))}
          {(sel.batches || []).length === 0 && <p style={{ color: C.sub, fontSize: 13 }}>No receipt stacks logged yet.</p>}
        </Modal>
      )}

      {modal === "add" && (
        <Modal title="Add New Catalog Position" onClose={() => setModal(null)}>
          <Fld label="Item Name *"><Inp value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Drip Edge - White" /></Fld>
          <Fld label="Category *">
            <Sel value={form.cat || ""} onChange={(e) => setForm({ ...form, cat: e.target.value })}><option value="">— Select a category —</option>{["Roofing Materials", "Fasteners", "Sealants", "Ventilation", "Decking", "Sheet Metal", "Accessories", "Tools"].map((c) => (<option key={c} value={c}>{c}</option>))}</Sel>
          </Fld>
          <Fld label="Unit *">
            <Sel value={form.unit || "rolls"} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{["rolls", "boxes", "each", "tubes", "bundles", "packs", "sheets", "gallons", "lbs"].map((u) => (<option key={u} value={u}>{u}</option>))}</Sel>
          </Fld>
          <Fld label="Low Alert Threshold"><Inp type="number" value={form.alrt || ""} onChange={(e) => setForm({ ...form, alrt: e.target.value })} /></Fld>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
            <Btn v="primary" onClick={addItem} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Creating..." : "Add Position"}</Btn>
          </div>
        </Modal>
      )}

      {modal === "edit" && sel && (
        <Modal title={`Modify Specifications: ${sel.name}`} onClose={() => setModal(null)}>
          <Fld label="Item Name"><Inp value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label="Category">
            <Sel value={form.cat || ""} onChange={(e) => setForm({ ...form, cat: e.target.value })}><option value="">— Select a category —</option>{["Roofing Materials", "Fasteners", "Sealants", "Ventilation", "Decking", "Sheet Metal", "Accessories", "Tools"].map((c) => (<option key={c} value={c}>{c}</option>))}</Sel>
          </Fld>
          <Fld label="Unit">
            <Sel value={form.unit || "rolls"} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{["rolls", "boxes", "each", "tubes", "bundles", "packs", "sheets", "gallons", "lbs"].map((u) => (<option key={u} value={u}>{u}</option>))}</Sel>
          </Fld>
          <Fld label="Low Threshold Alert Level"><Inp type="number" value={form.alrt || ""} onChange={(e) => setForm({ ...form, alrt: e.target.value })} /></Fld>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
            <Btn v="primary" onClick={editItem} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Saving..." : "Save Changes"}</Btn>
          </div>
        </Modal>
      )}

      {modal === "rcv" && sel && (
        <Modal title={`Receive Inbound Stock: ${sel.name}`} onClose={() => setModal(null)}>
          <Fld label="Date Received"><Inp type="date" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Fld>
          <Fld label={`Quantity to Inject (${sel.unit})`}><Inp type="number" value={form.qty || ""} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Fld>
          {perms.inv_pricing_edit ? (
            <Fld label="Price Per Unit">
              <div style={{ position: "relative" }}><span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.sub }}>$</span><Inp type="number" step="0.01" value={form.price || ""} onChange={(e) => setForm({ ...form, price: e.target.value })} style={{ paddingLeft: 22 }} /></div>
            </Fld>
          ) : (
            <div style={{ background: C.aB, border: `1px solid ${C.am}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: C.am }}>
              Pricing is lock-restricted. Last batch unit valuations will automatically cycle carry over.
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
            <Btn v="primary" onClick={rcvBatch} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Processing..." : "Receive Batch"}</Btn>
          </div>
        </Modal>
      )}

      {modal === "bulk" && perms.inv_bulk_receive && (
        <Modal title="📦 Receive Bulk Order Manifest" onClose={() => { setModal(null); setBulkItems([]); setBulkSrch(""); }} wide>
          <div style={{ background: C.gL, border: `1.5px solid ${C.gold}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: C.navy }}>
            ⭐ <strong>Inbound Accounting:</strong> FIFO indices update automatically. Each item maps a standalone discrete batch vector tracking vendor origins.
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, padding: 14, background: C.lg, borderRadius: 10, marginBottom: 16 }}>
            <Fld label="Date Received *"><Inp type="date" value={bulkMeta.date} onChange={(e) => setBulkMeta({ ...bulkMeta, date: e.target.value })} /></Fld>
            <Fld label="PO / Order #"><Inp value={bulkMeta.po} onChange={(e) => setBulkMeta({ ...bulkMeta, po: e.target.value })} placeholder="e.g. PO-2025-100" /></Fld>
            <Fld label="Vendor / Supplier"><Inp value={bulkMeta.vendor} onChange={(e) => setBulkMeta({ ...bulkMeta, vendor: e.target.value })} placeholder="e.g. ABC Supply" /></Fld>
          </div>
          
          <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Select Items to Receive</div>
              <Inp value={bulkSrch} onChange={(e) => setBulkSrch(e.target.value)} placeholder="🔍 Search inventory..." style={{ marginBottom: 8 }} />
              <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                {bulkFiltered.map((item) => (
                  <div key={item.id} style={{ background: C.w, border: `1.5px solid ${C.bd}`, borderRadius: 8, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>{item.name}</div>
                      <div style={{ fontSize: 10, color: C.sub }}>{item.cat} · {tot(item)} {item.unit} available</div>
                    </div>
                    <Btn v="primary" sz="sm" onClick={() => addToBulk(item)}>+ Add</Btn>
                  </div>
                ))}
                {bulkFiltered.length === 0 && (
                  <div style={{ padding: 20, textAlign: "center", color: C.sub, fontSize: 12, background: C.lg, borderRadius: 8 }}>
                    {bulkItems.length > 0 ? "All items matched ✓" : "No matching inventory items found"}
                  </div>
                )}
              </div>
            </div>
            
            <div style={{ flex: "0 0 380px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px" }}>Manifest Queue {bulkItems.length > 0 && `(${bulkItems.length})`}</div>
                {bulkItems.length > 0 && <button onClick={() => setBulkItems([])} style={{ background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: 11, fontWeight: 700 }}>Clear All</button>}
              </div>
              
              {bulkItems.length === 0 ? (
                <div style={{ height: 200, background: C.lg, borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: C.sub, gap: 8 }}>
                  <span style={{ fontSize: 32 }}>📋</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>Manifest queue is empty</span>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto", marginBottom: 10 }}>
                    {bulkItems.map((b) => {
                      const sub = (parseFloat(b.qty) || 0) * (parseFloat(b.price) || 0);
                      return (
                        <div key={b.iid} style={{ background: C.w, border: `1.5px solid ${C.bd}`, borderRadius: 8, padding: "10px 12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                            <span style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>{b.iname}</span>
                            <button onClick={() => removeBulk(b.iid)} style={{ background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: 18, lineHeight: 1 }}>×</button>
                          </div>
                          
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
                            <div>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>Qty ({b.unit})</div>
                              <Inp type="number" min="1" value={b.qty} onChange={(e) => updateBulk(b.iid, "qty", e.target.value)} placeholder="0" style={{ padding: "5px 8px" }} />
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>Unit Price</div>
                              <div style={{ position: "relative" }}>
                                <span style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: C.sub, fontSize: 11 }}>$</span>
                                {perms.inv_pricing_edit ? (
                                  <Inp type="number" step="0.01" min="0" value={b.price} onChange={(e) => updateBulk(b.iid, "price", e.target.value)} placeholder="0.00" style={{ padding: "5px 8px", paddingLeft: 16 }} />
                                ) : (
                                  <Inp value={b.price} readOnly style={{ padding: "5px 8px", paddingLeft: 16, color: C.sub, background: C.lg }} />
                                )}
                              </div>
                            </div>
                            <div style={{ paddingBottom: 2, textAlign: "right" }}>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>Subtotal</div>
                              <div style={{ fontSize: 13, fontWeight: 800, color: sub > 0 ? C.gr : C.sub }}>{fm(sub)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  <div style={{ background: C.navy, borderRadius: 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>Manifest Valuation</div>
                      <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2 }}>
                        {bulkItems.filter((b) => parseFloat(b.qty) > 0).length} valid item positions
                      </div>
                    </div>
                    <div style={{ fontWeight: 900, fontSize: 22, color: C.gold }}>{fm(bulkTotal)}</div>
                  </div>
                </>
              )}
            </div>
          </div>
          
          <div style={{ display: "flex", gap: 10 }}>
            <Btn v="ghost" onClick={() => { setModal(null); setBulkItems([]); setBulkSrch(""); }} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Cancel</Btn>
            <Btn v="gold" sz="lg" onClick={confirmBulk} style={{ flex: 2, justifyContent: "center" }} disabled={saving}>
              {saving ? "⏳ Logging Operation..." : `✅ Commit Manifest (${bulkItems.filter((b) => parseFloat(b.qty) > 0).length} Items)`}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}