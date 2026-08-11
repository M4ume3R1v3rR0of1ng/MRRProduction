// src/views/BuildJobsView.jsx
import { useState, useMemo, useEffect } from "react";
import { C, uid, fd, fm, tot, mkJI, newestPrice, todayLocal } from "../utils/helpers";
import { translations } from "../utils/translations";
import { Btn, Bdg, Fld, Inp, Sel, TA, Modal } from "../components/UIPrimitives";
import { sendEmail, escapeHtml as esc } from "../utils/email";
import { shouldNotifyJobMove, notifyJobMove } from "../utils/jobNotifications";
import { supabase, getAccessToken, updateRowStrict } from "../utils/supabase";
import { useNotify } from "../context/NotificationContext";
import CrewCalendar from "../components/CrewCalendar";
import { openJobReport } from "../utils/jobReport";
import { syncStatusOf, reportUploadedAtOf } from "../utils/accuLynxSync";
import { logAction } from "../utils/logger";

import { fetchJobTemplates, resolveDefaultTemplates } from "../utils/jobTemplates";
import EditJobModal from "./jobs/EditJobModal";

export default function BuildJobs({
  jobs = [],
  company = null,
  jobNotifications = {},
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
  lang = "en",
  openItemId,
  onOpenItemHandled,
  activeLogo,
}) {
  const { showToast } = useNotify();
  const t = translations[lang] || translations.en;
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
    contractValue: "",
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
    setWPO({ po: "", name: "", addr: "", notes: "", scheduledDate: "", contractValue: "", acculynxJobId: null });
    setWItems([]);
    setWAssign("");
    setWTrailers([]);
    setISrch("");
    setAxQ("");
    setAxR([]);
  };

  const searchAX = async () => {
    if (!axQ.trim()) return;
    if (
      !acculynxConfig ||
      !acculynxConfig.enabled ||
      !acculynxConfig.proxyUrl
    ) {
      showToast(t.bjAxDisabled, "warning");
      return;
    }
    setAxL(true);
    try {
      const accessToken = await getAccessToken();
      // Without this the proxy answers 401 "Not authenticated", which reads as an
      // AccuLynx credential problem and sends people to re-enter their API key.
      if (!accessToken) throw new Error(t.bjSessionExpired);
      const response = await fetch(acculynxConfig.proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", query: axQ.trim(), accessToken }),
      });
      // The proxy always says WHY in the body — an inactive membership, a lapsed
      // subscription, no AccuLynx key for this company. Throwing on the status code
      // alone discarded that and left a bare "403" on screen with nothing to act on.
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok)
        throw new Error(
          data.error || `Server returned HTTP Error Status: ${response.status}`,
        );
      const results = Array.isArray(data.jobs) ? data.jobs : [];
      setAxR(results);
      if (results.length === 0) {
        const debugHint = data._debug ? ` (API keys: ${data._debug.map(d => d.keys.join(",")).join(" | ")})` : "";
        showToast(`${t.bjAxNoResults.replace("{query}", axQ.trim())}${debugHint}`, "warning");
        if (data._debug) console.warn("AccuLynx search debug:", data._debug);
      } else {
        showToast(results.length === 1 ? t.bjAxFoundOne : t.bjAxFoundMany.replace("{count}", results.length), "success");
      }
    } catch (err) {
      console.error("AccuLynx Live Proxy Query Failure:", err);
      showToast(
        `${t.bjAxFetchFail} ${err.message}`,
        "error",
      );
      setAxR([]);
    } finally {
      setAxL(false);
    }
  };

  // AccuLynx estimate import was removed here on 2026-08-06.
  //
  // fetchJobEstimateChecklist ran on every job selection, stored the result in
  // state nothing ever read, and rendered nothing. It was also looking in the
  // wrong place: it read estimateItems off the job resource, but the proxy's
  // getJob calls GET /jobs/{id}, and AccuLynx v2 keeps estimate lines on a
  // separate resource — so the array was almost certainly always empty.
  //
  // Reviving it is not a rendering job. It needs a new proxy action for the
  // estimates endpoint, and then the actual work: mapping AccuLynx line items
  // ("GAF Timberline HDZ, 32 SQ") onto catalog items and units (rolls, boxes,
  // tubes). There is no shared SKU and the units do not correspond, so that is a
  // mapping table someone has to own and keep current.
  //
  // utils/jobTemplates.js already solves "stop retyping the material list" by
  // keyword-matching named packages onto live inventory. Prefer improving that
  // unless per-roof quantities are worth the mapping burden.

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

  // Job material templates: saved ones from the DB (managed in Inventory →
  // 🧰 Templates), falling back to the built-in starter packages.
  const [savedTemplates, setSavedTemplates] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await fetchJobTemplates();
        if (!cancelled && saved) setSavedTemplates(saved);
      } catch (err) {
        console.error("Failed to load job templates:", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const jobTemplates = savedTemplates || resolveDefaultTemplates(inv);

  // Apply a material template: resolve each entry against live inventory and
  // add everything not already on the job list in one shot.
  const applyTemplate = (tpl) => {
    const missing = [];
    const additions = [];
    // `entry`, not `t` — `t` is the translation dictionary in this component and
    // shadowing it here would silently break any t.key added inside this loop.
    (tpl.items || []).forEach((entry) => {
      const item = inv.find((i) => i && i.id === entry.iid);
      if (!item) {
        missing.push(entry.iname);
        return;
      }
      if (wItems.find((x) => x.iid === item.id) || additions.find((x) => x.iid === item.id)) return;
      additions.push({
        iid: item.id,
        iname: item.name,
        icat: item.cat,
        unit: item.unit,
        qty: Math.max(1, parseInt(entry.qty) || 1),
        avail: tot(item),
      });
    });

    if (additions.length > 0) setWItems((p) => [...p, ...additions]);

    if (missing.length > 0) {
      showToast(
        `"${tpl.name}" applied — ${additions.length} item${additions.length === 1 ? "" : "s"} added. Not found in inventory: ${missing.join(", ")}. Add those manually.`,
        "warning",
      );
    } else if (additions.length === 0) {
      showToast(t.bjTemplateAllPresent.replace("{name}", tpl.name), "info");
    } else {
      showToast(`"${tpl.name}" template applied — ${additions.length} item${additions.length === 1 ? "" : "s"} added. Adjust quantities in the Job List.`, "success");
    }
  };

  const saveJob = async (asDraft) => {
    if (!wPO.po || !wPO.name || wItems.length === 0) {
      showToast(t.bjCompleteSteps, "warning");
      return;
    }
    if (!wPO.notes || !wPO.notes.trim()) {
      showToast(t.bjNotesRequired, "warning");
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
      scheduledDate: wPO.scheduledDate || todayLocal(),
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
      // null, not 0, when left blank. See utils/jobCosting: 0 would report the job
      // as a total loss instead of excluding it from margin.
      contract_value:
        perms.jobs_revenue && wPO.contractValue !== "" && wPO.contractValue != null
          ? parseFloat(wPO.contractValue)
          : null,
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
          showToast(`${t.bjTrailerBookFail} ${jtErr.message}`, "warning");
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
          ? t.bjDraftSaved
          : t.bjJobApprovedNotified,
        "success",
      );
      setModal(null);
      resetWiz();
    } catch (err) {
      console.error("Failed to save job:", err);
      showToast(`${t.bjSaveFail} ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const doApprove = async () => {
    if (!apAssign) {
      showToast(t.bjAssignBeforeApprove, "warning");
      return;
    }
    setApproving(true);
    const approvedAtTime = new Date().toISOString();
    try {
      const { error } = await updateRowStrict("jobs", sel.id, {
        status: "approved",
        approved: approvedAtTime,
        assignedto: apAssign,
        newforassigned: true,
      });
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

      // The approval/assignment email is now gated by the company's notification rule
      // (Settings → Notifications, "Approved"). Defaults ON so existing behaviour is
      // preserved; an admin can turn it off. Richer than the generic move email — it
      // carries the trailer list — so it stays its own template rather than routing
      // through notifyJobMove.
      const assignedUser = users.find((u) => u.id === apAssign);
      if (assignedUser?.email && shouldNotifyJobMove("approved", jobNotifications)) {
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

      showToast(t.bjApproved, "success");
      setSel(null);
      setModal(null);
      setApAssign("");
    } catch (err) {
      console.error("Failed to approve job:", err);
      showToast(
        `${t.bjApproveFail} ${err.message}`,
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
      showToast(t.bjPurged, "success");
    } catch (err) {
      console.error("Failed to delete job:", err);
      showToast(
        `${t.bjDeleteFail} ${err.message}`,
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
      showToast(
        (action === "added" ? t.bjTrailerNotifiedAdded : t.bjTrailerNotifiedRemoved)
          .replace("{name}", assignedUser?.name || t.bjSupervisorFallback),
        "success",
      );
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
        showToast(`${t.bjTrailerRemoveFail} ${err.message}`, "error");
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
        showToast(`${t.bjTrailerAssignFail} ${err.message}`, "error");
        setJobTrailers((p) => p.filter((jt) => jt.id !== newRow.id));
      }
    }
  };

  const closeJob = async (job = sel) => {
    if (!job) return;
    const closedAt = new Date().toISOString();
    try {
      const { error } = await updateRowStrict("jobs", job.id, { status: "closed", closedAt });
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
      // Email the assigned supervisor if the company enabled "Closed" notifications.
      notifyJobMove({ transition: "closed", job: updated, users, prefs: jobNotifications });
      showToast(t.bjClosed, "success");
    } catch (err) {
      console.error("Failed to close job:", err);
      showToast(`${t.bjCloseFail} ${err.message}`, "error");
    }
  };

  const reopenJob = async (job = sel) => {
    if (!job) return;
    try {
      const { error } = await updateRowStrict("jobs", job.id, { status: "completed", closedAt: "" });
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
        t.bjReopened,
        "success",
      );
    } catch (err) {
      console.error("Failed to reopen job:", err);
      showToast(
        `${t.bjReopenFail} ${err.message}`,
        "error",
      );
    }
  };

  const filtInv = inv.filter((i) =>
    (i?.name || "").toLowerCase().includes(iSrch.toLowerCase()),
  );

  // ── ✏️ EDIT JOB HELPERS ────────────────────────────────────────────────────
  // The dialog seeds itself from the job it is handed, so opening it is now just
  // a modal switch. It used to require calling this first to populate four
  // pieces of parent state, in the right order.
  const startEditJob = () => setModal("edit");

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
            {t.bjSubtitle}
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
          lang={lang}
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
              placeholder={t.bjSearchPlaceholder}
              style={{ flex: 1, minWidth: 220, maxWidth: 380 }}
            />
            <Sel value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label={t.bjSortAria} style={{ width: "auto" }}>
              <option value="newest">{t.bjSortNewest}</option>
              <option value="oldest">{t.bjSortOldest}</option>
              <option value="name_az">{t.bjSortNameAZ}</option>
              <option value="name_za">{t.bjSortNameZA}</option>
              <option value="po">{t.bjSortPo}</option>
              <option value="status">{t.bjSortStatus}</option>
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
                      color: filt === k ? C.onAccent : C.sub,
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
                      {syncStatusOf(job) === "synced" && <Bdg color="sky">☁️ AccuLynx Synced</Bdg>}
                      {syncStatusOf(job) === "failed" && <Bdg color="red">⚠️ Sync Failed</Bdg>}
                      {syncStatusOf(job) === "manual" && <Bdg color="amber">📋 Sync Pending</Bdg>}
                      {reportUploadedAtOf(job) && <Bdg color="green">{t.pullReportFiled}</Bdg>}
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
                        {t.bjApproveAssign}
                      </Btn>
                    )}
                    {job.status === "completed" && (
                      <Btn
                        v="green"
                        sz="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openJobReport({
                            job, users, activeLogo, inv, company,
                            acculynxConfig, showToast, t, popupBlockedMsg: t.bjPopupBlocked, setJobs,
                          });
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
                          if (window.confirm(t.bjCloseConfirm)) {
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
                          if (window.confirm(t.bjDeleteConfirm)) {
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
              <Btn
                v="green"
                sz="sm"
                onClick={() => {
                  openJobReport({
                    job: sel, users, activeLogo, inv, company,
                    acculynxConfig, showToast, t, popupBlockedMsg: t.bjPopupBlocked, setJobs,
                  });
                }}
              >
                📄 Download PDF Report
              </Btn>
            )}
            {perms.jobs_close && sel.status === "completed" && (
              <Btn
                v="purple"
                sz="sm"
                onClick={() => {
                  if (window.confirm(t.bjCloseConfirm)) {
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
                  if (window.confirm(t.bjDeleteDraftConfirm)) {
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
              ["Approved", fd(sel.approved)],
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
          <div className="sw-table-scroll">
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
                  // Priced from the pull-time FIFO snapshot, matching the PDF and
                  // Reports; current inventory price is the fallback for rows that
                  // never recorded one (legacy imports, or nothing pulled yet).
                  const used = Math.max((item.pulled || 0) - (item.returned || 0), 0);
                  const invItem = inv.find((x) => x && x.id === item.iid);
                  const livePrice = invItem ? newestPrice(invItem) : 0;
                  const snapshot = parseFloat(item.priceAtPull);
                  const unitPrice = (item.pulled || 0) > 0 && Number.isFinite(snapshot) ? snapshot : livePrice;
                  const usedCost = used * unitPrice;
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
          </div>
        </Modal>
      )}

      {/* ── 📂 MODAL: EDIT JOB BUILD ── */}
      {/* ── 📂 MODAL: SUPERVISOR APPROVAL POPUP ── */}
      {modal === "edit" && sel && (
        <EditJobModal
          job={sel}
          inv={inv}
          fieldUsers={fieldUsers}
          activeUser={activeUser}
          perms={perms}
          onSaved={(updated) => {
            setJobs((p) => p.map((j) => (j.id === updated.id ? updated : j)));
            setSel(updated);
            setModal("detail");
          }}
          onClose={() => setModal("detail")}
        />
      )}

      {modal === "approve" && sel && (
        <Modal title={`Approve: ${sel.title || sel.name}`} onClose={() => setModal(null)}>
          <div style={{ background: C.tB, border: `1.5px solid ${C.tl}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.tl, fontWeight: "var(--weight-semibold)" }}>
            {t.bjApproveNotice}
          </div>
          <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)" }}>
            <strong style={{ color: C.navy }}>{sel.po} — {sel.title || sel.name}</strong>
            <div style={{ color: C.sub, marginTop: 2 }}>{Math.max((sel.items || sel.materials || []).length, 0)} items planned</div>
          </div>
          <Fld label={t.bjAssignSupervisorReq}>
            <Sel value={apAssign} onChange={(e) => setApAssign(e.target.value)} disabled={approving}>
              <option value="">{t.bjSelectSupervisorOpt}</option>
              {fieldUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Sel>
          </Fld>
          <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 8 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: "center" }} disabled={approving}>{t.bjCancel}</Btn>
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
                <Inp value={axQ} onChange={(e) => setAxQ(e.target.value)} placeholder={t.bjAxSearchPlaceholder} onKeyDown={(e) => e.key === "Enter" && !axL && searchAX()} style={{ flex: 1 }} disabled={axL} />
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
                <Fld label={t.bjJobPo}><Inp value={wPO.po} onChange={(e) => setWPO({ ...wPO, po: e.target.value })} placeholder={t.bjPoPlaceholder} /></Fld>
                <Fld label={t.bjJobName}><Inp value={wPO.name} onChange={(e) => setWPO({ ...wPO, name: e.target.value })} placeholder={t.bjJobNamePlaceholder} /></Fld>
                <Fld label={t.bjJobAddr}><Inp value={wPO.addr} onChange={(e) => setWPO({ ...wPO, addr: e.target.value })} placeholder={t.bjJobAddrPlaceholder} /></Fld>
                {/* Captured at creation, when the number is in front of whoever is
                    building the job. Left optional on purpose: forcing it here would
                    push people to type a placeholder, and a wrong contract value is
                    worse than a blank one — blank keeps the job out of margin
                    reporting, a guess quietly corrupts it. */}
                {perms.jobs_revenue && (
                  <Fld label={t.bjContractValue} hint={t.bjContractValueHint}>
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.sub }}>$</span>
                      <Inp
                        type="number"
                        step="0.01"
                        min="0"
                        value={wPO.contractValue || ""}
                        onChange={(e) => setWPO({ ...wPO, contractValue: e.target.value })}
                        placeholder="e.g. 14500.00"
                        style={{ paddingLeft: 22 }}
                      />
                    </div>
                  </Fld>
                )}
                <Fld label={t.bjSchedStart}>
                  <Inp type="date" aria-label={t.bjSchedStart} value={wPO.scheduledDate || ""} onChange={(e) => setWPO({ ...wPO, scheduledDate: e.target.value })} />
                </Fld>
              </div>
              <Btn v="primary" sz="lg" onClick={() => { if (!wPO.po || !wPO.name) { showToast(t.bjPoNameRequired, "warning"); return; } setWStep(2); }} style={{ width: "100%", justifyContent: "center", marginTop: 10 }}>{t.bjContinue}</Btn>
            </div>
          )}

          {wStep === 2 && (
            <div>
              <div style={{ background: C.gL, border: `1.5px solid ${C.gold}`, borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: 12, fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: C.navy }}>
                📋 {wPO.po} — {wPO.name}
              </div>
              
              {/* ── 🆕 OPTION 2: MULTI-COLUMN INTERACTIVE SIDE PANEL LAYOUT ── */}
              <div style={{ display: "flex", gap: "var(--space-7)", flexWrap: "wrap" }}>
                
                {/* Column A: Job Material Templates */}
                <div style={{ flex: 1.2, minWidth: 200, background: C.bg || "var(--c-subtle)", border: `1px solid ${C.bd}`, borderRadius: "var(--radius-lg)", padding: 12, maxHeight: 380, overflowY: "auto" }}>
                  <h4 style={{ margin: "0 0 8px 0", color: C.navy, fontSize: "var(--text-base)", display: "flex", alignItems: "center", gap: 5 }}>
                    🧰 Job Templates
                  </h4>
                  <p style={{ margin: "0 0 10px 0", fontSize: "var(--text-xs)", color: C.sub }}>
                    One-click material packages. Apply one, then fine-tune quantities in the Job List.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                    {jobTemplates.length === 0 && (
                      <p style={{ fontSize: "var(--text-xs)", color: C.sub, fontStyle: "italic", margin: 0 }}>
                        {t.bjNoTemplates}
                      </p>
                    )}
                    {jobTemplates.map((tpl) => (
                      <div key={tpl.id || tpl.name} style={{ background: C.w, border: `1px solid ${C.lg}`, borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, fontSize: "var(--text-sm)" }}>
                            {tpl.icon} {tpl.name}
                          </div>
                          <Btn v="primary" sz="sm" onClick={() => applyTemplate(tpl)}>+ Apply</Btn>
                        </div>
                        <div style={{ fontSize: "var(--text-2xs)", color: C.sub, lineHeight: 1.7 }}>
                          {(tpl.items || []).map((it) => it.iname + (it.qty > 1 ? ` ×${it.qty}` : "")).join(" · ")}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: "var(--text-2xs)", color: C.sub }}>
                    ✏️ Manage these in Inventory → 🧰 Templates
                  </p>
                </div>

                {/* Column B: Real WMS System Catalog Query Feed */}
                <div style={{ flex: 2, minWidth: 240 }}>
                  <Inp value={iSrch} onChange={(e) => setISrch(e.target.value)} placeholder={t.bjSearchInv} style={{ marginBottom: 8 }} />
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
                          {added ? <Bdg color="blue">{t.bjAdded}</Bdg> : <Btn v="primary" sz="sm" onClick={() => addWItem(item)}>{t.bjAdd}</Btn>}
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
                      <p style={{ color: C.sub, fontSize: "var(--text-sm)", margin: 0 }}>{t.bjAddFromList}</p>
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
                <Btn v="primary" onClick={() => { if (wItems.length === 0) { showToast(t.bjAddOneItem, "warning"); return; } setWStep(3); }} style={{ flex: 1, justifyContent: "center" }}>{t.bjContinue}</Btn>
              </div>
            </div>
          )}

          {wStep === 3 && (
            <div>
              <div style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14 }}>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{wPO.po} — {wPO.name}</div>
                <div style={{ fontSize: "var(--text-sm)", color: C.sub }}>{wItems.length} items planned</div>
              </div>
              <Fld label={t.bjNotes} hint={t.bjNotesHint}>
                <TA
                  value={wPO.notes}
                  onChange={(e) => setWPO({ ...wPO, notes: e.target.value })}
                  placeholder={t.bjNotesPlaceholder}
                  disabled={saving}
                />
              </Fld>
              <Fld label={t.bjAssignSupervisor} hint={t.bjAssignLaterHint}>
                <Sel value={wAssign} onChange={(e) => setWAssign(e.target.value)} disabled={saving}>
                  <option value="">{t.bjAssignLaterOpt}</option>
                  {fieldUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </Sel>
              </Fld>
              <div style={{ background: wAssign ? C.tB : C.aB, border: `1px solid ${wAssign ? C.tl : C.am}`, borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: 14, fontSize: "var(--text-sm)", color: wAssign ? C.tl : C.am, fontWeight: "var(--weight-semibold)" }}>
                {wAssign ? `✅ ${users.find((u) => u.id === wAssign)?.name} will be notified when you approve.` : "⚠️ No supervisor assigned — will save as draft."}
              </div>
              {vehs.some((v) => v.type === "trailer") && (
                <Fld label={t.bjTrailersNeeded} hint={t.bjTrailersHint}>
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