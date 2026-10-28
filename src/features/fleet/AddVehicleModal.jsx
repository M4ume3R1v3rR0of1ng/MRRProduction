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
import { Truck, Loader2, Plus } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { uid, todayLocal } from "@/shared/utils/helpers";
import { Btn, Fld, Inp, Modal, Sel, Row, Grid } from "@/shared/components/UIPrimitives";
import { logAction } from "@/shared/utils/logger";
import { useNotify } from "@/shared/context/NotificationContext";
import { translations } from "@/shared/utils/translations";

const BLANK = {
  name: "",
  type: "truck",
  yr: "",
  make: "",
  model: "",
  plate: "",
  mi: "",
  oii: "5000",
  dii: "90",
};

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

export default function AddVehicleModal({ user, onCreated, onClose, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const [form, setForm] = useState(BLANK);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useNotify();

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const close = () => {
    if (!submitting) onClose?.();
  };

  const save = async () => {
    if (!form.name.trim() || !form.plate.trim()) {
      showToast(t.avMissingErr, "warning");
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

      showToast(t.avAddedOk, "success");
      setForm(BLANK);
      onClose?.();
    } catch (err) {
      showToast(`${t.avAddFail} ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <Row gap={3}>
          <Truck size={17} aria-hidden="true" /> {t.avTitle}
        </Row>
      }
      onClose={close}
    >
      <Fld label={t.avNameLabel}>
        <Inp
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={t.avNamePlaceholder}
          disabled={submitting}
        />
      </Fld>
      <Fld label={t.avTypeLabel}>
        <Sel
          value={form.type}
          onChange={(e) => set({ type: e.target.value })}
          disabled={submitting}
        >
          <option value="truck">{t.flTruck}</option>
          <option value="trailer">{t.flTrailer}</option>
        </Sel>
      </Fld>
      <Grid cols={3} gap={3}>
        <Fld label={t.flYear}>
          <Inp
            type="number"
            value={form.yr}
            onChange={(e) => set({ yr: e.target.value })}
            disabled={submitting}
          />
        </Fld>
        <Fld label={t.flMake}>
          <Inp
            value={form.make}
            onChange={(e) => set({ make: e.target.value })}
            disabled={submitting}
          />
        </Fld>
        <Fld label={t.flModel}>
          <Inp
            value={form.model}
            onChange={(e) => set({ model: e.target.value })}
            disabled={submitting}
          />
        </Fld>
      </Grid>
      <Fld label={t.avPlateLabel}>
        <Inp
          value={form.plate}
          onChange={(e) => set({ plate: e.target.value })}
          disabled={submitting}
        />
      </Fld>
      {form.type === "truck" && (
        <Grid gap={3}>
          <Fld label={t.avStartMileage}>
            <Inp
              type="number"
              value={form.mi}
              onChange={(e) => set({ mi: e.target.value })}
              disabled={submitting}
            />
          </Fld>
          <Fld label={t.avOilInterval}>
            <Inp
              type="number"
              value={form.oii}
              onChange={(e) => set({ oii: e.target.value })}
              disabled={submitting}
            />
          </Fld>
        </Grid>
      )}
      <Fld label={t.avDetailInterval}>
        <Inp
          type="number"
          value={form.dii}
          onChange={(e) => set({ dii: e.target.value })}
          disabled={submitting}
        />
      </Fld>
      <Row gap={4} style={{ marginTop: 8 }}>
        <Btn
          v="ghost"
          onClick={close}
          style={{ flex: 1, justifyContent: "center" }}
          disabled={submitting}
        >
          {t.cancel}
        </Btn>
        <Btn
          v="primary"
          onClick={save}
          style={{ flex: 1, justifyContent: "center" }}
          disabled={submitting}
        >
          {submitting ? (
            <>
              <Loader2
                size={14}
                style={{ animation: "mrr-spin 0.7s linear infinite" }}
                aria-hidden="true"
              />{" "}
              {t.avSaving}
            </>
          ) : (
            <>
              <Plus size={14} aria-hidden="true" /> {t.avSubmit}
            </>
          )}
        </Btn>
      </Row>
    </Modal>
  );
}
