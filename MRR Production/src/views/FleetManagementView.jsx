// src/views/FleetManagementView.jsx
import { useState, useEffect } from "react";
import { supabase, updateRowStrict } from "../utils/supabase";
import {
  Btn,
  Bdg,
  Fld,
  Inp,
  Sel,
  Modal,
  PhotoUpload,
} from "../components/UIPrimitives";
import { C, uid, todayLocal } from "../utils/helpers";
import { translations } from "../utils/translations";
import { learnServiceIntervals } from "../utils/patterns";
import { logAction } from "../utils/logger";
import { useNotify } from "../context/NotificationContext";
import TrailerCalendar from "../components/TrailerCalendar";
import { uploadPhotoToBucket } from "../utils/storageBucketUpload";
import MaintenanceRequestModal from "./fleet/MaintenanceRequestModal";
import AddVehicleModal from "./fleet/AddVehicleModal";
import InspectionModal from "./fleet/InspectionModal";


// ── MAIN VIEW COMPONENT (The Only Default Export) ──
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
  const [subView, setSubView] = useState("list");
  const [calSel, setCalSel] = useState(null);
  const [filt, setFilt] = useState("all");
  const [sortBy, setSortBy] = useState("name_az");
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [reqModal, setReqModal] = useState(false);
  const [reqVid, setReqVid] = useState("");
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [savingVehicleInfo, setSavingVehicleInfo] = useState(false);
  const predictedServices = sel ? learnServiceIntervals(sel) : [];
  // Which dialog is open stays here; each dialog owns its own form state.
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
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
      showToast("Only managers or admins can delete vehicle photos.", "error");
      return;
    }
    try {
      const photo_url = data ? await uploadPhotoToBucket("vehicle-photos", user.companyId, id, data) : null;
      const { error } = await updateRowStrict("vehicles", id, { photo_url });
      if (error) throw error;
      setVehs((p) => p.map((v) => (v.id === id ? { ...v, photo_url } : v)));
      setSel((p) => (p && p.id === id ? { ...p, photo_url } : p));
    } catch (err) {
      showToast(`Failed to save vehicle photo: ${err.message}`, "error");
    }
  };

  // Current log arrays for one vehicle straight from the database — appending
  // to this device's copy (loaded once at sign-in) silently erased entries
  // other devices logged since. Same disease the inventory batches had.
  const fetchLiveVehicle = async (id, cols) => {
    const { data, error } = await supabase
      .from("vehicles")
      .select(cols)
      .eq("id", id)
      .single();
    if (error) throw error;
    return data || {};
  };

  const logMi = async () => {
    // Say what's missing. A bare `return` here looks identical to a save that worked:
    // the modal sits there, nothing is written, and no one finds out until the numbers
    // are wrong later.
    const missing = [];
    if (!form.mi) missing.push("odometer reading");
    if (!form.date) missing.push("date");
    if (missing.length) {
      showToast(`Nothing was logged — please enter the ${missing.join(" and ")}.`, "warning");
      return;
    }
    const mi = parseFloat(form.mi);
    try {
      const live = await fetchLiveVehicle(sel.id, "mi,mil");
      // Validate against the live odometer, not this device's snapshot.
      if (mi < (parseFloat(live.mi) || 0)) {
        showToast("Cannot be less than current mileage.", "info");
        return;
      }
      const changes = {
        mi,
        mil: [...(live.mil || []), { dt: form.date, mi, by: user.id }],
      };
      const { error } = await updateRowStrict("vehicles", sel.id, changes);
      if (error) throw error;
      const up = { ...sel, ...changes };
      setVehs((p) => p.map((v) => (v.id === sel.id ? up : v)));
      setSel(up);
      setModal(null);
      setForm({});
    } catch (err) {
      showToast(`Database Error: Could not log mileage. ${err.message}`, "error");
    }
  };

  const logSvc = async () => {
    const missing = [];
    if (!form.type) missing.push("service type");
    if (!form.date) missing.push("date");
    if (missing.length) {
      showToast(`Nothing was logged — please enter the ${missing.join(" and ")}.`, "warning");
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
      const { error } = await updateRowStrict("vehicles", sel.id, changes);
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
        "fleet"
      );
    } catch (err) {
      showToast(`Database Error: Could not log service record. ${err.message}`, "error");
    }
  };

  const assignUser = async () => {
    const assignedTo = form.assignedTo || "";
    try {
      const { error } = await updateRowStrict("vehicles", sel.id, { assignedTo });
      if (error) throw error;
      const up = { ...sel, assignedTo };
      setVehs((p) => p.map((v) => (v.id === sel.id ? up : v)));
      setSel(up);
      setModal(null);
      setForm({});
    } catch (err) {
      showToast(`Database Error: Could not save assignment. ${err.message}`, "error");
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

      const created = data && data[0] ? data[0] : payload;
      setReqs((p) => [created, ...p]);

      await logAction(
        user.id,
        user.email,
        "MAINTENANCE_REQUEST_CREATE",
        `Filed new maintenance request for vehicle: ${r.vname} (Urgency: ${(r.urgency || "normal").toUpperCase()})`,
        { ticket_id: created.id || "N/A", vehicle_id: r.vid, issue_types: r.type },
        "maintenance"
      );

      showToast("Maintenance request filed successfully!", "success");
    } catch (err) {
      showToast(`Database Error: Could not file request. ${err.message}`, "error");
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
      const { error } = await updateRowStrict("vehicles", sel.id, changes);
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
        "fleet"
      );

      showToast("Vehicle details saved.", "success");
      setIsEditingInfo(false);
    } catch (err) {
      showToast(`Database Error: Could not save vehicle changes. ${err.message}`, "error");
    } finally {
      setSavingVehicleInfo(false);
    }
  };

 const handleRemoveVehicle = async (vehicleId, vehicleName) => {
    if (
      !window.confirm(
        `Are you sure you want to permanently remove ${vehicleName} from the fleet roster?`,
      )
    )
      return;
      
    const { error } = await supabase
      .from("vehicles")
      .delete()
      .eq("id", vehicleId);
      
    if (error) {
      showToast(`Database Error: ${error.message}`, "error");
    } else {
      await logAction(
        user.id,
        user.email,
        "FLEET_STATUS_CHANGE",
        `Permanently purged vehicle asset record "${vehicleName}" (ID: ${vehicleId}) from the company fleet roster.`,
        { deleted_vehicle_id: vehicleId, deleted_vehicle_name: vehicleName },
        "fleet"
      );

      setVehs((prev) => prev.filter((v) => v.id !== vehicleId));
      showToast("Vehicle successfully removed from roster.", "success");
    }
  };
  const vReqs = sel
    ? reqs.filter((r) => r.vid === sel.id && r.status !== "completed")
    : [];

  if (vehs.length === 0) {
    return (
      <>
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "60px 20px", background: "var(--c-surface)", borderRadius: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
          textAlign: "center", marginTop: 10
        }}>
          <span style={{ fontSize: "48px", marginBottom: 16 }}>🚛</span>
          <h3 style={{ margin: "0 0 8px 0", color: "var(--c-slate)", fontWeight: "var(--weight-extrabold)" }}>Fleet Registry Empty</h3>
          <p style={{ margin: "0 0 20px 0", color: "var(--c-sub)", fontSize: "var(--text-base)", maxWidth: "340px" }}>
            No company vehicles are currently configured for tracking at the Saint Joe Road Warehouse.
          </p>
          {perms.fleet_edit && (
            <Btn v="gold" onClick={() => setIsAddVehicleOpen(true)}>
              + Register First Fleet Vehicle
            </Btn>
          )}
        </div>
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
    // ── 🟢 1. WRAP ENTIRE VIEW TO FILL WIDTH AND LOCK SCREEN ELEMENT OVERFLOW ──
    <div style={{ 
      display: "flex", 
      flexDirection: "column", 
      height: "calc(100vh - 96px)", // Dynamic compensation boundary calculation subtracting parent layout bars
      width: "100%",
      maxWidth: "100%",
      overflow: "hidden"
    }}>
      
      {/* HEADER SECTION TIER (flexShrink: 0 keeps it locked in view) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: "var(--space-4)",
          flexShrink: 0
        }}
      >
        <div>
          <h1
            style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy }}
          >
            {t.fleetTitle}
          </h1>
          <p style={{ margin: "2px 0 0", color: C.sub, fontSize: "var(--text-sm)" }}>
            {vehs.filter((v) => v.type === "truck").length} {t.trucks} ·{" "}
            {vehs.filter((v) => v.type === "trailer").length} {t.trailers}
          </p>
        </div>
        <div
          style={{
            display: "flex",
            gap: "var(--space-3)",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {perms.fleet_edit && (
            <Btn
              v="primary"
              sz="sm"
              onClick={() => setIsAddVehicleOpen(true)}
              style={{ fontWeight: "var(--weight-extrabold)" }}
            >
              + Add Vehicle
            </Btn>
          )}
          {/* ── 🟢 ADD HERE: THE LOG INSPECTION TOGGLE ACTION BUTTON ── */}
          {perms.fleet_log_inspection && (
            <Btn
              v="gold"
              sz="sm"
              onClick={() => setIsInspectOpen(true)}
              style={{ fontWeight: "var(--weight-extrabold)" }}
            >
              📋 Log Inspection
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
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              {["all", "truck", "trailer"].map((f) => (
                <Btn
                  key={f}
                  v={filt === f ? "primary" : "ghost"}
                  sz="sm"
                  onClick={() => setFilt(f)}
                  style={{ textTransform: "capitalize" }}
                >
                  {f === "all" ? "All" : f + "s"}
                </Btn>
              ))}
              <Sel value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort vehicles" style={{ width: "auto" }}>
                <option value="name_az">↕ Name — A to Z</option>
                <option value="name_za">↕ Name — Z to A</option>
                <option value="year_new">↕ Year — Newest</option>
                <option value="year_old">↕ Year — Oldest</option>
                <option value="mi_high">↕ Mileage — High to Low</option>
                <option value="mi_low">↕ Mileage — Low to High</option>
              </Sel>
            </div>
          )}
          <div style={{ display: "flex", gap: 5 }}>
            {[["list", "📋 List"], ["calendar", "📅 Trailer Calendar"]].map(([v, label]) => (
              <Btn
                key={v}
                v={subView === v ? "primary" : "ghost"}
                sz="sm"
                onClick={() => setSubView(v)}
              >
                {label}
              </Btn>
            ))}
          </div>
        </div>
      </div>

      {subView === "calendar" ? (
        <div style={{ flex: 1, overflowY: "auto", paddingRight: 6, paddingBottom: 24 }}>
          <TrailerCalendar
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
      {/* ── 🟢 2. INJECT ENCLOSED SCROLL TRACK CONTAINER FOR INTERIOR ELEMENTS ONLY ── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          paddingRight: 6,
          paddingBottom: 24,
          scrollbarWidth: "thin", // Native Firefox layout alignment compatibility rules fallback
          scrollbarColor: "var(--c-line) transparent"
        }}
      >
        {/* Fleet Grid Tracker */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(265px, 1fr))",
            gap: "var(--space-6)",
          }}
        >
          {filtered.map((v) => {
            const os = oilSt(v);
            const ds = detSt(v);
            const getFleetStatus = (vehicle, oilStatus, detailStatus) => {
              if (
                vehicle.status === "out_of_service" ||
                oilStatus === "overdue"
              ) {
                return { dot: "🔴", label: "Out of Service", color: C.rd };
              }
              if (
                oilStatus === "soon" ||
                detailStatus === "soon" ||
                vehicle.status === "service_due"
              ) {
                return { dot: "🟡", label: "Service Due", color: C.am };
              }
              return { dot: "🟢", label: "Active", color: C.gr };
            };

            const fleetStatus = getFleetStatus(v, os, ds);
            const bc =
              os === "overdue" || ds === "overdue"
                ? C.rd
                : os === "soon" || ds === "soon"
                  ? C.am
                  : "transparent";
            const oLeft = v.type === "truck" ? v.oii - (v.mi - v.lomi) : null;
            const pd = predDays(v);
            const vOpenReqs = reqs.filter(
              (r) => r.vid === v.id && r.status !== "completed",
            );
            const asgn = users.find((u) => u.id === v.assignedTo);
            const photo = v.photo_url;
            return (
              <div
                key={v.id}
                className="mrr-card-click"
                onClick={() => setSel(v)}
                style={{
                  background: C.w,
                  borderRadius: "var(--radius-xl)",
                  overflow: "hidden",
                  cursor: "pointer",
                  boxShadow: "var(--shadow-sm)",
                  border: `2px solid ${bc}`,
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    fontSize: "11px",
                    fontWeight: "var(--weight-extrabold)",
                    color: fleetStatus.color,
                    padding: "8px 12px 4px"
                  }}
                >
                  <span>{fleetStatus.dot}</span>
                  <span>{fleetStatus.label}</span>
                </div>
                <div
                  style={{
                    height: 130,
                    background: photo ? "#000" : C.lg,
                    overflow: "hidden",
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
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
                  ) : (
                    <span style={{ fontSize: 52, opacity: 0.25 }}>
                      {v.type === "truck" ? "🚛" : "🚜"}
                    </span>
                  )}
                  <div style={{ position: "absolute", top: 8, left: 8 }}>
                    {vOpenReqs.length > 0 && (
                      <span
                        style={{
                          background: C.pu,
                          color: C.onAccent,
                          borderRadius: 20,
                          fontSize: "var(--text-2xs)",
                          padding: "2px 8px",
                          fontWeight: "var(--weight-extrabold)",
                        }}
                      >
                        {vOpenReqs.length} req
                      </span>
                    )}
                  </div>
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
                    <div
                      style={{
                        fontWeight: "var(--weight-extrabold)",
                        color: photo ? C.w : C.navy,
                        fontSize: "var(--text-md)",
                    }}
                    >
                      {v.name}
                    </div>
                    <div
                      style={{
                        fontSize: "var(--text-2xs)",
                        color: photo ? "rgba(255,255,255,0.8)" : C.sub,
                      }}
                    >
                      {v.yr} {v.make} {v.model} · #{v.plate}
                    </div>
                  </div>
                </div>
                <div style={{ padding: 12 }}>
                  {asgn && (
                    <div
                      style={{
                        fontSize: "var(--text-2xs)",
                        color: C.blue,
                        fontWeight: "var(--weight-bold)",
                        marginBottom: 6,
                      }}
                    >
                      👤 {asgn.name}
                    </div>
                  )}
                  {v.type === "truck" && (
                    <div style={{ marginBottom: 8 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "var(--text-xs)",
                          marginBottom: 3,
                        }}
                      >
                        <span style={{ color: C.sub }}>{t.mileage}</span>
                        <span style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>
                          {v.mi.toLocaleString()} mi
                        </span>
                      </div>
                      <div
                        style={{
                          height: 4,
                          background: C.lg,
                          borderRadius: 3,
                          marginBottom: 3,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: 3,
                            background:
                              os === "overdue"
                                ? C.rd
                                : os === "soon"
                                  ? C.am
                                  : C.gr,
                            width: `${Math.max(0, Math.min(100, (1 - oLeft / v.oii) * 100))}%`,
                          }}
                        />
                      </div>
                      <div
                        style={{ fontSize: "var(--text-2xs)", color: oLeft <= 0 ? C.rd : C.sub }}
                      >
                        {oLeft <= 0
                          ? "🚨 Oil overdue!"
                          : `${Math.max(0, oLeft)} mi until oil change`}
                        {pd !== null && (
                          <span style={{ color: C.blue }}>
                            {" "}
                            · ~{pd === 0 ? "overdue" : `${pd}d`}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {v.type === "truck" && (
                      <Bdg
                        color={
                          os === "overdue"
                            ? "red"
                            : os === "soon"
                              ? "amber"
                              : "green"
                        }
                      >
                        {os === "overdue"
                          ? "Oil Overdue"
                          : os === "soon"
                            ? "Oil Soon"
                            : "Oil OK"}
                      </Bdg>
                    )}
                    <Bdg
                      color={
                        ds === "overdue"
                          ? "red"
                          : ds === "soon"
                            ? "amber"
                            : "green"
                      }
                    >
                      {ds === "overdue"
                        ? "Detail Overdue"
                        : ds === "soon"
                          ? "Detail Soon"
                          : "Detail OK"}
                    </Bdg>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </>
      )}

      {calSel && (
        <Modal title={calSel.title || calSel.name || "Job Details"} onClose={() => setCalSel(null)}>
          <p style={{ margin: "0 0 8px", fontSize: "var(--text-sm)", color: C.sub }}><strong>PO:</strong> {calSel.po}</p>
          <p style={{ margin: "0 0 8px", fontSize: "var(--text-sm)", color: C.sub }}><strong>Address:</strong> {calSel.addr || "N/A"}</p>
          <p style={{ margin: "0 0 8px", fontSize: "var(--text-sm)", color: C.sub }}><strong>Scheduled:</strong> {calSel.scheduledDate || "N/A"}</p>
          <p style={{ margin: "0 0 8px", fontSize: "var(--text-sm)", color: C.sub }}>
            <strong>Site Supervisor:</strong> {users.find((u) => u.id === (calSel.assignedto || calSel.assignedTo))?.name || "Unassigned"}
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: C.sub }}>
            <strong>Trailers:</strong>{" "}
            {jobTrailers.filter((jt) => jt.job_id === calSel.id).map((jt) => vehs.find((v) => v.id === jt.trailer_id)?.name).filter(Boolean).join(", ") || "None assigned"}
          </p>
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
          <div
            style={{
              display: "flex",
              gap: "var(--space-3)",
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
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
                📍 Log Mileage
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
                🔧 Log Service
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
                👤 Assign Driver
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
                ✏️{" "}
                {isEditingInfo
                  ? "Cancel Details Edit"
                  : "Edit Vehicle Name/Plate"}
              </Btn>
            )}
            {user.role === "admin" && (
              <Btn
                v="danger"
                sz="sm"
                onClick={() => {
                  handleRemoveVehicle(sel.id, sel.name);
                  setSel(null);
                }}
              >
                🗑️ Decommission Asset
              </Btn>
            )}
          </div>

          {isEditingInfo && (
            <div
              style={{
                background: C.lg,
                padding: 14,
                borderRadius: "var(--radius-lg)",
                marginBottom: 14,
                border: `1.5px solid ${C.bd}`,
              }}
            >
              <Fld label="Vehicle Display Name / Nickname">
                <Inp
                  value={form.name || ""}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Fld>
              <div className="sw-grid-3" style={{ gap: "var(--space-3)" }}>
                <Fld label="Year">
                  <Inp
                    type="number"
                    value={form.yr || ""}
                    onChange={(e) => setForm({ ...form, yr: e.target.value })}
                  />
                </Fld>
                <Fld label="Make">
                  <Inp
                    value={form.make || ""}
                    onChange={(e) => setForm({ ...form, make: e.target.value })}
                  />
                </Fld>
                <Fld label="Model">
                  <Inp
                    value={form.model || ""}
                    onChange={(e) =>
                      setForm({ ...form, model: e.target.value })
                    }
                  />
                </Fld>
              </div>
              <div className="sw-grid-2" style={{ gap: "var(--space-3)" }}>
                <Fld label="License Plate">
                  <Inp
                    value={form.plate || ""}
                    onChange={(e) => setForm({ ...form, plate: e.target.value })}
                  />
                </Fld>
                <Fld label="Asset Type">
                  <Sel value={form.type || "truck"} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    <option value="truck">Truck</option>
                    <option value="trailer">Trailer</option>
                  </Sel>
                </Fld>
              </div>
              <Btn
                v="green"
                sz="sm"
                onClick={saveVehicleInfo}
                disabled={savingVehicleInfo}
              >
                {savingVehicleInfo ? "⏳ Saving..." : "Save Vehicle Changes"}
              </Btn>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <Fld label="Vehicle Photo">
              <PhotoUpload
                current={sel.photo_url || null}
                onUpload={(data) => setPhoto(sel.id, data)}
                canRemove={!!perms.fleet_photo_delete}
                label="Upload vehicle photo"
                maxDim={600}
                quality={0.75}
                previewHeight={200}
              />
            </Fld>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))",
              gap: "var(--space-3)",
              marginBottom: 16,
            }}
          >
            {[
              ["Plate", sel.plate],
              [
                "Assigned To",
                users.find((u) => u.id === sel.assignedTo)?.name ||
                  "Unassigned",
              ],
              ...(sel.type === "truck"
                ? [
                    [t.mileage, sel.mi.toLocaleString()],
                    ["Last Oil @ Mi", sel.lomi.toLocaleString()],
                    ["Miles Rem.", Math.max(0, sel.oii - (sel.mi - sel.lomi))],
                  ]
                : []),
              ["Last Detail", fd(sel.ldd)],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: 10 }}
              >
                <div
                  style={{
                    fontSize: "var(--text-2xs)",
                    color: C.sub,
                    fontWeight: "var(--weight-bold)",
                    textTransform: "uppercase",
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--weight-extrabold)",
                    color: C.navy,
                    marginTop: 1,
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          {predictedServices.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4
                style={{
                  margin: "0 0 8px",
                  color: C.navy,
                  fontSize: "var(--text-sm)",
                  textTransform: "uppercase",
                }}
              >
                🔧 Predicted Next Service
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {predictedServices.map((p) => (
                  <div
                    key={p.type}
                    style={{
                      background: C.pB,
                      border: `1px solid ${C.pu}`,
                      borderRadius: "var(--radius-md)",
                      padding: "8px 12px",
                      fontSize: "var(--text-sm)",
                    }}
                  >
                    <div style={{ fontWeight: "var(--weight-extrabold)", color: C.pu }}>
                      {p.type} — ~{fd(p.predictedNextDate)}
                      {p.predictedNextMileage !== null && ` · ${p.predictedNextMileage.toLocaleString()} mi`}
                    </div>
                    <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>
                      Based on {p.sampleSize} past service{p.sampleSize === 1 ? "" : "s"} · every ~
                      {p.avgIntervalDays}d
                      {p.avgIntervalMiles !== null && ` / ${p.avgIntervalMiles.toLocaleString()} mi`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h4
            style={{
              margin: "0 0 8px",
              color: C.navy,
              fontSize: "var(--text-sm)",
              textTransform: "uppercase",
            }}
          >
            Service History
          </h4>
          {sel.sl.length === 0 ? (
            <p style={{ color: C.sub, fontSize: "var(--text-sm)", margin: 0 }}>
              No service records.
            </p>
          ) : (
            [...sel.sl]
              .sort((a, b) => new Date(b.dt) - new Date(a.dt))
              .map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: "10px 14px",
                    background: C.lg,
                    borderRadius: "var(--radius-md)",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "var(--space-3)",
                    }}
                  >
                    <div>
                      <Bdg color={s.type === "Oil Change" ? "blue" : "green"}>
                        {s.type}
                      </Bdg>
                      <div
                        style={{
                          fontWeight: "var(--weight-bold)",
                          color: C.navy,
                          marginTop: 4,
                          fontSize: "var(--text-base)",
                        }}
                      >
                        {fd(s.dt)}
                      </div>
                      <div style={{ fontSize: "var(--text-xs)", color: C.sub }}>
                        {s.by}
                        {s.mi ? ` · ${s.mi.toLocaleString()} mi` : ""}
                      </div>
                    </div>
                    {s.cost > 0 && (
                      <div style={{ fontWeight: "var(--weight-extrabold)", color: C.blue }}>
                        {fm(s.cost)}
                      </div>
                    )}
                  </div>
                </div>
              ))
          )}
        </Modal>
      )}

      {modal === "assign" && sel && (
        <Modal
          title={`Assign Driver — ${sel.name}`}
          onClose={() => setModal(null)}
        >
          <Fld label="Assigned Driver">
            <Sel
              value={form.assignedTo || ""}
              onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
            >
              <option value="">— Unassigned —</option>
              {users
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Sel>
          </Fld>
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn
              v="ghost"
              onClick={() => setModal(null)}
              style={{ flex: 1, justifyContent: "center" }}
            >
              Cancel
            </Btn>
            <Btn
              v="primary"
              onClick={assignUser}
              style={{ flex: 1, justifyContent: "center" }}
            >
              Save
            </Btn>
          </div>
        </Modal>
      )}

      {modal === "mi" && sel && (
        <Modal
          title={`Log Mileage — ${sel.name}`}
          onClose={() => setModal(null)}
        >
          <div
            style={{
              background: C.lg,
              borderRadius: "var(--radius-md)",
              padding: 10,
              marginBottom: 12,
              fontSize: "var(--text-sm)",
              color: C.sub,
            }}
          >
            Current: <strong>{sel.mi.toLocaleString()} mi</strong>
          </div>
          <Fld label="Date">
            <Inp
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </Fld>
          <Fld label="Odometer (miles)">
            <Inp
              type="number"
              value={form.mi}
              onChange={(e) => setForm({ ...form, mi: e.target.value })}
            />
          </Fld>
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn
              v="ghost"
              onClick={() => setModal(null)}
              style={{ flex: 1, justifyContent: "center" }}
            >
              Cancel
            </Btn>
            <Btn
              v="primary"
              onClick={logMi}
              style={{ flex: 1, justifyContent: "center" }}
            >
              Save
            </Btn>
          </div>
        </Modal>
      )}

      {modal === "svc" && sel && perms.fleet_log_service && (
        <Modal
          title={`Log Service — ${sel.name}`}
          onClose={() => setModal(null)}
        >
          <Fld label="Service Type">
            <Sel
              value={form.type || "Oil Change"}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {[
                "Oil Change",
                "Tire Rotation",
                "Brake Service",
                "Repair",
                "Detail",
                "Inspection",
                "Other",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Sel>
          </Fld>
          <Fld label="Date">
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
          <Fld label="Performed By">
            <Inp
              value={form.by || ""}
              onChange={(e) => setForm({ ...form, by: e.target.value })}
              placeholder="Shop or employee"
            />
          </Fld>
          <Fld label="Cost ($)">
            <Inp
              type="number"
              step="0.01"
              value={form.cost || ""}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
            />
          </Fld>
          <Fld label="Notes">
            <Inp
              value={form.notes || ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Fld>
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Btn
              v="ghost"
              onClick={() => setModal(null)}
              style={{ flex: 1, justifyContent: "center" }}
            >
              Cancel
            </Btn>
            <Btn
              v="primary"
              onClick={logSvc}
              style={{ flex: 1, justifyContent: "center" }}
            >
              Save
            </Btn>
          </div>
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

    </div>
  );
}