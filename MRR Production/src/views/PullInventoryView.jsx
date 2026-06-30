// src/views/PullInventoryView.jsx
// ── Pull Inventory ────────────────────────────────
import { useState } from "react";
import { C, fd, fm, doFifo, uid, tot, ft } from "../utils/helpers";
import { generatePDF } from "../utils/pdfGenerator";
import { attemptAccuLynxSync } from "../utils/accuLynxSync";
import { Btn, Bdg, Modal, Fld, TA, Inp, PhotoUpload } from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { supabase } from "../utils/supabase";
import { useNotify } from "../context/NotificationContext";
import { uploadPhotoToBucket } from "../utils/storageBucketUpload"; 

export default function PullInventory({
  jobs = [],
  setJobs,
  inv = [],
  setInv,
  users = [],
  user,
  perms,
  activeLogo,
  acculynxConfig,
  jSC,
  jobPhotos,
  setJobPhotos,
}) {
  const { showToast } = useNotify();
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [pullQtys, setPullQtys] = useState({});
  const [retQtys, setRetQtys] = useState({});
  const [syncModal, setSyncModal] = useState(null);

  const [pulling, setPulling] = useState(false);
  const [returning, setReturning] = useState(false);

  const isField = user.role === "field";
  
  // ── 🟢 SAFEGUARD PIPELINE MAPPING TO CORRECT DATABASE SHARDS ──
  const myJobs = isField
    ? jobs.filter((j) => j && (j.assignedto === user.id || j.assignedTo === user.id) && j.status !== "draft")
    : jobs
        .filter((j) => j && j.status !== "draft")
        .sort((a, b) => new Date(b.created || b.createdAt || 0) - new Date(a.created || a.createdAt || 0));

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

  const confirmPull = async () => {
    if (!sel) return;
    setPulling(true);

    const newInv = [...inv];
    let ok = true;
    const updItems = [...(sel.items || sel.materials || [])];

    for (const item of updItems) {
      if (!item) continue;
      const qty = parseFloat(pullQtys[item.iid]) ?? (item.planned || item.qty || 0);
      if (qty <= 0) continue;
      const idx = newInv.findIndex((i) => i.id === item.iid);
      if (idx < 0) continue;

      const res = doFifo(newInv[idx], qty);
      if (!res) {
        showToast(
          `Not enough warehouse stock available for ${item.iname || item.name}. Please review staging allocations.`,
          "error",
        );
        ok = false;
        break;
      }

      newInv[idx] = { ...newInv[idx], batches: res.batches };
      const ppu = qty > 0 ? res.cost / qty : 0;
      const ji = updItems.findIndex((i) => i && i.iid === item.iid);
      if (ji >= 0) {
        updItems[ji] = {
          ...updItems[ji],
          pulled: qty,
          priceAtPull: ppu,
          pullCost: res.cost,
        };
      }
    }

    if (!ok) {
      setPulling(false);
      return;
    }

    const updatedJob = { ...sel, status: "active", items: updItems, materials: updItems };

    try {
      const jobRes = await supabase
        .from("jobs")
        .update({ status: "active", items: updItems, materials: updItems })
        .eq("id", sel.id);
      if (jobRes.error) throw jobRes.error;

      for (const updatedItem of newInv) {
        const invRes = await supabase
          .from("inventory")
          .update({ batches: updatedItem.batches })
          .eq("id", updatedItem.id);
        if (invRes.error) throw invRes.error;
      }

      setInv(newInv);
      setJobs((p) => p.map((j) => (j.id === sel.id ? updatedJob : j)));
      setSel(updatedJob);

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

    const newInv = [...inv];
    const rawItems = sel.items || sel.materials || [];
    const updItems = rawItems.map((item) => {
      if (!item) return null;
      const ret = Math.min(parseFloat(retQtys[item.iid]) || 0, item.pulled || 0);
      if (ret > 0) {
        const idx = newInv.findIndex((i) => i.id === item.iid);
        if (idx >= 0) {
          const nb = {
            id: uid(),
            rcvd: new Date().toISOString().split("T")[0],
            qty: ret,
            price: item.priceAtPull || 0,
            by: user.id,
            rem: ret,
          };
          newInv[idx] = {
            ...newInv[idx],
            batches: [...(newInv[idx].batches || []), nb],
          };
        }
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

    try {
      const jobRes = await supabase
        .from("jobs")
        .update({ status: "completed", completed: completedAt, completedAt, items: updItems, materials: updItems })
        .eq("id", sel.id);
      if (jobRes.error) throw jobRes.error;

      for (const updatedItem of newInv) {
        const invRes = await supabase
          .from("inventory")
          .update({ batches: updatedItem.batches })
          .eq("id", updatedItem.id);
        if (invRes.error) throw invRes.error;
      }

      setInv(newInv);
      setJobs((p) => p.map((j) => (j.id === sel.id ? updatedJob : j)));
      showToast("Job logistics completed. Generating material manifest report.", "success");
      setModal(null);
      setRetQtys({});

      setTimeout(() => {
        generatePDF(updatedJob, users, activeLogo);
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
    
    if (!base64Data) {
      if (typeof setJobPhotos === "function") {
        setJobPhotos((prev) => ({
          ...prev,
          [sel.id]: {
            ...(prev[sel.id] || { before: null, after: null }),
            [phase]: null,
          },
        }));
      }
      return;
    }

    try {
      showToast(`Uploading ${phase} photo asset securely to cloud...`, "info");
      const cloudPublicUrl = await uploadPhotoToBucket("job-attachments", sel.id, base64Data);
      if (!cloudPublicUrl) throw new Error("Cloud engine failed to return a valid URL.");

      if (typeof setJobPhotos === "function") {
        setJobPhotos((prev) => ({
          ...prev,
          [sel.id]: {
            ...(prev[sel.id] || { before: null, after: null }),
            [phase]: cloudPublicUrl,
          },
        }));
      }

      const columnToUpdate = phase === "before" ? "photo_before_url" : "photo_after_url";
      const { error: dbError } = await supabase
        .from("jobs")
        .update({ [columnToUpdate]: cloudPublicUrl })
        .eq("id", sel.id);

      if (dbError) throw dbError;
      showToast(`${phase === "before" ? "Before" : "After"} photo synchronized to cloud storage!`, "success");
    } catch (err) {
      console.error("[Storage Upload Failure]:", err);
      showToast(`Upload failed: ${err.message || "Network timeout error."}`, "error");
    }
  };

  const parsedJobPhotos = typeof jobPhotos !== "undefined" && jobPhotos ? jobPhotos : {};
  const currentJobPhotos = sel ? (parsedJobPhotos[sel.id] || { before: null, after: null }) : { before: null, after: null };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>📋 Pull Inventory</h1>
        <p style={{ margin: "2px 0 0", color: C.sub, fontSize: 12 }}>
          {isField ? "Your assigned jobs" : "All active jobs in pipeline"}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {myJobs.map((job) => {
          if (!job) return null;
          const sup = users.find((u) => u.id === job.assignedto || u.id === job.assignedTo);
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
              style={{
                background: C.w,
                borderRadius: 12,
                padding: 16,
                boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
                border: `2px solid ${isNew ? C.tl : job.status === "active" ? C.am : "transparent"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 5, flexWrap: "wrap" }}>
                    <Bdg color={st.c}>{st.icon} {st.l}</Bdg>
                    {isNew && <Bdg color="teal">🔔 NEW</Bdg>}
                    <span style={{ fontSize: 12, color: C.sub }}>{job.po || "No PO #"}</span>
                    {syncBadge(job)}
                  </div>
                  <div style={{ fontWeight: 800, color: C.navy, fontSize: 15, marginBottom: 2 }}>
                    {job.title || job.name}
                  </div>
                  <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>{job.addr || job.address}</div>
                  {!isField && sup && <div style={{ fontSize: 11, color: C.blue, fontWeight: 700 }}>👤 {sup.name}</div>}
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
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Btn v="green" sz="sm" onClick={() => generatePDF(job, users, activeLogo)}>📄 PDF</Btn>
                      <Btn v="sky" sz="sm" onClick={() => setSyncModal(job)}>☁️ Sync Status</Btn>
                    </div>
                  )}
                  <Btn v="ghost" sz="sm" onClick={() => openJob(job)}>Details</Btn>
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${C.lg}`, paddingTop: 10, display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
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
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, whiteSpace: "nowrap" }}>{item.iname || item.name}</div>
                      <div style={{ fontSize: 10, color: C.sub }}>
                        {item.pulled > 0
                          ? `${(item.pulled || 0) - (item.returned || 0)} used`
                          : `${item.planned || item.qty || 0} ${item.unit || ""} planned`}
                      </div>
                    </div>
                  );
                })}
                {currentItems.length > 6 && (
                  <div style={{ background: C.lg, borderRadius: 7, padding: "5px 10px", flexShrink: 0, display: "flex", alignItems: "center", fontSize: 10, color: C.sub }}>
                    +{currentItems.length - 6} more
                  </div>
                )}
              </div>
              {perms.inv_pricing_view && job.status === "completed" && totalCost > 0 && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${C.lg}`, paddingTop: 8, display: "flex", justifyContent: "flex-end" }}>
                  <span style={{ fontWeight: 900, fontSize: 15, color: C.gr }}>Total: {fm(totalCost)}</span>
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
          <div style={{ background: C.tB, border: `1.5px solid ${C.tl}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: C.tl, fontWeight: 600 }}>
            Adjust quantities if needed. Confirm to deduct from warehouse inventory (FIFO).
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {["Item", "Planned", "Actual to Pull", "Available"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.sub, fontWeight: 700, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(sel.items) ? sel.items : (sel.materials || [])).map((item) => {
                if (!item) return null;
                const avail = tot(inv.find((i) => i.id === item.iid) || { batches: [] });
                const actual = parseFloat(pullQtys[item.iid]) ?? (item.planned || item.qty || 0);
                const short = actual > avail;
                return (
                  <tr key={item.iid} style={{ borderTop: `1px solid ${C.lg}`, background: short ? C.rB : "transparent" }}>
                    <td style={{ padding: "9px 10px", fontWeight: 700, color: C.navy }}>{item.iname || item.name}</td>
                    <td style={{ padding: "9px 10px" }}>{item.planned || item.qty || 0} {item.unit || ""}</td>
                    <td style={{ padding: "9px 10px" }}>
                      <Inp
                        type="number"
                        value={pullQtys[item.iid] ?? (item.planned || item.qty || 0)}
                        min="0"
                        max={avail}
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
                    <td style={{ padding: "9px 10px", color: short ? C.rd : C.gr, fontWeight: 700 }}>
                      {avail} {item.unit || ""}
                      {short && " ⚠️"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 10 }}>
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
          <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: C.am, fontWeight: 600 }}>
            Enter quantities being returned. PDF report + AccuLynx sync will trigger on completion.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {["Item", "Pulled", "Returning", "Will Be Used"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.sub, fontWeight: 700, fontSize: 11 }}>{h}</th>
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
                      <td style={{ padding: "9px 10px", fontWeight: 700, color: C.navy }}>{item.iname || item.name}</td>
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
                      <td style={{ padding: "9px 10px", fontWeight: 800, color: used > 0 ? C.navy : C.sub }}>
                        {used} {item.unit || ""}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {perms.inv_pricing_view && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${C.navy}` }}>
                  <td colSpan={3} style={{ padding: "9px 10px", fontWeight: 700, color: C.navy }}>Estimated Cost</td>
                  <td style={{ padding: "9px 10px", fontWeight: 900, color: C.gr, fontSize: 15 }}>
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
          <div style={{ display: "flex", gap: 10 }}>
            <Btn v="ghost" onClick={() => { setModal(null); setRetQtys({}); }} style={{ flex: 1, justifyContent: "center" }} disabled={returning}>Cancel</Btn>
            <Btn v="green" sz="lg" onClick={confirmReturn} style={{ flex: 2, justifyContent: "center" }} disabled={returning}>
              {returning ? "⏳ Compiling Core Assets..." : "🏁 Complete Job & Generate PDF"}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === null && sel && (
        <Modal title={`${sel.po || "No PO"} — ${sel.title || sel.name}`} onClose={() => setSel(null)} wide>
          <div style={{ marginTop: 18, borderTop: `1px solid ${C.lg}`, paddingTop: 14 }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 800, color: C.navy }}>📸 Visual Production Accountability Media</h3>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 4 }}>Before Photo (Site Prep / Decking)</div>
                <PhotoUpload current={currentJobPhotos.before} onUpload={(base64) => handleStagePhoto("before", base64)} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 4 }}>After Photo (Finished Shingles / Clean)</div>
                <PhotoUpload current={currentJobPhotos.after} onUpload={(base64) => handleStagePhoto("after", base64)} />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 8, marginBottom: 14, marginTop: 14 }}>
            {[
              ["Status", <Bdg color={(jSC[sel.status] || {c:"gray"}).c}>{(jSC[sel.status] || {l:sel.status}).l}</Bdg>],
              ["PO", sel.po || "—"],
              ["Assigned To", users.find((u) => u.id === sel.assignedto || u.id === sel.assignedTo)?.name || "—"],
              ["Approved", fd(sel.approved || sel.approvedAt)],
              ["Completed", fd(sel.completed || sel.completedAt)],
            ].map(([k, v]) => (
              <div key={k} style={{ background: C.lg, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {["Item", "Planned", "Pulled", "Returned", "Used", ...(perms.inv_pricing_view ? ["Cost"] : [])].map((h) => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: "left", color: C.sub, fontWeight: 700 }}>{h}</th>
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
                    <td style={{ padding: "8px 10px", fontWeight: 700, color: C.navy }}>{item.iname || item.name}</td>
                    <td style={{ padding: "8px 10px" }}>{item.planned || item.qty || 0}</td>
                    <td style={{ padding: "8px 10px", color: pQty > 0 ? C.gr : C.sub }}>{pQty}</td>
                    <td style={{ padding: "8px 10px", color: rQty > 0 ? C.am : C.sub }}>{rQty}</td>
                    <td style={{ padding: "8px 10px", fontWeight: 700 }}>{pQty - rQty}</td>
                    {perms.inv_pricing_view && (
                      <td style={{ padding: "8px 10px", color: C.blue, fontWeight: 700 }}>
                        {item.pullCost > 0 ? fm((pQty - rQty) * (item.priceAtPull || 0)) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sel.status === "completed" && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Btn v="green" onClick={() => generatePDF(sel, users, activeLogo)}>📄 PDF</Btn>
              <Btn v="sky" onClick={() => setSyncModal(sel)}>☁️ AccuLynx Sync</Btn>
            </div>
          )}
        </Modal>
      )}

      {syncModal && (
        <Modal title={`AccuLynx Sync — ${syncModal.po || "No PO #"}`} onClose={() => setSyncModal(null)}>
          <div style={{ marginBottom: 14 }}>
            {syncModal.syncStatus === "synced" && (
              <div style={{ background: C.sB, border: `1.5px solid ${C.sl}`, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontWeight: 700, color: C.sl, marginBottom: 4 }}>☁️ Successfully Synced to AccuLynx</div>
                <div style={{ fontSize: 12, color: C.sub }}>{syncModal.syncNote}</div>
                {syncModal.syncedAt && <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>Synced: {ft(syncModal.syncedAt)}</div>}
              </div>
            )}
            {syncModal.syncStatus === "failed" && (
              <div style={{ background: C.rB, border: `1.5px solid ${C.rd}`, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontWeight: 700, color: C.rd, marginBottom: 4 }}>⚠️ Sync Failed</div>
                <div style={{ fontSize: 12, color: C.sub }}>{syncModal.syncNote}</div>
              </div>
            )}
            {(syncModal.syncStatus === "manual" || !syncModal.syncStatus) && (
              <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontWeight: 700, color: C.am, marginBottom: 4 }}>📋 Auto-Sync Not Configured</div>
                <div style={{ fontSize: 12, color: C.navy }}>Configure AccuLynx in Settings → AccuLynx to enable automatic document upload and cost entry.</div>
              </div>
            )}
          </div>
          {syncModal.syncPayload && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 6 }}>Payload Sent to AccuLynx</div>
              <div style={{ background: "#1A202C", borderRadius: 8, padding: 12, overflowX: "auto", marginBottom: 12 }}>
                <pre style={{ margin: 0, fontSize: 10, color: "#68D391", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {JSON.stringify(syncModal.syncPayload, null, 2)}
                </pre>
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
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