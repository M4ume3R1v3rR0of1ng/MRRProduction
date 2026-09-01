// src/features/maintenance/CompleteServiceModal.jsx
//
// "Complete Service" — closes out a scheduled maintenance ticket in one step:
// what was done, what it cost, the odometer reading, and (optionally) who's
// driving the truck now that it's back. The actual write is a single RPC
// (public.complete_maintenance_service, see supabase/34) so a failure partway
// through can't log the service on the vehicle without also closing the
// ticket, or vice versa — see that file's header for why this isn't three
// separate client writes.
//
// This component only collects and validates the form. MaintenanceRequestsView
// owns the actual supabase.rpc() call, the audit log entry, and the requester
// notification — same division as MaintenanceRequestModal and InspectionModal.
import { useState } from "react";
import { C, todayLocal } from "@/utils/helpers";
import { Btn, Fld, Inp, Modal, Sel, TA } from "@/components/UIPrimitives";
import { useNotify } from "@/context/NotificationContext";

const SERVICE_TYPES = [
  "Oil Change",
  "Tire Rotation",
  "Brake Service",
  "AC / Heat Repair",
  "Electrical Repair",
  "Engine Repair",
  "Detail",
  "Inspection",
  "General Repair",
  "Other",
];

// The ticket's filed `type` is a comma-joined free list of what was reported
// (e.g. "Brake Service, Electrical Issue"); the completed service is one of
// them. Guess the first that matches a known service type, so the field
// starts on something plausible instead of blank.
export const guessServiceType = (reqType) => {
  const first = (reqType || "").split(",")[0]?.trim();
  return SERVICE_TYPES.includes(first) ? first : "";
};

export default function CompleteServiceModal({ req, vehs = [], users = [], user, onSubmit, onClose }) {
  const veh = vehs.find((v) => v.id === req.vid);
  const currentDriver = veh?.assignedTo ? users.find((u) => u.id === veh.assignedTo) : null;
  const { showToast } = useNotify();

  const [form, setForm] = useState({
    serviceType: guessServiceType(req.type),
    serviceDate: todayLocal(),
    performedBy: user?.name || user?.email || "",
    mileage: "",
    cost: "",
    notes: "",
    // "unchanged" leaves whatever the swap-revert trigger decides; "clear" and
    // a user id are explicit human choices that override it.
    driverChoice: "unchanged",
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const missing = [];
    if (!form.serviceType) missing.push("service type");
    if (!form.serviceDate) missing.push("service date");
    if (!form.performedBy.trim()) missing.push("performed by");
    if (missing.length) {
      showToast(`Please fill in: ${missing.join(", ")}.`, "warning");
      return;
    }
    if (form.mileage && veh && parseFloat(form.mileage) < (parseFloat(veh.mi) || 0)) {
      showToast(`Odometer can't be behind the vehicle's last logged mileage (${(veh.mi || 0).toLocaleString()}).`, "warning");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        serviceType: form.serviceType,
        serviceDate: form.serviceDate,
        performedBy: form.performedBy.trim(),
        mileage: form.mileage ? parseFloat(form.mileage) : null,
        cost: form.cost ? parseFloat(form.cost) : 0,
        notes: form.notes.trim(),
        // undefined = don't send the arg at all = RPC default (no change)
        reassignDriverId:
          form.driverChoice === "unchanged" ? undefined
          : form.driverChoice === "clear" ? ""
          : form.driverChoice,
      });
      onClose();
    } catch (err) {
      showToast(`Failed to complete service: ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`✅ Complete Service — ${req.vname}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {req.wh_notes && (
          <div style={{ background: C.lg, padding: 10, borderRadius: "var(--radius-md)", fontSize: "var(--text-sm)" }}>
            <strong>Scheduling notes:</strong> {req.wh_notes}
          </div>
        )}
        {req.replacement_vehicle_id && (
          <div
            style={{
              background: C.pB,
              border: `1.5px solid ${C.pu}`,
              borderRadius: "var(--radius-md)",
              padding: "10px 14px",
              fontSize: "var(--text-sm)",
              color: C.pu,
              fontWeight: "var(--weight-semibold)",
            }}
          >
            A spare was lent while this truck was in for service. Completing it returns the
            original driver automatically — pick a driver below only if that's not what you want.
          </div>
        )}

        <div className="sw-grid-2" style={{ gap: "var(--space-4)" }}>
          <Fld label="Service Performed *">
            <Sel value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })}>
              <option value="">— Select —</option>
              {SERVICE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Sel>
          </Fld>
          <Fld label="Service Date *">
            <Inp type="date" value={form.serviceDate} onChange={(e) => setForm({ ...form, serviceDate: e.target.value })} />
          </Fld>
        </div>

        <div className="sw-grid-2" style={{ gap: "var(--space-4)" }}>
          <Fld label="Performed By *">
            <Inp value={form.performedBy} onChange={(e) => setForm({ ...form, performedBy: e.target.value })} placeholder="Shop or technician name" />
          </Fld>
          <Fld label="Cost" hint="Optional">
            <Inp type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="0.00" />
          </Fld>
        </div>

        {veh && veh.type === "truck" && (
          <Fld label="Odometer at Completion" hint={`Optional — last logged: ${(veh.mi || 0).toLocaleString()} mi`}>
            <Inp type="number" value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })} placeholder={String(veh.mi || "")} />
          </Fld>
        )}

        <Fld label="Resolution Notes" hint="What was found and fixed — this replaces the ticket's scheduling notes.">
          <TA value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Replaced front brake pads, bled lines..." />
        </Fld>

        <Fld
          label="Driver"
          hint={
            currentDriver
              ? `Currently assigned: ${currentDriver.name || currentDriver.email}`
              : "No driver currently assigned"
          }
        >
          <Sel value={form.driverChoice} onChange={(e) => setForm({ ...form, driverChoice: e.target.value })}>
            <option value="unchanged">— No change —</option>
            <option value="clear">Remove driver</option>
            {users.filter((u) => u.active !== false).map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </Sel>
        </Fld>

        <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 4 }}>
          <Btn v="ghost" onClick={onClose} style={{ flex: 1, justifyContent: "center" }} disabled={submitting}>
            Cancel
          </Btn>
          <Btn v="green" onClick={submit} style={{ flex: 1, justifyContent: "center" }} disabled={submitting}>
            {submitting ? "Completing…" : "Complete Service ✅"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
