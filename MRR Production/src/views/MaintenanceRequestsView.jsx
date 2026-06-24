// src/views/MaintenanceRequestsView.jsx
import { useState } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
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

export default function MaintenanceRequestsView({
  reqs,
  setReqs,
  vehs,
  users,
  user,
  perms,
}) {
  const { showToast } = useNotify();

  const [filt, setFilt] = useState("all");
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState({});

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTicket, setNewTicket] = useState({
    vehicleId: "",
    type: [], // 🟢 FIXED: Changed to an array to handle multiple option checkboxes
    urgency: "standard",
    notes: "",
    photo: null,
  });

  const filtered = reqs.filter((r) => {
    if (filt === "all") return true;
    if (filt === "active") return r.status === "pending" || r.status === "scheduled";
    return r.status === filt;
  });

  const handleCreateRequest = async () => {
    if (!newTicket.vehicleId) {
      showToast("Please select a vehicle.", "error");
      return;
    }
    // 🟢 FIXED: Check array selection count instead of a blank string
    if (!Array.isArray(newTicket.type) || newTicket.type.length === 0) {
      showToast("Please select at least one issue or classification checkbox.", "error");
      return;
    }
    if (!newTicket.notes.trim()) {
      showToast("Please describe the issue or service requested.", "error");
      return;
    }

    const selectedVehicle = vehs.find(
      (v) => v.id === newTicket.vehicleId || String(v.id) === String(newTicket.vehicleId),
    );
    const vehicleName = selectedVehicle
      ? `${selectedVehicle.make} ${selectedVehicle.model} (${selectedVehicle.plates || "No Plate"})`
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
      showToast("Failed to submit request: " + error.message, "error");
      return;
    }

    const createdRecord = data && data[0] ? data[0] : requestPayload;
    setReqs((prev) => [createdRecord, ...prev]);
    showToast("Maintenance request filed successfully!", "success");

    setNewTicket({
      vehicleId: "",
      type: [], // 🟢 FIXED: Flushes checkbox state on clear
      urgency: "standard",
      notes: "",
      photo: null,
    });
    setIsCreateOpen(false);
  };

  const updateStatus = async (id, status, whNotes = "") => {
    const scheduledDate = form.scheduledDate || "";
    const completedAt = status === "completed" ? new Date().toISOString() : "";

    const { error } = await supabase
      .from("maintenance_requests")
      .update({
        status,
        wh_notes: whNotes,
        scheduled_date: scheduledDate,
        completed_at: completedAt,
      })
      .eq("id", id);

    if (error) {
      showToast("Error updating request: " + error.message, "error");
      return;
    }

    setReqs((p) =>
      p.map((r) =>
        r.id === id ? { ...r, status, wh_notes: whNotes, scheduled_date: scheduledDate, completed_at: completedAt } : r,
      ),
    );
    setSel(null);
    setForm({});
    showToast(`Ticket status successfully updated to ${status}!`, "success");
  };

  const handleDeleteRequest = async (id) => {
    if (!window.confirm("Are you absolutely sure you want to permanently delete this maintenance request? This action cannot be undone.")) {
      return;
    }

    const { error } = await supabase
      .from("maintenance_requests")
      .delete()
      .eq("id", id);

    if (error) {
      showToast("Failed to delete request: " + error.message, "error");
      return;
    }

    setReqs((p) => p.filter((r) => r.id !== id));
    setSel(null);
    setForm({});
    showToast("Maintenance request deleted successfully.", "success");
  };

  const pendingCount = reqs.filter((r) => r.status === "pending").length;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      
      {/* Header Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#1e3a8a", display: "flex", alignItems: "center", gap: 8 }}>
            🔧 Maintenance Requests
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {pendingCount > 0 && (
            <div style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fee2e2", padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              🔔 {pendingCount} awaiting scheduling
            </div>
          )}
          <Btn v="primary" sz="sm" onClick={() => setIsCreateOpen(true)} style={{ fontWeight: 800 }}>
            ➕ New Request
          </Btn>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "#f1f5f9", padding: 4, borderRadius: 8, width: "fit-content" }}>
        {[
          ["all", "All"],
          ["active", "Active"],
          ["pending", "Pending"],
          ["scheduled", "Scheduled"],
          ["completed", "Completed"]
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilt(key)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 12,
              fontWeight: 700,
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

      {/* Cards Stream Canvas */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.length === 0 ? (
          <div style={{ background: "#fff", padding: 32, borderRadius: 12, textAlign: "center", color: "#64748b", border: "1px solid #e2e8f0" }}>
            No maintenance requests found matching this filter.
          </div>
        ) : (
          filtered.map((r) => {
            const isUrgent = r.urgency === "urgent";
            return (
              <div
                key={r.id}
                style={{
                  background: isUrgent ? "#fff5f5" : "#fff",
                  borderRadius: 12,
                  padding: 16,
                  border: isUrgent ? "1px solid #fecaca" : "1px solid #e2e8f0",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap"
                }}
              >
                {/* Left Side Metadata Info */}
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
                    <Bdg color={r.status === "pending" ? "amber" : r.status === "scheduled" ? "blue" : "green"}>
                      {r.status}
                    </Bdg>
                    {isUrgent && <Bdg color="red">🚨 URGENT</Bdg>}
                    <Bdg color="gray">{r.type}</Bdg>
                  </div>
                  <h3 style={{ margin: "0 0 4px 0", fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                    {r.vname}
                  </h3>
                  <p style={{ margin: "0 0 6px 0", fontSize: 13, color: "#475569", lineHeight: 1.4 }}>
                    {r.notes}
                  </p>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    By {r.uname} • {r.at ? new Date(r.at).toLocaleDateString() : "Recent"}
                    {r.scheduled_date && (
                      <span style={{ marginLeft: 8, color: "#2563eb", fontWeight: 700 }}>
                        🗓️ Scheduled: {new Date(r.scheduled_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right Actions Block */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {r.status === "pending" && perms.maint_manage && (
                    <Btn v="primary" sz="sm" onClick={() => setSel(r)}>
                      🗓️ Schedule
                    </Btn>
                  )}
                  {r.status === "scheduled" && perms.maint_manage && (
                    <Btn v="green" sz="sm" onClick={() => setSel(r)}>
                      ✅ Complete
                    </Btn>
                  )}
                  <Btn v="ghost" sz="sm" onClick={() => setSel(r)}>
                    Review →
                  </Btn>
                  
                  {/* Quick-Trash Shortcut for Admin Roles */}
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
                        fontSize: 16,
                        padding: "4px 8px",
                        display: "flex",
                        alignItems: "center"
                      }}
                      title="Permanently remove request"
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

      {/* Create Modal Form Layout */}
      {isCreateOpen && (
        <Modal title="File Maintenance Request" onClose={() => setIsCreateOpen(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Fld label="Select Fleet Vehicle">
              <Sel value={newTicket.vehicleId} onChange={(e) => setNewTicket({ ...newTicket, vehicleId: e.target.value })}>
                <option value="">-- Choose Vehicle --</option>
                {vehs.map((v) => (
                  <option key={v.id} value={v.id}>{v.make} {v.model} ({v.plates || "No Plate"})</option>
                ))}
              </Sel>
            </Fld>

            {/* ── 🟢 FIXED: DROPDOWN CONVERTED TO A MULTI-SELECT CHECKBOX GRID ── */}
            <Fld label="Issue Classification (Select all that apply) *">
              <div style={{ 
                display: "grid", 
                gridTemplateColumns: "1fr 1fr", 
                gap: "10px", 
                background: "#f8fafc", 
                padding: 12, 
                borderRadius: 8,
                border: "1px solid #e2e8f0" 
              }}>
                {[
                  "Routine Oil Change",
                  "Brake System Service",
                  "Tire Repair / Replacement",
                  "Engine / Powertrain Alert",
                  "Body Damage / Accident Report",
                  "Other / General Diagnostics"
                ].map((t) => {
                  const isChecked = Array.isArray(newTicket.type) && newTicket.type.includes(t);
                  return (
                    <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        style={{ transform: "scale(1.1)", cursor: "pointer" }}
                        onChange={() => {
                          const currentTypes = Array.isArray(newTicket.type) ? newTicket.type : [];
                          const nextTypes = isChecked 
                            ? currentTypes.filter(item => item !== t) 
                            : [...currentTypes, t];
                          setNewTicket({ ...newTicket, type: nextTypes });
                        }}
                      />
                      {t.replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g, '')}
                    </label>
                  );
                })}
              </div>
            </Fld>

            <Fld label="Urgency Level">
              <Sel value={newTicket.urgency} onChange={(e) => setNewTicket({ ...newTicket, urgency: e.target.value })}>
                <option value="standard">Standard Schedule (Next service interval)</option>
                <option value="soon">Attention Needed Soon (Fix within 48-72 hrs)</option>
                <option value="urgent">🚨 URGENT / SAFETY HAZARD (Ground vehicle immediately)</option>
              </Sel>
            </Fld>
            <Fld label="Reported Notes & Detailed Description*">
              <TA placeholder="Describe exactly what is wrong..." value={newTicket.notes} onChange={(e) => setNewTicket({ ...newTicket, notes: e.target.value })} />
            </Fld>

            {/* ── 🟢 FIXED: PROP MAP CORRECTED FROM value/onChange TO current/onUpload ── */}
            <Fld label="Visual Evidence / Broken Equipment Reference Photo*">
              <PhotoUpload 
                current={newTicket.photo} 
                onUpload={(base64) => setNewTicket({ ...newTicket, photo: base64 })} 
                maxDim={600}
                quality={0.75}
                previewHeight={140}
              />
            </Fld>
            
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Btn v="ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setIsCreateOpen(false)}>Cancel</Btn>
              <Btn v="primary" style={{ flex: 1, justifyContent: "center" }} onClick={handleCreateRequest}>🚀 Submit Work Order</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Review & Management Modal Panel */}
      {sel && (
        <Modal title={`Review Request — ${sel.vname}`} onClose={() => { setSel(null); setForm({}); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><strong>Submitted By:</strong> {sel.uname} on {new Date(sel.at).toLocaleDateString()}</div>
              {perms.maint_manage && (
                <button
                  onClick={() => handleDeleteRequest(sel.id)}
                  style={{
                    background: "#fef2f2",
                    color: "#b91c1c",
                    border: "1px solid #fee2e2",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  💥 Delete Request
                </button>
              )}
            </div>
            <div><strong>Issue Classification:</strong> {sel.type}</div>
            <div>
              <strong>Reported Notes / Description:</strong>
              <div style={{ background: C.lg, padding: 12, borderRadius: 8, marginTop: 4, fontStyle: "italic" }}>
                "{sel.notes}"
              </div>
            </div>

            {sel.photo && (
              <div style={{ marginTop: 4 }}>
                <strong style={{ display: "block", marginBottom: 6, color: C.navy }}>📸 Visual Evidence Attached:</strong>
                <img src={sel.photo} alt="Reported equipment damage" style={{ width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 10, border: `1px solid ${C.bd}`, background: C.lg }} />
              </div>
            )}

            {sel.status === "pending" && perms.maint_manage && (
              <div style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6 }}>
                <h3 style={{ margin: "0 0 10px 0", fontSize: 14, color: C.navy }}>Warehouse Management Actions</h3>
                <Fld label="Schedule Date">
                  <Inp type="date" onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
                </Fld>
                <Fld label="Resolution / Scheduling Notes">
                  <TA placeholder="e.g., Booked with auto shop for Tuesday..." onChange={(e) => setForm({ ...form, whNotes: e.target.value })} />
                </Fld>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Btn v="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => updateStatus(sel.id, "scheduled", form.whNotes)}>🗓️ Approve & Schedule</Btn>
                  <Btn v="green" style={{ flex: 1, justifyContent: "center" }} onClick={() => updateStatus(sel.id, "completed", form.whNotes)}>✅ Resolve Instantly</Btn>
                </div>
              </div>
            )}

            {sel.status === "scheduled" && perms.maint_manage && (
              <div style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6 }}>
                <h3 style={{ margin: "0 0 10px 0", fontSize: 14, color: C.navy }}>Complete Service Logs</h3>
                {sel.wh_notes && <div style={{ marginBottom: 10 }}><strong>Schedule Info:</strong> {sel.wh_notes}</div>}
                <Fld label="Final Completion Notes">
                  <TA placeholder="e.g., Service resolved..." onChange={(e) => setForm({ ...form, whNotes: e.target.value })} />
                </Fld>
                <Btn v="green" style={{ width: "100%", justifyContent: "center" }} onClick={() => updateStatus(sel.id, "completed", form.whNotes)}>🏁 Complete & Close Request</Btn>
              </div>
            )}

            {sel.status === "completed" && (
              <div style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6, background: "#f0fdf4", padding: 12, borderRadius: 8 }}>
                <strong style={{ color: "#166534" }}>✅ Request Closed</strong>
                {sel.wh_notes && <div style={{ marginTop: 4 }}><strong>Resolution Notes:</strong> {sel.wh_notes}</div>}
                {sel.completed_at && <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>Closed on: {new Date(sel.completed_at).toLocaleString()}</div>}
              </div>
            )}
          </div>
        </Modal>
      )}

    </div>
  );
}