// src/views/InventoryView.jsx
import { useState, useMemo, useEffect } from "react";
import { supabase, getAccessToken } from "../utils/supabase";
import { C, uid, fd, fm, tot, newestPrice } from "../utils/helpers";
import { fetchJobTemplates, saveJobTemplates, resolveDefaultTemplates } from "../utils/jobTemplates";
import {
  Btn,
  Bdg,
  Fld,
  Inp,
  Sel,
  TA,
  Modal,
  PhotoUpload,
} from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { useNotify } from "../context/NotificationContext";
import { translations } from "../utils/translations";
import { uploadPhotoToBucket } from "../utils/storageBucketUpload";


export default function InventoryView({ 
  inv = [], 
  setInv, 
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

  // ── 🧰 JOB MATERIAL TEMPLATES MANAGER ──
  const [tpls, setTpls] = useState([]);
  const [tplEditing, setTplEditing] = useState(null); // template object being edited
  const [tplSrch, setTplSrch] = useState("");
  const [tplLoading, setTplLoading] = useState(false);
  const [tplSaving, setTplSaving] = useState(false);

  const openTemplates = async () => {
    setModal("tpl");
    setTplEditing(null);
    setTplSrch("");
    setTplLoading(true);
    try {
      const saved = await fetchJobTemplates();
      setTpls(saved || resolveDefaultTemplates(inv));
    } catch (err) {
      showToast(`Could not load templates: ${err.message}`, "error");
      setTpls(resolveDefaultTemplates(inv));
    } finally {
      setTplLoading(false);
    }
  };

  const persistTemplates = async (next) => {
    setTplSaving(true);
    try {
      await saveJobTemplates(next);
      setTpls(next);
      return true;
    } catch (err) {
      showToast(`Database Error: Could not save templates. ${err.message}`, "error");
      return false;
    } finally {
      setTplSaving(false);
    }
  };

  const saveTplEdit = async () => {
    if (!tplEditing.name.trim()) {
      showToast("Template name is required.", "warning");
      return;
    }
    if (tplEditing.items.length === 0) {
      showToast("Add at least one material to the template.", "warning");
      return;
    }
    const cleaned = { ...tplEditing, name: tplEditing.name.trim() };
    const exists = tpls.find((t) => t.id === cleaned.id);
    const next = exists ? tpls.map((t) => (t.id === cleaned.id ? cleaned : t)) : [...tpls, cleaned];
    if (await persistTemplates(next)) {
      showToast(`Template "${cleaned.name}" saved.`, "success");
      setTplEditing(null);
    }
  };

  const deleteTpl = async (tpl) => {
    if (!window.confirm(`Delete the "${tpl.name}" template? Jobs already built with it are not affected.`)) return;
    if (await persistTemplates(tpls.filter((t) => t.id !== tpl.id))) {
      showToast(`Template "${tpl.name}" deleted.`, "success");
    }
  };

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

  const toggleSpecial = async (item, e) => {
    e.stopPropagation();
    if (!perms.inv_edit) return;
    const special = !item.special;
    try {
      const { error } = await supabase.from("inventory").update({ special }).eq("id", item.id);
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
      const photo_url = data ? await uploadPhotoToBucket("inventory-photos", id, data) : null;
      const { error } = await supabase.from("inventory").update({ photo_url }).eq("id", id);
      if (error) throw error;
      setInv((p) => p.map((i) => (i.id === id ? { ...i, photo_url } : i)));
      setSel((p) => (p && p.id === id ? { ...p, photo_url } : p));
    } catch (err) {
      showToast(`Failed to save item photo: ${err.message}`, "error");
    }
  };

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

    // Current price lives on the newest batch, so a price change rewrites it
    // there (or seeds a zero-qty batch when no receipt history exists yet).
    const oldPrice = newestPrice(sel);
    const newPrice = parseFloat(form.price);
    const priceChanged =
      perms.inv_pricing_edit && form.price !== "" && form.price != null && !isNaN(newPrice) && newPrice !== oldPrice;
    try {
      if (priceChanged) {
        const batches = [...(await fetchLiveBatches(sel.id))];
        if (batches.length > 0) {
          let newest = 0;
          batches.forEach((b, i) => {
            if (new Date(b.rcvd) - new Date(batches[newest].rcvd) > 0) newest = i;
          });
          batches[newest] = { ...batches[newest], price: newPrice };
        } else {
          batches.push({
            id: "b_" + uid(),
            rcvd: new Date().toISOString().split("T")[0],
            qty: 0,
            price: newPrice,
            by: user?.id || "system",
            rem: 0,
          });
        }
        updatedFields.batches = batches;
      }

      const { error } = await supabase
        .from("inventory")
        .update(updatedFields)
        .eq("id", sel.id);

      if (error) throw error;

      setInv((p) =>
        p.map((i) => (i.id === sel.id ? { ...i, ...updatedFields } : i)),
      );
      setSel((p) => (p && p.id === sel.id ? { ...p, ...updatedFields } : p));

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Modified catalog specifications for item: "${sel.name}"${priceChanged ? ` (price ${fm(oldPrice)} → ${fm(newPrice)})` : ""}`,
        {
          item_id: sel.id,
          changes: {
            name: updatedFields.name,
            cat: updatedFields.cat,
            unit: updatedFields.unit,
            alrt: updatedFields.alrt,
            ...(priceChanged ? { price: { from: oldPrice, to: newPrice } } : {}),
          },
        },

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

  const rcvBatch = async () => {
    if (!form.qty || !form.price || !form.date || !sel) return;
    const qty = parseFloat(form.qty);
    const price = parseFloat(form.price);
    // Negative qty/price are allowed intentionally — temporary corrections ahead
    // of a later batch that zeroes them back out. Only reject non-numeric input.
    if (isNaN(qty)) {
      showToast("Quantity must be a valid number.", "warning");
      return;
    }
    if (isNaN(price)) {
      showToast("Price must be a valid number.", "warning");
      return;
    }
    setSaving(true);

    const b = {
      id: "b_" + uid(),
      rcvd: form.date,
      qty,
      price: price || newestPrice(sel),
      by: user?.id || "system",
      rem: qty,
    };

    try {
      const updatedBatches = [...(await fetchLiveBatches(sel.id)), b];
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
        // Only notify users who've opted in via Profile → Inventory Alert Preferences.
        const managers = users.filter(
          (u) =>
            (u.role === "manager" ||
              u.role === "coordinator" ||
              u.role === "warehouse") &&
            u.active &&
            u.receive_email_alerts,
        );
        const alertAccessToken = await getAccessToken();
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
                accessToken: alertAccessToken,
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

  const adjustStock = async () => {
    if (!sel || form.newQty === undefined || form.newQty === "") {
      showToast("Please enter the corrected quantity.", "warning");
      return;
    }
    const newQty = parseFloat(form.newQty);
    if (isNaN(newQty) || newQty < 0) {
      showToast("Quantity must be a valid non-negative number.", "warning");
      return;
    }
    if (newQty === tot(sel)) {
      showToast("No change — quantity already matches.", "info");
      return;
    }

    setSaving(true);
    const reasonSuffix = form.reason?.trim() ? ` — ${form.reason.trim()}` : "";

    try {
      // Correct against live batches so the final total lands on newQty even
      // if other devices changed stock since this session loaded.
      const liveBatches = await fetchLiveBatches(sel.id);
      const current = tot({ batches: liveBatches });
      const delta = newQty - current;
      let updatedBatches;

      if (delta > 0) {
        const correctionBatch = {
          id: "b_" + uid(),
          rcvd: new Date().toISOString().split("T")[0],
          qty: delta,
          price: newestPrice({ batches: liveBatches }) || newestPrice(sel) || 0,
          by: user?.id || "system",
          rem: delta,
          ref: `Manual Adjustment${reasonSuffix}`,
        };
        updatedBatches = [...liveBatches, correctionBatch];
      } else {
        let deficit = Math.abs(delta);
        const sorted = [...liveBatches].sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd));
        updatedBatches = sorted.map((b) => {
          if (deficit <= 0) return b;
          const take = Math.min(parseFloat(b.rem) || 0, deficit);
          deficit -= take;
          return { ...b, rem: (parseFloat(b.rem) || 0) - take };
        });
      }

      const { error } = await supabase.from("inventory").update({ batches: updatedBatches }).eq("id", sel.id);
      if (error) throw error;

      setInv((p) => p.map((i) => (i.id === sel.id ? { ...i, batches: updatedBatches } : i)));
      setSel((p) => (p ? { ...p, batches: updatedBatches } : p));

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Manually adjusted stock for "${sel.name}" from ${current} to ${newQty} ${sel.unit}${reasonSuffix}`,
        { item_id: sel.id, previous_total: current, new_total: newQty, delta },
        "inventory",
      );

      showToast("Stock quantity corrected.", "success");
      setModal(null);
      setForm({});
    } catch (err) {
      console.error(err);
      showToast(`Database Error adjusting stock: ${err.message}`, "error");
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
    // Negative qty/price are allowed intentionally — temporary corrections ahead
    // of a later batch that zeroes them back out. Only exclude zero/non-numeric rows.
    const valid = bulkItems.filter((b) => {
      const qty = parseFloat(b.qty);
      return !isNaN(qty) && qty !== 0;
    });
    if (valid.length === 0) {
      showToast("Add at least one item with a non-zero quantity.", "info");
      return;
    }

    setSaving(true);

    try {
      // Append each receipt to the batches currently in the database — the
      // in-memory list may predate receipts/pulls from other devices.
      const { data: freshRows, error: freshErr } = await supabase
        .from("inventory")
        .select("id,batches")
        .in("id", valid.map((b) => b.iid));
      if (freshErr) throw freshErr;
      const freshById = new Map((freshRows || []).map((r) => [r.id, r.batches || []]));

      const changedBatches = new Map();
      for (const bi of valid) {
        if (!freshById.has(bi.iid)) continue;
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
        changedBatches.set(bi.iid, [...freshById.get(bi.iid), nb]);
      }

      const results = await Promise.all(
        [...changedBatches].map(([iid, batches]) =>
          supabase.from("inventory").update({ batches }).eq("id", iid),
        ),
      );

      // Supabase calls resolve (never throw) with an { error } payload — an
      // unchecked failure here would show success while nothing was saved.
      const firstError = results.map((r) => r?.error).find(Boolean);
      if (firstError) throw firstError;

      setInv((p) => p.map((i) => (changedBatches.has(i.id) ? { ...i, batches: changedBatches.get(i.id) } : i)));

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
            <Btn v="gold" onClick={() => { setBulkItems([]); setBulkMeta({ date: new Date().toISOString().split("T")[0], po: "", vendor: "" }); setBulkSrch(""); setModal("bulk"); }}>
              {/* ── 🟢 FIXED: TRANSLATED ACTION BUTTONS ── */}
              📦 {lang === "es" ? "Recibir Pedido en Bloque" : "Receive Bulk Order"}
            </Btn>
          )}
          {perms.inv_edit && (
            <Btn v="outline" onClick={openTemplates}>
              🧰 {lang === "es" ? "Plantillas" : "Templates"}
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
              className="mrr-card-click"
              onClick={() => { setSel(item); setForm({ name: item.name, cat: item.cat, unit: item.unit, alrt: item.alrt }); setModal("detail"); }}
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
                  {stockStatus.color === C.rd && <span style={{ fontSize: 15, marginLeft: 4 }}>🚨</span>}
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

      {modal === "detail" && sel && (
        <Modal title={sel.name} onClose={() => setModal(null)} wide>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-7)", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Product Photo</div>
              <PhotoUpload current={sel.photo_url || null} onUpload={(data) => setPhoto(sel.id, data)} label="Upload product photo" previewHeight={180} />
            </div>
            <div>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Item Details</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
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
                  <div key={k} style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "var(--text-xs)", color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase" }}>{k}</span>
                    <span style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "var(--space-3)", marginTop: 12, flexWrap: "wrap" }}>
                {perms.inv_edit && (
                  <Btn v="outline" sz="sm" onClick={() => { setForm({ name: sel.name, cat: sel.cat, unit: sel.unit, alrt: sel.alrt, price: newestPrice(sel) ? String(newestPrice(sel)) : "" }); setModal("edit"); }}>✏️ Edit Materials</Btn>
                )}
                {perms.inv_receive && (
                  <Btn v="primary" sz="sm" onClick={() => { setForm({ date: new Date().toISOString().split("T")[0], qty: "", price: "" }); setModal("rcv"); }}>+ Receive Batch</Btn>
                )}
                {perms.inv_adjust && (
                  <Btn v="gold" sz="sm" onClick={() => { setForm({ newQty: String(tot(sel)), reason: "" }); setModal("adjust"); }}>🔧 Adjust Stock</Btn>
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
          
          <h4 style={{ margin: "0 0 8px", color: C.navy, fontSize: "var(--text-sm)", textTransform: "uppercase" }}>Batch History (FIFO)</h4>
          {[...(sel.batches || [])]
            .sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd))
            .map((b, i) => (
              <div key={b.id} style={{ padding: "10px 14px", background: i === 0 && b.rem > 0 ? "rgba(27,82,184,0.08)" : C.lg, borderRadius: "var(--radius-md)", border: i === 0 && b.rem > 0 ? `1.5px solid ${C.blue}` : "none", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)" }}>
                  <div>
                    <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>
                      {i === 0 && b.rem > 0 && <span style={{ color: C.blue }}>▶ ACTIVE · </span>}
                      {fd(b.rcvd)}{b.vendor && <span style={{ color: C.sub }}> · {b.vendor}</span>}{b.ref && <span style={{ color: C.tl }}> · {b.ref}</span>}
                    </div>
                    <div style={{ fontSize: "var(--text-xs)", color: C.sub }}>By: {users.find((u) => u.id === b.by)?.name || "Unknown"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: "var(--weight-extrabold)", color: b.rem === 0 ? C.sub : C.gr, fontSize: "var(--text-sm)" }}>{b.rem}/{b.qty} remaining</div>
                    {perms.inv_pricing_view && <div style={{ fontSize: "var(--text-xs)", color: C.blue, fontWeight: "var(--weight-bold)" }}>{fm(b.price)} ea.</div>}
                  </div>
                </div>
              </div>
            ))}
          {(sel.batches || []).length === 0 && <p style={{ color: C.sub, fontSize: "var(--text-base)" }}>No receipt stacks logged yet.</p>}
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
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
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
          {perms.inv_pricing_edit && (
            <Fld label="Current Price Per Unit">
              <div style={{ position: "relative" }}><span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.sub }}>$</span><Inp type="number" step="0.01" value={form.price || ""} onChange={(e) => setForm({ ...form, price: e.target.value })} style={{ paddingLeft: 22 }} /></div>
            </Fld>
          )}
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
            <Btn v="primary" onClick={editItem} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Saving..." : "Save Changes"}</Btn>
          </div>
        </Modal>
      )}

      {/* ── 🧰 JOB MATERIAL TEMPLATES MANAGER ── */}
      {modal === "tpl" && (
        <Modal
          title="🧰 Job Material Templates"
          onClose={() => { if (!tplSaving) { setModal(null); setTplEditing(null); } }}
          wide
        >
          {tplLoading ? (
            <p style={{ color: C.sub, textAlign: "center", padding: "20px 0" }}>Loading templates...</p>
          ) : tplEditing ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "var(--space-3)" }}>
                <Fld label="Icon">
                  <Inp value={tplEditing.icon || ""} onChange={(e) => setTplEditing({ ...tplEditing, icon: e.target.value })} placeholder="🏠" disabled={tplSaving} />
                </Fld>
                <Fld label="Template Name *">
                  <Inp value={tplEditing.name} onChange={(e) => setTplEditing({ ...tplEditing, name: e.target.value })} placeholder="e.g. Economy Roof" disabled={tplSaving} />
                </Fld>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-5)" }}>
                <div>
                  <h4 style={{ margin: "0 0 8px", color: C.navy, fontSize: "var(--text-sm)" }}>📦 Materials ({tplEditing.items.length})</h4>
                  {tplEditing.items.length === 0 ? (
                    <p style={{ color: C.sub, fontSize: "var(--text-sm)" }}>Add materials from the catalog on the right.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight: 260, overflowY: "auto" }}>
                      {tplEditing.items.map((t, idx) => {
                        const inCatalog = t.iid && inv.find((i) => i && i.id === t.iid);
                        return (
                          <div key={t.iid || `x_${idx}`} style={{ background: C.lg, borderRadius: 7, padding: "7px 9px" }}>
                            <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-xs)", marginBottom: 4 }}>
                              {t.iname} {!inCatalog && <span style={{ color: C.am }}>⚠ not in catalog</span>}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <Inp
                                type="number"
                                value={t.qty}
                                min="1"
                                onChange={(e) => {
                                  const qty = Math.max(1, parseInt(e.target.value) || 1);
                                  setTplEditing((p) => ({ ...p, items: p.items.map((x, i2) => (i2 === idx ? { ...x, qty } : x)) }));
                                }}
                                style={{ width: 55, padding: "3px 6px" }}
                                disabled={tplSaving}
                              />
                              <span style={{ fontSize: "var(--text-2xs)", color: C.sub }}>default qty</span>
                              <button
                                onClick={() => setTplEditing((p) => ({ ...p, items: p.items.filter((_, i2) => i2 !== idx) }))}
                                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: "var(--text-lg)", lineHeight: 1 }}
                                disabled={tplSaving}
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <Inp value={tplSrch} onChange={(e) => setTplSrch(e.target.value)} placeholder="🔍 Search catalog..." style={{ marginBottom: 8 }} disabled={tplSaving} />
                  <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                    {inv
                      .filter((i) => i && (i.name || "").toLowerCase().includes(tplSrch.toLowerCase()) && !tplEditing.items.find((t) => t.iid === i.id))
                      .slice(0, 40)
                      .map((item) => (
                        <div key={item.id} style={{ background: C.w, borderRadius: "var(--radius-md)", padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                          <div>
                            <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-xs)" }}>{item.name}</div>
                            <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>{tot(item)} {item.unit} available</div>
                          </div>
                          <Btn
                            v="primary"
                            sz="sm"
                            onClick={() => setTplEditing((p) => ({ ...p, items: [...p.items, { iid: item.id, iname: item.name, qty: 1 }] }))}
                            disabled={tplSaving}
                          >
                            + Add
                          </Btn>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 14 }}>
                <Btn v="ghost" onClick={() => setTplEditing(null)} style={{ flex: 1, justifyContent: "center" }} disabled={tplSaving}>← Back</Btn>
                <Btn v="primary" onClick={saveTplEdit} style={{ flex: 1, justifyContent: "center" }} disabled={tplSaving}>
                  {tplSaving ? "⏳ Saving..." : "💾 Save Template"}
                </Btn>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 12px", fontSize: "var(--text-sm)", color: C.sub }}>
                These material packages appear in the Build Jobs wizard (Step 2) for one-click job lists.
              </p>
              {tpls.length === 0 && (
                <p style={{ color: C.sub, fontSize: "var(--text-sm)", textAlign: "center", padding: "16px 0" }}>No templates yet — create your first one below.</p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxHeight: 320, overflowY: "auto" }}>
                {tpls.map((tpl) => (
                  <div key={tpl.id} style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, fontSize: "var(--text-sm)" }}>{tpl.icon} {tpl.name}</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Btn v="outline" sz="sm" onClick={() => { setTplSrch(""); setTplEditing({ ...tpl, items: [...(tpl.items || [])] }); }} disabled={tplSaving}>✏️ Edit</Btn>
                        <Btn v="danger" sz="sm" onClick={() => deleteTpl(tpl)} disabled={tplSaving}>🗑️</Btn>
                      </div>
                    </div>
                    <div style={{ fontSize: "var(--text-2xs)", color: C.sub, lineHeight: 1.7 }}>
                      {(tpl.items || []).map((t) => t.iname + (t.qty > 1 ? ` ×${t.qty}` : "")).join(" · ") || "No materials"}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 14 }}>
                <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: "center" }} disabled={tplSaving}>Close</Btn>
                <Btn
                  v="primary"
                  onClick={() => { setTplSrch(""); setTplEditing({ id: "tpl_" + uid(), name: "", icon: "🧰", items: [] }); }}
                  style={{ flex: 1, justifyContent: "center" }}
                  disabled={tplSaving}
                >
                  + New Template
                </Btn>
              </div>
            </>
          )}
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
            <div style={{ background: C.aB, border: `1px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: 12, fontSize: "var(--text-sm)", color: C.am }}>
              Pricing is lock-restricted. Last batch unit valuations will automatically cycle carry over.
            </div>
          )}
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
            <Btn v="primary" onClick={rcvBatch} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Processing..." : "Receive Batch"}</Btn>
          </div>
        </Modal>
      )}

      {modal === "adjust" && sel && (
        <Modal title={`Adjust Stock: ${sel.name}`} onClose={() => setModal(null)}>
          <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.sub }}>
            Current on-hand: <strong style={{ color: C.navy }}>{tot(sel)} {sel.unit}</strong>
          </div>
          <Fld label={`Corrected Quantity (${sel.unit})`}>
            <Inp type="number" min="0" value={form.newQty ?? ""} onChange={(e) => setForm({ ...form, newQty: e.target.value })} />
          </Fld>
          <Fld label="Reason for Correction" hint="e.g. physical count, damaged goods, miscount">
            <TA value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Fld>
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
            <Btn v="gold" onClick={adjustStock} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Saving..." : "Save Correction"}</Btn>
          </div>
        </Modal>
      )}

      {modal === "bulk" && perms.inv_bulk_receive && (
        <Modal title="📦 Receive Bulk Order Manifest" onClose={() => { setModal(null); setBulkItems([]); setBulkSrch(""); }} wide>
          <div style={{ background: C.gL, border: `1.5px solid ${C.gold}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.navy }}>
            ⭐ <strong>Inbound Accounting:</strong> FIFO indices update automatically. Each item maps a standalone discrete batch vector tracking vendor origins.
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-4)", padding: 14, background: C.lg, borderRadius: "var(--radius-lg)", marginBottom: 16 }}>
            <Fld label="Date Received *"><Inp type="date" value={bulkMeta.date} onChange={(e) => setBulkMeta({ ...bulkMeta, date: e.target.value })} /></Fld>
            <Fld label="PO / Order #"><Inp value={bulkMeta.po} onChange={(e) => setBulkMeta({ ...bulkMeta, po: e.target.value })} placeholder="e.g. PO-2025-100" /></Fld>
            <Fld label="Vendor / Supplier"><Inp value={bulkMeta.vendor} onChange={(e) => setBulkMeta({ ...bulkMeta, vendor: e.target.value })} placeholder="e.g. ABC Supply" /></Fld>
          </div>
          
          <div style={{ display: "flex", gap: "var(--space-6)", marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Select Items to Receive</div>
              <Inp value={bulkSrch} onChange={(e) => setBulkSrch(e.target.value)} placeholder="🔍 Search inventory..." style={{ marginBottom: 8 }} />
              <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                {bulkFiltered.map((item) => (
                  <div key={item.id} style={{ background: C.w, border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>{item.name}</div>
                      <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>{item.cat} · {tot(item)} {item.unit} available</div>
                    </div>
                    <Btn v="primary" sz="sm" onClick={() => addToBulk(item)}>+ Add</Btn>
                  </div>
                ))}
                {bulkFiltered.length === 0 && (
                  <div style={{ padding: 20, textAlign: "center", color: C.sub, fontSize: "var(--text-sm)", background: C.lg, borderRadius: "var(--radius-md)" }}>
                    {bulkItems.length > 0 ? "All items matched ✓" : "No matching inventory items found"}
                  </div>
                )}
              </div>
            </div>
            
            <div style={{ flex: "0 0 380px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px" }}>Manifest Queue {bulkItems.length > 0 && `(${bulkItems.length})`}</div>
                {bulkItems.length > 0 && <button onClick={() => setBulkItems([])} style={{ background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)" }}>Clear All</button>}
              </div>
              
              {bulkItems.length === 0 ? (
                <div style={{ height: 200, background: C.lg, borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: C.sub, gap: "var(--space-3)" }}>
                  <span style={{ fontSize: 32 }}>📋</span>
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)" }}>Manifest queue is empty</span>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight: 280, overflowY: "auto", marginBottom: 10 }}>
                    {bulkItems.map((b) => {
                      const sub = (parseFloat(b.qty) || 0) * (parseFloat(b.price) || 0);
                      return (
                        <div key={b.iid} style={{ background: C.w, border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                            <span style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>{b.iname}</span>
                            <button onClick={() => removeBulk(b.iid)} style={{ background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: "var(--text-xl)", lineHeight: 1 }}>×</button>
                          </div>
                          
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "var(--space-3)", alignItems: "end" }}>
                            <div>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase", marginBottom: 3 }}>Qty ({b.unit})</div>
                              <Inp type="number" value={b.qty} onChange={(e) => updateBulk(b.iid, "qty", e.target.value)} placeholder="0" style={{ padding: "5px 8px" }} />
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase", marginBottom: 3 }}>Unit Price</div>
                              <div style={{ position: "relative" }}>
                                <span style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: C.sub, fontSize: "var(--text-xs)" }}>$</span>
                                {perms.inv_pricing_edit ? (
                                  <Inp type="number" step="0.01" value={b.price} onChange={(e) => updateBulk(b.iid, "price", e.target.value)} placeholder="0.00" style={{ padding: "5px 8px", paddingLeft: 16 }} />
                                ) : (
                                  <Inp value={b.price} readOnly style={{ padding: "5px 8px", paddingLeft: 16, color: C.sub, background: C.lg }} />
                                )}
                              </div>
                            </div>
                            <div style={{ paddingBottom: 2, textAlign: "right" }}>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase", marginBottom: 3 }}>Subtotal</div>
                              <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: sub > 0 ? C.gr : C.sub }}>{fm(sub)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  <div style={{ background: C.navy, borderRadius: "var(--radius-md)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", textTransform: "uppercase" }}>Manifest Valuation</div>
                      <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "var(--text-xs)", marginTop: 2 }}>
                        {bulkItems.filter((b) => { const q = parseFloat(b.qty); return !isNaN(q) && q !== 0; }).length} valid item positions
                      </div>
                    </div>
                    <div style={{ fontWeight: "var(--weight-black)", fontSize: "var(--text-3xl)", color: C.gold }}>{fm(bulkTotal)}</div>
                  </div>
                </>
              )}
            </div>
          </div>
          
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn v="ghost" onClick={() => { setModal(null); setBulkItems([]); setBulkSrch(""); }} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Cancel</Btn>
            <Btn v="gold" sz="lg" onClick={confirmBulk} style={{ flex: 2, justifyContent: "center" }} disabled={saving}>
              {saving ? "⏳ Logging Operation..." : `✅ Commit Manifest (${bulkItems.filter((b) => { const q = parseFloat(b.qty); return !isNaN(q) && q !== 0; }).length} Items)`}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}