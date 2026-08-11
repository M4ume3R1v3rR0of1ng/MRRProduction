// src/views/PullInventoryView.jsx
// ── Pull Inventory ────────────────────────────────
import { useState, useEffect } from "react";
import { C, fd, fm, doFifo, uid, tot, ft, mkJI, mergePullTracking, todayLocal, applyReturnBatch } from "../utils/helpers";
import { displayNameOf } from "../utils/people";
import { translations } from "../utils/translations";
import { generatePDF } from "../utils/pdfGenerator";
import { syncJobReportToAccuLynx, syncStatusOf, syncNoteOf, syncedAtOf, reportUploadedAtOf } from "../utils/accuLynxSync";
import { Btn, Bdg, Modal, Fld, TA, Inp, Sel, PhotoUpload } from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { supabase, updateRowStrict, isTransportError } from "../utils/supabase";
import { sendLowStockAlerts } from "../utils/lowStockAlerts";
import { useNotify } from "../context/NotificationContext";
import { uploadPhotoToBucket } from "../utils/storageBucketUpload";
import { sendEmail, escapeHtml as esc } from "../utils/email";
import { notifyJobMove } from "../utils/jobNotifications";

export default function PullInventory({
  jobs = [],
  company = null,
  jobNotifications = {},
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
  lang,
  openItemId,
  onOpenItemHandled,
}) {
  const { showToast } = useNotify();
  const t = translations[lang] || translations.en;
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [pullQtys, setPullQtys] = useState({});
  const [retQtys, setRetQtys] = useState({});
  const [syncModal, setSyncModal] = useState(null);

  const [pulling, setPulling] = useState(false);
  const [returning, setReturning] = useState(false);
  // Lines that would take stock below zero, held for confirmation. Non-null means
  // the pull was computed against LIVE batches, found a shortfall, and stopped
  // before committing anything. See confirmPull.
  const [shortWarn, setShortWarn] = useState(null);
  const [sortBy, setSortBy] = useState("newest");
  // "all" | "approved" | "active". Defaults to all so the view opens showing the
  // whole queue — narrowing is a choice the user makes, not a state they land in
  // and have to notice they are in.
  const [statusFilt, setStatusFilt] = useState("all");
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
      if (!window.confirm(`"${item.iname}" ${t.pullRemoveConfirm.replace("{qty}", item.pulled).replace("{unit}", item.unit || "")}`)) {
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

      showToast(t.pullJobSaved, "success");
      setModal(null);
    } catch (err) {
      console.error("Failed to save job edit:", err);
      showToast(`${t.pullSaveError} ${err.message}`, "error");
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
          .update({ newforassigned: true })
          .eq("id", jobId);
        if (error) throw error;
        setJobs((p) => p.map((j) => (j.id === jobId ? { ...j, newforassigned: true } : j)));
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
      showToast(`${assignedUser?.name || t.pullSupervisor} ${action === "added" ? t.pullTrailerAddedMsg : t.pullTrailerRemovedMsg}`, "success");
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
        showToast(`${t.pullFailRemoveTrailer} ${err.message}`, "error");
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
        showToast(`${t.pullFailAssignTrailer} ${err.message}`, "error");
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

  // Everything this user may see here. Completed is INCLUDED at this level and
  // excluded from the work queue below.
  //
  // It has to be reachable somewhere in this view. Completing a job drops it out
  // of the queue instantly, and if the PDF popup was blocked on the way out there
  // was no way back to the report — the 📄 PDF / Sync buttons further down are
  // written for exactly that recovery and could never render, because the list
  // they render from had already filtered completed jobs away. Closed jobs stay
  // out: those are finished business and live in Build Jobs.
  const visibleJob = (j) => j && j.status !== "draft" && j.status !== "closed";
  const mine = isField
    ? jobs.filter((j) => visibleJob(j) && (j.assignedto === user.id || j.assignedTo === user.id))
    : jobs.filter(visibleJob);

  // The work queue: what still needs doing. This is what "All" means, and it is
  // deliberately not "everything on this screen" — a finished job is not work.
  const openJobs = mine.filter(isOpenJob);

  // Counts come from the whole set, not the current slice, so each button says
  // what is behind the others before you press them.
  const statusCounts = {
    all: openJobs.length,
    approved: openJobs.filter((j) => j.status === "approved").length,
    active: openJobs.filter((j) => j.status === "active").length,
    completed: mine.filter((j) => j.status === "completed").length,
  };

  const myJobs = (statusFilt === "all" ? openJobs : mine.filter((j) => j.status === statusFilt))
    .sort(jobSorters[sortBy] || jobSorters.newest);

  const openJob = async (j) => {
    if (!j) return;
    setSel(j);
    const isNew = j.newforassigned;
    if (isNew && (j.assignedto === user.id || j.assignedTo === user.id)) {
      try {
        const { error } = await supabase
          .from("jobs")
          .update({ newforassigned: false })
          .eq("id", j.id);
        if (error) throw error;
        setJobs((p) =>
          p.map((x) => (x.id === j.id ? { ...x, newforassigned: false } : x)),
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

  // `force` is the second press, after the shortfall dialog. The first press
  // computes the whole pull, and if anything would go negative it stops and shows
  // what and by how much — nothing is written on that pass.
  const confirmPull = async (force = false) => {
    if (!sel) return;
    setPulling(true);

    const updItems = [...(sel.items || sel.materials || [])];
    const shortRows = [];
    // Batches touched by this pull, keyed by inventory id. Only these rows get
    // written back — writing the whole in-memory list here used to overwrite
    // stock other devices had received since this session loaded.
    const changedBatches = new Map();
    // Stamped onto the synthetic negative batch so an item found at -1 six months
    // from now still names the job that took it. audit_logs cannot answer that:
    // it is purged at 30 days. The batch row is not.
    const jobRef = `${sel.po ? `PO ${sel.po}` : "No PO"} · ${sel.title || sel.name || "Untitled job"}`;
    const pulledAt = todayLocal();

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

        const res = doFifo({ batches: freshById.get(item.iid) }, qty, {
          by: user.id,
          byName: displayNameOf(user),
          jobId: sel.id,
          ref: jobRef,
        });
        if (res.shortfall > 0) {
          shortRows.push({
            iid: item.iid,
            name: item.iname || item.name,
            unit: item.unit || "",
            requested: qty,
            available: qty - res.shortfall,
            short: res.shortfall,
          });
        }

        changedBatches.set(item.iid, res.batches);
        const ppu = qty > 0 ? res.cost / qty : 0;
        const ji = updItems.findIndex((i) => i && i.iid === item.iid);
        if (ji >= 0) {
          updItems[ji] = {
            ...updItems[ji],
            pulled: qty,
            // The day the material physically left, which is not the day the job
            // closes. Monthly reconciliation files usage by this; without it a job
            // pulled in January and completed in February moves a month's worth of
            // consumption into the wrong period. See utils/inventoryCounts.
            pulledAt,
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

      // Pulling past on-hand is allowed — the roof still needs doing and the
      // warehouse count is sometimes just stale. But it must be a decision, not a
      // side effect discovered afterwards in a toast. The old code committed the
      // negative first and mentioned it second.
      //
      // This check runs on FRESH batches, not the modal's snapshot, so it reflects
      // what another device received or pulled while this screen sat open.
      if (shortRows.length > 0 && !force) {
        setShortWarn(shortRows);
        return;
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

      // Email the assigned supervisor if the company enabled "Materials pulled".
      notifyJobMove({ transition: "active", job: updatedJob, users, prefs: jobNotifications });

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

      await handlePullMaterials(sel.id, updItems, shortRows);
      if (shortRows.length > 0) {
        showToast(
          t.pullShortStock.replace("{items}", shortRows.map((r) => `${r.name} (${r.short} ${r.unit})`.trim()).join(", ")),
          "warning",
        );
      } else {
        showToast(t.pullPulledOk, "success");
      }
      setShortWarn(null);
      setModal(null);
      setPullQtys({});
    } catch (err) {
      console.error("Failed to finalize material pull layout:", err);
      showToast(`${t.pullPullAborted} ${err.message}`, "error");
    } finally {
      setPulling(false);
    }
  };

  const confirmReturn = async () => {
    if (!sel) return;
    setReturning(true);

    const rawItems = sel.items || sel.materials || [];

    // Hoisted out of the try so the recovery path in the catch can still finish
    // the job off when it turns out the commit landed and only the reply was lost.
    let updatedJob = null;
    let newInv = inv;

    // Everything that happens once the job is genuinely completed. Shared by the
    // happy path and the recovery path so a lost response finishes identically to
    // a clean one — same local state, same PDF, same AccuLynx sync, same emails.
    const finish = () => {
      setInv(newInv);
      setJobs((p) => p.map((j) => (j.id === sel.id ? updatedJob : j)));
      // Email the assigned supervisor if the company enabled "Completed".
      notifyJobMove({ transition: "completed", job: updatedJob, users, prefs: jobNotifications });
      showToast(t.pullJobCompleted, "success");
      setModal(null);
      setRetQtys({});

      setTimeout(() => {
        // The PDF is for the person standing here — it opens to print or save and
        // goes nowhere else. Sending anything to AccuLynx is the sync's job.
        if (!generatePDF(updatedJob, users, activeLogo, newInv, company)) {
          showToast(t.pullPopupBlocked1, "warning");
        }
        if (acculynxConfig?.autoSync) {
          syncJobReportToAccuLynx({
            job: updatedJob, users, config: acculynxConfig, setJobs,
            activeLogo, inv: newInv, company,
          }).then((r) => {
            if (r.ok) showToast(t.pullReportUploaded, "success");
            else if (!r.skipped) showToast(`${t.pullReportUploadFail} ${r.error}`, "warning");
          });
        }
      }, 300);

      setSel(null);
    };

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
          // Deterministic batch id, so pressing Complete again after a dropped
          // connection re-posts the same return instead of a second one. See
          // applyReturnBatch.
          changedBatches.set(
            item.iid,
            applyReturnBatch(freshById.get(item.iid), {
              jobId: sel.id,
              iid: item.iid,
              qty: ret,
              price: item.priceAtPull || 0,
              by: user.id,
              byName: displayNameOf(user),
              rcvd: todayLocal(),
            }),
          );
        }
        return { ...item, returned: ret };
      }).filter(Boolean);

      const completedAt = new Date().toISOString();
      updatedJob = {
        ...sel,
        status: "completed",
        completed: completedAt,
        completedAt,
        items: updItems,
        materials: updItems,
      };
      newInv = inv.map((i) => (changedBatches.has(i.id) ? { ...i, batches: changedBatches.get(i.id) } : i));

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

      finish();
    } catch (err) {
      console.error("Failed to complete job procedures:", err);

      // "TypeError: Failed to fetch" is the browser reporting that no response
      // ever came back — a truck losing its hotspot mid-request. Labelling that a
      // "Database Error" points every investigation at the wrong system, and it
      // buries the part that matters: the transaction may have COMMITTED with only
      // the reply lost, leaving the job completed server-side while this device
      // still shows it active, with no PDF and no AccuLynx sync. So ask the
      // database which of the two happened rather than guessing.
      if (isTransportError(err) && updatedJob) {
        try {
          const { data: row, error: probeErr } = await supabase
            .from("jobs")
            .select("status,completed,completedAt")
            .eq("id", sel.id)
            .maybeSingle();
          if (!probeErr && row?.status === "completed") {
            // Carry the timestamp the database actually recorded, not the one
            // this attempt generated — the commit that landed was the earlier one.
            updatedJob = { ...updatedJob, completed: row.completed, completedAt: row.completedAt };
            finish();
            return;
          }
        } catch {
          // Still no signal. Fall through to the honest message below.
        }
        showToast(t.pullReturnOffline, "error");
        return;
      }

      showToast(`${t.pullReturnError} ${err.message}`, "error");
    } finally {
      setReturning(false);
    }
  };

  // One fact now: did the report PDF reach AccuLynx. syncStatus and
  // report_uploaded_at describe the same upload, so this reads whichever is set —
  // report_uploaded_at also covers jobs filed before the status was recorded.
  const syncBadge = (job) => {
    if (!job || job.status !== "completed") return null;
    const status = syncStatusOf(job);
    if (status === "synced" || reportUploadedAtOf(job)) return <Bdg color="green">{t.pullReportFiled}</Bdg>;
    if (status === "failed") return <Bdg color="red">{t.pullUploadFailed}</Bdg>;
    if (status === "manual") return <Bdg color="amber">{t.pullConfigureSync}</Bdg>;
    return null;
  };

  // The audit entry for a pull.
  //
  // It used to read "Dispatched staging materials out for Job PO #123 (Smith)" and
  // nothing else. The item list went into metadata under a nested `payload` key
  // that the Audit Log screen never rendered, so in practice the log recorded that
  // SOMETHING was pulled and never what. The description now carries the line count
  // and any shortfall, and the metadata is flat so the Inspect panel can show it.
  const handlePullMaterials = async (jobId, materialsList, shortRows = []) => {
    const lines = (materialsList || []).filter((i) => i && (i.pulled || 0) > 0);
    const jobName = sel.title || sel.name || "Untitled job";
    const shortNote = shortRows.length
      ? ` Went short on ${shortRows.map((r) => `${r.name} (${r.short} ${r.unit})`.trim()).join(", ")}. Stock is now negative, check the count.`
      : "";

    await logAction(
      user.id,
      user.email,
      "INVENTORY_PULL",
      `Pulled ${lines.length} material line${lines.length === 1 ? "" : "s"} for PO ${sel.po || "n/a"} (${jobName}).${shortNote}`,
      {
        job_id: jobId,
        po: sel.po || null,
        job_name: jobName,
        line_count: lines.length,
        lines: lines.map((i) => ({
          item: i.iname || i.name,
          qty: i.pulled,
          unit: i.unit || "",
          planned: i.planned ?? i.qty ?? null,
          unit_cost: i.priceAtPull ?? null,
        })),
        short: shortRows.map((r) => ({ item: r.name, short: r.short, unit: r.unit, available: r.available })),
      },
      "pull",
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
        showToast(`${phase === "before" ? t.pullBefore : t.pullAfter} ${t.pullPhotoSynced}`, "success");
      }
    } catch (err) {
      console.error("[Storage Upload Failure]:", err);
      showToast(`${t.pullUploadFailed} ${err.message || t.pullNetworkTimeout}`, "error");
    }
  };

  const currentJobPhotos = sel ? { before: sel.photo_before_url || null, after: sel.photo_after_url || null } : { before: null, after: null };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "var(--space-3)", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy }}>📋 {t.pull}</h1>
          <p style={{ margin: "2px 0 0", color: C.sub, fontSize: "var(--text-sm)" }}>
            {isField ? t.pullYourJobs : t.pullAllJobs}
          </p>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
        {/* Counts come from the unfiltered queue on purpose: the point of the
            number is to say what is behind the OTHER buttons before you press
            them. The dot emoji stays even though the selected button is already
            colour-coded, because an unselected button is plain ghost grey and
            colour would then be the only thing distinguishing them. */}
        <div role="group" aria-label={t.pullFilterAria} style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {[
            // Geometric marks, not emoji: the coloured-circle emoji I first used
            // here were silently stripped from this file on save (astral-plane
            // codepoints; the BMP ▦ survived). These also read as a progression,
            // empty to half to done, which the emoji never did.
            { id: "all", dot: "▦", label: t.pullFilterAllShort, full: t.pullFilterAll, count: statusCounts.all, tone: "primary" },
            { id: "approved", dot: "○", label: t.pullFilterApprovedShort, full: t.pullFilterApproved, count: statusCounts.approved, tone: "gold" },
            { id: "active", dot: "◐", label: t.pullFilterActiveShort, full: t.pullFilterActive, count: statusCounts.active, tone: "green" },
            // Not part of "All": finished work is not queue work. It is here so a
            // job that vanished on completion stays findable, and so the PDF can
            // be reopened when the popup was blocked.
            { id: "completed", dot: "●", label: t.pullFilterCompletedShort, full: t.pullFilterCompleted, count: statusCounts.completed, tone: "sky" },
          ].map((f) => {
            const on = statusFilt === f.id;
            return (
              <Btn
                key={f.id}
                v={on ? f.tone : "ghost"}
                sz="sm"
                onClick={() => setStatusFilt(f.id)}
                aria-pressed={on}
                title={f.full}
              >
                {f.dot} {f.label} ({f.count})
              </Btn>
            );
          })}
        </div>
        <Sel value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label={t.pullSortAria} style={{ width: "auto" }}>
          <option value="newest">↕ {t.pullSortNewest}</option>
          <option value="oldest">↕ {t.pullSortOldest}</option>
          <option value="name_az">↕ {t.pullSortNameAZ}</option>
          <option value="name_za">↕ {t.pullSortNameZA}</option>
          <option value="po">↕ {t.pullSortPO}</option>
          <option value="status">↕ {t.status}</option>
        </Sel>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {myJobs.length === 0 && (
          <div style={{ background: C.w, padding: 32, borderRadius: "var(--radius-xl)", textAlign: "center", color: C.sub, boxShadow: "var(--shadow-sm)" }}>
            {/* "All caught up" is only true when nothing is hidden. With a filter
                on and jobs behind it, that message sends someone hunting for a
                bug that is really a dropdown two feet above their cursor. */}
            {openJobs.length === 0 ? t.pullAllCaughtUp : t.pullNoneMatchFilter}
            {openJobs.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Btn v="ghost" sz="sm" onClick={() => setStatusFilt("all")}>
                  {t.pullShowAllJobs} ({statusCounts.all})
                </Btn>
              </div>
            )}
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
          const isNew = (job.newforassigned) && (job.assignedto === user.id || job.assignedTo === user.id);
          
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
                    {isNew && <Bdg color="teal">🔔 {t.pullNew}</Bdg>}
                    <span style={{ fontSize: "var(--text-sm)", color: C.sub }}>{job.po || t.pullNoPoHash}</span>
                    {syncBadge(job)}
                  </div>
                  <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, fontSize: 15, marginBottom: 2 }}>
                    {job.title || job.name}
                  </div>
                  <div style={{ fontSize: "var(--text-sm)", color: C.sub, marginBottom: 4 }}>{job.addr || job.address}</div>
                  {!isField && sup && <div style={{ fontSize: "var(--text-xs)", color: C.blue, fontWeight: "var(--weight-bold)" }}>👤 {sup.name}</div>}
                  {jobTrailerNames.length > 0 && (
                    <div style={{ fontSize: "var(--text-xs)", color: C.am, fontWeight: "var(--weight-bold)", marginTop: 2 }}>
                      {t.pullBringTrailer} {jobTrailerNames.join(", ")}
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
                      🚛 {t.pullPullMaterials}
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
                      {t.pullReturnComplete}
                    </Btn>
                  )}
                  {job.status === "completed" && (
                    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      <Btn v="green" sz="sm" onClick={() => { if (!generatePDF(job, users, activeLogo, inv, company)) showToast(t.pullPopupBlocked2, "warning"); }}>📄 PDF</Btn>
                      <Btn v="sky" sz="sm" onClick={() => setSyncModal(job)}>{t.pullSyncUpload}</Btn>
                    </div>
                  )}
                  <Btn v="ghost" sz="sm" onClick={() => openJob(job)}>{t.pullDetails}</Btn>
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
                          ? `${(item.pulled || 0) - (item.returned || 0)} ${t.pullUsed}`
                          : `${item.planned || item.qty || 0} ${item.unit || ""} ${t.pullPlanned}`}
                      </div>
                    </div>
                  );
                })}
                {currentItems.length > 6 && (
                  <div style={{ background: C.lg, borderRadius: 7, padding: "5px 10px", flexShrink: 0, display: "flex", alignItems: "center", fontSize: "var(--text-2xs)", color: C.sub }}>
                    +{currentItems.length - 6} {t.pullMore}
                  </div>
                )}
              </div>
              {perms.inv_pricing_view && job.status === "completed" && totalCost > 0 && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${C.lg}`, paddingTop: 8, display: "flex", justifyContent: "flex-end" }}>
                  <span style={{ fontWeight: "var(--weight-black)", fontSize: 15, color: C.gr }}>{t.pullTotal}: {fm(totalCost)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {modal === "pull" && sel && (
        <Modal
          title={`${t.pullPullMaterials} — ${sel.title || sel.name}`}
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
            {t.pullAdjustInfo}
          </div>
          <div className="sw-table-scroll">
            <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: "var(--text-base)" }}>
              <thead>
                <tr style={{ background: C.lg }}>
                  {[t.colItem, t.colPlanned, t.colActualPull, t.colAvailable].map((h) => (
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
          </div>
          {/* Sticky for the same reason as the return modal below: this is the
              last child of a scrolling body, and the confirm button should never
              be something you have to discover by scrolling. */}
          <div
            style={{
              display: "flex",
              gap: "var(--space-4)",
              position: "sticky",
              bottom: 0,
              margin: "0 calc(var(--space-8) * -1) calc(var(--space-8) * -1)",
              padding: "var(--space-4) var(--space-8) var(--space-8)",
              background: C.w,
              borderTop: `1px solid ${C.lg}`,
            }}
          >
            <Btn v="ghost" onClick={() => { setModal(null); setSel(null); setPullQtys({}); }} style={{ flex: 1, justifyContent: "center" }} disabled={pulling}>{t.cancel}</Btn>
            {/* Wrapped, not passed by reference: onClick hands the click event
                through as the first argument, and an event object is truthy — so
                `onClick={confirmPull}` would arrive as force=true and skip the
                shortfall confirmation entirely. */}
            <Btn v="teal" sz="lg" onClick={() => confirmPull()} style={{ flex: 2, justifyContent: "center" }} disabled={pulling}>
              {pulling ? t.pullInProgress : t.pullConfirm}
            </Btn>
          </div>
        </Modal>
      )}

      {/* ── Going negative ──────────────────────────────────────────────────
          Raised BEFORE anything is written, computed against live batches rather
          than this device's snapshot. The pull is still allowed: a crew standing
          on a roof cannot wait for a recount, and the warehouse number is wrong
          often enough that blocking would strand them. But it has to be chosen. */}
      {shortWarn && (
        <Modal title={t.pullShortTitle} onClose={() => { if (!pulling) setShortWarn(null); }}>
          <div style={{ background: C.rB, border: `1.5px solid ${C.rd}`, borderRadius: "var(--radius-md)", padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontWeight: "var(--weight-bold)", color: C.rd, marginBottom: 4, fontSize: "var(--text-base)" }}>
              ⚠️ {t.pullShortHeading}
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: C.navy, lineHeight: 1.45 }}>
              {t.pullShortBody}
            </div>
          </div>

          <div className="sw-table-scroll">
            <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: "var(--text-base)" }}>
              <thead>
                <tr style={{ background: C.lg }}>
                  {[t.colItem, t.colOnHand, t.colActualPull, t.colShortBy].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shortWarn.map((r) => (
                  <tr key={r.iid} style={{ borderTop: `1px solid ${C.lg}` }}>
                    <td style={{ padding: "9px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>{r.name}</td>
                    <td style={{ padding: "9px 10px" }}>{r.available} {r.unit}</td>
                    <td style={{ padding: "9px 10px" }}>{r.requested} {r.unit}</td>
                    <td style={{ padding: "9px 10px", fontWeight: "var(--weight-black)", color: C.rd }}>
                      −{r.short} {r.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginBottom: 14, lineHeight: 1.45 }}>
            {t.pullShortFootnote}
          </div>

          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn v="ghost" onClick={() => setShortWarn(null)} disabled={pulling} style={{ flex: 1, justifyContent: "center" }}>
              {t.pullShortCancel}
            </Btn>
            <Btn v="gold" onClick={() => confirmPull(true)} disabled={pulling} style={{ flex: 1, justifyContent: "center" }}>
              {pulling ? t.pullInProgress : t.pullShortProceed}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === "return" && sel && (
        <Modal
          title={`${t.pullReturnUnused} — ${sel.title || sel.name}`}
          onClose={() => { if (!returning) { setModal(null); setRetQtys({}); } }}
          wide
        >
          <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.am, fontWeight: "var(--weight-semibold)" }}>
            {t.pullReturnInfo}
          </div>
          <div className="sw-table-scroll">
            <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: "var(--text-base)" }}>
              <thead>
                <tr style={{ background: C.lg }}>
                  {[t.colItem, t.colPulled, t.colReturning, t.colWillUse].map((h) => (
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
                    <td colSpan={3} style={{ padding: "9px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>{t.pullEstCost}</td>
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
          </div>
          {/* Sticky. Modal is maxHeight:92vh with overflowY:auto, and this row is
              the LAST child of a padded body — so on a phone, a job with seven
              items pushes "Complete Job" below the fold with nothing on screen
              suggesting it is there. The table just runs off the bottom and the
              modal reads as finished. Nothing errors because nothing is pressed.
              Negative margins let the bar span the modal edge to edge. */}
          <div
            style={{
              display: "flex",
              gap: "var(--space-4)",
              position: "sticky",
              bottom: 0,
              margin: "0 calc(var(--space-8) * -1) calc(var(--space-8) * -1)",
              padding: "var(--space-4) var(--space-8) var(--space-8)",
              background: C.w,
              borderTop: `1px solid ${C.lg}`,
            }}
          >
            <Btn v="ghost" onClick={() => { setModal(null); setRetQtys({}); }} style={{ flex: 1, justifyContent: "center" }} disabled={returning}>{t.cancel}</Btn>
            <Btn v="green" sz="lg" onClick={confirmReturn} style={{ flex: 2, justifyContent: "center" }} disabled={returning}>
              {returning ? t.pullCompiling : t.pullCompleteJob}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === "edit" && sel && perms.jobs_edit_pull && (
        <Modal title={`${t.pullEditJob} — ${sel.po}`} onClose={() => { if (!savingEdit) setModal(null); }} wide>
          <Fld label={t.pullJobPO}>
            <Inp value={editForm.po || ""} onChange={(e) => setEditForm({ ...editForm, po: e.target.value })} disabled={savingEdit} />
          </Fld>
          <Fld label={t.pullJobName}>
            <Inp value={editForm.name || ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} disabled={savingEdit} />
          </Fld>
          <Fld label={t.pullAddress}>
            <Inp value={editForm.addr || ""} onChange={(e) => setEditForm({ ...editForm, addr: e.target.value })} disabled={savingEdit} />
          </Fld>
          <Fld label={t.pullSchedDate}>
            <Inp type="date" aria-label={t.pullSchedDate} value={editForm.scheduledDate || ""} onChange={(e) => setEditForm({ ...editForm, scheduledDate: e.target.value })} disabled={savingEdit} />
          </Fld>
          <Fld label={t.pullAssignedSup}>
            <Sel value={editForm.assignedto || ""} onChange={(e) => setEditForm({ ...editForm, assignedto: e.target.value })} disabled={savingEdit}>
              <option value="">{t.pullUnassigned}</option>
              {fieldUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Sel>
          </Fld>
          <Fld label={t.pullNotes}>
            <TA value={editForm.notes || ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} disabled={savingEdit} />
          </Fld>

          {vehs.some((v) => v.type === "trailer") && (
            <Fld label={t.pullTrailersNeeded} hint={t.pullTrailerHint}>
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

          <h4 style={{ margin: "16px 0 8px", color: C.navy, fontSize: "var(--text-sm)", textTransform: "uppercase" }}>{t.pullMaterialsChecklist}</h4>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: 10 }}>
            {editItems.length === 0 ? (
              <p style={{ color: C.sub, fontSize: "var(--text-sm)", margin: 0 }}>{t.pullNoMaterials}</p>
            ) : (
              editItems.map((item) => (
                <div key={item.iid} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", background: C.lg, borderRadius: 7, padding: "7px 10px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>{item.iname}</div>
                    {item.pulled > 0 && (
                      <div style={{ fontSize: "var(--text-2xs)", color: C.am }}>⚠️ {item.pulled} {item.unit} {t.pullAlreadyPulled}</div>
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

          <Fld label={t.pullAddMaterial}>
            <Inp value={editItemSearch} onChange={(e) => setEditItemSearch(e.target.value)} placeholder={t.pullSearchInv} disabled={savingEdit} />
          </Fld>
          {editItemSearch.trim() && (
            <div style={{ border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", maxHeight: 160, overflowY: "auto", marginBottom: 14 }}>
              {editFiltInv.length === 0 ? (
                <div style={{ padding: 10, fontSize: "var(--text-sm)", color: C.sub, textAlign: "center" }}>{t.pullNoMatchingInv}</div>
              ) : (
                editFiltInv.map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${C.lg}` }}>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy }}>{item.name}</span>
                    <Btn v="primary" sz="sm" onClick={() => { addEditItem(item); setEditItemSearch(""); }}>{t.pullAdd}</Btn>
                  </div>
                ))
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn v="ghost" onClick={() => setModal(null)} disabled={savingEdit} style={{ flex: 1, justifyContent: "center" }}>{t.cancel}</Btn>
            <Btn v="primary" onClick={saveJobEdit} disabled={savingEdit} style={{ flex: 1, justifyContent: "center" }}>{savingEdit ? t.pullSaving : t.pullSaveChanges}</Btn>
          </div>
        </Modal>
      )}

      {modal === null && sel && (
        <Modal title={`${sel.po || "No PO"} — ${sel.title || sel.name}`} onClose={() => setSel(null)} wide>
          {perms.jobs_edit_pull && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <Btn v="outline" sz="sm" onClick={() => startEditJob(sel)}>✏️ {t.pullEditJob}</Btn>
            </div>
          )}
          <div style={{ marginTop: 18, borderTop: `1px solid ${C.lg}`, paddingTop: 14 }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>{t.pullVisualMedia}</h3>
            <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.sub, marginBottom: 4 }}>{t.pullBeforePhoto}</div>
                <PhotoUpload current={currentJobPhotos.before} onUpload={(base64) => handleStagePhoto("before", base64)} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.sub, marginBottom: 4 }}>{t.pullAfterPhoto}</div>
                <PhotoUpload current={currentJobPhotos.after} onUpload={(base64) => handleStagePhoto("after", base64)} />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: "var(--space-3)", marginBottom: 14, marginTop: 14 }}>
            {[
              [t.status, <Bdg color={(jSC[sel.status] || {c:"gray"}).c}>{(jSC[sel.status] || {l:sel.status}).l}</Bdg>],
              ["PO", sel.po || "—"],
              [t.pullAssignedTo, users.find((u) => u.id === sel.assignedto || u.id === sel.assignedTo)?.name || "—"],
              [t.pullTrailer, jobTrailers.filter((jt) => jt.job_id === sel.id).map((jt) => vehs.find((v) => v.id === jt.trailer_id)?.name).filter(Boolean).join(", ") || t.pullNoneNeeded],
              [t.pullApproved, fd(sel.approved)],
              [t.completed, fd(sel.completed || sel.completedAt)],
            ].map(([k, v]) => (
              <div key={k} style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: 10 }}>
                <div style={{ fontSize: "var(--text-2xs)", color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <div className="sw-table-scroll">
            <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
              <thead>
                <tr style={{ background: C.lg }}>
                  {[t.colItem, t.colPlanned, t.colPulled, t.colReturned, t.colUsed, ...(perms.inv_pricing_view ? [t.colCost] : [])].map((h) => (
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
          </div>
          {sel.status === "completed" && (
            <div style={{ marginTop: 10, display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
              <Btn v="green" onClick={() => { if (!generatePDF(sel, users, activeLogo, inv, company)) showToast(t.pullPopupBlocked2, "warning"); }}>📄 PDF</Btn>
              <Btn v="sky" onClick={() => setSyncModal(sel)}>{t.pullSyncUpload}</Btn>
            </div>
          )}
        </Modal>
      )}

      {syncModal && (() => {
        // Three states, not two. syncStatus lives in React state only and is wiped by
        // any refresh, so a missing value means "no sync attempted in this session" —
        // NOT "AccuLynx isn't set up". Conflating them told correctly-configured
        // companies to go configure AccuLynx, on every completed job, after every
        // reload. Only claim "not configured" when the config is genuinely absent.
        const axReady = !!(acculynxConfig?.enabled && acculynxConfig?.proxyUrl);
        const syncState = syncStatusOf(syncModal) || (axReady ? "pending" : "manual");
        const filedAt = reportUploadedAtOf(syncModal);
        const fileName = syncModal.report_file_name;
        return (
        <Modal title={`${t.pullAccuLynxUploadTitle} - ${syncModal.po || t.pullNoPoHash}`} onClose={() => setSyncModal(null)}>
          <div style={{ marginBottom: 14 }}>
            {syncState === "synced" && (
              <div style={{ background: C.gB, border: `1.5px solid ${C.gr}`, borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.gr, marginBottom: 4 }}>{t.pullReportFiledTitle}</div>
                <div style={{ fontSize: "var(--text-sm)", color: C.sub }}>{syncNoteOf(syncModal)}</div>
                {(filedAt || syncedAtOf(syncModal)) && (
                  <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 4 }}>
                    {t.pullReportFiledAt}: {ft(filedAt || syncedAtOf(syncModal))}{fileName ? ` · ${fileName}` : ""}
                  </div>
                )}
              </div>
            )}
            {syncState === "failed" && (
              <div style={{ background: C.rB, border: `1.5px solid ${C.rd}`, borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.rd, marginBottom: 4 }}>{t.pullUploadFailed}</div>
                <div style={{ fontSize: "var(--text-sm)", color: C.sub }}>{syncNoteOf(syncModal)}</div>
              </div>
            )}
            {syncState === "manual" && (
              <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.am, marginBottom: 4 }}>{t.pullUploadNotConfig}</div>
                <div style={{ fontSize: "var(--text-sm)", color: C.navy }}>{t.pullConfigureAccuLynx}</div>
              </div>
            )}
            {syncState === "pending" && (
              <div style={{ background: "var(--c-shell)", border: `1.5px solid ${C.lg}`, borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.sub, marginBottom: 4 }}>{t.pullReportNotFiled}</div>
                <div style={{ fontSize: "var(--text-sm)", color: C.navy }}>{t.pullReportNotFiledDesc}</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            {/* "pending" gets the button too: an unsent job is exactly the case where
                you want to push it, and before this the modal offered nothing but
                Close. A job already filed does NOT, because AccuLynx has no
                replace-document call — a second press files a second copy. */}
            {(syncState === "failed" || syncState === "manual" || syncState === "pending") && (
              <Btn v="sky" onClick={() => {
                syncJobReportToAccuLynx({
                  job: syncModal, users, config: acculynxConfig, setJobs, activeLogo, inv, company,
                }).then((r) => {
                  if (r.ok) showToast(t.pullReportUploaded, "success");
                  else if (!r.skipped) showToast(`${t.pullReportUploadFail} ${r.error}`, "warning");
                });
                setSyncModal(null);
              }} style={{ flex: 1, justifyContent: "center" }}>{syncState === "pending" ? t.pullUploadNow : t.pullRetryUpload}</Btn>
            )}
            <Btn v="ghost" onClick={() => setSyncModal(null)} style={{ flex: 1, justifyContent: "center" }}>{t.close}</Btn>
          </div>
        </Modal>
        );
      })()}
    </div>
  );
}