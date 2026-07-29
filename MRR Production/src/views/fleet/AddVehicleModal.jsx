// src/views/fleet/AddVehicleModal.jsx
//
// Register a truck or trailer onto the fleet roster.
//
// Extracted from FleetManagementView, where its three useState hooks and the
// insert handler sat among nineteen other hooks. The form state was never read
// outside this dialog.
//
// The parent no longer receives a setter. It is told what was created through
// onCreated, and decides for itself how to fold that into its list.
import { useState } from "react";
import { supabase } from "../../utils/supabase";
import { uid, todayLocal } from "../../utils/helpers";
import { Btn, Fld, Inp, Modal, Sel } from "../../components/UIPrimitives";
import { logAction } from "../../utils/logger";
import { useNotify } from "../../context/NotificationContext";

const BLANK = { name: "", type: "truck", yr: "", make: "", model: "", plate: "", mi: "", oii: "5000", dii: "90" };

// Turn the form strings into the row the fleet table expects. Pure, so the
// defaulting rules are checkable: a blank oil interval becomes 5000 rather than
// NaN, and starting mileage seeds lomi so the first oil change is not instantly
// overdue.
export const buildVehicle = (form) => {
  const startMi = parseFloat(form.mi) || 0;
  return {
    id: "v_" + uid(),
    name: (form.name || "").trim(),
    type: form.type,
    yr: parseInt(form.yr) || new Date().getFullYear(),
    make: (form.make || "").trim(),
    model: (form.model || "").trim(),
    plate: (form.plate || "").trim(),
    mi: startMi,
    // Seeded to the starting odometer, not zero. Otherwise oilSt() reads the
    // whole starting mileage as distance since the last oil change and flags a
    // brand-new vehicle as overdue.
    lomi: startMi,
    oii: parseFloat(form.oii) || 5000,
    dii: parseFloat(form.dii) || 90,
    ldd: todayLocal(),
    mil: [],
    sl: [],
    assignedTo: "",
    status: "active",
  };
};

export default function AddVehicleModal({ user, onCreated, onClose }) {
  const [form, setForm] = useState(BLANK);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useNotify();

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const close = () => { if (!submitting) onClose?.(); };

  const save = async () => {
    if (!form.name.trim() || !form.plate.trim()) {
      showToast("Please enter at least a name/nickname and license plate.", "warning");
      return;
    }
    setSubmitting(true);
    const vehicle = buildVehicle(form);
    try {
      const { error } = await supabase.from("vehicles").insert([vehicle]);
      if (error) throw error;

      onCreated?.(vehicle);

      await logAction(
        user.id,
        user.email,
        "FLEET_STATUS_CHANGE",
        `Registered new fleet asset: "${vehicle.name}" (${vehicle.yr} ${vehicle.make} ${vehicle.model}, Plate: ${vehicle.plate})`,
        { vehicle_id: vehicle.id },
        "fleet",
      );

      showToast("Vehicle added to the fleet roster.", "success");
      setForm(BLANK);
      onClose?.();
    } catch (err) {
      showToast(`Database Error: Could not add vehicle. ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="🚛 Register New Fleet Vehicle" onClose={close}>
      <Fld label="Name / Nickname *">
        <Inp value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Truck 013" disabled={submitting} />
      </Fld>
      <Fld label="Type">
        <Sel value={form.type} onChange={(e) => set({ type: e.target.value })} disabled={submitting}>
          <option value="truck">Truck</option>
          <option value="trailer">Trailer</option>
        </Sel>
      </Fld>
      <div className="sw-grid-3" style={{ gap: "var(--space-3)" }}>
        <Fld label="Year">
          <Inp type="number" value={form.yr} onChange={(e) => set({ yr: e.target.value })} disabled={submitting} />
        </Fld>
        <Fld label="Make">
          <Inp value={form.make} onChange={(e) => set({ make: e.target.value })} disabled={submitting} />
        </Fld>
        <Fld label="Model">
          <Inp value={form.model} onChange={(e) => set({ model: e.target.value })} disabled={submitting} />
        </Fld>
      </div>
      <Fld label="License Plate *">
        <Inp value={form.plate} onChange={(e) => set({ plate: e.target.value })} disabled={submitting} />
      </Fld>
      {form.type === "truck" && (
        <div className="sw-grid-2" style={{ gap: "var(--space-3)" }}>
          <Fld label="Starting Mileage">
            <Inp type="number" value={form.mi} onChange={(e) => set({ mi: e.target.value })} disabled={submitting} />
          </Fld>
          <Fld label="Oil Change Interval (mi)">
            <Inp type="number" value={form.oii} onChange={(e) => set({ oii: e.target.value })} disabled={submitting} />
          </Fld>
        </div>
      )}
      <Fld label="Detail Interval (days)">
        <Inp type="number" value={form.dii} onChange={(e) => set({ dii: e.target.value })} disabled={submitting} />
      </Fld>
      <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 8 }}>
        <Btn v="ghost" onClick={close} style={{ flex: 1, justifyContent: "center" }} disabled={submitting}>Cancel</Btn>
        <Btn v="primary" onClick={save} style={{ flex: 1, justifyContent: "center" }} disabled={submitting}>
          {submitting ? "⏳ Saving..." : "+ Add Vehicle"}
        </Btn>
      </div>
    </Modal>
  );
}
