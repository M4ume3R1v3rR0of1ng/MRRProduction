// src/views/fleet/MaintenanceRequestModal.jsx
//
// "Something is wrong with this truck." Filed from the yard or the cab, it lands
// in the Maintenance queue as a pending request.
//
// This was already a standalone component; it just happened to live at the top of
// FleetManagementView.jsx, which made that file read as 1,682 lines when a third
// of it was really a separate dialog. Moving it out changes no behavior.
//
// Two things were cleaned up on the way:
//   - a `handleApproveMaintenance` helper that was declared here and never
//     called from anywhere. Approval happens in the Maintenance view, not here.
//   - an unused `uid` prop. The id below is generated inline and always was.
import { useState } from "react";
import { C } from "../../utils/helpers";
import { Btn, Fld, Inp, Modal, Sel, TA } from "../../components/UIPrimitives";
import { useNotify } from "../../context/NotificationContext";

export default function MaintenanceRequestModal({ vehs = [], user, onSave, onClose, preVid }) {
  const [form, setForm] = useState({
    vid: preVid || "",
    type: [], 
    urgency: "normal",
    notes: "",
    mileage: "",
  });
  const selV = vehs.find((v) => v.id === form.vid);
  const { showToast } = useNotify();
  
  const submit = () => {
    if (!form.vid || !Array.isArray(form.type) || form.type.length === 0 || !form.notes.trim()) {
      showToast("Please select a vehicle, at least one service type, and describe the issue.", "info");
      return;
    }
    const v = vehs.find((x) => x.id === form.vid);
    onSave({
      id: Math.random().toString(36).slice(2, 10),
      vid: form.vid,
      vname: `${v.name} (${v.plate})`,
      vtype: v.type,
      type: form.type.join(", "), 
      urgency: form.urgency,
      notes: form.notes,
      mileage: form.mileage,
      uid: user.id,
      uname: user.name,
      at: new Date().toISOString(),
      status: "pending",
      scheduledDate: "",
      completedAt: "",
      whNotes: "",
    });
    onClose();
  };


  return (
    <Modal title="🔧 Submit Maintenance Request" onClose={onClose}>
      <div
        style={{
          background: C.pB,
          border: `1.5px solid ${C.pu}`,
          borderRadius: "var(--radius-md)",
          padding: "10px 14px",
          marginBottom: 14,
          fontSize: "var(--text-sm)",
          color: C.pu,
          fontWeight: "var(--weight-semibold)",
        }}
      >
        Your request will be sent to the Warehouse Manager for scheduling.
      </div>
      <Fld label="Vehicle *">
        <Sel
          value={form.vid}
          onChange={(e) =>
            setForm({ ...form, vid: e.target.value, type: [] }) // 🟢 FIXED: Flushes checkbox state on toggle
          }
        >
          <option value="">— Select a vehicle —</option>
          {vehs.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} — {v.yr} {v.make} {v.model} ({v.plate})
            </option>
          ))}
        </Sel>
      </Fld>
      {selV && (
        <>
          {/* ── 🟢 FIXED: MULTI-SELECT CHECKBOX GRID INTERACTION LAYER ── */}
          <Fld label="Service Types (Select all that apply) *">
            <div className="sw-grid-2" style={{ 
              gap: "10px", 
              background: "var(--c-subtle)", 
              padding: 12, 
              borderRadius: "var(--radius-md)",
              border: `1px solid ${C.bd || "var(--c-line)"}` 
            }}>
              {(selV.type === "truck"
                ? [
                    "Oil Change",
                    "Tire Rotation",
                    "Brake Service",
                    "AC / Heat Issue",
                    "Electrical Issue",
                    "Engine Issue",
                    "Repair",
                    "Inspection",
                    "Other",
                  ]
                : [
                    "Tire Check",
                    "Brake Check",
                    "Lighting Issue",
                    "Hitch / Coupler Issue",
                    "Repair",
                    "Inspection",
                    "Other",
                  ]
              ).map((t) => {
                const isChecked = Array.isArray(form.type) && form.type.includes(t);
                return (
                  <label key={t} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color: C.navy, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      style={{ accentColor: C.pu, transform: "scale(1.1)", cursor: "pointer" }}
                      onChange={() => {
                        const currentTypes = Array.isArray(form.type) ? form.type : [];
                        const nextTypes = isChecked 
                          ? currentTypes.filter(item => item !== t) 
                          : [...currentTypes, t];
                        setForm({ ...form, type: nextTypes });
                      }}
                    />
                    {t}
                  </label>
                );
              })}
            </div>
          </Fld>
          
          <Fld label="Urgency">
            <Sel
              value={form.urgency}
              onChange={(e) => setForm({ ...form, urgency: e.target.value })}
            >
              <option value="normal">Normal — Schedule when possible</option>
              <option value="soon">Soon — Within the next few days</option>
              <option value="urgent">
                Urgent — Safety concern / vehicle down
              </option>
            </Sel>
          </Fld>
          {selV.type === "truck" && (
            <Fld label="Current Mileage (optional)">
              <Inp
                type="number"
                value={form.mileage}
                onChange={(e) => setForm({ ...form, mileage: e.target.value })}
              />
            </Fld>
          )}
          <Fld
            label="Description / Notes *"
            hint="Be specific — what you hear, feel, or see."
          >
            <TA
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. Brakes grinding when stopping..."
            />
          </Fld>
        </>
      )}
      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <Btn
          v="ghost"
          onClick={onClose}
          style={{ flex: 1, justifyContent: "center" }}
        >
          Cancel
        </Btn>
        <Btn
          v="purple"
          onClick={submit}
          style={{ flex: 1, justifyContent: "center" }}
        >
          Submit Request 🔔
        </Btn>
      </div>
    </Modal>
  );
}
