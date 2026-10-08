// src/features/fleet/FleetManagementView.jsx
import { useState, useEffect } from "react";
import {
  Truck,
  Tractor,
  Wrench,
  User,
  KeyRound,
  MapPin,
  Pencil,
  CheckCircle2,
  Ban,
  Trash2,
  AlertOctagon,
  Loader2,
  Save,
} from "lucide-react";
import { supabase, updateRowStrict } from "@/shared/utils/supabase";
import {
  Btn,
  Bdg,
  Fld,
  Inp,
  Sel,
  Modal,
  TA,
  PhotoUpload,
  PageHeader,
  CardGrid,
  FilterPill,
  Row,
  Stack,
  Text,
  Muted,
  Callout,
  Card,
  Meter,
  Grid,
  StatusDot,
} from "@/shared/components/UIPrimitives";
import { C, todayLocal } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import { useStickySort } from "@/shared/hooks/useStickySort";
import { learnServiceIntervals } from "./patterns";
import { logAction } from "@/shared/utils/logger";
import { useNotify } from "@/shared/context/NotificationContext";
import TrailerCalendar from "./TrailerCalendar";
import SearchBar, { matchesQuery } from "@/shared/components/SearchBar";
import { uploadPhotoToBucket } from "@/shared/utils/storageBucketUpload";
import { notifyMaintFiled } from "@/shared/utils/maintenanceNotifications";
import { notifyVehicleAssigned } from "@/shared/utils/fleetNotifications";
import { vehicleStatusKind, isGrounded, groundingPatch, isServiceDue } from "./fleetStatus";
import MaintenanceRequestModal from "./MaintenanceRequestModal";
import AddVehicleModal from "./AddVehicleModal";
import InspectionModal from "./InspectionModal";
import LendSpareModal from "./LendSpareModal";

// ── MAIN VIEW COMPONENT (The Only Default Export) ──
// The values of the <option> list in this view's sort dropdown, in the same
// order. useStickySort checks a remembered choice against this before trusting
// it, so a sort that is renamed or removed later degrades to the default rather
// than leaving the control blank. Keep it in step with the JSX.
const SORTS = ["name_az", "name_za", "year_new", "year_old", "mi_high", "mi_low"];

