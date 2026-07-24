// src/views/MaintenanceRequestsView.jsx
import { useState, useEffect } from "react";
import { supabase, updateRowStrict } from "../utils/supabase";
import { C } from "../utils/helpers";
import { translations } from "../utils/translations";
import { detectChronicIssues, detectFleetTrends } from "../utils/patterns";
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
import { sendEmail } from "../utils/email";
import { useNotify } from "../context/NotificationContext";
import { logAction } from "../utils/logger";
import MaintenanceCalendar from "../components/MaintenanceCalendar";

export default function MaintenanceRequestsView({
  reqs,
  setReqs,
  vehs,
  users,
  user,
  perms,
  curUser,
  lang,
  openItemId,
  onOpenItemHandled,
}) {
  const { showToast } = useNotify();
  const t = translations[lang] || translations.en;
  const activeUser = user || curUser || { id: "system", email: "unknown@mrr.com", name: "Crew Member" };

  const [filt, setFilt] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState({});
  const [subView, setSubView] = useState("list");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTicket, setNewTicket] = useState({
    vehicleId: "",
    type: [], 
    urgency: "standard",
    notes: "",
    photo: null,
  });

  const urgencyRank = { urgent: 3, high: 3, priority: 2, standard: 2, normal: 2, low: 1 };
  const reqSorters = {
    newest: (a, b) => new Date(b.at || 0) - new Date(a.at || 0),
    oldest: (a, b) => new Date(a.at || 0) - new Date(b.at || 0),
    vehicle_az: (a, b) => (a.vname || "").localeCompare(b.vname || "", undefined, { numeric: true }),
    vehicle_za: (a, b) => (b.vname || "").localeCompare(a.vname || "", undefined, { numeric: true }),
    urgency: (a, b) => (urgencyRank[(b.urgency || "").toLowerCase()] || 0) - (urgencyRank[(a.urgency || "").toLowerCase()] || 0),
    status: (a, b) => (a.status || "").localeCompare(b.status || ""),
  };
  const filtered = reqs
    .filter((r) => {
      if (filt === "all") return true;
      if (filt === "active") return r.status === "pending" || r.status === "scheduled";
      return r.status === filt;
    })
    .sort(reqSorters[sortBy] || reqSorters.newest);

  // Deep-link from OmniSearch: open the matching ticket card on arrival
  useEffect(() => {
    if (!openItemId) return;
    const target = reqs.find((r) => String(r.id) === String(openItemId));
    if (target) {
      setSubView("list");
      setSel(target);
    }
    onOpenItemHandled?.();
  }, [openItemId]);

  const handleCreateRequest = async () => {
    if (!newTicket.vehicleId) {
      showToast(t.maintSelectVehicleErr, "error");
      return;
    }
    if (!Array.isArray(newTicket.type) || newTicket.type.length === 0) {
      showToast(t.maintSelectIssueErr, "error");
      return;
    }
    if (!newTicket.notes.trim()) {
      showToast(t.maintDescribeErr, "error");
      return;
    }

    const selectedVehicle = vehs.find(
      (v) => v.id === newTicket.vehicleId || String(v.id) === String(newTicket.vehicleId),
    );
    // Identify the vehicle the way the crew does — by its unit number (v.name, e.g.
    // "011"), matching the format FleetManagementView files tickets under. Make/model
    // alone can't tell two F-250s apart, and `plates` is not a column (it's `plate`),
    // so that read was always undefined and every ticket saved as "(No Plate)".
    const vehicleName = selectedVehicle
      ? `${selectedVehicle.name} (${selectedVehicle.plate || "No Plate"})`
      : "Unknown Vehicle";

    const requestPayload = {
      vid: newTicket.vehicleId,
      vname: vehicleName,
      vtype: selectedVehicle ? selectedVehicle.type : "truck",
      type: newTicket.type.join(", "), 
      urgency: newTicket.urgency,
      notes: newTicket.notes.trim(),
      photo: newTicket.photo || null,
      uname: user.name || user.email,
      uid: user.id,
      status: "pending",
      at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("maintenance_requests")
      .insert([requestPayload])
      .select();

    if (error) {
      showToast(t.maintSubmitFail + " " + error.message, "error");
      return;
    }

    const createdRecord = data && data[0] ? data[0] : requestPayload;

    // ── 🟢 AUDIT LOG: NEW TICKET CREATED ──
    await logAction(
      user.id,
      user.email,
      "MAINTENANCE_REQUEST_CREATE",
      `Filed new maintenance request for vehicle: ${vehicleName} (Urgency: ${newTicket.urgency.toUpperCase()})`,
      { ticket_id: createdRecord.id || "N/A", vehicle_id: newTicket.vehicleId, issue_types: newTicket.type },
      "maintenance"
    );

    setReqs((prev) => [createdRecord, ...prev]);
    showToast(t.maintFiledOk, "success");

    setNewTicket({
      vehicleId: "",
      type: [], 
      urgency: "standard",
      notes: "",
      photo: null,
    });
    setIsCreateOpen(false);
  };

  const updateStatus = async (id, status, whNotes = "") => {
    const scheduledDate = form.scheduledDate || "";
    const completedAt = status === "completed" ? new Date().toISOString() : "";

    const currentTicket = reqs.find((r) => r.id === id);
    // Flag the change so the requester gets a dashboard alert (same pattern as jobs.newforassigned);
    // skipped when someone updates their own ticket so they don't alert themselves.
    const notifyRequester = !!currentTicket && String(currentTicket.uid) !== String(user.id);

    const { error } = await updateRowStrict("maintenance_requests", id, {
      status,
      wh_notes: whNotes,
      scheduled_date: scheduledDate,
      completed_at: completedAt,
      newforrequester: notifyRequester,
    });

    if (error) {
      showToast(t.maintUpdateErr + " " + error.message, "error");
      return;
    }

    const vehicleLabel = currentTicket ? currentTicket.vname : `Ticket ID: ${id}`;

    // ── 🟢 AUDIT LOG: STATUS CHANGE WORKFLOW ──
    await logAction(
      user.id,
      user.email,
      status === "completed" ? "FLEET_MAINTENANCE" : "INV_MUTATION", 
      `Updated vehicle request status for "${vehicleLabel}" to: ${status.toUpperCase()}`,
      { ticket_id: id, status_transition: status, scheduler_notes: whNotes },
      "maintenance"
    );

    setReqs((p) =>
      p.map((r) =>
        r.id === id ? { ...r, status, wh_notes: whNotes, scheduled_date: scheduledDate, completed_at: completedAt, newforrequester: notifyRequester } : r,
      ),
    );
    setSel(null);
    setForm({});
    showToast(t.maintStatusUpdated, "success");
  };

  const handleDeleteRequest = async (id) => {
    if (!window.confirm(t.maintDeleteConfirm)) {
      return;
    }

    const targetTicket = reqs.find((r) => r.id === id);
    const targetLabel = targetTicket ? targetTicket.vname : `ID: ${id}`;

    const { error } = await supabase
      .from("maintenance_requests")
      .delete()
      .eq("id", id);

    if (error) {
      showToast(t.maintDeleteFail + " " + error.message, "error");
      return;
    }

    // ── 🟢 AUDIT LOG: REQUEST REMOVED / DELETED ──
    await logAction(
      user.id,
      user.email,
      "FLEET_STATUS_CHANGE",
      `Permanently purged maintenance request ticket file for vehicle: "${targetLabel}"`,
      { purged_ticket_id: id, metadata_backup: targetTicket || {} },
      "maintenance"
    );

    setReqs((p) => p.filter((r) => r.id !== id));
    setSel(null);
    setForm({});
    showToast(t.maintDeletedOk, "success");
  };

  const pendingCount = reqs.filter((r) => r.status === "pending").length;
  const chronicIssues = perms.maint_manage ? detectChronicIssues(reqs) : [];
  const trendingIssues = perms.maint_manage ? detectFleetTrends(reqs) : [];

  return (
    <div>
      
      {/* Header Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: "var(--space-5)" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-3xl)", fontWeight: "var(--weight-black)", color: "#1e3a8a", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            🔧 {t.maintTitle}
          </h1>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          {pendingCount > 0 && (
            <div style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fee2e2", padding: "6px 12px", borderRadius: 20, fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              🔔 {pendingCount} {t.maintAwaiting}
            </div>
          )}
          <div style={{ display: "flex", background: "#f1f5f9", padding: 4, borderRadius: "var(--radius-md)", marginRight: 4 }}>
            <button
              onClick={() => setSubView("list")}
              style={{ padding: "6px 12px", border: "none", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", cursor: "pointer", background: subView === "list" ? "#fff" : "transparent", color: subView === "list" ? "#0f172a" : "#64748b", boxShadow: subView === "list" ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}
            >
              📋 {t.maintRequestList}
            </button>
            <button
              onClick={() => setSubView("calendar")}
              style={{ padding: "6px 12px", border: "none", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", cursor: "pointer", background: subView === "calendar" ? "#fff" : "transparent", color: subView === "calendar" ? "#0f172a" : "#64748b", boxShadow: subView === "calendar" ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}
            >
              📅 {t.maintScheduleCalendar}
            </button>
          </div>
          <Btn v="primary" sz="sm" onClick={() => setIsCreateOpen(true)} style={{ fontWeight: "var(--weight-extrabold)" }}>
            ➕ {t.maintNewRequest}
          </Btn>
        </div>
      </div>

      {(chronicIssues.length > 0 || trendingIssues.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {chronicIssues.map((c) => (
            <div
              key={`${c.vid}::${c.issueType}`}
              style={{ background: "#fef2f2", border: "1px solid #fee2e2", color: "#991b1b", padding: "8px 14px", borderRadius: "var(--radius-md)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)" }}
            >
              🔁 {c.vname} — "{c.issueType}" {t.maintReported} {c.count}x {t.maintInLast60}
            </div>
          ))}
          {trendingIssues.map((trend) => (
            <div
              key={trend.issueType}
              style={{ background: "#fffbeb", border: "1px solid #fef3c7", color: "#92400e", padding: "8px 14px", borderRadius: "var(--radius-md)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)" }}
            >
              📈 "{trend.issueType}" {t.maintTrendingUp} — {trend.recentCount} {t.maintInLast30}
              {!trend.isNew && ` (${trend.ratio}${t.maintBaselineRate})`}
            </div>
          ))}
        </div>
      )}

      {subView === "calendar" ? (
        <MaintenanceCalendar reqs={reqs} vehs={vehs} user={activeUser} setReqs={setReqs} onRequestClick={(r) => setSel(r)} />
      ) : (
      <>
      {/* Filter Tabs + Sort */}
      <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "var(--space-2)", background: "#f1f5f9", padding: 4, borderRadius: "var(--radius-md)", width: "fit-content" }}>
          {[
            ["all", t.all],
            ["active", t.active],
            ["pending", t.pending],
            ["scheduled", t.scheduled],
            ["completed", t.completed]
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilt(key)}
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius-sm)",
                border: "none",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-bold)",
                cursor: "pointer",
                background: filt === key ? "#7c3aed" : "transparent",
                color: filt === key ? "#fff" : "#475569",
                transition: "all 0.15s"
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <Sel value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label={t.maintSortAria} style={{ width: "auto" }}>
          <option value="newest">↕ {t.sortDateNewest}</option>
          <option value="oldest">↕ {t.sortDateOldest}</option>
          <option value="urgency">↕ {t.sortUrgencyHigh}</option>
          <option value="vehicle_az">↕ {t.sortVehicleAZ}</option>
          <option value="vehicle_za">↕ {t.sortVehicleZA}</option>
          <option value="status">↕ {t.status}</option>
        </Sel>
      </div>

      {/* Cards Stream Canvas */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        {filtered.length === 0 ? (
          <div style={{ background: "#fff", padding: 32, borderRadius: "var(--radius-xl)", textAlign: "center", color: "#64748b", border: "1px solid #e2e8f0" }}>
            {t.maintNoneFound}
          </div>
        ) : (
          filtered.map((r) => {
            const isUrgent = r.urgency === "urgent";
            return (
              <div
                key={r.id}
                className="mrr-card-hover"
                style={{
                  background: isUrgent ? "#fff5f5" : "#fff",
                  borderRadius: "var(--radius-xl)",
                  padding: 16,
                  border: isUrgent ? "1px solid #fecaca" : "1px solid #e2e8f0",
                  boxShadow: "var(--shadow-xs)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "var(--space-7)",
                  flexWrap: "wrap"
                }}
              >
                {/* Left Side Metadata Info */}
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
                    <Bdg color={r.status === "pending" ? "amber" : r.status === "scheduled" ? "blue" : "green"}>
                      {{ pending: t.pending, scheduled: t.scheduled, completed: t.completed }[r.status] || r.status}
                    </Bdg>
                    {isUrgent && <Bdg color="red">🚨 {t.maintUrgent}</Bdg>}
                    <Bdg color="gray">{r.type}</Bdg>
                  </div>
                  <h3 style={{ margin: "0 0 4px 0", fontSize: 15, fontWeight: "var(--weight-extrabold)", color: "#0f172a" }}>
                    {r.vname}
                  </h3>
                  <p style={{ margin: "0 0 6px 0", fontSize: "var(--text-base)", color: "#475569", lineHeight: 1.4 }}>
                    {r.notes}
                  </p>
                  <div style={{ fontSize: "var(--text-xs)", color: "#94a3b8" }}>
                    {t.maintBy} {r.uname} • {r.at ? new Date(r.at).toLocaleDateString() : "Recent"}
                    {r.scheduled_date && (
                      <span style={{ marginLeft: 8, color: "#2563eb", fontWeight: "var(--weight-bold)" }}>
                        🗓️ {t.scheduled}: {new Date(r.scheduled_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right Actions Block */}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  {r.status === "pending" && perms.maint_manage && (
                    <Btn v="primary" sz="sm" onClick={() => setSel(r)}>
                      🗓️ {t.maintScheduleBtn}
                    </Btn>
                  )}
                  {r.status === "scheduled" && perms.maint_manage && (
                    <Btn v="green" sz="sm" onClick={() => setSel(r)}>
                      ✅ {t.maintCompleteBtn}
                    </Btn>
                  )}
                  <Btn v="ghost" sz="sm" onClick={() => setSel(r)}>
                    {t.maintReview} →
                  </Btn>
                  
                  {perms.maint_manage && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteRequest(r.id);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: C.rd,
                        cursor: "pointer",
                        fontSize: "var(--text-lg)",
                        padding: "4px 8px",
                        display: "flex",
                        alignItems: "center"
                      }}
                      title={t.maintRemoveTitle}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      </>
      )}

      {/* Create Modal Form Layout */}
      {isCreateOpen && (
        <Modal title={t.maintFileRequest} onClose={() => setIsCreateOpen(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <Fld label={t.maintSelectVehicle}>
              <Sel value={newTicket.vehicleId} onChange={(e) => setNewTicket({ ...newTicket, vehicleId: e.target.value })}>
                <option value="">{t.maintChooseVehicle}</option>
                {vehs.map((v) => (
                  <option key={v.id} value={v.id}>{v.name} — {v.yr} {v.make} {v.model} ({v.plate || "No Plate"})</option>
                ))}
              </Sel>
            </Fld>

            <Fld label={`${t.maintIssueClassification} *`}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
                background: "#f8fafc",
                padding: 12,
                borderRadius: "var(--radius-md)",
                border: "1px solid #e2e8f0"
              }}>
                {[
                  "Routine Oil Change",
                  "Brake System Service",
                  "Tire Repair / Replacement",
                  "Engine / Powertrain Alert",
                  "Body Damage / Accident Report",
                  "Other / General Diagnostics"
                ].map((opt) => {
                  const isChecked = Array.isArray(newTicket.type) && newTicket.type.includes(opt);
                  return (
                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        style={{ transform: "scale(1.1)", cursor: "pointer" }}
                        onChange={() => {
                          const currentTypes = Array.isArray(newTicket.type) ? newTicket.type : [];
                          const nextTypes = isChecked
                            ? currentTypes.filter(item => item !== opt)
                            : [...currentTypes, opt];
                          setNewTicket({ ...newTicket, type: nextTypes });
                        }}
                      />
                      {opt.replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g, '')}
                    </label>
                  );
                })}
              </div>
            </Fld>

            <Fld label={t.urgency}>
              <Sel value={newTicket.urgency} onChange={(e) => setNewTicket({ ...newTicket, urgency: e.target.value })}>
                <option value="standard">{t.maintUrgStandard}</option>
                <option value="soon">{t.maintUrgSoon}</option>
                <option value="urgent">{t.maintUrgUrgent}</option>
              </Sel>
            </Fld>
            <Fld label={`${t.reportedNotes}*`}>
              <TA placeholder={t.maintDescribePlaceholder} value={newTicket.notes} onChange={(e) => setNewTicket({ ...newTicket, notes: e.target.value })} />
            </Fld>

            <Fld label={`${t.maintPhotoLabel}*`}>
              <PhotoUpload 
                current={newTicket.photo} 
                onUpload={(base64) => setNewTicket({ ...newTicket, photo: base64 })} 
                maxDim={600}
                quality={0.75}
                previewHeight={140}
              />
            </Fld>
            
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: 10 }}>
              <Btn v="ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setIsCreateOpen(false)}>{t.cancel}</Btn>
              <Btn v="primary" style={{ flex: 1, justifyContent: "center" }} onClick={handleCreateRequest}>{t.maintSubmit}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Review & Management Modal Panel */}
      {sel && (
        <Modal title={`${t.maintReviewRequest} — ${sel.vname}`} onClose={() => { setSel(null); setForm({}); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", fontSize: "var(--text-base)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><strong>{t.maintSubmittedBy}</strong> {sel.uname} {t.maintOn} {new Date(sel.at).toLocaleDateString()}</div>
              {perms.maint_manage && (
                <button
                  onClick={() => handleDeleteRequest(sel.id)}
                  style={{
                    background: "#fef2f2",
                    color: "#b91c1c",
                    border: "1px solid #fee2e2",
                    borderRadius: "var(--radius-sm)",
                    padding: "4px 10px",
                    fontSize: "var(--text-xs)",
                    fontWeight: "var(--weight-bold)",
                    cursor: "pointer"
                  }}
                >
                  {t.maintDeleteRequest}
                </button>
              )}
            </div>
            <div><strong>{t.maintIssueClassLabel}</strong> {sel.type}</div>
            <div>
              <strong>{t.maintNotesLabel}</strong>
              <div style={{ background: C.lg, padding: 12, borderRadius: "var(--radius-md)", marginTop: 4, fontStyle: "italic" }}>
                "{sel.notes}"
              </div>
              {(() => {
                const lastCompleted = reqs
                  .filter((r) => r.vid === sel.vid && r.status === "completed" && r.id !== sel.id)
                  .sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0))[0];
                if (!lastCompleted) return null;
                return (
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: 10, borderRadius: "var(--radius-md)", marginTop: 8 }}>
                    <strong style={{ fontSize: "var(--text-xs)", color: "#166534", textTransform: "uppercase" }}>
                      🕓 {t.maintLastCompleted} — {sel.vname}
                    </strong>
                    <div style={{ fontSize: "var(--text-sm)", color: "#166534", marginTop: 4 }}>
                      {lastCompleted.wh_notes || t.maintNoResolutionNotes}
                    </div>
                    {lastCompleted.completed_at && (
                      <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 4 }}>
                        {t.completed} {new Date(lastCompleted.completed_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {sel.photo && (
              <div style={{ marginTop: 4 }}>
                <strong style={{ display: "block", marginBottom: 6, color: C.navy }}>{t.maintPhotoAttached}</strong>
                <img src={sel.photo} alt={t.maintPhotoAlt} style={{ width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: "var(--radius-lg)", border: `1px solid ${C.bd}`, background: C.lg }} />
              </div>
            )}

            {sel.status === "pending" && perms.maint_manage && (
              <div style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6 }}>
                <h3 style={{ margin: "0 0 10px 0", fontSize: "var(--text-md)", color: C.navy }}>{t.maintMgmtActions}</h3>
                <Fld label={t.maintScheduleDate}>
                  <Inp type="date" onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
                </Fld>
                <Fld label={t.maintResolutionNotes}>
                  <TA placeholder={t.maintSchedNotesPlaceholder} onChange={(e) => setForm({ ...form, whNotes: e.target.value })} />
                </Fld>
                <div style={{ display: "flex", gap: "var(--space-3)", marginTop: 10 }}>
                  <Btn v="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => updateStatus(sel.id, "scheduled", form.whNotes)}>{t.maintApproveSchedule}</Btn>
                </div>
              </div>
            )}

            {sel.status === "scheduled" && perms.maint_manage && (
              <div style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6 }}>
                <h3 style={{ margin: "0 0 10px 0", fontSize: "var(--text-md)", color: C.navy }}>{t.maintCompleteServiceLogs}</h3>
                {sel.wh_notes && <div style={{ marginBottom: 10 }}><strong>{t.maintScheduleInfo}</strong> {sel.wh_notes}</div>}
                <Fld label={t.maintFinalNotes}>
                  <TA placeholder={t.maintFinalPlaceholder} onChange={(e) => setForm({ ...form, whNotes: e.target.value })} />
                </Fld>
                <Btn v="green" style={{ width: "100%", justifyContent: "center" }} onClick={() => updateStatus(sel.id, "completed", form.whNotes)}>{t.maintCompleteClose}</Btn>
              </div>
            )}

            {sel.status === "completed" && (
              <div style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6, background: "#f0fdf4", padding: 12, borderRadius: "var(--radius-md)" }}>
                <strong style={{ color: "#166534" }}>{t.maintRequestClosed}</strong>
                {sel.wh_notes && <div style={{ marginTop: 4 }}><strong>{t.maintResolutionNotesLabel}</strong> {sel.wh_notes}</div>}
                {sel.completed_at && <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 4 }}>{t.maintClosedOn} {new Date(sel.completed_at).toLocaleString()}</div>}
              </div>
            )}
          </div>
        </Modal>
      )}

    </div>
  );
}