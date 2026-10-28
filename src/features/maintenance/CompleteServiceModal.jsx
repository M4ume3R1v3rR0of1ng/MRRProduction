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
import { CheckCircle2 } from "lucide-react";
import { C, todayLocal } from "@/shared/utils/helpers";
import {
  Btn,
  Fld,
  Inp,
  Modal,
  Sel,
  TA,
  Card,
  Row,
  Stack,
  Grid,
} from "@/shared/components/UIPrimitives";
import { useNotify } from "@/shared/context/NotificationContext";
import { translations } from "@/shared/utils/translations";

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

export default function CompleteServiceModal({
  req,
  vehs = [],
  users = [],
  user,
  onSubmit,
  onClose,
  lang = "en",
}) {
  const t = translations[lang] || translations.en;
  // Stored value -> label, the same split MaintenanceRequestModal draws: the
  // English string goes to the service log, only the option text translates.
  const serviceLabel = (svc) =>
    ({
      "Oil Change": t.svcOilChange,
      "Tire Rotation": t.svcTireRotation,
      "Brake Service": t.svcBrakeService,
      "AC / Heat Repair": t.svcACHeatRepair,
      "Electrical Repair": t.svcElectricalRepair,
      "Engine Repair": t.svcEngineRepair,
      "General Repair": t.svcGeneralRepair,
      Detail: t.svcDetail,
      Inspection: t.svcInspection,
      Other: t.svcOther,
    })[svc] || svc;
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
    if (!form.serviceType) missing.push(t.csFieldServiceType);
    if (!form.serviceDate) missing.push(t.csFieldServiceDate);
    if (!form.performedBy.trim()) missing.push(t.csFieldPerformedBy);
    if (missing.length) {
      showToast(`${t.csMissingPrefix} ${missing.join(", ")}.`, "warning");
      return;
    }
    if (form.mileage && veh && parseFloat(form.mileage) < (parseFloat(veh.mi) || 0)) {
      showToast(t.csOdometerBehind.replace("{n}", (veh.mi || 0).toLocaleString()), "warning");
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
          form.driverChoice === "unchanged"
            ? undefined
            : form.driverChoice === "clear"
              ? ""
              : form.driverChoice,
      });
      onClose();
    } catch (err) {
      showToast(`${t.csFailed} ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <Row gap={3}>
          <CheckCircle2 size={17} aria-hidden="true" /> {t.csTitlePrefix} {req.vname}
        </Row>
      }
      onClose={onClose}
    >
      <Stack gap={4}>
        {req.wh_notes && (
          <Card
            variant="flat"
            pad="none"
            style={{
              background: C.lg,
              border: "none",
              borderRadius: "var(--radius-md)",
              padding: 10,
              fontSize: "var(--text-sm)",
            }}
          >
            <strong>{t.csSchedulingNotes}</strong> {req.wh_notes}
          </Card>
        )}
        {req.replacement_vehicle_id && (
          <Card
            variant="flat"
            pad="none"
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
            {t.csSpareNote}
          </Card>
        )}

        <Grid gap={4}>
          <Fld label={t.csServicePerformed}>
            <Sel
              value={form.serviceType}
              onChange={(e) => setForm({ ...form, serviceType: e.target.value })}
            >
              <option value="">{t.csSelect}</option>
              {SERVICE_TYPES.map((svc) => (
                <option key={svc} value={svc}>
                  {serviceLabel(svc)}
                </option>
              ))}
            </Sel>
          </Fld>
          <Fld label={t.csServiceDate}>
            <Inp
              type="date"
              value={form.serviceDate}
              onChange={(e) => setForm({ ...form, serviceDate: e.target.value })}
            />
          </Fld>
        </Grid>

        <Grid gap={4}>
          <Fld label={t.csPerformedBy}>
            <Inp
              value={form.performedBy}
              onChange={(e) => setForm({ ...form, performedBy: e.target.value })}
              placeholder={t.csPerformedByPlaceholder}
            />
          </Fld>
          <Fld label={t.colCost} hint={t.csCostHint}>
            <Inp
              type="number"
              min="0"
              step="0.01"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              placeholder="0.00"
            />
          </Fld>
        </Grid>

        {veh && veh.type === "truck" && (
          <Fld
            label={t.csOdometer}
            hint={t.csOdometerHint.replace("{n}", (veh.mi || 0).toLocaleString())}
          >
            <Inp
              type="number"
              value={form.mileage}
              onChange={(e) => setForm({ ...form, mileage: e.target.value })}
              placeholder={String(veh.mi || "")}
            />
          </Fld>
        )}

        <Fld label={t.csResolutionNotes} hint={t.csResolutionHint}>
          <TA
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder={t.csResolutionPlaceholder}
          />
        </Fld>

        <Fld
          label={t.osDriver}
          hint={
            currentDriver
              ? t.csDriverAssigned.replace("{name}", currentDriver.name || currentDriver.email)
              : t.csDriverNone
          }
        >
          <Sel
            value={form.driverChoice}
            onChange={(e) => setForm({ ...form, driverChoice: e.target.value })}
          >
            <option value="unchanged">{t.csNoChange}</option>
            <option value="clear">{t.csRemoveDriver}</option>
            {users
              .filter((u) => u.active !== false)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
          </Sel>
        </Fld>

        <Row gap={4} style={{ marginTop: 4 }}>
          <Btn
            v="ghost"
            onClick={onClose}
            style={{ flex: 1, justifyContent: "center" }}
            disabled={submitting}
          >
            {t.cancel}
          </Btn>
          <Btn
            v="green"
            onClick={submit}
            style={{ flex: 1, justifyContent: "center" }}
            disabled={submitting}
          >
            {submitting ? (
              t.csCompleting
            ) : (
              <>
                <CheckCircle2 size={14} aria-hidden="true" /> {t.csComplete}
              </>
            )}
          </Btn>
        </Row>
      </Stack>
    </Modal>
  );
}