export default function FleetManagementView({
  vehs,
  setVehs,
  reqs,
  setReqs,
  jobs,
  setJobs,
  jobTrailers,
  setJobTrailers,
  jSC,
  users,
  user,
  perms,
  maintenanceNotifications,
  fleetNotifications,
  maintManagers = [],
  oilSt,
  detSt,
  predDays,
  fd,
  fm,
  lang = "en",
  openItemId,
  onOpenItemHandled,
}) {
  const { showToast } = useNotify();
  const t = translations[lang] || translations.en;

  // How each status kind from features/fleet/fleetStatus renders. Red is reserved for a truck
  // that is genuinely off the road, i.e. one a person grounded. An overdue oil change is
  // a maintenance warning on a truck you can still drive, so it gets the deep-amber warn
  // token rather than sharing the destructive colour and the "Out of Service" wording.
  // A solid dot in the status color, except in_shop which gets the wrench glyph
  // instead — that state is "being worked on", not a plain severity level.
  const Dot = StatusDot;
  const STATUS_DISPLAY = {
    grounded: { dot: <Dot color={C.rd} />, label: t.flStatusOutOfService, color: C.rd },
    in_shop: {
      dot: <Wrench size={10} aria-hidden="true" />,
      label: t.flStatusInService,
      color: C.pu,
    },
    oil_overdue: { dot: <Dot color={C.am} />, label: t.flStatusOilOverdue, color: C.am },
    // Was C.gold (the bright accent) — at this badge's size (11px bold) that's
    // 3.30:1 on a white card, under WCAG AA's 4.5:1 for normal text. C.am is the
    // same deep-amber "warn" token oil_overdue already uses one line up, for the
    // same reason described in the comment above: 4.66:1, and it was already the
    // semantically correct token for a warning-severity badge.
    service_due: { dot: <Dot color={C.am} />, label: t.flStatusServiceDue, color: C.am },
    active: { dot: <Dot color={C.gr} />, label: t.flStatusActive, color: C.gr },
  };

  const [subView, setSubView] = useState("list");
  const [calSel, setCalSel] = useState(null);
  const [filt, setFilt] = useState("all");
  const [sortBy, setSortBy] = useStickySort("fleet", SORTS, "name_az");
  const [srch, setSrch] = useState("");
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [reqModal, setReqModal] = useState(false);
  const [reqVid, setReqVid] = useState("");
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [savingVehicleInfo, setSavingVehicleInfo] = useState(false);
  const [groundModal, setGroundModal] = useState(false);
  const [groundReason, setGroundReason] = useState("");
  const [grounding, setGrounding] = useState(false);
  const predictedServices = sel ? learnServiceIntervals(sel) : [];

  // Which dialog is open stays here; each dialog owns its own form state.
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
  // The scheduled maintenance request we are lending a spare against. The dialog
  // owns the RPC and its own in-flight flag; see LendSpareModal.
  const [swapReq, setSwapReq] = useState(null);
  const vehSorters = {
    name_az: (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true }),
    name_za: (a, b) => (b.name || "").localeCompare(a.name || "", undefined, { numeric: true }),
    year_new: (a, b) => (b.yr || 0) - (a.yr || 0),
    year_old: (a, b) => (a.yr || 0) - (b.yr || 0),
    mi_high: (a, b) => (b.mi || 0) - (a.mi || 0),
    mi_low: (a, b) => (a.mi || 0) - (b.mi || 0),
  };
  const filtered = vehs
    .filter((v) => filt === "all" || v.type === filt)
    // Name, plate, make and model — the four things someone has when they are
    // looking at a truck in the yard, or reading one off a text message.
    .filter((v) => matchesQuery(srch, [v.name, v.plate, v.make, v.model]))
    .sort(vehSorters[sortBy] || vehSorters.name_az);

  // Deep-link from OmniSearch: open the matching vehicle card on arrival
  useEffect(() => {
    if (!openItemId) return;
    const target = vehs.find((v) => String(v.id) === String(openItemId));
    if (target) {
      setSubView("list");
      setSel(target);
      setIsEditingInfo(false);
    }
    onOpenItemHandled?.();
  }, [openItemId]);

  const setPhoto = async (id, data) => {
    if (!data && !perms.fleet_photo_delete) {
      showToast(t.flPhotoDeletePerm, "error");
      return;
    }
    try {
      const photo_url = data
        ? await uploadPhotoToBucket("vehicle-photos", user.companyId, id, data)
        : null;
      const { error } = await updateRowStrict("vehicles", id, { photo_url }, user.companyId);
      if (error) throw error;
      setVehs((p) => p.map((v) => (v.id === id ? { ...v, photo_url } : v)));
      setSel((p) => (p && p.id === id ? { ...p, photo_url } : p));
    } catch (err) {
      showToast(`${t.flPhotoSaveFail} ${err.message}`, "error");
    }
  };

  // Current log arrays for one vehicle straight from the database — appending
  // to this device's copy (loaded once at sign-in) silently erased entries
  // other devices logged since. Same disease the inventory batches had.
  //
  // company_id belongs in this filter: vehicles' PK is (company_id, id) because
  // the ids are app-generated text that repeats across tenants, so `.eq("id")`
  // on its own is half a key. For an ordinary user RLS hid the other companies'
  // matches; for a platform admin it does not, and .single() then came back with
  // PostgREST's "Cannot coerce the result to a single JSON object" — which reads
  // like a corrupt record and is really two tenants' trucks sharing an id.
  const fetchLiveVehicle = async (id, cols) => {
    const { data, error } = await supabase
      .from("vehicles")
      .select(cols)
      .eq("company_id", user.companyId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new Error(
        "This vehicle is no longer in the database — it may have been deleted by someone else. Refresh the page and try again.",
      );
    return data;
  };

  const logMi = async () => {
    // Say what's missing. A bare `return` here looks identical to a save that worked:
    // the modal sits there, nothing is written, and no one finds out until the numbers
    // are wrong later.
    const missing = [];
    if (!form.mi) missing.push(t.flFieldOdometer);
    if (!form.date) missing.push(t.flFieldDate);
    if (missing.length) {
      showToast(t.flNothingLogged.replace("{fields}", missing.join(` ${t.flJoinAnd} `)), "warning");
      return;
    }
    const mi = parseFloat(form.mi);
    try {
      const live = await fetchLiveVehicle(sel.id, "mi,mil");
      // Validate against the live odometer, not this device's snapshot.
      if (mi < (parseFloat(live.mi) || 0)) {
        showToast(t.flMileageTooLow, "info");
        return;
      }
      const changes = {
        mi,
        mil: [...(live.mil || []), { dt: form.date, mi, by: user.id }],
      };
      const { error } = await updateRowStrict("vehicles", sel.id, changes, user.companyId);
      if (error) throw error;
      const up = { ...sel, ...changes };
      setVehs((p) => p.map((v) => (v.id === sel.id ? up : v)));
      setSel(up);
      setModal(null);
      setForm({});
    } catch (err) {
      showToast(`${t.flMileageLogFail} ${err.message}`, "error");
    }
  };

  const logSvc = async () => {
    const missing = [];
    if (!form.type) missing.push(t.flFieldServiceType);
    if (!form.date) missing.push(t.flFieldDate);
    if (missing.length) {
      showToast(t.flNothingLogged.replace("{fields}", missing.join(` ${t.flJoinAnd} `)), "warning");
      return;
    }
    const e = {
      id: Math.random().toString(36).slice(2, 10),
      type: form.type,
      dt: form.date,
      mi: parseFloat(form.mi) || sel.mi,
      by: form.by || user.name,
      notes: form.notes || "",
      cost: parseFloat(form.cost) || 0,
    };
    try {
      // Append to the service history currently in the database, not this
      // device's copy — see fetchLiveVehicle.
      const live = await fetchLiveVehicle(sel.id, "sl");
      const changes = {
        sl: [...(live.sl || []), e],
        ...(form.type === "Oil Change" ? { lomi: e.mi } : {}),
        ...(form.type === "Detail" ? { ldd: form.date } : {}),
      };
      const { error } = await updateRowStrict("vehicles", sel.id, changes, user.companyId);
      if (error) throw error;
      const up = { ...sel, ...changes };
      setVehs((p) => p.map((v) => (v.id === sel.id ? up : v)));
      setSel(up);
      setModal(null);
      setForm({});

      await logAction(
        user.id,
        user.email,
        "FLEET_MAINTENANCE",
        `Logged service for "${sel.name}": ${e.type} @ ${e.mi} mi${e.cost ? ` ($${e.cost})` : ""}`,
        { vehicle_id: sel.id, service: e },
        "fleet",
      );
    } catch (err) {
      showToast(`${t.flServiceLogFail} ${err.message}`, "error");
    }
  };

  const assignUser = async () => {
    const assignedTo = form.assignedTo || "";
    // Read before the write: the helper needs the OLD driver to tell a real handover
    // from a Save that changed nothing, and `sel` is replaced below.
    const previousDriverId = sel.assignedTo || "";
    try {
      const { error } = await updateRowStrict("vehicles", sel.id, { assignedTo }, user.companyId);
      if (error) throw error;
      const up = { ...sel, assignedTo };
      setVehs((p) => p.map((v) => (v.id === sel.id ? up : v)));
      setSel(up);
      setModal(null);
      setForm({});

      // Tell the driver which truck is now theirs. Deliberately not awaited, same as the
      // maintenance filing email below: the assignment is already saved, and a slow or
      // failed relay must not hold up the dialog closing or surface as an assignment
      // error. notifyVehicleAssigned resolves either way.
      notifyVehicleAssigned({
        vehicle: up,
        driverId: assignedTo,
        previousDriverId,
        users,
        prefs: fleetNotifications,
        actorId: user.id,
        assignedByName: user.name || user.email,
      });
    } catch (err) {
      showToast(`${t.flAssignmentFail} ${err.message}`, "error");
    }
  };

  // Persist service requests filed from the fleet page — mirrors the insert
  // shape used by MaintenanceRequestsView (DB generates the id).
  const saveServiceRequest = async (r) => {
    const payload = {
      vid: r.vid,
      vname: r.vname,
      vtype: r.vtype,
      type: r.type,
      urgency: r.urgency,
      notes: r.notes,
      mileage: r.mileage === "" || r.mileage == null ? null : r.mileage,
      uid: r.uid,
      uname: r.uname,
      status: r.status || "pending",
      at: r.at,
    };
    try {
      const { data, error } = await supabase
        .from("maintenance_requests")
        .insert([payload])
        .select();
      if (error) throw error;

      if (!data || !data[0]) {
        // Same gotcha as MaintenanceRequestsView.handleCreateRequest: the insert
        // committed but PostgREST returned no row back (a SELECT policy that
        // doesn't match it yet, most likely). Using `payload` as a stand-in would
        // add an id-less ticket to local state, and every later action on it would
        // fail against the real row with "record no longer exists". Fail loudly now.
        throw new Error(t.maintSubmitUnconfirmed);
      }

      const created = data[0];
      setReqs((p) => [created, ...p]);

      await logAction(
        user.id,
        user.email,
        "MAINTENANCE_REQUEST_CREATE",
        `Filed new maintenance request for vehicle: ${r.vname} (Urgency: ${(r.urgency || "normal").toUpperCase()})`,
        { ticket_id: created.id || "N/A", vehicle_id: r.vid, issue_types: r.type },
        "maintenance",
      );

      // Tell the people who can schedule it. Deliberately not awaited: the request is
      // already saved, and a slow or failed relay must not hold up the confirmation
      // toast or surface as a filing error. notifyMaintFiled resolves either way.
      notifyMaintFiled({
        req: created,
        recipients: maintManagers,
        prefs: maintenanceNotifications,
        excludeUserId: user.id,
      });

      showToast(t.flMaintFiled, "success");
    } catch (err) {
      showToast(`${t.flMaintFileFail} ${err.message}`, "error");
    }
  };

  // Ground a vehicle, or put it back on the road. Deliberately separate from
  // saveVehicleInfo: that dialog edits identity fields (name, plate, make) and is behind
  // an "Edit Vehicle Name/Plate" button, which is not where anyone would look to pull a
  // truck off the road.
  const setServiceStatus = async (grounded, reason) => {
    if (!sel) return;
    setGrounding(true);
    const changes = groundingPatch(grounded, reason);
    try {
      const { error } = await updateRowStrict("vehicles", sel.id, changes, user.companyId);
      if (error) throw error;

      const updated = { ...sel, ...changes };
      setVehs((p) => p.map((v) => (v.id === sel.id ? updated : v)));
      setSel(updated);

      // The row does not carry who or when; this entry is that record. See the note in
      // supabase/25 on why there are no oos_by / oos_at columns.
      await logAction(
        user.id,
        user.email,
        "FLEET_STATUS_CHANGE",
        grounded
          ? `Took "${updated.name}" out of service${changes.oos_reason ? `: ${changes.oos_reason}` : ""}`
          : `Returned "${updated.name}" to service`,
        { vehicle_id: sel.id, status: changes.status, reason: changes.oos_reason },
        "fleet",
      );

      showToast(grounded ? t.flGrounded : t.flReturned, "success");
      setGroundModal(false);
    } catch (err) {
      showToast(`${t.flGroundFail} ${err.message}`, "error");
    } finally {
      setGrounding(false);
    }
  };

  const saveVehicleInfo = async () => {
    if (!sel) return;
    setSavingVehicleInfo(true);

    const changes = {
      name: form.name,
      yr: parseInt(form.yr) || sel.yr,
      make: form.make,
      model: form.model,
      plate: form.plate,
      type: form.type || sel.type,
    };

    try {
      const { error } = await updateRowStrict("vehicles", sel.id, changes, user.companyId);
      if (error) throw error;

      const updated = { ...sel, ...changes };
      setVehs((p) => p.map((v) => (v.id === sel.id ? updated : v)));
      setSel(updated);

      await logAction(
        user.id,
        user.email,
        "FLEET_STATUS_CHANGE",
        `Updated vehicle details for "${updated.name}" (ID: ${sel.id})`,
        { vehicle_id: sel.id, changes },
        "fleet",
      );

      showToast(t.flVehicleSaved, "success");
      setIsEditingInfo(false);
    } catch (err) {
      showToast(`${t.flVehicleSaveFail} ${err.message}`, "error");
    } finally {
      setSavingVehicleInfo(false);
    }
  };

  const handleRemoveVehicle = async (vehicleId, vehicleName) => {
    if (!window.confirm(t.flRemoveConfirm.replace("{name}", vehicleName))) return;

    const { error } = await supabase.from("vehicles").delete().eq("id", vehicleId);

    if (error) {
      showToast(`${t.flDbError} ${error.message}`, "error");
    } else {
      await logAction(
        user.id,
        user.email,
        "FLEET_STATUS_CHANGE",
        `Permanently purged vehicle asset record "${vehicleName}" (ID: ${vehicleId}) from the company fleet roster.`,
        { deleted_vehicle_id: vehicleId, deleted_vehicle_name: vehicleName },
        "fleet",
      );

      setVehs((prev) => prev.filter((v) => v.id !== vehicleId));
      showToast(t.flVehicleRemoved, "success");
    }
  };

  if (vehs.length === 0) {
    return (
      <>
        <Card variant="raised" pad="60px 20px" style={{ marginTop: 10 }}>
          <Stack gap={0} align="center" style={{ textAlign: "center" }}>
            <Truck
              size={44}
              color={C.slate}
              strokeWidth={1.5}
              style={{ marginBottom: 16 }}
              aria-hidden="true"
            />
            <Text as="h3" weight="extrabold" color={C.slate} style={{ margin: "0 0 8px 0" }}>
              {t.flRegistryEmpty}
            </Text>
            <Text
              as="p"
              size="base"
              color={C.sub}
              style={{ margin: "0 0 20px 0", maxWidth: "340px" }}
            >
              No company vehicles are currently configured for tracking at the Saint Joe Road
              Warehouse.
            </Text>
            {perms.fleet_edit && (
              <Btn v="gold" onClick={() => setIsAddVehicleOpen(true)}>
                + Register First Fleet Vehicle
              </Btn>
            )}
          </Stack>
        </Card>
        {isAddVehicleOpen && (
          <AddVehicleModal
            user={user}
            onCreated={(v) => setVehs((p) => [...p, v])}
            onClose={() => setIsAddVehicleOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    // ── WRAP ENTIRE VIEW TO FILL WIDTH AND LOCK SCREEN ELEMENT OVERFLOW ──
    // Fixed to the viewport (less the app bars) so only the card grid scrolls.
    <Stack gap={0} style={{ height: "calc(100vh - 96px)", width: "100%", overflow: "hidden" }}>
      {/* HEADER SECTION TIER (flexShrink: 0 keeps it locked in view) */}
      <PageHeader
        title={t.fleetTitle}
        subtitle={
          <>
            {vehs.filter((v) => v.type === "truck").length} {t.trucks} ·{" "}
            {vehs.filter((v) => v.type === "trailer").length} {t.trailers}
          </>
        }
        style={{ flexShrink: 0 }}
        actions={
          <>
            {perms.fleet_edit && (
              <Btn
                v="primary"
                sz="sm"
                onClick={() => setIsAddVehicleOpen(true)}
                style={{ fontWeight: "var(--weight-extrabold)" }}
              >
                {t.flAddVehicle}
              </Btn>
            )}
            {/* ── THE LOG INSPECTION TOGGLE ACTION BUTTON ── */}
            {perms.fleet_log_inspection && (
              <Btn
                v="gold"
                sz="sm"
                onClick={() => setIsInspectOpen(true)}
                style={{ fontWeight: "var(--weight-extrabold)" }}
              >
                {t.flLogInspection}
              </Btn>
            )}
            {perms.maint_submit && (
              <Btn
                v="purple"
                sz="sm"
                onClick={() => {
                  setReqVid("");
                  setReqModal(true);
                }}
              >
                {t.requestMaintBtn}
              </Btn>
            )}
            {subView === "list" && (
              <Row gap="5px">
                {[
                  ["all", t.flFilterAll],
                  ["truck", t.flFilterTrucks],
                  ["trailer", t.flFilterTrailers],
                ].map(([f, label]) => (
                  <FilterPill
                    key={f}
                    label={label}
                    active={filt === f}
                    onClick={() => setFilt(f)}
                  />
                ))}
                <Sel
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label={t.flSortAria}
                  style={{ width: "auto" }}
                >
                  <option value="name_az">{t.flSortNameAZ}</option>
                  <option value="name_za">{t.flSortNameZA}</option>
                  <option value="year_new">{t.flSortYearNew}</option>
                  <option value="year_old">{t.flSortYearOld}</option>
                  <option value="mi_high">{t.flSortMiHigh}</option>
                  <option value="mi_low">{t.flSortMiLow}</option>
                </Sel>
              </Row>
            )}
            <Row gap="5px" align="stretch">
              {[
                ["list", t.flViewList],
                ["calendar", t.flViewTrailerCal],
              ].map(([v, label]) => (
                <Btn
                  key={v}
                  v={subView === v ? "primary" : "ghost"}
                  sz="sm"
                  onClick={() => setSubView(v)}
                >
                  {label}
                </Btn>
              ))}
            </Row>
          </>
        }
      />

      {/* List only. The trailer calendar is a different shape of question — "who
          has this trailer next week" — and a name filter over it would hide the
          bookings that make the calendar worth looking at. */}
      {subView === "list" && (
        <SearchBar
          value={srch}
          onChange={setSrch}
          placeholder={t.flSearchPlaceholder}
          resultCount={filtered.length}
          lang={lang}
        />
      )}

      {subView === "calendar" ? (
        <div style={{ flex: 1, overflowY: "auto", paddingRight: 6, paddingBottom: 24 }}>
          <TrailerCalendar
            lang={lang}
            vehs={vehs}
            jobs={jobs}
            jobTrailers={jobTrailers}
            setJobTrailers={setJobTrailers}
            setJobs={setJobs}
            jSC={jSC}
            user={user}
            perms={perms}
            onJobClick={(job) => setCalSel(job)}
          />
        </div>
      ) : (
        <>
          {/* ── INJECT ENCLOSED SCROLL TRACK CONTAINER FOR INTERIOR ELEMENTS ONLY ── */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              paddingRight: 6,
              paddingBottom: 24,
              scrollbarWidth: "thin", // Native Firefox layout alignment compatibility rules fallback
              scrollbarColor: `${C.line} transparent`,
            }}
          >
            {/* Fleet Grid Tracker */}
            <CardGrid minWidth={265} gap="var(--space-6)">
              {filtered.map((v) => {
                const os = oilSt(v);
                const ds = detSt(v);
                // Blocked means SCHEDULED, not merely requested. Submitting a request
                // needs only maint_submit, so treating 'pending' as blocking would let
                // any driver pull a truck off the road by asking for service. Moving a
                // request to 'scheduled' needs maint_manage, i.e. someone agreed. The
                // same rule is enforced in the database — see supabase/19.
                //
                // AND due today: a request scheduled for a future date must not ground
                // the truck the moment it's booked — only once that date arrives. See
                // fleetStatus.isServiceDue.
                //
                // Declared up here because fleetStatus below reads it.
                const blockingReq = reqs.find(
                  (r) =>
                    r.vid === v.id && r.status === "scheduled" && isServiceDue(r, todayLocal()),
                );
                const isBlocked = !!blockingReq;
                // Precedence lives in features/fleet/fleetStatus so it can be tested without the
                // theme or translations. Note "Out of Service" now means only a deliberate
                // grounding; an overdue oil change gets its own red label, because sharing
                // one made people hunt for a switch that turns off a mileage calculation.
                const fleetStatus =
                  STATUS_DISPLAY[
                    vehicleStatusKind({
                      vehicle: v,
                      oilStatus: os,
                      detailStatus: ds,
                      blocked: isBlocked,
                    })
                  ];
                const bc =
                  os === "overdue" || ds === "overdue"
                    ? C.rd
                    : os === "soon" || ds === "soon"
                      ? C.am
                      : "transparent";
                const oLeft = v.type === "truck" ? v.oii - (v.mi - v.lomi) : null;
                const pd = predDays(v);
                const vOpenReqs = reqs.filter((r) => r.vid === v.id && r.status !== "completed");
                const asgn = users.find((u) => u.id === v.assignedTo);
                const photo = v.photo_url;
                return (
                  <Card
                    key={v.id}
                    variant="raised"
                    pad="none"
                    containsActions
                    onClick={() => setSel(v)}
                    style={{
                      overflow: "hidden",
                      border: `2px solid ${isBlocked ? C.pu : bc}`,
                      // Dimmed, not hidden. The truck still exists and people need to
                      // see when it is due back, so the card stays clickable and the
                      // detail view stays reachable. Opacity lives here rather than a
                      // grayscale filter because a filter would also drain the purple
                      // border that marks it as blocked.
                      opacity: isBlocked ? 0.72 : 1,
                    }}
                  >
                    <Row
                      inline
                      gap={1}
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: "var(--weight-extrabold)",
                        color: fleetStatus.color,
                        padding: "8px 12px 4px",
                      }}
                    >
                      <span>{fleetStatus.dot}</span>
                      <span>{fleetStatus.label}</span>
                      {/* The date lives on the status line, not on the photo: the
                      photo is desaturated when blocked and would drain it. */}
                      {isBlocked && blockingReq.scheduled_date && (
                        <Text as="span" weight="bold" style={{ opacity: 0.8 }}>
                          · {fd(blockingReq.scheduled_date)}
                        </Text>
                      )}
                    </Row>
                    <div
                      style={{
                        height: 130,
                        background: photo ? C.mediaBackdrop : C.lg,
                        overflow: "hidden",
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        // Only the photo is desaturated. Doing this to the whole card
                        // would flatten the status colours that carry the meaning.
                        filter: isBlocked ? "grayscale(1)" : "none",
                      }}
                    >
                      {photo ? (
                        <img
                          src={photo}
                          alt={v.name}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : v.type === "truck" ? (
                        <Truck size={48} strokeWidth={1.5} opacity={0.25} aria-hidden="true" />
                      ) : (
                        <Tractor size={48} strokeWidth={1.5} opacity={0.25} aria-hidden="true" />
                      )}
                      {vOpenReqs.length > 0 && (
                        <Text
                          as="span"
                          size="2xs"
                          weight="extrabold"
                          color={C.onAccent}
                          style={{
                            position: "absolute",
                            top: 8,
                            left: 8,
                            background: C.pu,
                            borderRadius: 20,
                            padding: "2px 8px",
                          }}
                        >
                          {vOpenReqs.length} req
                        </Text>
                      )}
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: 0,
                          right: 0,
                          background: "linear-gradient(transparent,rgba(0,0,0,0.55))",
                          padding: "8px 10px 6px",
                        }}
                      >
                        <Text size="md" weight="extrabold" color={photo ? C.w : C.navy}>
                          {v.name}
                        </Text>
                        <Text size="2xs" color={photo ? "rgba(255,255,255,0.8)" : C.sub}>
                          {v.yr} {v.make} {v.model} · #{v.plate}
                        </Text>
                      </div>
                    </div>
                    <Stack gap={0} style={{ padding: 12 }}>
                      {asgn && (
                        <Row
                          gap={1}
                          style={{
                            fontSize: "var(--text-2xs)",
                            color: C.blue,
                            fontWeight: "var(--weight-bold)",
                            marginBottom: 6,
                          }}
                        >
                          <User size={11} aria-hidden="true" /> {asgn.name}
                        </Row>
                      )}
                      {/* Offered at the moment of need, on the card of the truck that
                      just went out of service, rather than buried in the detail
                      modal. stopPropagation so it doesn't also open that modal.
                      Hidden once a spare is already out, because the RPC refuses a
                      second loan and a button that always errors is worse than none. */}
                      {isBlocked && !blockingReq.replacement_vehicle_id && perms.fleet_edit && (
                        <Btn
                          v="purple"
                          sz="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSwapReq(blockingReq);
                          }}
                          style={{ width: "100%", marginBottom: 8, justifyContent: "center" }}
                        >
                          <KeyRound size={13} aria-hidden="true" /> {t.flLendSpare}
                        </Btn>
                      )}
                      {isBlocked && blockingReq.replacement_vehicle_id && (
                        <Row
                          gap={1}
                          style={{
                            fontSize: "var(--text-2xs)",
                            color: C.pu,
                            fontWeight: "var(--weight-bold)",
                            marginBottom: 6,
                          }}
                        >
                          <KeyRound size={11} aria-hidden="true" /> {t.flSpareOut}{" "}
                          {vehs.find((x) => x.id === blockingReq.replacement_vehicle_id)?.name ||
                            blockingReq.replacement_vehicle_id}
                        </Row>
                      )}
                      {v.type === "truck" && (
                        <Stack gap={0} style={{ marginBottom: 8 }}>
                          <Row
                            gap={0}
                            align="stretch"
                            justify="space-between"
                            style={{ fontSize: "var(--text-xs)", marginBottom: 3 }}
                          >
                            <Text as="span" color={C.sub}>
                              {t.mileage}
                            </Text>
                            <Text as="span" weight="bold" color={C.navy}>
                              {v.mi.toLocaleString()} mi
                            </Text>
                          </Row>
                          <Meter
                            value={1 - oLeft / v.oii}
                            color={os === "overdue" ? C.rd : os === "soon" ? C.am : C.gr}
                            height={4}
                            style={{ marginBottom: 3 }}
                          />
                          <Row
                            gap={1}
                            style={{
                              fontSize: "var(--text-2xs)",
                              color: oLeft <= 0 ? C.rd : C.sub,
                            }}
                          >
                            {oLeft <= 0 ? (
                              <>
                                <AlertOctagon size={11} aria-hidden="true" /> Oil overdue!
                              </>
                            ) : (
                              `${Math.max(0, oLeft)} mi until oil change`
                            )}
                            {pd !== null && (
                              <Text as="span" color={C.blue}>
                                {" "}
                                · ~{pd === 0 ? "overdue" : `${pd}d`}
                              </Text>
                            )}
                          </Row>
                        </Stack>
                      )}
                      <Row gap="5px" align="stretch" wrap>
                        {v.type === "truck" && (
                          <Bdg color={os === "overdue" ? "red" : os === "soon" ? "amber" : "green"}>
                            {os === "overdue"
                              ? "Oil Overdue"
                              : os === "soon"
                                ? "Oil Soon"
                                : "Oil OK"}
                          </Bdg>
                        )}
                        <Bdg color={ds === "overdue" ? "red" : ds === "soon" ? "amber" : "green"}>
                          {ds === "overdue"
                            ? "Detail Overdue"
                            : ds === "soon"
                              ? "Detail Soon"
                              : "Detail OK"}
                        </Bdg>
                      </Row>
                    </Stack>
                  </Card>
                );
              })}
            </CardGrid>
          </div>
        </>
      )}

      {calSel && (
        <Modal
          title={calSel.title || calSel.name || t.flJobDetails}
          onClose={() => setCalSel(null)}
        >
          <Muted as="p" size="sm" style={{ margin: "0 0 8px" }}>
            <strong>{t.flPoLabel}</strong> {calSel.po}
          </Muted>
          <Muted as="p" size="sm" style={{ margin: "0 0 8px" }}>
            <strong>{t.flAddressLabel}</strong> {calSel.addr || "N/A"}
          </Muted>
          <Muted as="p" size="sm" style={{ margin: "0 0 8px" }}>
            <strong>{t.flScheduledLabel}</strong> {calSel.scheduledDate || "N/A"}
          </Muted>
          <Muted as="p" size="sm" style={{ margin: "0 0 8px" }}>
            <strong>{t.flSupervisorLabel}</strong>{" "}
            {users.find((u) => u.id === (calSel.assignedto || calSel.assignedTo))?.name ||
              t.flUnassigned}
          </Muted>
          <Muted as="p" size="sm" style={{ margin: 0 }}>
            <strong>{t.flTrailersLabel}</strong>{" "}
            {jobTrailers
              .filter((jt) => jt.job_id === calSel.id)
              .map((jt) => vehs.find((v) => v.id === jt.trailer_id)?.name)
              .filter(Boolean)
              .join(", ") || t.flNoneAssigned}
          </Muted>
        </Modal>
      )}

      {/* ── MODALS ELEMENT LAYERS RENDERED DOWN BELOW ONLY ── */}
      {sel && (
        <Modal
          title={`${sel.name} — ${sel.yr} ${sel.make} ${sel.model}`}
          onClose={() => {
            setSel(null);
            setIsEditingInfo(false);
          }}
          wide
        >
          <Row align="stretch" wrap style={{ marginBottom: 14 }}>
            {perms.fleet_log_mi && sel.type === "truck" && (
              <Btn
                v="primary"
                sz="sm"
                onClick={() => {
                  setForm({
                    date: todayLocal(),
                    mi: sel.mi,
                  });
                  setModal("mi");
                }}
              >
                <MapPin size={14} aria-hidden="true" /> Log Mileage
              </Btn>
            )}
            {perms.fleet_log_service && (
              <Btn
                v="outline"
                sz="sm"
                onClick={() => {
                  setForm({
                    type: "Oil Change",
                    date: todayLocal(),
                    mi: sel.mi,
                  });
                  setModal("svc");
                }}
              >
                <Wrench size={14} aria-hidden="true" /> Log Service
              </Btn>
            )}
            {perms.fleet_edit && (
              <Btn
                v="ghost"
                sz="sm"
                onClick={() => {
                  setForm({ assignedTo: sel.assignedTo || "" });
                  setModal("assign");
                }}
              >
                <User size={14} aria-hidden="true" /> Assign Driver
              </Btn>
            )}
            {perms.fleet_edit && (
              <Btn
                v="outline"
                sz="sm"
                onClick={() => {
                  setForm({
                    name: sel.name,
                    plate: sel.plate,
                    make: sel.make,
                    model: sel.model,
                    yr: sel.yr,
                    type: sel.type,
                  });
                  setIsEditingInfo(!isEditingInfo);
                }}
              >
                <Pencil size={13} aria-hidden="true" />{" "}
                {isEditingInfo ? "Cancel Details Edit" : "Edit Vehicle Name/Plate"}
              </Btn>
            )}
            {perms.fleet_edit &&
              (isGrounded(sel) ? (
                <Btn v="green" sz="sm" disabled={grounding} onClick={() => setServiceStatus(false)}>
                  <CheckCircle2 size={14} aria-hidden="true" />{" "}
                  {grounding ? "…" : t.flReturnToService}
                </Btn>
              ) : (
                <Btn
                  v="outline"
                  sz="sm"
                  onClick={() => {
                    setGroundReason("");
                    setGroundModal(true);
                  }}
                >
                  <Ban size={14} aria-hidden="true" /> {t.flGroundVehicle}
                </Btn>
              ))}
            {user.role === "admin" && (
              <Btn
                v="danger"
                sz="sm"
                onClick={() => {
                  handleRemoveVehicle(sel.id, sel.name);
                  setSel(null);
                }}
              >
                <Trash2 size={14} aria-hidden="true" /> Decommission Asset
              </Btn>
            )}
          </Row>

          {isGrounded(sel) && (
            <Callout
              tone="danger"
              bordered
              icon={Ban}
              size="sm"
              weight="semibold"
              color={C.rd}
              style={{ marginBottom: 14 }}
            >
              {t.flGroundedBadge} {sel.oos_reason || t.flStatusOutOfService}
            </Callout>
          )}

          {isEditingInfo && (
            <Callout
              bordered
              pad={6}
              style={{ borderRadius: "var(--radius-lg)", marginBottom: 14 }}
            >
              <Fld label={t.flDisplayName}>
                <Inp
                  value={form.name || ""}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Fld>
              <Grid cols={3} gap={3}>
                <Fld label={t.flYear}>
                  <Inp
                    type="number"
                    value={form.yr || ""}
                    onChange={(e) => setForm({ ...form, yr: e.target.value })}
                  />
                </Fld>
                <Fld label={t.flMake}>
                  <Inp
                    value={form.make || ""}
                    onChange={(e) => setForm({ ...form, make: e.target.value })}
                  />
                </Fld>
                <Fld label={t.flModel}>
                  <Inp
                    value={form.model || ""}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                  />
                </Fld>
              </Grid>
              <Grid gap={3}>
                <Fld label={t.flLicensePlate}>
                  <Inp
                    value={form.plate || ""}
                    onChange={(e) => setForm({ ...form, plate: e.target.value })}
                  />
                </Fld>
                <Fld label={t.flAssetType}>
                  <Sel
                    value={form.type || "truck"}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    <option value="truck">{t.flTruck}</option>
                    <option value="trailer">{t.flTrailer}</option>
                  </Sel>
                </Fld>
              </Grid>
              <Btn v="green" sz="sm" onClick={saveVehicleInfo} disabled={savingVehicleInfo}>
                {savingVehicleInfo ? (
                  <>
                    <Loader2
                      size={14}
                      style={{ animation: "mrr-spin 0.7s linear infinite" }}
                      aria-hidden="true"
                    />{" "}
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={14} aria-hidden="true" /> Save Vehicle Changes
                  </>
                )}
              </Btn>
            </Callout>
          )}

          <Fld label={t.flVehiclePhoto} style={{ marginBottom: 16 }}>
            <PhotoUpload
              current={sel.photo_url || null}
              onUpload={(data) => setPhoto(sel.id, data)}
              canRemove={!!perms.fleet_photo_delete}
              label={t.flUploadPhoto}
              maxDim={600}
              quality={0.75}
              previewHeight={200}
            />
          </Fld>

          <CardGrid minWidth={130} gap="var(--space-3)" style={{ marginBottom: 16 }}>
            {[
              ["Plate", sel.plate],
              ["Assigned To", users.find((u) => u.id === sel.assignedTo)?.name || "Unassigned"],
              ...(sel.type === "truck"
                ? [
                    [t.mileage, sel.mi.toLocaleString()],
                    ["Last Oil @ Mi", sel.lomi.toLocaleString()],
                    ["Miles Rem.", Math.max(0, sel.oii - (sel.mi - sel.lomi))],
                  ]
                : []),
              ["Last Detail", fd(sel.ldd)],
            ].map(([k, v]) => (
              <Callout key={k} pad={4}>
                <Text size="2xs" weight="bold" color={C.sub} style={{ textTransform: "uppercase" }}>
                  {k}
                </Text>
                <Text size="sm" weight="extrabold" color={C.navy} style={{ marginTop: 1 }}>
                  {v}
                </Text>
              </Callout>
            ))}
          </CardGrid>

          {predictedServices.length > 0 && (
            <Stack gap={0} style={{ marginBottom: 16 }}>
              <Row
                as="h4"
                gap={2}
                style={{
                  margin: "0 0 8px",
                  color: C.navy,
                  fontSize: "var(--text-sm)",
                  textTransform: "uppercase",
                }}
              >
                <Wrench size={13} aria-hidden="true" /> Predicted Next Service
              </Row>
              <Stack gap={2}>
                {predictedServices.map((p) => (
                  <Callout key={p.type} tone="plum" bordered pad="sm" size="sm">
                    <Text weight="extrabold" color={C.pu}>
                      {p.type} — ~{fd(p.predictedNextDate)}
                      {p.predictedNextMileage !== null &&
                        ` · ${p.predictedNextMileage.toLocaleString()} mi`}
                    </Text>
                    <Muted size="2xs">
                      Based on {p.sampleSize} past service{p.sampleSize === 1 ? "" : "s"} · every ~
                      {p.avgIntervalDays}d
                      {p.avgIntervalMiles !== null &&
                        ` / ${p.avgIntervalMiles.toLocaleString()} mi`}
                    </Muted>
                  </Callout>
                ))}
              </Stack>
            </Stack>
          )}

          <Text
            as="h4"
            size="sm"
            color={C.navy}
            style={{ margin: "0 0 8px", textTransform: "uppercase" }}
          >
            {t.flServiceHistory}
          </Text>
          {sel.sl.length === 0 ? (
            <Muted as="p" size="sm" style={{ margin: 0 }}>
              {t.flNoServiceRecords}
            </Muted>
          ) : (
            [...sel.sl]
              .sort((a, b) => new Date(b.dt) - new Date(a.dt))
              .map((s) => (
                <Callout key={s.id} style={{ marginBottom: 8 }}>
                  <Row align="stretch" justify="space-between" wrap>
                    <div>
                      <Bdg color={s.type === "Oil Change" ? "blue" : "green"}>{s.type}</Bdg>
                      <Text size="base" weight="bold" color={C.navy} style={{ marginTop: 4 }}>
                        {fd(s.dt)}
                      </Text>
                      <Muted>
                        {s.by}
                        {s.mi ? ` · ${s.mi.toLocaleString()} mi` : ""}
                      </Muted>
                    </div>
                    {s.cost > 0 && (
                      <Text weight="extrabold" color={C.blue}>
                        {fm(s.cost)}
                      </Text>
                    )}
                  </Row>
                </Callout>
              ))
          )}
        </Modal>
      )}

      {modal === "assign" && sel && (
        <Modal title={`Assign Driver — ${sel.name}`} onClose={() => setModal(null)}>
          <Fld label={t.flAssignedDriver}>
            <Sel
              value={form.assignedTo || ""}
              onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
            >
              <option value="">{t.flUnassignedOpt}</option>
              {users
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {/* profiles keep the name in full_name; `u.name` alone renders
                        a blank option for every real profile row. */}
                    {u.full_name || u.name || u.email}
                  </option>
                ))}
            </Sel>
          </Fld>
          <Row gap={4} align="stretch">
            <Btn
              v="ghost"
              onClick={() => setModal(null)}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {t.cancel}
            </Btn>
            <Btn v="primary" onClick={assignUser} style={{ flex: 1, justifyContent: "center" }}>
              {t.flSave}
            </Btn>
          </Row>
        </Modal>
      )}

      {modal === "mi" && sel && (
        <Modal title={`Log Mileage — ${sel.name}`} onClose={() => setModal(null)}>
          <Callout pad={4} size="sm" color={C.sub} style={{ marginBottom: 12 }}>
            {t.flCurrent} <strong>{sel.mi.toLocaleString()} mi</strong>
          </Callout>
          <Fld label={t.flDate}>
            <Inp
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </Fld>
          <Fld label={t.flOdometer}>
            <Inp
              type="number"
              value={form.mi}
              onChange={(e) => setForm({ ...form, mi: e.target.value })}
            />
          </Fld>
          <Row gap={4} align="stretch">
            <Btn
              v="ghost"
              onClick={() => setModal(null)}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {t.cancel}
            </Btn>
            <Btn v="primary" onClick={logMi} style={{ flex: 1, justifyContent: "center" }}>
              {t.flSave}
            </Btn>
          </Row>
        </Modal>
      )}

      {modal === "svc" && sel && perms.fleet_log_service && (
        <Modal title={`Log Service — ${sel.name}`} onClose={() => setModal(null)}>
          <Fld label={t.flServiceType}>
            <Sel
              value={form.type || "Oil Change"}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {/* The VALUE stays English on purpose — it is written to the service
                  record. Only the visible label follows the language. */}
              {[
                ["Oil Change", t.svcOilChange],
                ["Tire Rotation", t.svcTireRotation],
                ["Brake Service", t.svcBrakeService],
                ["Repair", t.svcRepair],
                ["Detail", t.svcDetail],
                ["Inspection", t.svcInspection],
                ["Other", t.svcOther],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Sel>
          </Fld>
          <Fld label={t.flDate}>
            <Inp
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </Fld>
          {sel.type === "truck" && (
            <Fld label={t.mileage}>
              <Inp
                type="number"
                value={form.mi}
                onChange={(e) => setForm({ ...form, mi: e.target.value })}
              />
            </Fld>
          )}
          <Fld label={t.flPerformedBy}>
            <Inp
              value={form.by || ""}
              onChange={(e) => setForm({ ...form, by: e.target.value })}
              placeholder={t.flShopOrEmployee}
            />
          </Fld>
          <Fld label={t.flCost}>
            <Inp
              type="number"
              step="0.01"
              value={form.cost || ""}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
            />
          </Fld>
          <Fld label={t.flNotes}>
            <Inp
              value={form.notes || ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Fld>
          <Row gap={4} align="stretch">
            <Btn
              v="ghost"
              onClick={() => setModal(null)}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {t.cancel}
            </Btn>
            <Btn v="primary" onClick={logSvc} style={{ flex: 1, justifyContent: "center" }}>
              {t.flSave}
            </Btn>
          </Row>
        </Modal>
      )}

      {groundModal && sel && perms.fleet_edit && (
        <Modal
          title={
            <Row as="span">
              <Ban size={16} aria-hidden="true" /> {t.flGroundTitle}
            </Row>
          }
          onClose={() => setGroundModal(false)}
        >
          <Callout
            tone="warn"
            bordered
            size="sm"
            weight="semibold"
            color={C.am}
            style={{ marginBottom: 14 }}
          >
            {sel.name} — {t.flGroundNote}
          </Callout>
          <Fld label={t.flGroundReason} hint={t.flGroundReasonHint}>
            <TA
              value={groundReason}
              onChange={(e) => setGroundReason(e.target.value)}
              placeholder="e.g. Blown transmission, waiting on parts"
            />
          </Fld>
          <Row gap={4} align="stretch">
            <Btn
              v="ghost"
              onClick={() => setGroundModal(false)}
              style={{ flex: 1, justifyContent: "center" }}
            >
              Cancel
            </Btn>
            <Btn
              v="danger"
              disabled={grounding}
              onClick={() => setServiceStatus(true, groundReason)}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {grounding ? "Saving…" : t.flGroundVehicle}
            </Btn>
          </Row>
        </Modal>
      )}

      {reqModal && perms.maint_submit && (
        <MaintenanceRequestModal
          vehs={vehs}
          user={user}
          preVid={reqVid}
          onSave={saveServiceRequest}
          onClose={() => {
            setReqModal(false);
            setReqVid("");
          }}
        />
      )}

      {isAddVehicleOpen && (
        <AddVehicleModal
          user={user}
          onCreated={(v) => setVehs((p) => [...p, v])}
          onClose={() => setIsAddVehicleOpen(false)}
        />
      )}

      {isInspectOpen && (
        <InspectionModal vehs={vehs} user={user} onClose={() => setIsInspectOpen(false)} />
      )}

      {swapReq && (
        <LendSpareModal
          req={swapReq}
          vehs={vehs}
          setVehs={setVehs}
          reqs={reqs}
          setReqs={setReqs}
          user={user}
          lang={lang}
          onClose={() => setSwapReq(null)}
        />
      )}
    </Stack>
  );
}
