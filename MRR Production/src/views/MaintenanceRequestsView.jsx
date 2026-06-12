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
} from "../components/UIPrimitives"; // ✅ Added PhotoUpload import
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
    type: "Routine Oil Change",
    urgency: "standard",
    notes: "",
    photo: null, // ✅ NEW KEY TRACKER
  });

  const filtered = reqs.filter((r) => {
    if (filt === "all") return true;
    return r.status === filt;
  });

  const handleCreateRequest = async () => {
    if (!newTicket.vehicleId) {
      showToast("Please select a vehicle.", "error");
      return;
    }
    if (!newTicket.notes.trim()) {
      showToast("Please describe the issue or service requested.", "error");
      return;
    }

    const selectedVehicle = vehs.find(
      (v) =>
        v.id === newTicket.vehicleId ||
        String(v.id) === String(newTicket.vehicleId),
    );
    const vehicleName = selectedVehicle
      ? `${selectedVehicle.make} ${selectedVehicle.model} (${selectedVehicle.plates || "No Plate"})`
      : "Unknown Vehicle";

    const requestPayload = {
      vehicle_id: newTicket.vehicleId,
      vname: vehicleName,
      type: newTicket.type,
      urgency: newTicket.urgency,
      notes: newTicket.notes.trim(),
      photo: newTicket.photo || null, // ✅ MAP TO DATABASE OBJECT WRITER ROW
      uname: user.name || user.email,
      submitted_by: user.id,
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
      type: "Routine Oil Change",
      urgency: "standard",
      notes: "",
      photo: null,
    });
    setIsCreateOpen(false);
  };

  // ... Keep your existing updateStatus, uC, and sC code definitions identical ...

  return (
    <div>
      {/* ... Leave filters banner and summary table grid completely identical ... */}

      {/* ── 📸 SUBMIT MAINTENANCE MODAL PHOTO ATTACHMENT FIELD ── */}
      {isCreateOpen && (
        <Modal
          title="File Maintenance Request"
          onClose={() => setIsCreateOpen(false)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* ... Keep vehicle, type, urgency, and notes forms exactly as they are ... */}
            <Fld label="Select Fleet Vehicle">
              <Sel
                value={newTicket.vehicleId}
                onChange={(e) =>
                  setNewTicket({ ...newTicket, vehicleId: e.target.value })
                }
              >
                <option value="">-- Choose Vehicle --</option>
                {vehs.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.make} {v.model} ({v.plates || "No Plate"})
                  </option>
                ))}
              </Sel>
            </Fld>
            <Fld label="Issue Classification">
              <Sel
                value={newTicket.type}
                onChange={(e) =>
                  setNewTicket({ ...newTicket, type: e.target.value })
                }
              >
                <option value="Routine Oil Change">
                  🔄 Routine Oil Change
                </option>
                <option value="Brake System Service">
                  🛑 Brake System Service
                </option>
                <option value="Tire Repair / Replacement">
                  🛞 Tire Repair / Replacement
                </option>
                <option value="Engine / Powertrain Alert">
                  ⚠️ Engine / Powertrain Alert
                </option>
                <option value="Body Damage / Accident Report">
                  💥 Body Damage / Accident Report
                </option>
                <option value="Other / General Diagnostics">
                  📋 Other / General Diagnostics
                </option>
              </Sel>
            </Fld>
            <Fld label="Urgency Level">
              <Sel
                value={newTicket.urgency}
                onChange={(e) =>
                  setNewTicket({ ...newTicket, urgency: e.target.value })
                }
              >
                <option value="standard">
                  Standard Schedule (Next service interval)
                </option>
                <option value="soon">
                  Attention Needed Soon (Fix within 48-72 hrs)
                </option>
                <option value="urgent">
                  🚨 URGENT / SAFETY HAZARD (Ground vehicle immediately)
                </option>
              </Sel>
            </Fld>
            <Fld label="Reported Notes & Detailed Description">
              <TA
                placeholder="Describe exactly what is wrong..."
                value={newTicket.notes}
                onChange={(e) =>
                  setNewTicket({ ...newTicket, notes: e.target.value })
                }
              />
            </Fld>

            {/* ── 📸 ADD PHOTO CAPTURE COMPONENT TRIGGER ── */}
            <Fld label="Visual Evidence / Broken Equipment Reference Photo">
              <PhotoUpload
                value={newTicket.photo}
                onChange={(base64) =>
                  setNewTicket({ ...newTicket, photo: base64 })
                }
              />
            </Fld>

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Btn
                v="ghost"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Btn>
              <Btn
                v="primary"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={handleCreateRequest}
              >
                🚀 Submit Work Order
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── 📸 ADMINISTRATIVE REVIEW MODAL PHOTO VIEWER ── */}
      {sel && (
        <Modal
          title={`Review Request — ${sel.vname}`}
          onClose={() => {
            setSel(null);
            setForm({});
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              fontSize: 13,
            }}
          >
            <div>
              <strong>Submitted By:</strong> {sel.uname} on{" "}
              {new Date(sel.at).toLocaleDateString()}
            </div>
            <div>
              <strong>Issue Classification:</strong> {sel.type}
            </div>
            <div>
              <strong>Reported Notes / Description:</strong>
              <div
                style={{
                  background: C.lg,
                  padding: 12,
                  borderRadius: 8,
                  marginTop: 4,
                  fontStyle: "italic",
                }}
              >
                "{sel.notes}"
              </div>
            </div>

            {/* ── ⚡ NEW: CONDITIONAL ATTACHMENT IMAGE VIEWER LAYER ── */}
            {sel.photo && (
              <div style={{ marginTop: 4 }}>
                <strong
                  style={{ display: "block", marginBottom: 6, color: C.navy }}
                >
                  📸 Visual Evidence Attached:
                </strong>
                <img
                  src={sel.photo}
                  alt="Reported equipment damage"
                  style={{
                    width: "100%",
                    maxHeight: 280,
                    objectFit: "contain",
                    borderRadius: 10,
                    border: `1px solid ${C.bd}`,
                    background: C.lg,
                  }}
                />
              </div>
            )}

            {/* ... Leave existing status manipulation logic (Approve / Resolve buttons) unchanged beneath ... */}
            {sel.status === "pending" && perms.maint_manage && (
              <div
                style={{
                  borderTop: `1px solid ${C.bd}`,
                  paddingTop: 14,
                  marginTop: 6,
                }}
              >
                <h3
                  style={{ margin: "0 0 10px 0", fontSize: 14, color: C.navy }}
                >
                  Warehouse Management Actions
                </h3>
                <Fld label="Schedule Date (Optional)">
                  <Inp
                    type="date"
                    onChange={(e) =>
                      setForm({ ...form, scheduledDate: e.target.value })
                    }
                  />
                </Fld>
                <Fld label="Resolution / Scheduling Notes">
                  <TA
                    placeholder="e.g., Booked with auto shop for Tuesday..."
                    onChange={(e) =>
                      setForm({ ...form, whNotes: e.target.value })
                    }
                  />
                </Fld>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Btn
                    v="primary"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() =>
                      updateStatus(sel.id, "scheduled", form.whNotes)
                    }
                  >
                    🗓️ Approve & Schedule
                  </Btn>
                  <Btn
                    v="green"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() =>
                      updateStatus(sel.id, "completed", form.whNotes)
                    }
                  >
                    ✅ Resolve Instantly
                  </Btn>
                </div>
              </div>
            )}
            {sel.status === "scheduled" && perms.maint_manage && (
              <div
                style={{
                  borderTop: `1px solid ${C.bd}`,
                  paddingTop: 14,
                  marginTop: 6,
                }}
              >
                <h3
                  style={{ margin: "0 0 10px 0", fontSize: 14, color: C.navy }}
                >
                  Complete Service Logs
                </h3>
                {sel.whNotes && (
                  <div style={{ marginBottom: 10 }}>
                    <strong>Schedule Info:</strong> {sel.whNotes}
                  </div>
                )}
                <Fld label="Final Completion Notes">
                  <TA
                    placeholder="e.g., Oil changed..."
                    onChange={(e) =>
                      setForm({ ...form, whNotes: e.target.value })
                    }
                  />
                </Fld>
                <Btn
                  v="green"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() =>
                    updateStatus(sel.id, "completed", form.whNotes)
                  }
                >
                  🏁 Complete & Close Request
                </Btn>
              </div>
            )}
            {sel.status === "completed" && (
              <div
                style={{
                  borderTop: `1px solid ${C.bd}`,
                  paddingTop: 14,
                  marginTop: 6,
                  background: C.gL,
                  padding: 12,
                  borderRadius: 8,
                }}
              >
                <strong style={{ color: C.gr }}>✅ Request Closed</strong>
                {sel.whNotes && (
                  <div style={{ marginTop: 4 }}>
                    <strong>Resolution Notes:</strong> {sel.whNotes}
                  </div>
                )}
                {sel.completedAt && (
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>
                    Closed on: {new Date(sel.completedAt).toLocaleString()}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
