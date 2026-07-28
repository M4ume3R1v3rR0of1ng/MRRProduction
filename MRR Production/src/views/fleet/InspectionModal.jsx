// src/views/fleet/InspectionModal.jsx
//
// File a condition and inspection report against a vehicle, with photos.
// Writes to vehicle_inspections; Reports reads them back.
//
// Extracted from FleetManagementView along with its three useState hooks and the
// insert handler. Nothing outside this dialog touched that state.
import { useState } from "react";
import { supabase } from "../../utils/supabase";
import { Btn, Fld, Modal, PhotoUpload, Sel, TA } from "../../components/UIPrimitives";
import { logAction } from "../../utils/logger";
import { useNotify } from "../../context/NotificationContext";

const BLANK = { vehicleId: "", notes: "", photos: [] };

// How a vehicle is named on the record. Resolved by string comparison because
// the select yields a string id while the vehicle row may carry a number.
export const vehicleLabel = (vehs, vehicleId) => {
  const v = (vehs || []).find((x) => String(x.id) === String(vehicleId));
  return v ? `${v.name} (${v.plate})` : "Unknown Fleet Asset";
};

export default function InspectionModal({ vehs = [], user, onClose }) {
  const [form, setForm] = useState(BLANK);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useNotify();

  const submit = async () => {
    if (!form.vehicleId) {
      showToast("Please select a vehicle asset for inspection logging.", "error");
      return;
    }
    setSubmitting(true);
    const label = vehicleLabel(vehs, form.vehicleId);
    try {
      const { error } = await supabase.from("vehicle_inspections").insert([
        {
          vehicle_id: form.vehicleId,
          vehicle_name: label,
          inspector_name: user.name || user.email,
          inspector_id: user.id,
          notes: form.notes.trim(),
          photos: form.photos,
          created_at: new Date().toISOString(),
        },
      ]);
      if (error) throw error;

      await logAction(
        user.id,
        user.email,
        "FLEET_MAINTENANCE",
        `Logged a formal condition inspection report for vehicle asset: ${label}`,
        { vehicle_id: form.vehicleId, attached_photos_count: form.photos.length },
        "fleet",
      );

      showToast("Inspection records and photos committed successfully!", "success");
      setForm(BLANK);
      onClose?.();
    } catch (err) {
      showToast(`Database Transaction Blocked: ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="📋 File Vehicle Condition & Inspection Report" onClose={() => { if (!submitting) onClose?.(); }} wide>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <Fld label="Select Fleet Vehicle *">
          <Sel
            value={form.vehicleId}
            onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
            disabled={submitting}
          >
            <option value="">-- Choose Fleet Vehicle --</option>
            {vehs.map((v) => (
              <option key={v.id} value={v.id}>{v.name} — {v.yr} {v.make} ({v.plate})</option>
            ))}
          </Sel>
        </Fld>

        <Fld label="Inspection Assessments & Condition Notes">
          <TA
            placeholder="Log structural inspection results, provider diagnostics or general notes..."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            disabled={submitting}
          />
        </Fld>

        <Fld label="Upload Inspection Pictures / Condition Evidence">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <PhotoUpload
              current={null}
              onUpload={(base64) => setForm((prev) => ({ ...prev, photos: [...prev.photos, base64] }))}
              maxDim={800}
              quality={0.8}
            />
            {form.photos.length > 0 && (
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: 8 }}>
                {form.photos.map((img, idx) => (
                  <div key={idx} style={{ position: "relative", width: 70, height: 70, borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                    <img src={img} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button
                      onClick={() => setForm((prev) => ({ ...prev, photos: prev.photos.filter((_, i) => i !== idx) }))}
                      style={{ position: "absolute", top: 2, right: 2, background: "rgba(15,23,42,0.8)", color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, cursor: "pointer", fontSize: 10, lineHeight: 1 }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Fld>

        <div style={{ display: "flex", gap: "var(--space-3)", marginTop: 12 }}>
          <Btn v="ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn v="gold" style={{ flex: 1, justifyContent: "center" }} onClick={submit} disabled={submitting}>
            {submitting ? "⏳ Saving Log Entry..." : "💾 Commit Inspection Log"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
