// src/views/BuildJobsView.jsx
import { useState, useMemo, useEffect } from "react";
import { C, uid, fd, fm, tot, mkJI } from "../utils/helpers";
import { Btn, Bdg, Fld, Inp, Sel, TA, Modal, LoadingState } from "../components/UIPrimitives";
import { sendEmail, escapeHtml as esc } from "../utils/email";
import { supabase, getAccessToken } from "../utils/supabase";
import { useNotify } from "../context/NotificationContext";
import CrewCalendar from "../components/CrewCalendar";
import { generatePDF } from "../utils/pdfGenerator";
import { logAction } from "../utils/logger";

export default function BuildJobs({
  jobs = [],
  setJobs,
  inv = [],
  vehs = [],
  jobTrailers = [],
  setJobTrailers,
  users = [],
  user,
  curUser,
  perms,
  jSC,
  onNav,
  acculynxConfig,
  openItemId,
  onOpenItemHandled,
}) {
  const { showToast } = useNotify();
  const activeUser = user || curUser || { id: "system", email: "unknown@mrr.com" };
  const [subView, setSubView] = useState("list");
  // Bookkeeper-only users (jobs_close without jobs_build) land straight on the
  // completed/awaiting-close queue instead of the full pipeline.
  const [filt, setFilt] = useState(!perms.jobs_build && perms.jobs_close ? "completed" : "all");
  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  const [wStep, setWStep] = useState(1);
  const [wPO, setWPO] = useState({
    po: "",
    name: "",
    addr: "",
    notes: "",
    scheduledDate: "",
    acculynxJobId: null, // Tracked target unique reference
  });
  const [wItems, setWItems] = useState([]);
  const [wAssign, setWAssign] = useState("");
  const [wTrailers, setWTrailers] = useState([]);
  const [iSrch, setISrch] = useState("");
  const [axQ, setAxQ] = useState("");
  const [axR, setAxR] = useState([]);
  const [axL, setAxL] = useState(false);
  const [apAssign, setApAssign] = useState("");
  const [srch, setSrch] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  // ── ✏️ EDIT JOB STATE ──────────────────────────────────────────────────────
  const [editForm, setEditForm] = useState({});
  const [editItems, setEditItems] = useState([]);
  const [editItemSearch, setEditItemSearch] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // ── 🆕 ACCULYNX ESTIMATE TRACKING STATE ───────────────────────────────────
  const [axEstimateItems, setAxEstimateItems] = useState([]);
  const [loadingEstimate, setLoadingEstimate] = useState(false);

  const fieldUsers = users.filter(
    (u) => (u.role === "field" || u.role === "Site Supervisor") && u.active,
  );

  // Deep-link from OmniSearch: open the matching job card on arrival
  useEffect(() => {
    if (!openItemId) return;
    const target = jobs.find((j) => String(j.id) === String(openItemId));
    if (target) {
      setSubView("list");
      setSel(target);
      setModal("detail");
    }
    onOpenItemHandled?.();
  }, [openItemId]);

  const counts = {
    all: jobs.length,
    draft: 0,
    approved: 0,
    active: 0,
    completed: 0,
    closed: 0,
  };
  jobs.forEach((j) => {
    if (counts[j.status] !== undefined) counts[j.status]++;
  });

  const shown = useMemo(() => {
    const q = srch.toLowerCase().trim();
    const sorters = {
      newest: (a, b) => new Date(b.created || b.createdAt || 0) - new Date(a.created || a.createdAt || 0),
      oldest: (a, b) => new Date(a.created || a.createdAt || 0) - new Date(b.created || b.createdAt || 0),
      name_az: (a, b) => (a.title || a.name || "").localeCompare(b.title || b.name || "", undefined, { numeric: true }),
      name_za: (a, b) => (b.title || b.name || "").localeCompare(a.title || a.name || "", undefined, { numeric: true }),
      po: (a, b) => String(a.po || "").localeCompare(String(b.po || ""), undefined, { numeric: true }),
      status: (a, b) => (a.status || "").localeCompare(b.status || ""),
    };
    return jobs
      .filter(
        (j) =>
          (filt === "all" || j.status === filt) &&
          (q === "" ||
            (j.po || "").toLowerCase().includes(q) ||
            (j.title || j.name || "").toLowerCase().includes(q) ||
            (j.addr || "").toLowerCase().includes(q)),
      )
      .sort(sorters[sortBy] || sorters.newest);
  }, [jobs, filt, srch, sortBy]);

  const resetWiz = () => {
    setWStep(1);
    setWPO({ po: "", name: "", addr: "", notes: "", scheduledDate: "", acculynxJobId: null });
    setWItems([]);
    setWAssign("");
    setWTrailers([]);
    setISrch("");
    setAxQ("");
    setAxR([]);
    setAxEstimateItems([]);
  };

  const searchAX = async () => {
    if (!axQ.trim()) return;
    if (
      !acculynxConfig ||
      !acculynxConfig.enabled ||
      !acculynxConfig.proxyUrl
    ) {
      showToast(
        "AccuLynx integration is disabled or proxy endpoint URL is unconfigured in Settings.",
        "warning",
      );
      return;
    }
    setAxL(true);
    try {
      const accessToken = await getAccessToken();
      const response = await fetch(acculynxConfig.proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", query: axQ.trim(), accessToken }),
      });
      if (!response.ok)
        throw new Error(
          `Server returned HTTP Error Status: ${response.status}`,
        );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Search failed");
      const results = Array.isArray(data.jobs) ? data.jobs : [];
      setAxR(results);
      if (results.length === 0) {
        const debugHint = data._debug ? ` (API keys: ${data._debug.map(d => d.keys.join(",")).join(" | ")})` : "";
        showToast(`No AccuLynx jobs found for "${axQ.trim()}".${debugHint}`, "warning");
        if (data._debug) console.warn("AccuLynx search debug:", data._debug);
      } else {
        showToast(`Found ${results.length} job${results.length !== 1 ? "s" : ""} in AccuLynx.`, "success");
      }
    } catch (err) {
      console.error("AccuLynx Live Proxy Query Failure:", err);
      showToast(
        `Integration Error: Failed fetching AccuLynx data records. ${err.message}`,
        "error",
      );
      setAxR([]);
    } finally {
      setAxL(false);
    }
  };

  // ── 🆕 FETCH ESTIMATE DATA FROM THE INTEGRATED PROXY GATEWAY ──────────────
  const fetchJobEstimateChecklist = async (targetId) => {
    if (!targetId) return;
    setLoadingEstimate(true);
    try {
      const accessToken = await getAccessToken();
      const response = await fetch(acculynxConfig.proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getJob", acculynxJobId: targetId, accessToken }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      
      // Look up items safely off the normalized job schema or raw contract payload records
      const items = data?.job?._raw?.estimateItems || data?.job?.estimateItems || [];
      setAxEstimateItems(Array.isArray(items) ? items : []);
    } catch (err) {
      console.warn("Failed fetching structural job blueprint lines:", err);
      setAxEstimateItems([]);
    } finally {
      setLoadingEstimate(false);
    }
  };

  const addWItem = (item) => {
    if (wItems.find((i) => i.iid === item.id)) return;
    setWItems((p) => [
      ...p,
      {
        iid: item.id,
        iname: item.name,
        icat: item.cat,
        unit: item.unit,
        qty: 1,
        avail: tot(item),
      },
    ]);
  };

  const saveJob = async (asDraft) => {
    if (!wPO.po || !wPO.name || wItems.length === 0) {
      showToast(
        "Please complete all steps and select project materials first.",
        "warning",
      );
      return;
    }
    if (!wPO.notes || !wPO.notes.trim()) {
      showToast("Please add a job description/notes before saving.", "warning");
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    const targetJobId = uid();
    const job = {
      id: targetJobId,
      po: wPO.po,
      title: wPO.name,       
      addr: wPO.addr,
      notes: wPO.notes,
      scheduledDate: wPO.scheduledDate || new Date().toISOString().split("T")[0],
      status: asDraft ? "draft" : "approved",
      assignedto: wAssign,   
      created: now,          
      approved: asDraft ? "" : now, 
      completed: "",         
      newforassigned: !asDraft && !!wAssign, 
      syncStatus: null,
      syncedAt: "",
      syncPayload: null,
      syncNote: "",
      materials: wItems.map((i) => mkJI(i.iid, i.iname, i.icat, i.unit, i.qty)),
      acculynx_job_id: wPO.acculynxJobId || null,
    };

    try {
      const { error } = await supabase.from("jobs").insert([job]);
      if (error) throw error;
      setJobs((p) => [...p, job]);

      if (wTrailers.length > 0) {
        const trailerRows = wTrailers.map((tid) => ({ id: uid(), job_id: targetJobId, trailer_id: tid }));
        try {
          const { error: jtError } = await supabase.from("job_trailers").insert(trailerRows);
          if (jtError) throw jtError;
          setJobTrailers?.((p) => [...p, ...trailerRows]);
        } catch (jtErr) {
          console.error("Failed to book trailers for job:", jtErr);
          showToast(`Job saved, but trailer booking failed: ${jtErr.message}`, "warning");
        }
      }

      await logAction(
        activeUser.id,
        activeUser.email,
        asDraft ? "JOB_BUILD_DRAFT" : "JOB_BUILD_CREATE",
        `${asDraft ? "Drafted" : "Created & Approved"} a new roofing job build contract for: "${wPO.name}" (PO: ${wPO.po})`,
        { job_id: targetJobId, po_number: wPO.po, material_count: wItems.length, assigned_supervisor_id: wAssign || "unassigned" },
        "production"
      );

      if (!asDraft && wAssign) {
        const assignedUser = users.find((u) => u.id === wAssign);
        if (assignedUser?.email) {
          const trailerNames = wTrailers.map((tid) => vehs.find((v) => v.id === tid)?.name).filter(Boolean);
          sendEmail({
            to: assignedUser.email,
            subject: `New Job Assigned: ${wPO.name}`,
            html: `<h2>You've been assigned a new job</h2>
                <p><strong>Job:</strong> ${esc(wPO.name)}</p>
                <p><strong>PO:</strong> ${esc(wPO.po)}</p>
                <p><strong>Address:</strong> ${esc(wPO.addr)}</p>
                ${wPO.notes ? `<p><strong>Notes:</strong> ${esc(wPO.notes)}</p>` : ""}
                ${trailerNames.length > 0 ? `<p><strong>🚚 Trailer(s) to bring:</strong> ${trailerNames.map(esc).join(", ")}</p>` : ""}
                <p>Log in to pull inventory and get started.</p>`,
          });
        }
      }
      showToast(
        asDraft
          ? "Job draft saved successfully."
          : "Job approved and supervisor notified.",
        "success",
      );
      setModal(null);
      resetWiz();
    } catch (err) {
      console.error("Failed to save job:", err);
      showToast(`Database Error: Could not save job. ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const doApprove = async () => {
    if (!apAssign) {
      showToast("Please assign a site supervisor before approval.", "warning");
      return;
    }
    setApproving(true);
    const approvedAtTime = new Date().toISOString();
    try {
      const { error } = await supabase
        .from("jobs")
        .update({
          status: "approved",
          approved: approvedAtTime,
          assignedto: apAssign,
          newforassigned: true,
        })
        .eq("id", sel.id);
      if (error) throw error;

      await logAction(
        activeUser.id,
        activeUser.email,
        "JOB_BUILD_CREATE",
        `Approved and deployed production job draft "${sel.name || sel.title}" (PO: ${sel.po}) to active field pipeline.`,
        { job_id: sel.id, assigned_supervisor_id: apAssign, timestamp: approvedAtTime },
        "production"
      );

      setJobs((p) =>
        p.map((j) =>
          j.id === sel.id
            ? {
              ...j,
              status: "approved",
              approved: approvedAtTime,
              assignedto: apAssign,
              newforassigned: true,
            }
            : j,
        ),
      );

      const assignedUser = users.find((u) => u.id === apAssign);
      if (assignedUser?.email) {
        const trailerNames = jobTrailers
          .filter((jt) => jt.job_id === sel.id)
          .map((jt) => vehs.find((v) => v.id === jt.trailer_id)?.name)
          .filter(Boolean);
        sendEmail({
          to: assignedUser.email,
          subject: `Job Approved & Assigned: ${sel.name || sel.title}`,
          html: `<h2>A job has been approved and assigned to you</h2>
                 <p><strong>Job:</strong> ${esc(sel.name || sel.title)}</p>
                 <p><strong>PO:</strong> ${esc(sel.po)}</p>
                 <p><strong>Address:</strong> ${esc(sel.addr || "N/A")}</p>
                 ${trailerNames.length > 0 ? `<p><strong>🚚 Trailer(s) to bring:</strong> ${trailerNames.map(esc).join(", ")}</p>` : ""}
                 <p>Log in to pull inventory and get started.</p>`,
        });
      }

      showToast("Project successfully approved and assigned.", "success");
      setSel(null);
      setModal(null);
      setApAssign("");
    } catch (err) {
      console.error("Failed to approve job:", err);
      showToast(
        `Database Error: Could not approve job. ${err.message}`,
        "error",
      );
    } finally {
      setApproving(false);
    }
  };

  const deleteJob = async (jobId) => {
    const targetJob = jobs.find((j) => j.id === jobId);
    const targetLabel = targetJob ? (targetJob.name || targetJob.title) : `ID: ${jobId}`;

    try {
      const { error } = await supabase.from("jobs").delete().eq("id", jobId);
      if (error) throw error;

      await logAction(
        activeUser.id,
        activeUser.email,
        "JOB_BUILD_DELETE",
        `Permanently purged job contract "${targetLabel}" (PO: ${targetJob?.po || "—"}) from system registry.`,
        { deleted_job_id: jobId, archive_backup: targetJob || {} },
        "production"
      );

      setJobs((p) => p.filter((j) => j.id !== jobId));
      setJobTrailers?.((p) => p.filter((jt) => jt.job_id !== jobId));
      if (sel?.id === jobId) setSel(null);
      showToast("Job track purged successfully.", "success");
    } catch (err) {
      console.error("Failed to delete job:", err);
      showToast(
        `Database Error: Could not delete job record. ${err.message}`,
        "error",
      );
    }
  };

  const toggleJobTrailer = async (jobId, trailerId) => {
    if (typeof setJobTrailers !== "function") return;
    const job = jobs.find((j) => j.id === jobId);
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
        await logAction(activeUser.id, activeUser.email, "JOB_BUILD_EDIT", `Removed trailer "${trailerName}" from job "${job?.title || job?.name}"`, { job_id: jobId, trailer_id: trailerId }, "production");
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
        await logAction(activeUser.id, activeUser.email, "JOB_BUILD_EDIT", `Assigned trailer "${trailerName}" to job "${job?.title || job?.name}"`, { job_id: jobId, trailer_id: trailerId }, "production");
        await notifySupervisorOfTrailerChange("added");
      } catch (err) {
        console.error("Failed to assign trailer to job:", err);
        showToast(`Failed to assign trailer: ${err.message}`, "error");
        setJobTrailers((p) => p.filter((jt) => jt.id !== newRow.id));
      }
    }
  };

  const closeJob = async (job = sel) => {
    if (!job) return;
    const closedAt = new Date().toISOString();
    try {
      const { error } = await supabase
        .from("jobs")
        .update({ status: "closed", closedAt })
        .eq("id", job.id);
      if (error) throw error;

      await logAction(
        activeUser.id,
        activeUser.email,
        "JOB_BUILD_CLOSE",
        `Archived and locked completed job contract file for: "${job.name || job.title}" (PO: ${job.po})`,
        { job_id: job.id, archived_timestamp: closedAt },
        "production"
      );

      const updated = { ...job, status: "closed", closedAt };
      setJobs((p) => p.map((j) => (j.id === job.id ? updated : j)));
      setSel((p) => (p && p.id === job.id ? updated : p));
      showToast("Project closed and archived from pipeline.", "success");
    } catch (err) {
      console.error("Failed to close job:", err);
      showToast(`Database Error: Could not close job. ${err.message}`, "error");
    }
  };

  const reopenJob = async (job = sel) => {
    if (!job) return;
    try {
      const { error } = await supabase
        .from("jobs")
        .update({ status: "completed", closedAt: "" })
        .eq("id", job.id);
      if (error) throw error;

      await logAction(
        activeUser.id,
        activeUser.email,
        "JOB_BUILD_REOPEN",
        `Reopened archived job file back to active completion view: "${job.name || job.title}" (PO: ${job.po})`,
        { job_id: job.id },
        "production"
      );

      const updated = { ...job, status: "completed", closedAt: "" };
      setJobs((p) => p.map((j) => (j.id === job.id ? updated : j)));
      setSel((p) => (p && p.id === job.id ? updated : p));
      showToast(
        "Job successfully returned to active completed view.",
        "success",
      );
    } catch (err) {
      console.error("Failed to reopen job:", err);
      showToast(
        `Database Error: Could not reopen job. ${err.message}`,
        "error",
      );
    }
  };

  const filtInv = inv.filter((i) =>
    (i?.name || "").toLowerCase().includes(iSrch.toLowerCase()),
  );

  // ── ✏️ EDIT JOB HELPERS ────────────────────────────────────────────────────
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
    if (!editForm.po || !editForm.name) {
      showToast("PO and Job Name are strictly required fields.", "warning");
      return;
    }
    setSavingEdit(true);
    try {
      const payload = {
        po: editForm.po,
        title: editForm.name,
        addr: editForm.addr,
        notes: editForm.notes,
        scheduledDate: editForm.scheduledDate,
        assignedto: editForm.assignedto,
        items: editItems,
        materials: editItems,
      };

      const { error } = await supabase.from("jobs").update(payload).eq("id", sel.id);
      if (error) throw error;

      await logAction(
        activeUser.id,
        activeUser.email,
        "JOB_BUILD_EDIT",
        `Edited job build details for "${editForm.name}" (PO: ${editForm.po})`,
        { job_id: sel.id, material_count: editItems.length },
        "production",
      );

      const updated = { ...sel, ...payload };
      setJobs((p) => p.map((j) => (j.id === sel.id ? updated : j)));
      setSel(updated);
      showToast("Job build updated successfully.", "success");
      setModal("detail");
    } catch (err) {
      console.error("Failed to save job edits:", err);
      showToast(`Database Error: Could not save job edits. ${err.message}`, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div>
      {/* ── 🏗️ CORE APP ACTIONS MENU NAVIGATION ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: "var(--space-4)",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy }}>
            🏗️ Build Jobs
          </h1>
          <p style={{ margin: "2px 0 0", color: C.sub, fontSize: "var(--text-sm)" }}>
            Plan inventory, assign site supervisors, manage the pipeline
          </p>
        </div>

        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <div style={{ display: "flex", background: C.lg, padding: 4, borderRadius: "var(--radius-md)", marginRight: 8 }}>
            <button
              onClick={() => setSubView("list")}
              style={{ padding: "6px 12px", border: "none", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", cursor: "pointer", background: subView === "list" ? C.w : "transparent", color: subView === "list" ? C.navy : C.sub, boxShadow: subView === "list" ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}
            >
              📋 Pipeline List
            </button>
            <button
              onClick={() => setSubView("calendar")}
              style={{ padding: "6px 12px", border: "none", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", cursor: "pointer", background: subView === "calendar" ? C.w : "transparent", color: subView === "calendar" ? C.navy : C.sub, boxShadow: subView === "calendar" ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}
            >
              📅 Shift Timeline
            </button>
          </div>

          {perms.jobs_build && (
            <Btn
              v="primary"
              onClick={() => {
                resetWiz();
                setModal("new");
              }}
            >
              + New Job
            </Btn>
          )}
        </div>
      </div>

      {subView === "calendar" ? (
        <CrewCalendar
          jobs={jobs}
          users={users}
          jSC={jSC}
          setJobs={setJobs}
          onJobClick={(job) => {
            setSel(job);
            setModal("detail");
          }}
        />
      ) : (
        <>
          <div
            style={{
              display: "flex",
              gap: "var(--space-4)",
              marginBottom: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <Inp
              value={srch}
              onChange={(e) => setSrch(e.target.value)}
              placeholder="🔍 Search by PO #, job name, or addresses..."
              style={{ flex: 1, minWidth: 220, maxWidth: 380 }}
            />
            <Sel value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort jobs" style={{ width: "auto" }}>
              <option value="newest">↕ Date Created — Newest</option>
              <option value="oldest">↕ Date Created — Oldest</option>
              <option value="name_az">↕ Job Name — A to Z</option>
              <option value="name_za">↕ Job Name — Z to A</option>
              <option value="po">↕ PO Number</option>
              <option value="status">↕ Status</option>
            </Sel>
            {srch && (
              <Btn v="ghost" sz="sm" onClick={() => setSrch("")}>
                ✕ Clear
              </Btn>
            )}
            {srch && (
              <span style={{ fontSize: "var(--text-sm)", color: C.sub, fontWeight: "var(--weight-semibold)" }}>
                {shown.length} result{shown.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: 14, flexWrap: "wrap" }}>
            {[
              ["all", "All Jobs"],
              ["draft", "Drafts"],
              ["approved", "Approved"],
              ["active", "Active"],
              ["completed", "Completed"],
              ["closed", "Closed"],
            ].map(([k, l]) => (
              <Btn
                key={k}
                v={filt === k ? "primary" : "ghost"}
                sz="sm"
                onClick={() => setFilt(k)}
              >
                {l}
                {counts[k] > 0 && (
                  <span
                    style={{
                      marginLeft: 4,
                      background: filt === k ? "rgba(255,255,255,0.3)" : C.lg,
                      color: filt === k ? C.w : C.sub,
                      borderRadius: 20,
                      fontSize: "var(--text-2xs)",
                      padding: "1px 6px",
                      fontWeight: "var(--weight-extrabold)",
                    }}
                  >
                    {counts[k]}
                  </span>
                )}
              </Btn>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {shown.map((job) => {
              const sup = users.find((u) => u.id === job.assignedto || u.id === job.assignedTo);
              const currentItems = Array.isArray(job.items) ? job.items : (Array.isArray(job.materials) ? job.materials : []);
              const pulledCount = currentItems.filter((i) => i && i.pulled > 0).length;

              const getJobStatusMeta = (status) => {
                switch (status?.toLowerCase()) {
                  case "completed":
                  case "closed":
                    return { dot: "🟢", color: C.gr, label: "Completed" };
                  case "active":
                    return { dot: "🟡", color: C.am, label: "In Progress" };
                  case "approved":
                    return { dot: "🟡", color: C.blue, label: "Approved" };
                  case "draft":
                  default:
                    return { dot: "🔴", color: C.rd, label: "Delayed / Draft" };
                }
              };

              const statusMeta = getJobStatusMeta(job.status);

              return (
                <div
                  key={job.id}
                  className="mrr-card-click"
                  onClick={() => {
                    setSel(job);
                    setModal("detail");
                  }}
                  style={{
                    background: C.w,
                    borderRadius: "var(--radius-xl)",
                    padding: 16,
                    cursor: "pointer",
                    boxShadow: "var(--shadow-sm)",
                    border: `2px solid ${statusMeta.color}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "var(--space-5)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--text-xs)", fontWeight: "var(--weight-extrabold)", color: statusMeta.color }}>
                        <span>{statusMeta.dot}</span>
                        <span style={{ textTransform: "uppercase" }}>{statusMeta.label}</span>
                      </span>
                      <span style={{ fontSize: "var(--text-sm)", color: C.sub, fontWeight: "var(--weight-semibold)" }}>· {job.po}</span>
                      {job.syncStatus === "synced" && <Bdg color="sky">☁️ AccuLynx Synced</Bdg>}
                      {job.syncStatus === "failed" && <Bdg color="red">⚠️ Sync Failed</Bdg>}
                      {job.syncStatus === "manual" && <Bdg color="amber">📋 Sync Pending</Bdg>}
                    </div>
                    <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, fontSize: 15, marginBottom: 2 }}>{job.title || job.name}</div>
                    <div style={{ fontSize: "var(--text-sm)", color: C.sub, marginBottom: 6 }}>{job.addr}</div>
                    <div style={{ display: "flex", gap: "var(--space-6)", fontSize: "var(--text-xs)", color: C.sub, flexWrap: "wrap" }}>
                      <span>📦 {Math.max(currentItems.length, 0)} items</span>
                      {sup ? <span>👤 {sup.name}</span> : <span style={{ color: C.am }}>⚠️ Unassigned</span>}
                      <span>Created {fd(job.created || job.createdAt)}</span>
                    </div>
                  </div>

                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {(job.status === "active" || job.status === "completed") && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginBottom: 3 }}>{pulledCount}/{currentItems.length} pulled</div>
                        <div style={{ height: 5, width: 90, background: C.lg, borderRadius: 3 }}>
                          <div style={{ height: "100%", width: `${currentItems.length > 0 ? (pulledCount / currentItems.length) * 100 : 0}%` }} />
                        </div>
                      </div>
                    )}
                    {perms.jobs_approve && job.status === "draft" && (
                      <Btn
                        v="teal"
                        sz="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSel(job);
                          setApAssign(job.assignedto || job.assignedTo || "");
                          setModal("approve");
                        }}
                      >
                        Approve & Assign →
                      </Btn>
                    )}
                    {job.status === "completed" && (
                      <Btn
                        v="green"
                        sz="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          generatePDF(job, users);
                        }}
                      >
                        📄 PDF
                      </Btn>
                    )}
                    {perms.jobs_close && job.status === "completed" && (
                      <Btn
                        v="purple"
                        sz="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm("Close this job? It will be moved to the Closed list and archived from active work.")) {
                            closeJob(job);
                          }
                        }}
                      >
                        🔒 Close
                      </Btn>
                    )}
                    {perms.jobs_approve && (
                      <Btn
                        v="danger"
                        sz="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm("Permanently delete this job record? This cannot be undone.")) {
                            deleteJob(job.id);
                          }
                        }}
                      >
                        🗑️ Delete
                      </Btn>
                    )}
                  </div>
                </div>
              );
            })}
            {shown.length === 0 && (
              <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 30, textAlign: "center", color: C.sub, fontSize: "var(--text-base)", boxShadow: "var(--shadow-sm)" }}>
                No {filt === "all" ? "" : filt + " "}jobs. {perms.jobs_build && filt === "all" && ' Click "+ New Job" to get started.'}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 📂 MODAL: DETAILS DRAWER VIEW ── */}
      {modal === "detail" && sel && (
        <Modal
          title={`${sel.po} — ${sel.title || sel.name}`}
          onClose={() => {
            setModal(null);
            setSel(null);
          }}
          wide
        >
          <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: 14, flexWrap: "wrap" }}>
            {perms.jobs_build && sel.status !== "closed" && (
              <Btn v="outline" sz="sm" onClick={() => startEditJob(sel)}>
                ✏️ Edit Job
              </Btn>
            )}
            {perms.jobs_approve && sel.status === "draft" && (
              <Btn
                v="teal"
                sz="sm"
                onClick={() => {
                  setApAssign(sel.assignedto || sel.assignedTo || "");
                  setModal("approve");
                }}
              >
                ✅ Approve & Assign
              </Btn>
            )}
            {(sel.status === "completed" || sel.status === "closed") && (
              <Btn v="green" sz="sm" onClick={() => generatePDF(sel, users)}>
                📄 Download PDF Report
              </Btn>
            )}
            {perms.jobs_close && sel.status === "completed" && (
              <Btn
                v="purple"
                sz="sm"
                onClick={() => {
                  if (window.confirm("Close this job? It will be moved to the Closed list and archived from active work.")) {
                    closeJob();
                  }
                }}
              >
                🔒 Close Job
              </Btn>
            )}
            {perms.jobs_close && sel.status === "closed" && (
              <Btn v="ghost" sz="sm" onClick={() => reopenJob()}>
                ↩ Reopen
              </Btn>
            )}
            {perms.jobs_build && sel.status === "draft" && (
              <Btn
                v="danger"
                sz="sm"
                onClick={() => {
                  if (window.confirm("Delete this draft?")) {
                    deleteJob(sel.id);
                    setModal(null);
                  }
                }}
              >
                🗑️ Delete
              </Btn>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: "var(--space-3)", marginBottom: 16 }}>
            {[
              ["Status", <Bdg color={jSC[sel.status]?.c || "gray"}>{jSC[sel.status]?.l || sel.status}</Bdg>],
              ["PO", sel.po],
              ["Assigned To", users.find((u) => u.id === sel.assignedto || u.id === sel.assignedTo)?.name || "Unassigned"],
              ["Created", fd(sel.created || sel.createdAt)],
              ["Approved", fd(sel.approved || sel.approvedAt)],
              ["Completed", fd(sel.completed || sel.completedAt)],
              ["🚚 Trailers", jobTrailers.filter((jt) => jt.job_id === sel.id).map((jt) => vehs.find((v) => v.id === jt.trailer_id)?.name).filter(Boolean).join(", ") || "None assigned"],
            ].map(([k, v]) => (
              <div key={k} style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: 10 }}>
                <div style={{ fontSize: "var(--text-2xs)", color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          {perms.jobs_build && vehs.some((v) => v.type === "trailer") && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "var(--text-2xs)", color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase", marginBottom: 6 }}>🚚 Assign Trailers</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                {vehs.filter((v) => v.type === "trailer").map((v) => {
                  const checked = jobTrailers.some((jt) => jt.job_id === sel.id && jt.trailer_id === v.id);
                  return (
                    <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 5, background: checked ? C.tB : C.lg, border: `1px solid ${checked ? C.tl : C.bd}`, borderRadius: "var(--radius-pill)", padding: "5px 12px", fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color: checked ? C.tl : C.navy, cursor: "pointer" }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleJobTrailer(sel.id, v.id)} style={{ margin: 0 }} />
                      {v.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {["Item", "Category", "Planned", "Pulled", "Used", ...(perms.inv_pricing_view ? ["Cost"] : [])].map((h) => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {((sel.items || sel.materials || [])).map((item) => {
                if (!item) return null;
                // Cost reflects what was actually used (pulled minus returned),
                // not the raw pull cost — fully-returned items must read $0.00.
                const used = Math.max((item.pulled || 0) - (item.returned || 0), 0);
                const usedCost = used * (parseFloat(item.priceAtPull) || 0);
                return (
                  <tr key={item.iid || item.id || Math.random()} style={{ borderTop: `1px solid ${C.lg}` }}>
                    <td style={{ padding: "8px 10px", fontWeight: "var(--weight-bold)", color: C.navy }}>{item.iname || item.name || "—"}</td>
                    <td style={{ padding: "8px 10px", color: C.sub }}>{item.icat || item.cat || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{item.planned || item.qty || 0} {item.unit || ""}</td>
                    <td style={{ padding: "8px 10px", color: item.pulled > 0 ? C.gr : C.sub }}>{item.pulled || 0}</td>
                    <td style={{ padding: "8px 10px", fontWeight: "var(--weight-bold)" }}>{used}</td>
                    {perms.inv_pricing_view && (
                      <td style={{ padding: "8px 10px", fontWeight: "var(--weight-bold)", color: C.blue }}>{(item.pulled || 0) > 0 ? fm(usedCost) : "—"}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Modal>
      )}

      {/* ── 📂 MODAL: EDIT JOB BUILD ── */}
      {modal === "edit" && sel && (
        <Modal
          title={`Edit Job — ${sel.po}`}
          onClose={() => { if (!savingEdit) setModal("detail"); }}
          wide
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
            <Fld label="Job PO Number *">
              <Inp value={editForm.po || ""} onChange={(e) => setEditForm({ ...editForm, po: e.target.value })} disabled={savingEdit} />
            </Fld>
            <Fld label="Job Name *">
              <Inp value={editForm.name || ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} disabled={savingEdit} />
            </Fld>
          </div>
          <Fld label="Job Address">
            <Inp value={editForm.addr || ""} onChange={(e) => setEditForm({ ...editForm, addr: e.target.value })} disabled={savingEdit} />
          </Fld>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
            <Fld label="Production Schedule Start Date">
              <Inp type="date" aria-label="Production Schedule Start Date" value={editForm.scheduledDate || ""} onChange={(e) => setEditForm({ ...editForm, scheduledDate: e.target.value })} disabled={savingEdit} />
            </Fld>
            <Fld label="Assigned Site Supervisor">
              <Sel value={editForm.assignedto || ""} onChange={(e) => setEditForm({ ...editForm, assignedto: e.target.value })} disabled={savingEdit}>
                <option value="">— Unassigned —</option>
                {fieldUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Sel>
            </Fld>
          </div>
          <Fld label="Notes">
            <TA value={editForm.notes || ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} disabled={savingEdit} />
          </Fld>

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

          <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 14 }}>
            <Btn v="ghost" onClick={() => setModal("detail")} style={{ flex: 1, justifyContent: "center" }} disabled={savingEdit}>Cancel</Btn>
            <Btn v="primary" onClick={saveJobEdit} style={{ flex: 1, justifyContent: "center" }} disabled={savingEdit}>
              {savingEdit ? "⏳ Saving..." : "💾 Save Changes"}
            </Btn>
          </div>
        </Modal>
      )}

      {/* ── 📂 MODAL: SUPERVISOR APPROVAL POPUP ── */}
      {modal === "approve" && sel && (
        <Modal title={`Approve: ${sel.title || sel.name}`} onClose={() => setModal(null)}>
          <div style={{ background: C.tB, border: `1.5px solid ${C.tl}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.tl, fontWeight: "var(--weight-semibold)" }}>
            Approving will notify the assigned Site Supervisor.
          </div>
          <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)" }}>
            <strong style={{ color: C.navy }}>{sel.po} — {sel.title || sel.name}</strong>
            <div style={{ color: C.sub, marginTop: 2 }}>{Math.max((sel.items || sel.materials || []).length, 0)} items planned</div>
          </div>
          <Fld label="Assign to Site Supervisor *">
            <Sel value={apAssign} onChange={(e) => setApAssign(e.target.value)} disabled={approving}>
              <option value="">— Select Site Supervisor —</option>
              {fieldUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Sel>
          </Fld>
          <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 8 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: "center" }} disabled={approving}>Cancel</Btn>
            <Btn v="teal" onClick={doApprove} style={{ flex: 1, justifyContent: "center" }} disabled={approving}>
              {approving ? "⏳ Approving..." : "✅ Approve & Notify"}
            </Btn>
          </div>
        </Modal>
      )}

      {/* ── 📂 MODAL: NEW CREATION MULTI-STEP WIZARD ── */}
      {modal === "new" && (
        <Modal
          title={`New Job — Step ${wStep} of 3`}
          onClose={() => {
            if (!saving) {
              setModal(null);
              resetWiz();
            }
          }}
          wide
        >
          <div style={{ display: "flex", gap: 0, marginBottom: 18, background: C.lg, borderRadius: "var(--radius-md)", overflow: "hidden" }}>
            {["1. Find Job", "2. Add Inventory", "3. Assign & Save"].map((s, i) => (
              <div
                key={s}
                style={{
                  flex: 1,
                  padding: "9px 6px",
                  textAlign: "center",
                  fontSize: "var(--text-xs)",
                  fontWeight: "var(--weight-bold)",
                  background: wStep === i + 1 ? C.blue : wStep > i + 1 ? C.gB : "transparent",
                  color: wStep === i + 1 ? C.w : wStep > i + 1 ? C.gr : C.sub,
                }}
              >
                {wStep > i + 1 ? "✓ " : ""}{s}
              </div>
            ))}
          </div>

          {wStep === 1 && (
            <div>
              <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: 10 }}>
                <Inp value={axQ} onChange={(e) => setAxQ(e.target.value)} placeholder="Search AccuLynx job name or PO..." onKeyDown={(e) => e.key === "Enter" && !axL && searchAX()} style={{ flex: 1 }} disabled={axL} />
                <Btn v="primary" onClick={searchAX} disabled={axL}>{axL ? "Searching..." : "🔍 Search"}</Btn>
              </div>
              {axR.length > 0 && (
                <div style={{ border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", overflow: "hidden", marginBottom: 14 }}>
                  {axR.map((j) => (
                    <div
                      key={j.po}
                      onClick={() => {
                        setWPO({ po: j.po, name: j.name, addr: j.addr, notes: "", scheduledDate: "", acculynxJobId: j.acculynxJobId });
                        setAxR([]);
                        // Trigger async checklist query when selecting job profile
                        fetchJobEstimateChecklist(j.acculynxJobId);
                      }}
                      style={{ padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${C.lg}`, background: C.w }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.lg)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = C.w)}
                    >
                      <div style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{j.name}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: C.sub }}>{j.po} · {j.addr}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ borderTop: `1px solid ${C.lg}`, paddingTop: 14 }}>
                <Fld label="Job PO Number *"><Inp value={wPO.po} onChange={(e) => setWPO({ ...wPO, po: e.target.value })} placeholder="PO-2025-XXX" /></Fld>
                <Fld label="Job Name *"><Inp value={wPO.name} onChange={(e) => setWPO({ ...wPO, name: e.target.value })} placeholder="Customer / Project Name" /></Fld>
                <Fld label="Job Address *"><Inp value={wPO.addr} onChange={(e) => setWPO({ ...wPO, addr: e.target.value })} placeholder="123 Main St, Toledo OH" /></Fld>
                <Fld label="Production Schedule Start Date">
                  <Inp type="date" aria-label="Production Schedule Start Date" value={wPO.scheduledDate || ""} onChange={(e) => setWPO({ ...wPO, scheduledDate: e.target.value })} />
                </Fld>
              </div>
              <Btn v="primary" sz="lg" onClick={() => { if (!wPO.po || !wPO.name) { showToast("PO and Job Name are strictly required fields.", "warning"); return; } setWStep(2); }} style={{ width: "100%", justifyContent: "center", marginTop: 10 }}>Continue →</Btn>
            </div>
          )}

          {wStep === 2 && (
            <div>
              <div style={{ background: C.gL, border: `1.5px solid ${C.gold}`, borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: 12, fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy }}>
                📋 {wPO.po} — {wPO.name}
              </div>
              
              {/* ── 🆕 OPTION 2: MULTI-COLUMN INTERACTIVE SIDE PANEL LAYOUT ── */}
              <div style={{ display: "flex", gap: "var(--space-7)", flexWrap: "wrap" }}>
                
                {/* Column A: AccuLynx Contract Blueprint Guidelines Checklist */}
                <div style={{ flex: 1.2, minWidth: 200, background: C.bg || "#f8fafc", border: `1px solid ${C.bd}`, borderRadius: "var(--radius-lg)", padding: 12, maxHeight: 380, overflowY: "auto" }}>
                  <h4 style={{ margin: "0 0 8px 0", color: C.navy, fontSize: "var(--text-base)", display: "flex", alignItems: "center", gap: 5 }}>
                    📝 AccuLynx Order Roadmap
                  </h4>
                  <p style={{ margin: "0 0 10px 0", fontSize: "var(--text-xs)", color: C.sub }}>
                    Click items below to search your warehouse inventory for a matching component.
                  </p>
                  
                  {loadingEstimate ? (
                    <LoadingState label="Pulling estimate manifest..." compact />
                  ) : axEstimateItems.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                      {axEstimateItems.map((item, idx) => (
                        <div 
                          key={idx}
                          onClick={() => setISrch(item.name || "")}
                          style={{
                            background: C.w,
                            padding: "8px 10px",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                            border: `1px solid ${C.lg}`,
                            fontSize: "var(--text-xs)",
                            transition: "all 0.15s ease"
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.borderColor = C.blue}
                          onMouseLeave={(e) => e.currentTarget.style.borderColor = C.lg}
                        >
                          <div style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{item.name}</div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, color: C.sub, fontSize: "var(--text-2xs)" }}>
                            <span>Qty: {item.quantity} {item.estimateUnit || "pcs"}</span>
                            {item.type && <Bdg color="gray">{item.type}</Bdg>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: "var(--text-xs)", color: C.sub, fontStyle: "italic", textAlign: "center", padding: "30px 0" }}>
                      No estimate item data mapped onto this project or contract profile.
                    </div>
                  )}
                </div>

                {/* Column B: Real WMS System Catalog Query Feed */}
                <div style={{ flex: 2, minWidth: 240 }}>
                  <Inp value={iSrch} onChange={(e) => setISrch(e.target.value)} placeholder="🔍 Search inventory..." style={{ marginBottom: 8 }} />
                  <div style={{ maxHeight: 330, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                    {(filtInv || []).map((item) => {
                      if (!item) return null;
                      const added = (wItems || []).find((i) => i && i.iid === item.id);

                      return (
                        <div key={item.id} style={{ background: C.w, borderRadius: "var(--radius-md)", padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", border: `1.5px solid ${added ? C.blue : "transparent"}`, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                          <div>
                            <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>{item.name}</div>
                            <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>{tot(item)} {item.unit} available</div>
                          </div>
                          {added ? <Bdg color="blue">Added ✓</Bdg> : <Btn v="primary" sz="sm" onClick={() => addWItem(item)}>+ Add</Btn>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Column C: Current Jobs Staged Checklist Draft */}
                <div style={{ flex: 1.5, minWidth: 190 }}>
                  <div style={{ background: C.w, borderRadius: "var(--radius-lg)", padding: 12, boxShadow: "var(--shadow-sm)", position: "sticky", top: 0 }}>
                    <h4 style={{ margin: "0 0 10px", color: C.navy, fontSize: "var(--text-base)" }}>📦 Job List ({wItems.length})</h4>
                    {wItems.length === 0 ? (
                      <p style={{ color: C.sub, fontSize: "var(--text-sm)", margin: 0 }}>Add items from the list</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                        {wItems.map((i) => (
                          <div key={i.iid} style={{ background: C.lg, borderRadius: 7, padding: "7px 9px" }}>
                            <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-xs)", marginBottom: 4 }}>{i.iname}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <Inp type="number" value={i.qty} min="1" max={i.avail} onChange={(e) => setWItems((p) => p.map((x) => x.iid === i.iid ? { ...x, qty: Math.max(1, parseInt(e.target.value) || 1) } : x))} style={{ width: 55, padding: "3px 6px" }} />
                              <span style={{ fontSize: "var(--text-2xs)", color: C.sub }}>{i.unit}</span>
                              <button onClick={() => setWItems((p) => p.filter((x) => x.iid !== i.iid))} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.rd, fontSize: "var(--text-lg)", lineHeight: 1 }}>×</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              </div>
              <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 14 }}>
                <Btn v="ghost" onClick={() => setWStep(1)} style={{ flex: 1, justifyContent: "center" }}>← Back</Btn>
                <Btn v="primary" onClick={() => { if (wItems.length === 0) { showToast("Add at least one workflow material item to build a job checklist.", "warning"); return; } setWStep(3); }} style={{ flex: 1, justifyContent: "center" }}>Continue →</Btn>
              </div>
            </div>
          )}

          {wStep === 3 && (
            <div>
              <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14 }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{wPO.po} — {wPO.name}</div>
                <div style={{ fontSize: "var(--text-sm)", color: C.sub }}>{wItems.length} items planned</div>
              </div>
              <Fld label="Job Notes / Description *" hint="Required — describe the scope of work for the crew.">
                <TA
                  value={wPO.notes}
                  onChange={(e) => setWPO({ ...wPO, notes: e.target.value })}
                  placeholder="e.g., Full tear-off and reroof, 30sq, GAF Timberline HDZ shingles..."
                  disabled={saving}
                />
              </Fld>
              <Fld label="Assign to Site Supervisor" hint="Leave blank to save as draft and assign later.">
                <Sel value={wAssign} onChange={(e) => setWAssign(e.target.value)} disabled={saving}>
                  <option value="">— Assign later (save as draft) —</option>
                  {fieldUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </Sel>
              </Fld>
              <div style={{ background: wAssign ? C.tB : C.aB, border: `1px solid ${wAssign ? C.tl : C.am}`, borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: 14, fontSize: "var(--text-sm)", color: wAssign ? C.tl : C.am, fontWeight: "var(--weight-semibold)" }}>
                {wAssign ? `✅ ${users.find((u) => u.id === wAssign)?.name} will be notified when you approve.` : "⚠️ No supervisor assigned — will save as draft."}
              </div>
              {vehs.some((v) => v.type === "trailer") && (
                <Fld label="Trailers Needed" hint="Select any trailers this job needs — the site supervisor will see this list.">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                    {vehs.filter((v) => v.type === "trailer").map((v) => {
                      const checked = wTrailers.includes(v.id);
                      return (
                        <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 5, background: checked ? C.tB : C.lg, border: `1px solid ${checked ? C.tl : C.bd}`, borderRadius: "var(--radius-pill)", padding: "5px 12px", fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color: checked ? C.tl : C.navy, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setWTrailers((p) => (p.includes(v.id) ? p.filter((id) => id !== v.id) : [...p, v.id]))}
                            style={{ margin: 0 }}
                          />
                          {v.name}
                        </label>
                      );
                    })}
                  </div>
                </Fld>
              )}
              <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 8 }}>
                <Btn v="ghost" onClick={() => setWStep(2)} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>← Back</Btn>
                <Btn v="ghost" onClick={() => saveJob(true)} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>{saving ? "⏳ Caching..." : "💾 Save Draft"}</Btn>
                <Btn v="teal" onClick={() => saveJob(false)} style={{ flex: 1, justifyContent: "center" }} disabled={saving}>{saving ? "⏳ Submitting..." : "✅ Approve & Notify"}</Btn>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}