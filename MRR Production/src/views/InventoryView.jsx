// src/views/InventoryView.jsx
import { useState, useMemo, useEffect } from "react";
import { supabase, updateRowStrict } from "../utils/supabase";
import { sendLowStockAlerts } from "../utils/lowStockAlerts";
import { C, uid, fd, fm, tot, newestPrice, recostLine } from "../utils/helpers";
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
  const [form, setForm] = useState({});
  // Batch correction: the receive form is otherwise the ONLY place a batch's price,
  // PO and vendor can ever be set. Getting one wrong used to be permanent — Edit
  // Materials silently rewrites the NEWEST batch's price (so corrections landed on the
  // wrong batch), and nothing reached PO/vendor at all.
  const [batchSel, setBatchSel] = useState(null);
  const [batchForm, setBatchForm] = useState({});
  const [recalc, setRecalc] = useState(null);
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

  // Reorder signalling uses vivid traffic-light colors ON PURPOSE — not the muted
  // barnwood brand tokens (C.rd is rust, C.am is brown, C.gr is sage). A low item has to
  // jump off the screen so it's obvious what needs ordering; functional clarity beats
  // brand harmony for this one signal. Scoped to inventory, so nothing else reskins.
  const STOCK_RED = "#DC2626";
  const STOCK_YELLOW = "#EAB308";
  const STOCK_GREEN = "#16A34A";

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

      const { error } = await updateRowStrict("inventory", sel.id, updatedFields);

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
    // Don't fail silently — tell the user exactly what's missing, or a blank
    // field looks like it "saved" (modal never closes) while nothing persists.
    if (!sel) {
      showToast("Select an item to receive into first.", "warning");
      return;
    }
    const missing = [];
    if (!form.qty) missing.push("quantity");
    if (!form.price) missing.push("price");
    if (!form.date) missing.push("received date");
    if (missing.length) {
      showToast(`Nothing was received — please fill in the ${missing.join(", ")}.`, "warning");
      return;
    }
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
      // Bulk receive has always captured these; this form never did, which is why 31 of
      // 32 deliveries carry no paperwork. Optional — a correction batch has no invoice.
      ref: (form.ref || "").trim(),
      vendor: (form.vendor || "").trim(),
    };

    try {
      const liveBatches = await fetchLiveBatches(sel.id);
      const updatedBatches = [...liveBatches, b];
      const { error } = await updateRowStrict("inventory", sel.id, { batches: updatedBatches });

      if (error) throw error;

      setInv((p) =>
        p.map((i) => (i.id === sel.id ? { ...i, batches: updatedBatches } : i)),
      );
      const updatedItem = { ...sel, batches: updatedBatches };

      // Fires only when this change pushes the item below its threshold —
      // e.g. a negative correction batch. Normal receives raise stock.
      sendLowStockAlerts(
        [{ item: updatedItem, prevTotal: tot({ batches: liveBatches }), newTotal: tot(updatedItem) }],
        users,
        showToast,
      );

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Received new inbound batch stack for material: "${sel.name}"`,
        {
          item_id: sel.id,
          batch_id: b.id,
          quantity_added: b.qty,
          unit_cost: b.price,
          purchase_order: b.ref || "N/A",
          vendor: b.vendor || "N/A",
        },
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

  const lineFor = (j, itemId) => (j.items || j.materials || []).find((i) => i && i.iid === itemId);
  const usedOf = (j, itemId) => {
    const l = lineFor(j, itemId);
    return Math.max(0, (parseFloat(l?.pulled) || 0) - (parseFloat(l?.returned) || 0));
  };
  const hasSplit = (l) => Array.isArray(l?.consumed) && l.consumed.length > 0;

  // Which jobs actually took material from this batch.
  //
  //   with a split  — exact: the job names the batch id, so there is nothing to infer,
  //                   and a multi-batch pull can be repriced correctly.
  //   without one   — legacy rows predate `consumed`. The only signal left is the
  //                   blended priceAtPull matching this batch's price, which holds
  //                   only if the pull came from this batch alone. Anything else is a
  //                   blend of prices we can no longer take apart: surfaced, untouched.
  const jobsUsingBatch = (itemId, batchId, oldPrice) => {
    const exact = [];
    const blended = [];
    for (const j of jobs || []) {
      const line = lineFor(j, itemId);
      if (!line || (parseFloat(line.pulled) || 0) <= 0) continue;
      if (hasSplit(line)) {
        if (line.consumed.some((c) => c.bid === batchId)) exact.push(j);
        continue; // named a split that doesn't include this batch → genuinely unaffected
      }
      if ((parseFloat(line.priceAtPull) || 0) === oldPrice) exact.push(j);
      else blended.push(j);
    }
    return { exact, blended };
  };

  const saveBatch = async () => {
    if (!sel || !batchSel) return;
    const canPrice = perms.inv_pricing_edit;
    const oldPrice = parseFloat(batchSel.price) || 0;
    const newPrice = canPrice ? parseFloat(batchForm.price) : oldPrice;
    if (canPrice && !Number.isFinite(newPrice)) {
      showToast("Unit price must be a valid number.", "warning");
      return;
    }
    const newRef = (batchForm.ref || "").trim();
    const newVendor = (batchForm.vendor || "").trim();
    const priceChanged = canPrice && newPrice !== oldPrice;

    // A price change restates finished jobs, so it never happens without showing the
    // damage first. PO/vendor don't touch cost and save straight through.
    const hits = priceChanged ? jobsUsingBatch(sel.id, batchSel.id, oldPrice) : { exact: [], blended: [] };
    if (priceChanged && hits.exact.length > 0 && !recalc) {
      setRecalc({ oldPrice, newPrice, ...hits });
      return;
    }

    setSaving(true);
    try {
      const live = await fetchLiveBatches(sel.id);
      const idx = live.findIndex((b) => b.id === batchSel.id);
      if (idx === -1) throw new Error("This batch no longer exists — someone may have changed it. Refresh and try again.");
      const updated = live.map((b, i) =>
        i === idx ? { ...b, price: newPrice, ref: newRef, vendor: newVendor } : b,
      );

      const { error } = await updateRowStrict("inventory", sel.id, { batches: updated });
      if (error) throw error;
      setInv((p) => p.map((i) => (i.id === sel.id ? { ...i, batches: updated } : i)));
      setSel((p) => (p && p.id === sel.id ? { ...p, batches: updated } : p));

      let recalced = 0;
      if (priceChanged && hits.exact.length > 0) {
        const fix = (arr) =>
          (arr || []).map((i) => {
            if (!i || i.iid !== sel.id) return i;
            if ((parseFloat(i.pulled) || 0) <= 0) return i;
            return { ...i, ...recostLine(i, batchSel.id, newPrice) };
          });
        for (const j of hits.exact) {
          const next = { items: fix(j.items), materials: fix(j.materials) };
          const res = await updateRowStrict("jobs", j.id, next);
          if (res.error) throw res.error;
          setJobs?.((p) => p.map((x) => (x.id === j.id ? { ...x, ...next } : x)));
          recalced++;
        }
      }

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Corrected batch on "${sel.name}"${priceChanged ? ` (price ${fm(oldPrice)} → ${fm(newPrice)})` : ""}${recalced ? ` — recalculated ${recalced} job(s)` : ""}`,
        {
          item_id: sel.id,
          batch_id: batchSel.id,
          batch_rcvd: batchSel.rcvd,
          ...(priceChanged ? { price: { from: oldPrice, to: newPrice } } : {}),
          purchase_order: { from: batchSel.ref || "", to: newRef },
          vendor: { from: batchSel.vendor || "", to: newVendor },
          jobs_recalculated: recalced,
        },
        "inventory",
      );

      showToast(
        recalced > 0
          ? `Batch corrected — ${recalced} job${recalced > 1 ? "s" : ""} recalculated.`
          : "Batch corrected.",
        "success",
      );
      setRecalc(null);
      setBatchSel(null);
      setModal("detail");
    } catch (err) {
      console.error(err);
      showToast(`Database Error correcting batch: ${err.message}`, "error");
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

      const { error } = await updateRowStrict("inventory", sel.id, { batches: updatedBatches });
      if (error) throw error;

      setInv((p) => p.map((i) => (i.id === sel.id ? { ...i, batches: updatedBatches } : i)));
      setSel((p) => (p ? { ...p, batches: updatedBatches } : p));

      sendLowStockAlerts(
        [{ item: sel, prevTotal: current, newTotal: newQty }],
        users,
        showToast,
      );

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
    const hasQty = (b) => {
      const qty = parseFloat(b.qty);
      return !isNaN(qty) && qty !== 0;
    };
    const valid = bulkItems.filter(hasQty);
    // Rows left blank/zero would otherwise vanish without a trace — capture them
    // so we can name them in a warning instead of silently swallowing the delivery.
    const skipped = bulkItems.filter((b) => !hasQty(b));
    if (valid.length === 0) {
      showToast(
        "Nothing was received — every row is missing a quantity. Enter a quantity for each item.",
        "warning",
      );
      return;
    }

    // A BLANK price must never become a $0 batch. FIFO charges each batch at its own
    // price, so a $0 batch bills real material at nothing and prints $0 on the job
    // report. Blank falls back to the item's last known price (same as single receive);
    // if there's nothing to fall back on, refuse and name the rows rather than invent a
    // number. A typed 0 is left alone — that's a deliberate free/warranty batch.
    const priced = valid.map((b) => {
      const typed = parseFloat(b.price);
      if (Number.isFinite(typed)) return { ...b, rate: typed };
      const last = newestPrice(inv.find((i) => i && i.id === b.iid));
      return { ...b, rate: last > 0 ? last : null };
    });
    const unpriced = priced.filter((b) => b.rate === null);
    if (unpriced.length > 0) {
      showToast(
        `Enter a unit price for: ${unpriced.map((b) => b.iname).join(", ")}. ${
          unpriced.length > 1 ? "They have" : "It has"
        } no previous price to fall back on, and receiving at $0 would bill the job nothing for real material.`,
        "warning",
      );
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
      for (const bi of priced) {
        if (!freshById.has(bi.iid)) continue;
        const nb = {
          id: "b_" + uid(),
          rcvd: bulkMeta.date,
          qty: parseFloat(bi.qty),
          price: bi.rate,
          by: user?.id || "system",
          rem: parseFloat(bi.qty),
          ref: bulkMeta.po || "",
          vendor: bulkMeta.vendor || "",
        };
        changedBatches.set(bi.iid, [...freshById.get(bi.iid), nb]);
      }

      const results = await Promise.all(
        [...changedBatches].map(([iid, batches]) =>
          updateRowStrict("inventory", iid, { batches }),
        ),
      );

      // Supabase calls resolve (never throw) with an { error } payload — an
      // unchecked failure here would show success while nothing was saved.
      const firstError = results.map((r) => r?.error).find(Boolean);
      if (firstError) throw firstError;

      setInv((p) => p.map((i) => (changedBatches.has(i.id) ? { ...i, batches: changedBatches.get(i.id) } : i)));

      // Bulk rows can carry negative correction quantities, so a threshold
      // crossing is possible here too.
      sendLowStockAlerts(
        [...changedBatches]
          .map(([iid, batches]) => {
            const item = inv.find((i) => i.id === iid);
            return item
              ? { item, prevTotal: tot({ batches: freshById.get(iid) }), newTotal: tot({ batches }) }
              : null;
          })
          .filter(Boolean),
        users,
        showToast,
      );

      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Processed bulk purchase order delivery into warehouse roster`,
        {
          purchase_order: bulkMeta.po || "N/A",
          vendor: bulkMeta.vendor || "N/A",
          item_count: priced.length,
          total_manifest_value: bulkTotal,
          // WHICH items — not just how many. Without this a delivery logs as
          // "2 items" and the only way to learn what was in it is to reconstruct
          // it from the batches (see the Atlas box vent hunt on 2026-07-16).
          items: priced.map((b) => ({
            item_id: b.iid,
            name: b.iname,
            qty: parseFloat(b.qty),
            unit_cost: b.rate,
          })),
          ...(skipped.length > 0
            ? { skipped_no_quantity: skipped.map((b) => b.iname) }
            : {}),
        },
      );

      showToast(
        `Bulk delivery received — ${valid.length} item${valid.length > 1 ? "s" : ""} added.`,
        "success",
      );
      // Surface anything left out so a forgotten quantity can't quietly disappear.
      if (skipped.length) {
        showToast(
          `${skipped.length} item${skipped.length > 1 ? "s were" : " was"} NOT received (no quantity entered): ${skipped
            .map((b) => b.iname)
            .join(", ")}.`,
          "warning",
        );
      }
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
                  <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <div>
                      <div style={{ fontWeight: "var(--weight-extrabold)", color: b.rem === 0 ? C.sub : C.gr, fontSize: "var(--text-sm)" }}>{b.rem}/{b.qty} remaining</div>
                      {perms.inv_pricing_view && (
                        <div style={{ fontSize: "var(--text-xs)", color: (parseFloat(b.price) || 0) === 0 ? C.rd : C.blue, fontWeight: "var(--weight-bold)" }}>
                          {fm(b.price)} ea.{(parseFloat(b.price) || 0) === 0 && b.rem > 0 ? " ⚠️ unpriced" : ""}
                        </div>
                      )}
                    </div>
                    {(perms.inv_receive || perms.inv_pricing_edit) && (
                      <Btn
                        v="ghost"
                        sz="sm"
                        onClick={() => {
                          setBatchSel(b);
                          setBatchForm({ price: String(b.price ?? ""), ref: b.ref || "", vendor: b.vendor || "" });
                          setRecalc(null);
                          setModal("batch");
                        }}
                        title="Correct this batch's price, PO or vendor"
                      >
                        ✏️
                      </Btn>
                    )}
                  </div>
                </div>
              </div>
            ))}
          {(sel.batches || []).length === 0 && <p style={{ color: C.sub, fontSize: "var(--text-base)" }}>No receipt stacks logged yet.</p>}
        </Modal>
      )}

      {modal === "batch" && sel && batchSel && (
        <Modal
          title={`Correct Batch — ${fd(batchSel.rcvd)}`}
          onClose={() => { setBatchSel(null); setRecalc(null); setModal("detail"); }}
        >
          <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: "var(--space-4)", fontSize: "var(--text-xs)", color: C.sub }}>
            Received {fd(batchSel.rcvd)} · {batchSel.qty} {sel.unit} · {batchSel.rem} remaining · by{" "}
            {users.find((u) => u.id === batchSel.by)?.name || "Unknown"}
            <div style={{ marginTop: 4 }}>Quantities aren't editable here — use 🔧 Adjust Stock for those.</div>
          </div>

          {recalc ? (
            <div>
              <div style={{ background: "rgba(217,119,6,0.10)", border: `1.5px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "12px 14px", marginBottom: "var(--space-4)" }}>
                <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, marginBottom: 6 }}>
                  This changes {recalc.exact.length} finished job{recalc.exact.length > 1 ? "s" : ""}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginBottom: 10 }}>
                  These jobs recorded {sel.name} at {fm(recalc.oldPrice)} — the price you're correcting. Their cost
                  will be re-derived at {fm(recalc.newPrice)}. Nothing is typed in by hand.
                </div>
                {recalc.exact.map((j) => {
                  const line = lineFor(j, sel.id);
                  const used = usedOf(j, sel.id);
                  // What the report shows is used × priceAtPull, so preview that —
                  // re-derived per job, since a multi-batch pull only moves partway.
                  const before = used * (parseFloat(line.priceAtPull) || 0);
                  const after = used * (recostLine(line, batchSel.id, recalc.newPrice).priceAtPull || 0);
                  return (
                    <div key={j.id} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", fontSize: "var(--text-xs)", padding: "4px 0", borderTop: `1px solid ${C.bd}` }}>
                      <span style={{ color: C.navy, fontWeight: "var(--weight-bold)" }}>
                        {j.title || j.name || j.id} <span style={{ color: C.sub, fontWeight: "normal" }}>({j.status})</span>
                        {hasSplit(line) && line.consumed.length > 1 && (
                          <span style={{ color: C.sub, fontWeight: "normal" }}> · {line.consumed.length} batches</span>
                        )}
                      </span>
                      <span style={{ whiteSpace: "nowrap" }}>
                        {used} × · {fm(before)} → <strong style={{ color: C.gr }}>{fm(after)}</strong>
                      </span>
                    </div>
                  );
                })}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)", fontWeight: "var(--weight-extrabold)", color: C.navy, paddingTop: 8, marginTop: 4, borderTop: `2px solid ${C.bd}` }}>
                  <span>Total change</span>
                  <span>
                    {fm(recalc.exact.reduce((s, j) => s + usedOf(j, sel.id) * (parseFloat(lineFor(j, sel.id)?.priceAtPull) || 0), 0))} →{" "}
                    {fm(recalc.exact.reduce((s, j) => s + usedOf(j, sel.id) * (recostLine(lineFor(j, sel.id), batchSel.id, recalc.newPrice).priceAtPull || 0), 0))}
                  </span>
                </div>
              </div>

              {recalc.blended.length > 0 && (
                <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: "var(--space-4)", fontSize: "var(--text-xs)", color: C.sub }}>
                  <strong style={{ color: C.navy }}>{recalc.blended.length} other job{recalc.blended.length > 1 ? "s" : ""} won't be touched.</strong>{" "}
                  They pulled {sel.name} across several batches, so their cost is a blend this correction can't
                  safely re-derive: {recalc.blended.map((j) => j.title || j.name || j.id).join(", ")}.
                </div>
              )}

              <div style={{ display: "flex", gap: "var(--space-3)" }}>
                <Btn v="ghost" onClick={() => setRecalc(null)} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Back</Btn>
                <Btn v="primary" onClick={saveBatch} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>
                  {saving ? "⏳ Applying..." : `✅ Correct & recalculate ${recalc.exact.length}`}
                </Btn>
              </div>
            </div>
          ) : (
            <div>
              {perms.inv_pricing_edit && (
                <Fld label="Unit Price *">
                  <Inp type="number" step="0.01" value={batchForm.price ?? ""} onChange={(e) => setBatchForm({ ...batchForm, price: e.target.value })} placeholder="0.00" />
                </Fld>
              )}
              <Fld label="Invoice / PO Number">
                <Inp value={batchForm.ref ?? ""} onChange={(e) => setBatchForm({ ...batchForm, ref: e.target.value })} placeholder="e.g. 2011850932-001" />
              </Fld>
              <Fld label="Supplier / Vendor">
                <Inp value={batchForm.vendor ?? ""} onChange={(e) => setBatchForm({ ...batchForm, vendor: e.target.value })} placeholder="e.g. ABC Supply" />
              </Fld>
              <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-5)" }}>
                <Btn v="ghost" onClick={() => { setBatchSel(null); setModal("detail"); }} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>Cancel</Btn>
                <Btn v="primary" onClick={saveBatch} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>{saving ? "⏳ Saving..." : "💾 Save Batch"}</Btn>
              </div>
            </div>
          )}
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
          <Fld label="Invoice / PO Number"><Inp value={form.ref || ""} onChange={(e) => setForm({ ...form, ref: e.target.value })} placeholder="e.g. 2011850932-001" /></Fld>
          <Fld label="Supplier / Vendor"><Inp value={form.vendor || ""} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. ABC Supply" /></Fld>
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