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
import { Wrench, Bell } from "lucide-react";
import { C } from "@/shared/utils/helpers";
import {
  Btn,
  Fld,
  Inp,
  Modal,
  Sel,
  TA,
  Card,
  Row,
  Callout,
  Grid,
} from "@/shared/components/UIPrimitives";
import { useNotify } from "@/shared/context/NotificationContext";
import { translations } from "@/shared/utils/translations";

// The service types a request can carry. These English strings are the stored
// VALUE: they go into the database, show up in the Maintenance queue and get
// printed on the completion PDF, so they are deliberately NOT translated.
// serviceLabel below translates only what the person filing the request reads,
// which is the same split 94fc565 drew for a note typed in the cab.
const TRUCK_SERVICES = [
  "Oil Change",
  "Tire Rotation",
  "Brake Service",
  "AC / Heat Issue",
  "Electrical Issue",
  "Engine Issue",
  "Repair",
  "Inspection",
  "Other",
];
const TRAILER_SERVICES = [
  "Tire Check",
  "Brake Check",
  "Lighting Issue",
  "Hitch / Coupler Issue",
  "Repair",
  "Inspection",
  "Other",
];

export default function MaintenanceRequestModal({
  vehs = [],
  user,
  onSave,
  onClose,
  preVid,
  lang = "en",
}) {
  const t = translations[lang] || translations.en;
  const [form, setForm] = useState({
    vid: preVid || "",
    type: [],
    urgency: "normal",
    notes: "",
    mileage: "",
  });
  const selV = vehs.find((v) => v.id === form.vid);
  // Spelled out rather than looked up as t[key], so every key stays greppable.
  const serviceLabel = (svc) =>
    ({
      "Oil Change": t.svcOilChange,
      "Tire Rotation": t.svcTireRotation,
      "Brake Service": t.svcBrakeService,
      "AC / Heat Issue": t.svcACHeat,
      "Electrical Issue": t.svcElectrical,
      "Engine Issue": t.svcEngine,
      "Tire Check": t.svcTireCheck,
      "Brake Check": t.svcBrakeCheck,
      "Lighting Issue": t.svcLighting,
      "Hitch / Coupler Issue": t.svcHitchCoupler,
      Repair: t.svcRepair,
      Inspection: t.svcInspection,
      Other: t.svcOther,
    })[svc] || svc;
  const { showToast } = useNotify();

  const submit = () => {
    if (!form.vid || !Array.isArray(form.type) || form.type.length === 0 || !form.notes.trim()) {
      showToast(t.mrIncompleteErr, "info");
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
    <Modal
      title={
        <Row gap={3}>
          <Wrench size={17} aria-hidden="true" /> {t.mrTitle}
        </Row>
      }
      onClose={onClose}
    >
      <Card
        variant="flat"
        pad="none"
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
        {t.mrQueueNote}
      </Card>
      <Fld label={t.mrVehicleLabel}>
        <Sel
          value={form.vid}
          onChange={
            (e) => setForm({ ...form, vid: e.target.value, type: [] }) // Flushes checkbox state on toggle
          }
        >
          <option value="">{t.mrSelectVehicle}</option>
          {vehs.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} — {v.yr} {v.make} {v.model} ({v.plate})
            </option>
          ))}
        </Sel>
      </Fld>
      {selV && (
        <>
          {/* ── MULTI-SELECT CHECKBOX GRID INTERACTION LAYER ── */}
          <Fld label={t.mrServiceTypes}>
            <Callout as={Grid} bordered pad={5} gap={4}>
              {(selV.type === "truck" ? TRUCK_SERVICES : TRAILER_SERVICES).map((svc) => {
                const isChecked = Array.isArray(form.type) && form.type.includes(svc);
                return (
                  <Row
                    as="label"
                    key={svc}
                    gap={3}
                    style={{
                      fontSize: "var(--text-base)",
                      fontWeight: "var(--weight-semibold)",
                      color: C.navy,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      style={{ accentColor: C.pu, transform: "scale(1.1)", cursor: "pointer" }}
                      onChange={() => {
                        const currentTypes = Array.isArray(form.type) ? form.type : [];
                        const nextTypes = isChecked
                          ? currentTypes.filter((item) => item !== svc)
                          : [...currentTypes, svc];
                        setForm({ ...form, type: nextTypes });
                      }}
                    />
                    {serviceLabel(svc)}
                  </Row>
                );
              })}
            </Callout>
          </Fld>

          <Fld label={t.osUrgency}>
            <Sel
              value={form.urgency}
              onChange={(e) => setForm({ ...form, urgency: e.target.value })}
            >
              <option value="normal">{t.mrUrgNormal}</option>
              <option value="soon">{t.mrUrgSoon}</option>
              <option value="urgent">{t.mrUrgUrgent}</option>
            </Sel>
          </Fld>
          {selV.type === "truck" && (
            <Fld label={t.mrMileageLabel}>
              <Inp
                type="number"
                value={form.mileage}
                onChange={(e) => setForm({ ...form, mileage: e.target.value })}
              />
            </Fld>
          )}
          <Fld label={t.mrNotesLabel} hint={t.mrNotesHint}>
            <TA
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={t.mrNotesPlaceholder}
            />
          </Fld>
        </>
      )}
      <Row gap={4}>
        <Btn v="ghost" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>
          {t.cancel}
        </Btn>
        <Btn v="purple" onClick={submit} style={{ flex: 1, justifyContent: "center" }}>
          {t.mrSubmit} <Bell size={14} aria-hidden="true" />
        </Btn>
      </Row>
    </Modal>
  );
}
