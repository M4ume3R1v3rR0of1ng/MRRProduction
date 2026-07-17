// src/views/PullInventoryView.jsx
// ── Pull Inventory ────────────────────────────────
import { useState, useEffect } from "react";
import { C, fd, fm, doFifo, uid, tot, ft, mkJI, mergePullTracking } from "../utils/helpers";
import { generatePDF } from "../utils/pdfGenerator";
import { attemptAccuLynxSync } from "../utils/accuLynxSync";
import { Btn, Bdg, Modal, Fld, TA, Inp, Sel, PhotoUpload } from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { supabase, updateRowStrict } from "../utils/supabase";
import { sendLowStockAlerts } from "../utils/lowStockAlerts";
import { useNotify } from "../context/NotificationContext";
import { uploadPhotoToBucket } from "../utils/storageBucketUpload";
import { sendEmail, escapeHtml as esc } from "../utils/email";

export default function PullInventory({
  jobs = [],
  setJobs,
  inv = [],
  setInv,
  vehs = [],
  jobTrailers = [],
  setJobTrailers,
  users = [],
  user,
  perms,
  activeLogo,
  acculynxConfig,
  jSC,
  openItemId,
  onOpenItemHandled,
}) {
  const { showToast } = useNotify();
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [pullQtys, setPullQtys] = useState({});
  const [retQtys, setRetQtys] = useState({});
  const [syncModal, setSyncModal] = useState(null);

  const [pulling, setPulling] = useState(false);
  const [returning, setReturning] = useState(false);
  const [sortBy, setSortBy] = useState("newest");
  const [editForm, setEditForm] = useState({});
  const [editItems, setEditItems] = useState([]);
  const [editItemSearch, setEditItemSearch] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const isField = user.role === "field";

  const fieldUsers = users.filter(
    (u) => (u.role === "field" || u.role === "Site Supervisor") && u.active,
  );

  const startEditJob = (job) => {
    setEditForm({
      po: job.po || "",
      name: job.title || job.name || "",
      addr: job.addr || "",
      notes: job.notes || "",
      scheduledDate: job.scheduledDate || "",
      assignedto: job.assignedto || job.assignedTo || "",
    });
    setEditItems((job.items || job.materials || []).filter(Boolean));
    setEditItemSearch("");
    setModal("edit");
  };

  const editFiltInv = inv.filter(
    (i) =>
      (i?.name || "").toLowerCase().includes(editItemSearch.toLowerCase()) &&
      !editItems.find((x) => x.iid === i.id),
  );

  const addEditItem = (item) => {
    setEditItems((p) => [...p, mkJI(item.id, item.name, item.cat, item.unit, 1)]);
  };

  const updateEditItemQty = (iid, val) => {
    setEditItems((p) => p.map((x) => (x.iid === iid ? { ...x, planned: Math.max(0, parseFloat(val) || 0) } : x)));
  };

  const removeEditItem = (item) => {
    if (item.pulled > 0) {
      if (!window.confirm(`"${item.iname}" already has ${item.pulled} ${item.unit || ""} pulled from the warehouse. Removing it here will NOT return that stock — it only removes it from this job's checklist. Continue?`)) {
        return;
      }
    }
    setEditItems((p) => p.filter((x) => x.iid !== item.iid));
  };

  const saveJobEdit = async () => {
    if (!sel) return;
    setSavingEdit(true);
    const prevAssignedTo = sel.assignedto || sel.assignedTo || "";
    const reassigned = editForm.assignedto && editForm.assignedto !== prevAssignedTo;

    const payload = {
      po: editForm.po,
      title: editForm.name,
      addr: editForm.addr,
      notes: editForm.notes,
      scheduledDate: editForm.scheduledDate,
      assignedto: editForm.assignedto,
      items: editItems,
      materials: editItems,
      ...(reassigned ? { newforassigned: true } : {}),
    };

    try {
      // A crew may have pulled materials while this edit was open — merge the
      // live pull-tracking onto the edited list so it can't be erased.
      const { data: liveJob, error: liveErr } = await supabase
        .from("jobs")
        .select("items, materials")
        .eq("id", sel.id)
        .single();
      if (liveErr) throw liveErr;
      const mergedItems = mergePullTracking(editItems, liveJob?.items || liveJob?.materials);
      payload.items = mergedItems;
      payload.materials = mergedItems;

      const { error } = await updateRowStrict("jobs", sel.id, payload);
      if (error) throw error;

      const updated = { ...sel, ...payload };
      setJobs((p) => p.map((j) => (j.id === sel.id ? updated : j)));
      setSel(updated);

      await logAction(
        user.id,
        user.email,
        "JOB_BUILD_EDIT",
        `Edited job details for "${editForm.name}" (PO: ${editForm.po}) from Pull Inventory`,
        { job_id: sel.id, changes: payload },
        "production",
      );

      if (reassigned) {
        const assignedUser = users.find((u) => u.id === editForm.assignedto);
        if (assignedUser?.email) {
          sendEmail({
            to: assignedUser.email,
            subject: `Job Reassigned to You: ${editForm.name}`,
            html: `<h2>A job has been reassigned to you</h2>
                   <p><strong>Job:</strong> ${esc(editForm.name)}</p>
                   <p><strong>PO:</strong> ${esc(editForm.po)}</p>
                   <p><strong>Address:</strong> ${esc(editForm.addr || "N/A")}</p>
                   <p>Log in to view details and pull inventory.</p>`,
          });
        }
      }

      showToast("Job details saved.", "success");
      setModal(null);
    } catch (err) {
      console.error("Failed to save job edit:", err);
      showToast(`Database Error: Could not save job. ${err.message}`, "error");
    } finally {
      setSavingEdit(false);
    }
  };
  
  const toggleJobTrailer = async (jobId, trailerId) => {
    if (typeof setJobTrailers !== "function") return;
    const job = jobs.find((j) => j.id === jobId) || sel;
    const trailerName = vehs.find((v) => v.id === trailerId)?.name || trailerId;
    const existing = jobTrailers.find((jt) => jt.job_id === jobId && jt.trailer_id === trailerId);
    const supervisorId = job?.assignedto || job?.assignedTo;
    const isLive = !!(job && supervisorId && job.status !== "draft");

    const notifySupervisorOfTrailerChange = async (action) => {
      if (!isLive) return;
      try {
        const { error } = await supabase
          .from("jobs")
          .update({ newforassigned: true, newForAssigned: true })
          .eq("id", jobId);
        if (error) throw error;
        setJobs((p) => p.map((j) => (j.id === jobId ? { ...j, newforassigned: true, newForAssigned: true } : j)));
      } catch (err) {
        console.error("Failed to flag job for trailer update notification:", err);
      }

      const assignedUser = users.find((u) => u.id === supervisorId);
      if (assignedUser?.email) {
        sendEmail({
          to: assignedUser.email,
          subject: `Trailer Update — ${job.title || job.name} (PO: ${job.po})`,
          html: `<h2>Trailer requirement updated for your job</h2>
                 <p><strong>Job:</strong> ${esc(job.title || job.name)}</p>
                 <p><strong>PO:</strong> ${esc(job.po)}</p>
                 <p>🚚 Trailer <strong>${esc(trailerName)}</strong> ${action === "added" ? "now needs to be brought to this job." : "is no longer needed for this job."}</p>`,
        });
      }
      showToast(`${assignedUser?.name || "Supervisor"} notified that trailer was ${action}.`, "success");
    };

    if (existing) {
      setJobTrailers((p) => p.filter((jt) => jt.id !== existing.id));
      try {
        const { error } = await supabase.from("job_trailers").delete().eq("id", existing.id);
        if (error) throw error;
        await logAction(user.id, user.email, "JOB_BUILD_EDIT", `Removed trailer "${trailerName}" from job "${job?.title || job?.name}"`, { job_id: jobId, trailer_id: trailerId }, "production");
        await notifySupervisorOfTrailerChange("removed");
      } catch (err) {
        console.error("Failed to remove trailer from job:", err);
        showToast(`Failed to remove trailer: ${err.message}`, "error");
        setJobTrailers((p) => [...p, existing]);
      }
    } else {
      const newRow = { id: uid(), job_id: jobId, trailer_id: trailerId };
      setJobTrailers((p) => [...p, newRow]);
      try {
        const { error } = await supabase.from("job_trailers").insert([newRow]);
        if (error) throw error;
        await logAction(user.id, user.email, "JOB_BUILD_EDIT", `Assigned trailer "${trailerName}" to job "${job?.title || job?.name}"`, { job_id: jobId, trailer_id: trailerId }, "production");
        await notifySupervisorOfTrailerChange("added");
      } catch (err) {
        console.error("Failed to assign trailer to job:", err);
        showToast(`Failed to assign trailer: ${err.message}`, "error");
        setJobTrailers((p) => p.filter((jt) => jt.id !== newRow.id));
      }
    }
  };

  // ── 🟢 SAFEGUARD PIPELINE MAPPING TO CORRECT DATABASE SHARDS ──
  const jobSorters = {
    newest: (a, b) => new Date(b.created || b.createdAt || 0) - new Date(a.created || a.createdAt || 0),
    oldest: (a, b) => new Date(a.created || a.createdAt || 0) - new Date(b.created || b.createdAt || 0),
    name_az: (a, b) => (a.title || a.name || "").localeCompare(b.title || b.name || "", undefined, { numeric: true }),
    name_za: (a, b) => (b.title || b.name || "").localeCompare(a.title || a.name || "", undefined, { numeric: true }),
    po: (a, b) => String(a.po || "").localeCompare(String(b.po || ""), undefined, { numeric: true }),
    status: (a, b) => (a.status || "").localeCompare(b.status || ""),
  };
  // Completed/closed jobs drop off this view — Pull Inventory is a work queue,
  // and finished jobs remain reachable from Build Jobs (PDF, close-out).
  const isOpenJob = (j) => j && j.status !== "draft" && j.status !== "completed" && j.status !== "closed";
  const myJobs = (isField
    ? jobs.filter((j) => isOpenJob(j) && (j.assignedto === user.id || j.assignedTo === user.id))
    : jobs.filter(isOpenJob)
  ).sort(jobSorters[sortBy] || jobSorters.newest);

  const openJob = async (j) => {
    if (!j) return;
    setSel(j);
    const isNew = j.newforassigned || j.newForAssigned;
    if (isNew && (j.assignedto === user.id || j.assignedTo === user.id)) {
      try {
        const { error } = await supabase
          .from("jobs")
          .update({ newforassigned: false, newForAssigned: false })
          .eq("id", j.id);
        if (error) throw error;
        setJobs((p) =>
          p.map((x) => (x.id === j.id ? { ...x, newforassigned: false, newForAssigned: false } : x)),
        );
      } catch (err) {
        console.error("Failed to update newForAssigned badge:", err);
      }
    }
  };

  // Deep-link from OmniSearch: open the matching job card on arrival
  useEffect(() => {
    if (!openItemId) return;
    const target = jobs.find((j) => String(j.id) === String(openItemId));
    if (target) openJob(target);
    onOpenItemHandled?.();
  }, [openItemId]);

  const confirmPull = async () => {
    if (!sel) return;
    setPulling(true);

    const updItems = [...(sel.items || sel.materials || [])];
    const shortItems = [];
    // Batches touched by this pull, keyed by inventory id. Only these rows get
    // written back — writing the whole in-memory list here used to overwrite
    // stock other devices had received since this session loaded.
    const changedBatches = new Map();

    try {
      // Re-read current batches for the job's items so FIFO deducts from
      // what's actually in the warehouse now, not this device's snapshot.
      const pullIds = updItems.filter(Boolean).map((i) => i.iid);
      let freshById = new Map();
      if (pullIds.length > 0) {
        const { data: freshRows, error: freshErr } = await supabase
          .from("inventory")
          .select("id,batches")
          .in("id", pullIds);
        if (freshErr) throw freshErr;
        freshById = new Map((freshRows || []).map((r) => [r.id, r.batches || []]));
      }

      for (const item of updItems) {
        if (!item) continue;
        const parsedQty = parseFloat(pullQtys[item.iid]);
        const qty = Number.isNaN(parsedQty) ? (item.planned || item.qty || 0) : parsedQty;
        if (qty <= 0) continue;
        if (!freshById.has(item.iid)) continue;

        const res = doFifo({ batches: freshById.get(item.iid) }, qty);
        if (res.shortfall > 0) {
          shortItems.push(item.iname || item.name);
        }

        changedBatches.set(item.iid, res.batches);
        const ppu = qty > 0 ? res.cost / qty : 0;
        const ji = updItems.findIndex((i) => i && i.iid === item.iid);
        if (ji >= 0) {
          updItems[ji] = {
            ...updItems[ji],
            pulled: qty,
            priceAtPull: ppu,
            pullCost: res.cost,
            // The batch-by-batch split behind priceAtPull. priceAtPull is a blended
            // average and can't be traced back; this can. It makes a batch price
            // correction exact rather than a guess, and lets a report show what the
            // material actually cost instead of an average of it.
            consumed: res.consumed,
          };
        }
      }

      if (shortItems.length > 0) {
        showToast(
          `Pulled past available stock for: ${shortItems.join(", ")}. Warehouse balance is now negative for ${shortItems.length > 1 ? "these items" : "this item"} — reorder soon.`,
          "warning",
        );
      }

      const updatedJob = { ...sel, status: "active", items: updItems, materials: updItems };

      // One transaction (supabase/14). Writing the job and then each item separately
      // meant a failure partway left the job marked pulled with only some stock
      // deducted — and unrecoverable, since the Pull button only shows on `approved`
      // jobs. Either all of this lands or none of it does.
      const { error: commitErr } = await supabase.rpc("commit_job_materials", {
        p_job_id: sel.id,
        p_status: "active",
        p_items: updItems,
        p_batches: Object.fromEntries(changedBatches),
      });
      if (commitErr) throw commitErr;

      setInv((p) => p.map((i) => (changedBatches.has(i.id) ? { ...i, batches: changedBatches.get(i.id) } : i)));
      setJobs((p) => p.map((j) => (j.id === sel.id ? updatedJob : j)));
      setSel(updatedJob);

      // Pulls are the main way stock drops below threshold — alert the
      // opted-in managers when this pull crosses an item's alert line.
      sendLowStockAlerts(
        [...changedBatches]
          .map(([iid, batches]) => {
            const item = inv.find((i) => i.id === iid);
            return item
              ? { item, prevTotal: tot({ batches: freshById.get(iid) || [] }), newTotal: tot({ batches }) }
              : null;
          })
          .filter(Boolean),
        users,
        showToast,
      );

      await handlePullMaterials(sel.id, updItems);
      showToast("Materials successfully pulled from warehouse staging.", "success");
      setModal(null);
      setPullQtys({});
    } catch (err) {
      console.error("Failed to finalize material pull layout:", err);
      showToast(`Database Error: Pull aborted. ${err.message}`, "error");
    } finally {
      setPulling(false);
    }
  };

  const confirmReturn = async () => {
    if (!sel) return;
    setReturning(true);

    const rawItems = sel.items || sel.materials || [];

    try {
      // Re-read current batches for the items being returned so the return
      // batch stacks on top of live warehouse data. Only these rows get
      // written back — writing the whole in-memory list here used to
      // overwrite stock other devices had received since this session loaded.
      const returnIds = rawItems
        .filter((i) => i && Math.min(parseFloat(retQtys[i.iid]) || 0, i.pulled || 0) > 0)
        .map((i) => i.iid);
      let freshById = new Map();
      if (returnIds.length > 0) {
        const { data: freshRows, error: freshErr } = await supabase
          .from("inventory")
          .select("id,batches")
          .in("id", returnIds);
        if (freshErr) throw freshErr;
        freshById = new Map((freshRows || []).map((r) => [r.id, r.batches || []]));
      }

      const changedBatches = new Map();
      const updItems = rawItems.map((item) => {
        if (!item) return null;
        const ret = Math.min(parseFloat(retQtys[item.iid]) || 0, item.pulled || 0);
        if (ret > 0 && freshById.has(item.iid)) {
          const nb = {
            id: uid(),
            rcvd: new Date().toISOString().split("T")[0],
            qty: ret,
            price: item.priceAtPull || 0,
            by: user.id,
            rem: ret,
          };
          changedBatches.set(item.iid, [...freshById.get(item.iid), nb]);
        }
        return { ...item, returned: ret };
      }).filter(Boolean);

      const completedAt = new Date().toISOString();
      const updatedJob = {
        ...sel,
        status: "completed",
        completed: completedAt,
        completedAt,
        items: updItems,
        materials: updItems,
      };

      // Same transaction guarantee as the pull: returned stock and the job's
      // completion land together, or neither does.
      const { error: commitErr } = await supabase.rpc("commit_job_materials", {
        p_job_id: sel.id,
        p_status: "completed",
        p_items: updItems,
        p_batches: Object.fromEntries(changedBatches),
        p_completed: completedAt,
      });
      if (commitErr) throw commitErr;

      const newInv = inv.map((i) => (changedBatches.has(i.id) ? { ...i, batches: changedBatches.get(i.id) } : i));
      setInv(newInv);
      setJobs((p) => p.map((j) => (j.id === sel.id ? updatedJob : j)));
      showToast("Job logistics completed. Generating material manifest report.", "success");
      setModal(null);
      setRetQtys({});

      setTimeout(() => {
        if (!generatePDF(updatedJob, users, activeLogo, newInv)) {
          showToast("Popup blocked — allow popups for this site, then use the 📄 PDF button to open the report.", "warning");
        }
        if (acculynxConfig?.autoSync) {
          attemptAccuLynxSync(updatedJob, users, acculynxConfig, setJobs);
        }
      }, 300);

      setSel(null);
    } catch (err) {
      console.error("Failed to complete job procedures:", err);
      showToast(`Database Error: Could not process return & completion. ${err.message}`, "error");
    } finally {
      setReturning(false);
    }
  };

  const syncBadge = (job) => {
    if (!job || !job.syncStatus || job.status !== "completed") return null;
    if (job.syncStatus === "synced") return <Bdg color="sky">☁️ AccuLynx Synced</Bdg>;
    if (job.syncStatus === "failed") return <Bdg color="red">⚠️ Sync Failed</Bdg>;
    if (job.syncStatus === "manual") return <Bdg color="amber">📋 Configure Sync</Bdg>;
    return null;
  };

  const handlePullMaterials = async (jobId, materialsList) => {
    await logAction(
      user.id,
      user.email,
      "INVENTORY_PULL",
      `Dispatched staging materials out for Job PO #${sel.po} (${sel.title || sel.name}).`,
      { targetId: sel.id, payload: { itemsPulled: materialsList } },
    );
  };

  const handleStagePhoto = async (phase, base64Data) => {
    if (!sel) return;
    const columnToUpdate = phase === "before" ? "photo_before_url" : "photo_after_url";

    try {
      const url = base64Data ? await uploadPhotoToBucket("job-attachments", user.companyId, sel.id, base64Data) : null;
      if (base64Data && !url) throw new Error("Cloud engine failed to return a valid URL.");

      const { error: dbError } = await updateRowStrict("jobs", sel.id, { [columnToUpdate]: url });
      if (dbError) throw dbError;

      setJobs((p) => p.map((j) => (j.id === sel.id ? { ...j, [columnToUpdate]: url } : j)));
      setSel((p) => (p ? { ...p, [columnToUpdate]: url } : p));

      if (url) {
        showToast(`${phase === "before" ? "Before" : "After"} photo synchronized to cloud storage!`, "success");
      }
    } catch (err) {
      console.error("[Storage Upload Failure]:", err);
      showToast(`Upload failed: ${err.message || "Network timeout error."}`, "error");
    }
  };

  const currentJobPhotos = sel ? { before: sel.photo_before_url || null, after: sel.photo_after_url || null } : { before: null, after: null };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "var(--space-3)", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy }}>📋 Pull Inventory</h1>
          <p style={{ margin: "2px 0 0", color: C.sub, fontSize: "var(--text-sm)" }}>
            {isField ? "Your assigned jobs" : "All active jobs in pipeline"}
          </p>
        </div>
        <Sel value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort jobs" style={{ width: "auto" }}>
          <option value="newest">↕ Date Created — Newest</option>
          <option value="oldest">↕ Date Created — Oldest</option>
          <option value="name_az">↕ Job Name — A to Z</option>
          <option value="name_za">↕ Job Name — Z to A</option>
          <option value="po">↕ PO Number</option>
          <option value="status">↕ Status</option>
        </Sel>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {myJobs.length === 0 && (
          <div style={{ background: C.w, padding: 32, borderRadius: "var(--radius-xl)", textAlign: "center", color: C.sub, boxShadow: "var(--shadow-sm)" }}>
            🏁 All caught up — no open jobs right now. Completed jobs live in Build Jobs.
          </div>
        )}
        {myJobs.map((job) => {
          if (!job) return null;
          const sup = users.find((u) => u.id === job.assignedto || u.id === job.assignedTo);
          const jobTrailerNames = jobTrailers
            .filter((jt) => jt.job_id === job.id)
            .map((jt) => vehs.find((v) => v.id === jt.trailer_id)?.name)
            .filter(Boolean);
          const st = jSC[job.status] || { c: "gray", icon: "📋", l: job.status };
          const isNew = (job.newforassigned || job.newForAssigned) && (job.assignedto === user.id || job.assignedTo === user.id);
          
          const currentItems = Array.isArray(job.items) ? job.items : (Array.isArray(job.materials) ? job.materials : []);
          
          const totalCost = currentItems.reduce(
            (s, i) => s + (i ? ((i.pulled || 0) - (i.returned || 0)) * (i.priceAtPull || 0) : 0),
            0,
          );

          return (
            <div
              key={job.id}
              className="mrr-card-hover"
              style={{
                background: C.w,
                borderRadius: "var(--radius-xl)",
                padding: 16,
                boxShadow: "var(--shadow-sm)",
                border: `2px solid ${isNew ? C.tl : job.status === "active" ? C.am : "transparent"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: "var(--space-4)" }}>
                <div>
                  <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 5, flexWrap: "wrap" }}>
                    <Bdg color={st.c}>{st.icon} {st.l}</Bdg>
                    {isNew && <Bdg color="teal">🔔 NEW</Bdg>}
                    <span style={{ fontSize: "var(--text-sm)", color: C.sub }}>{job.po || "No PO #"}</span>
                    {syncBadge(job)}
                  </div>
                  <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, fontSize: 15, marginBottom: 2 }}>
                    {job.title || job.name}
                  </div>
                  <div style={{ fontSize: "var(--text-sm)", color: C.sub, marginBottom: 4 }}>{job.addr || job.address}</div>
                  {!isField && sup && <div style={{ fontSize: "var(--text-xs)", color: C.blue, fontWeight: "var(--weight-bold)" }}>👤 {sup.name}</div>}
                  {jobTrailerNames.length > 0 && (
                    <div style={{ fontSize: "var(--text-xs)", color: C.am, fontWeight: "var(--weight-bold)", marginTop: 2 }}>
                      🚚 Bring trailer: {jobTrailerNames.join(", ")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-end" }}>
                  {perms.jobs_pull && job.status === "approved" && (
                    <Btn
                      v="teal"
                      sz="sm"
                      onClick={() => {
                        openJob(job);
                        const q = {};
                        currentItems.forEach((i) => {
                          if (i) q[i.iid] = i.planned || i.qty || 0;
                        });
                        setPullQtys(q);
                        setModal("pull");
                        setSel(job);
                      }}
                    >
                      🚛 Pull Materials
                    </Btn>
                  )}
                  {perms.jobs_complete && job.status === "active" && (
                    <Btn
                      v="gold"
                      sz="sm"
                      onClick={() => {
                        setSel(job);
                        const q = {};
                        currentItems.forEach((i) => {
                          if (i) q[i.iid] = 0;
                        });
                        setRetQtys(q);
                        setModal("return");
                      }}
                    >
                      📦 Return & Complete
                    </Btn>
                  )}
                  {job.status === "completed" && (
                    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      <Btn v="green" sz="sm" onClick={() => { if (!generatePDF(job, users, activeLogo, inv)) showToast("Popup blocked — allow popups for this site to open the PDF report.", "warning"); }}>📄 PDF</Btn>
                      <Btn v="sky" sz="sm" onClick={() => setSyncModal(job)}>☁️ Sync Status</Btn>
                    </div>
                  )}
                  <Btn v="ghost" sz="sm" onClick={() => openJob(job)}>Details</Btn>
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${C.lg}`, paddingTop: 10, display: "flex", gap: "var(--space-3)", overflowX: "auto", paddingBottom: 4 }}>
                {currentItems.slice(0, 6).map((item) => {
                  if (!item) return null;
                  return (
                    <div
                      key={item.iid || item.id}
                      style={{
                        background: item.pulled > 0 ? C.gB : C.lg,
                        borderRadius: 7,
                        padding: "5px 10px",
                        flexShrink: 0,
                        border: item.pulled > 0 ? `1px solid ${C.gr}` : "none",
                      }}
                    >
                      <div style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", color: C.navy, whiteSpace: "nowrap" }}>{item.iname || item.name}</div>
                      <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>
                        {item.pulled > 0
                          ? `${(item.pulled || 0) - (item.returned || 0)} used`
                          : `${item.planned || item.qty || 0} ${item.unit || ""} planned`}
                      </div>
                    </div>
                  );
                })}
                {currentItems.length > 6 && (
                  <div style={{ background: C.lg, borderRadius: 7, padding: "5px 10px", flexShrink: 0, display: "flex", alignItems: "center", fontSize: "var(--text-2xs)", color: C.sub }}>
                    +{currentItems.length - 6} more
                  </div>
                )}
              </div>
              {perms.inv_pricing_view && job.status === "completed" && totalCost > 0 && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${C.lg}`, paddingTop: 8, display: "flex", justifyContent: "flex-end" }}>
                  <span style={{ fontWeight: "var(--weight-black)", fontSize: 15, color: C.gr }}>Total: {fm(totalCost)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {modal === "pull" && sel && (
        <Modal
          title={`Pull Materials — ${sel.title || sel.name}`}
          onClose={() => {
            if (!pulling) {
              setModal(null);
              setSel(null);
              setPullQtys({});
            }
          }}
          wide
        >
          <div style={{ background: C.tB, border: `1.5px solid ${C.tl}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.tl, fontWeight: "var(--weight-semibold)" }}>
            Adjust quantities if needed. Confirm to deduct from warehouse inventory (FIFO).
          </div>
          <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: "var(--text-base)" }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {["Item", "Planned", "Actual to Pull", "Available"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(sel.items) ? sel.items : (sel.materials || [])).map((item) => {
                if (!item) return null;
                const avail = tot(inv.find((i) => i.id === item.iid) || { batches: [] });
                const parsedActual = parseFloat(pullQtys[item.iid]);
                const actual = Number.isNaN(parsedActual) ? (item.planned || item.qty || 0) : parsedActual;
                const short = actual > avail;
                return (
                  <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}`, background: short ? C.rB : "transparent" }}>
                    <td style={{ padding: "9px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>{item.iname || item.name}</td>
                    <td style={{ padding: "9px 10px" }}>{item.planned || item.qty || 0} {item.unit || ""}</td>
                    <td style={{ padding: "9px 10px" }}>
                      <Inp
                        type="number"
                        value={pullQtys[item.iid] ?? (item.planned || item.qty || 0)}
                        min="0"
                        onChange={(e) =>
                          setPullQtys((p) => ({
                            ...p,
                            [item.iid]: Math.max(0, parseFloat(e.target.value) || 0),
                          }))
                        }
                        style={{ width: 80, padding: "4px 8px" }}
                        disabled={pulling}
                      />
                    </td>
                    <td style={{ padding: "9px 10px", color: short ? C.rd : C.gr, fontWeight: "var(--weight-bold)" }}>
                      {avail} {item.unit || ""}
                      {short && " ⚠️"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn v="ghost" onClick={() => { setModal(null); setSel(null); setPullQtys({}); }} style={{ flex: 1, justifyContent: "center" }} disabled={pulling}>Cancel</Btn>
            <Btn v="teal" sz="lg" onClick={confirmPull} style={{ flex: 2, justifyContent: "center" }} disabled={pulling}>
              {pulling ? "⏳ Allocation Sync In Progress..." : "✅ Confirm Pull from Warehouse"}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === "return" && sel && (
        <Modal
          title={`Return Unused — ${sel.title || sel.name}`}
          onClose={() => { if (!returning) { setModal(null); setRetQtys({}); } }}
          wide
        >
          <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.am, fontWeight: "var(--weight-semibold)" }}>
            Enter quantities being returned. PDF report + AccuLynx sync will trigger on completion.
          </div>
          <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: "var(--text-base)" }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {["Item", "Pulled", "Returning", "Will Be Used"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(sel.items) ? sel.items : (sel.materials || []))
                .filter((i) => i && (i.pulled || 0) > 0)
                .map((item) => {
                  const ret = Math.min(parseFloat(retQtys[item.iid]) || 0, item.pulled || 0);
                  const used = (item.pulled || 0) - ret;
                  return (
                    <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}` }}>
                      <td style={{ padding: "9px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>{item.iname || item.name}</td>
                      <td style={{ padding: "9px 10px" }}>{item.pulled} {item.unit || ""}</td>
                      <td style={{ padding: "9px 10px" }}>
                        <Inp
                          type="number"
                          value={retQtys[item.iid] ?? 0}
                          min="0"
                          max={item.pulled}
                          onChange={(e) =>
                            setRetQtys((p) => ({
                              ...p,
                              [item.iid]: Math.min(item.pulled, Math.max(0, parseFloat(e.target.value) || 0)),
                            }))
                          }
                          style={{ width: 80, padding: "4px 8px" }}
                          disabled={returning}
                        />
                      </td>
                      <td style={{ padding: "9px 10px", fontWeight: "var(--weight-extrabold)", color: used > 0 ? C.navy : C.sub }}>
                        {used} {item.unit || ""}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {perms.inv_pricing_view && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${C.navy}` }}>
                  <td colSpan={3} style={{ padding: "9px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>Estimated Cost</td>
                  <td style={{ padding: "9px 10px", fontWeight: "var(--weight-black)", color: C.gr, fontSize: 15 }}>
                    {fm(
                      (Array.isArray(sel.items) ? sel.items : (sel.materials || []))
                        .filter((i) => i && (i.pulled || 0) > 0)
                        .reduce((s, i) => {
                          const ret = Math.min(parseFloat(retQtys[i.iid]) || 0, i.pulled || 0);
                          return s + ((i.pulled || 0) - ret) * (i.priceAtPull || 0);
                        }, 0),
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn v="ghost" onClick={() => { setModal(null); setRetQtys({}); }} style={{ flex: 1, justifyContent: "center" }} disabled={returning}>Cancel</Btn>
            <Btn v="green" sz="lg" onClick={confirmReturn} style={{ flex: 2, justifyContent: "center" }} disabled={returning}>
              {returning ? "⏳ Compiling Core Assets..." : "🏁 Complete Job & Generate PDF"}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === "edit" && sel && perms.jobs_edit_pull && (
        <Modal title={`Edit Job — ${sel.po}`} onClose={() => { if (!savingEdit) setModal(null); }} wide>
          <Fld label="Job PO Number *">
            <Inp value={editForm.po || ""} onChange={(e) => setEditForm({ ...editForm, po: e.target.value })} disabled={savingEdit} />
          </Fld>
          <Fld label="Job Name *">
            <Inp value={editForm.name || ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} disabled={savingEdit} />
          </Fld>
          <Fld label="Address">
            <Inp value={editForm.addr || ""} onChange={(e) => setEditForm({ ...editForm, addr: e.target.value })} disabled={savingEdit} />
          </Fld>
          <Fld label="Scheduled Date">
            <Inp type="date" aria-label="Scheduled Date" value={editForm.scheduledDate || ""} onChange={(e) => setEditForm({ ...editForm, scheduledDate: e.target.value })} disabled={savingEdit} />
          </Fld>
          <Fld label="Assigned Site Supervisor">
            <Sel value={editForm.assignedto || ""} onChange={(e) => setEditForm({ ...editForm, assignedto: e.target.value })} disabled={savingEdit}>
              <option value="">— Unassigned —</option>
              {fieldUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Sel>
          </Fld>
          <Fld label="Notes">
            <TA value={editForm.notes || ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} disabled={savingEdit} />
          </Fld>

          {vehs.some((v) => v.type === "trailer") && (
            <Fld label="🚚 Trailers Needed" hint="Toggling a trailer here notifies the assigned supervisor immediately.">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                {vehs.filter((v) => v.type === "trailer").map((v) => {
                  const checked = jobTrailers.some((jt) => jt.job_id === sel.id && jt.trailer_id === v.id);
                  return (
                    <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 5, background: checked ? C.tB : C.lg, border: `1px solid ${checked ? C.tl : C.bd}`, borderRadius: "var(--radius-pill)", padding: "5px 12px", fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color: checked ? C.tl : C.navy, cursor: "pointer" }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleJobTrailer(sel.id, v.id)} disabled={savingEdit} style={{ margin: 0 }} />
                      {v.name}
                    </label>
                  );
                })}
              </div>
            </Fld>
          )}

          <h4 style={{ margin: "16px 0 8px", color: C.navy, fontSize: "var(--text-sm)", textTransform: "uppercase" }}>Materials Checklist</h4>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: 10 }}>
            {editItems.length === 0 ? (
              <p style={{ color: C.sub, fontSize: "var(--text-sm)", margin: 0 }}>No materials on this job.</p>
            ) : (
              editItems.map((item) => (
                <div key={item.iid} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", background: C.lg, borderRadius: 7, padding: "7px 10px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>{item.iname}</div>
                    {item.pulled > 0 && (
                      <div style={{ fontSize: "var(--text-2xs)", color: C.am }}>⚠️ {item.pulled} {item.unit} already pulled</div>
                    )}
                  </div>
                  <Inp
                    type="number"
                    min="0"
                    value={item.planned}
                    onChange={(e) => updateEditItemQty(item.iid, e.target.value)}
                    style={{ width: 70, padding: "4px 8px" }}
                    disabled={savingEdit}
                  />
                  <span style={{ fontSize: "var(--text-xs)", color: C.sub, width: 50 }}>{item.unit}</span>
                  <button
                    onClick={() => removeEditItem(item)}
                    disabled={savingEdit}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: "var(--text-lg)", lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          <Fld label="Add Material">
            <Inp value={editItemSearch} onChange={(e) => setEditItemSearch(e.target.value)} placeholder="🔍 Search inventory..." disabled={savingEdit} />
          </Fld>
          {editItemSearch.trim() && (
            <div style={{ border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", maxHeight: 160, overflowY: "auto", marginBottom: 14 }}>
              {editFiltInv.length === 0 ? (
                <div style={{ padding: 10, fontSize: "var(--text-sm)", color: C.sub, textAlign: "center" }}>No matching inventory items.</div>
              ) : (
                editFiltInv.map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${C.lg}` }}>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy }}>{item.name}</span>
                    <Btn v="primary" sz="sm" onClick={() => { addEditItem(item); setEditItemSearch(""); }}>+ Add</Btn>
                  </div>
                ))
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn v="ghost" onClick={() => setModal(null)} disabled={savingEdit} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
            <Btn v="primary" onClick={saveJobEdit} disabled={savingEdit} style={{ flex: 1, justifyContent: "center" }}>{savingEdit ? "Saving..." : "Save Changes"}</Btn>
          </div>
        </Modal>
      )}

      {modal === null && sel && (
        <Modal title={`${sel.po || "No PO"} — ${sel.title || sel.name}`} onClose={() => setSel(null)} wide>
          {perms.jobs_edit_pull && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <Btn v="outline" sz="sm" onClick={() => startEditJob(sel)}>✏️ Edit Job</Btn>
            </div>
          )}
          <div style={{ marginTop: 18, borderTop: `1px solid ${C.lg}`, paddingTop: 14 }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>📸 Visual Production Accountability Media</h3>
            <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.sub, marginBottom: 4 }}>Before Photo (Site Prep / Decking)</div>
                <PhotoUpload current={currentJobPhotos.before} onUpload={(base64) => handleStagePhoto("before", base64)} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.sub, marginBottom: 4 }}>After Photo (Finished Shingles / Clean)</div>
                <PhotoUpload current={currentJobPhotos.after} onUpload={(base64) => handleStagePhoto("after", base64)} />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: "var(--space-3)", marginBottom: 14, marginTop: 14 }}>
            {[
              ["Status", <Bdg color={(jSC[sel.status] || {c:"gray"}).c}>{(jSC[sel.status] || {l:sel.status}).l}</Bdg>],
              ["PO", sel.po || "—"],
              ["Assigned To", users.find((u) => u.id === sel.assignedto || u.id === sel.assignedTo)?.name || "—"],
              ["🚚 Trailer", jobTrailers.filter((jt) => jt.job_id === sel.id).map((jt) => vehs.find((v) => v.id === jt.trailer_id)?.name).filter(Boolean).join(", ") || "None needed"],
              ["Approved", fd(sel.approved || sel.approvedAt)],
              ["Completed", fd(sel.completed || sel.completedAt)],
            ].map(([k, v]) => (
              <div key={k} style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: 10 }}>
                <div style={{ fontSize: "var(--text-2xs)", color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {["Item", "Planned", "Pulled", "Returned", "Used", ...(perms.inv_pricing_view ? ["Cost"] : [])].map((h) => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(sel.items) ? sel.items : (sel.materials || [])).map((item) => {
                if (!item) return null;
                const pQty = item.pulled || 0;
                const rQty = item.returned || 0;
                return (
                  <tr key={item.iid || item.id} style={{ borderTop: `1px solid ${C.lg}` }}>
                    <td style={{ padding: "8px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>{item.iname || item.name}</td>
                    <td style={{ padding: "8px 10px" }}>{item.planned || item.qty || 0}</td>
                    <td style={{ padding: "8px 10px", color: pQty > 0 ? C.gr : C.sub }}>{pQty}</td>
                    <td style={{ padding: "8px 10px", color: rQty > 0 ? C.am : C.sub }}>{rQty}</td>
                    <td style={{ padding: "8px 10px", fontWeight: "var(--weight-bold)" }}>{pQty - rQty}</td>
                    {perms.inv_pricing_view && (
                      <td style={{ padding: "8px 10px", color: C.blue, fontWeight: "var(--weight-bold)" }}>
                        {item.pullCost > 0 ? fm((pQty - rQty) * (item.priceAtPull || 0)) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sel.status === "completed" && (
            <div style={{ marginTop: 10, display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
              <Btn v="green" onClick={() => { if (!generatePDF(sel, users, activeLogo, inv)) showToast("Popup blocked — allow popups for this site to open the PDF report.", "warning"); }}>📄 PDF</Btn>
              <Btn v="sky" onClick={() => setSyncModal(sel)}>☁️ AccuLynx Sync</Btn>
            </div>
          )}
        </Modal>
      )}

      {syncModal && (
        <Modal title={`AccuLynx Sync — ${syncModal.po || "No PO #"}`} onClose={() => setSyncModal(null)}>
          <div style={{ marginBottom: 14 }}>
            {syncModal.syncStatus === "synced" && (
              <div style={{ background: C.sB, border: `1.5px solid ${C.sl}`, borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.sl, marginBottom: 4 }}>☁️ Successfully Synced to AccuLynx</div>
                <div style={{ fontSize: "var(--text-sm)", color: C.sub }}>{syncModal.syncNote}</div>
                {syncModal.syncedAt && <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 4 }}>Synced: {ft(syncModal.syncedAt)}</div>}
              </div>
            )}
            {syncModal.syncStatus === "failed" && (
              <div style={{ background: C.rB, border: `1.5px solid ${C.rd}`, borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.rd, marginBottom: 4 }}>⚠️ Sync Failed</div>
                <div style={{ fontSize: "var(--text-sm)", color: C.sub }}>{syncModal.syncNote}</div>
              </div>
            )}
            {(syncModal.syncStatus === "manual" || !syncModal.syncStatus) && (
              <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.am, marginBottom: 4 }}>📋 Auto-Sync Not Configured</div>
                <div style={{ fontSize: "var(--text-sm)", color: C.navy }}>Configure AccuLynx in Settings → AccuLynx to enable automatic document upload and cost entry.</div>
              </div>
            )}
          </div>
          {syncModal.syncPayload && (
            <>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.navy, textTransform: "uppercase", marginBottom: 6 }}>Payload Sent to AccuLynx</div>
              <div style={{ background: "#1A202C", borderRadius: "var(--radius-md)", padding: 12, overflowX: "auto", marginBottom: 12 }}>
                <pre style={{ margin: 0, fontSize: "var(--text-2xs)", color: "#68D391", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {JSON.stringify(syncModal.syncPayload, null, 2)}
                </pre>
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            {(syncModal.syncStatus === "failed" || syncModal.syncStatus === "manual") && (
              <Btn v="sky" onClick={() => { attemptAccuLynxSync(syncModal, users, acculynxConfig, setJobs); setSyncModal(null); }} style={{ flex: 1, justifyContent: "center" }}>🔄 Retry Sync</Btn>
            )}
            <Btn v="ghost" onClick={() => setSyncModal(null)} style={{ flex: 1, justifyContent: "center" }}>Close</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}