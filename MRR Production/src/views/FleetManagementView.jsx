// src/views/FleetManagementView.jsx
import { useState } from "react";
import { supabase } from "../utils/supabase";
import {
  Btn,
  Bdg,
  Fld,
  Inp,
  Sel,
  TA,
  Modal,
  PhotoUpload,
} from "../components/UIPrimitives";
import { C } from "../utils/helpers";
import { ROLES } from "../database/permissions";
import { logAction } from "../utils/logger";
import { useNotify } from "../context/NotificationContext";

// ── SUB-COMPONENT: ReqModal (Named Export) ─────────
export function ReqModal({ vehs, user, onSave, onClose, preVid, uid }) {
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

  const handleApproveMaintenance = async (requestId, vehicleVin) => {
    await logAction(
      user.id,
      user.email,
      "FLEET_MAINTENANCE",
      `Approved maintenance ticket for vehicle VIN: ${vehicleVin}`,
      { ticketId: requestId },
            "fleet" 
    );
  };

  return (
    <Modal title="🔧 Submit Maintenance Request" onClose={onClose}>
      <div
        style={{
          background: C.pB,
          border: `1.5px solid ${C.pu}`,
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 14,
          fontSize: 12,
          color: C.pu,
          fontWeight: 600,
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
            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "1fr 1fr", 
              gap: "10px", 
              background: "#f8fafc", 
              padding: 12, 
              borderRadius: 8,
              border: `1px solid ${C.bd || "#e2e8f0"}` 
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
                  <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: C.navy, cursor: "pointer" }}>
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
      <div style={{ display: "flex", gap: 10 }}>
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

// ── MAIN VIEW COMPONENT (The Only Default Export) ──
export default function FleetManagementView({
  vehs,
  setVehs,
  reqs,
  setReqs,
  users,
  user,
  perms,
  vehPhotos,
  setVehPhotos,
  oilSt,
  detSt,
  predDays,
  fd,
  fm,
}) {
  const { showToast } = useNotify();
  const [filt, setFilt] = useState("all");
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [reqModal, setReqModal] = useState(false);
  const [reqVid, setReqVid] = useState("");
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [inspectSubmitting, setInspectSubmitting] = useState(false);
  const [inspectionForm, setInspectionForm] = useState({
    vehicleId: "",
    notes: "",
    photos: [] 
  });
  const filtered = vehs.filter((v) => filt === "all" || v.type === filt);
  const setPhoto = (id, data) =>
    setVehPhotos((p) =>
      data
        ? { ...p, [id]: data }
        : Object.fromEntries(Object.entries(p).filter(([k]) => k !== id)),
    );

  const logMi = () => {
    if (!form.mi || !form.date) return;
    const mi = parseFloat(form.mi);
    if (mi < sel.mi) {
      showToast("Cannot be less than current mileage.", "info");
      return;
    }
    const up = {
      ...sel,
      mi,
      mil: [...sel.mil, { dt: form.date, mi, by: user.id }],
    };
    setVehs((p) => p.map((v) => (v.id === sel.id ? up : v)));
    setSel(up);
    setModal(null);
    setForm({});
  };

  const logSvc = () => {
    if (!form.type || !form.date) return;
    const e = {
      id: Math.random().toString(36).slice(2, 10),
      type: form.type,
      dt: form.date,
      mi: parseFloat(form.mi) || sel.mi,
      by: form.by || user.name,
      notes: form.notes || "",
      cost: parseFloat(form.cost) || 0,
    };
    const up = {
      ...sel,
      sl: [...sel.sl, e],
      ...(form.type === "Oil Change" ? { lomi: e.mi } : {}),
      ...(form.type === "Detail" ? { ldd: form.date } : {}),
    };
    setVehs((p) => p.map((v) => (v.id === sel.id ? up : v)));
    setSel(up);
    setModal(null);
    setForm({});
  };

  const assignUser = () => {
    const up = { ...sel, assignedTo: form.assignedTo || "" };
    setVehs((p) => p.map((v) => (v.id === sel.id ? up : v)));
    setSel(up);
    setModal(null);
    setForm({});
  };

// ── 🟢 ADD HERE: DATABASE CONTROLLER FOR VEHICLE INSPECTION SUBMISSIONS ──
  const handleCreateInspection = async () => {
    if (!inspectionForm.vehicleId) {
      showToast("Please select a vehicle asset for inspection logging.", "error");
      return;
    }
    setInspectSubmitting(true);

    const targetVehicle = vehs.find(v => String(v.id) === String(inspectionForm.vehicleId));
    const vehicleLabel = targetVehicle 
      ? `${targetVehicle.name} (${targetVehicle.plate})` 
      : "Unknown Fleet Asset";

    const inspectionPayload = {
      vehicle_id: inspectionForm.vehicleId,
      vehicle_name: vehicleLabel,
      inspector_name: user.name || user.email,
      inspector_id: user.id,
      notes: inspectionForm.notes.trim(),
      photos: inspectionForm.photos,
      created_at: new Date().toISOString()
    };

    try {
      const { error } = await supabase
        .from("vehicle_inspections")
        .insert([inspectionPayload]);

      if (error) throw error;

      await logAction(
        user.id,
        user.email,
        "FLEET_MAINTENANCE",
        `Logged a formal condition inspection report for vehicle asset: ${vehicleLabel}`,
        { vehicle_id: inspectionForm.vehicleId, attached_photos_count: inspectionForm.photos.length },
        "fleet"
      );

      showToast("Inspection records and photos committed successfully!", "success");
      setIsInspectOpen(false);
      setInspectionForm({ vehicleId: "", notes: "", photos: [] });
    } catch (err) {
      showToast(`Database Transaction Blocked: ${err.message}`, "error");
    } finally {
      setInspectSubmitting(false);
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
      <div style={{ 
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "60px 20px", background: "#ffffff", borderRadius: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        textAlign: "center", marginTop: 10 
      }}>
        <span style={{ fontSize: "48px", marginBottom: 16 }}>🚛</span>
        <h3 style={{ margin: "0 0 8px 0", color: "#0f294a", fontWeight: 800 }}>Fleet Registry Empty</h3>
        <p style={{ margin: "0 0 20px 0", color: "#64748b", fontSize: 13, maxWidth: "340px" }}>
          No company vehicles are currently configured for tracking at the Saint Joe Road Warehouse.
        </p>
        {perms.fleet_manage && (
          <Btn v="gold" onClick={() => {}}>
            + Register First Fleet Vehicle
          </Btn>
        )}
      </div>
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
          gap: 10,
          flexShrink: 0
        }}
      >
        <div>
          <h1
            style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}
          >
            Base Fleet Management
          </h1>
          <p style={{ margin: "2px 0 0", color: C.sub, fontSize: 12 }}>
            {vehs.filter((v) => v.type === "truck").length} trucks ·{" "}
            {vehs.filter((v) => v.type === "trailer").length} trailers
          </p>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {/* ── 🟢 ADD HERE: THE LOG INSPECTION TOGGLE ACTION BUTTON ── */}
          {(user.role === "admin" || user.name === "John" || user.name === "Adam" || perms.fleet_manage) && (
            <Btn
              v="gold"
              sz="sm"
              onClick={() => setIsInspectOpen(true)}
              style={{ fontWeight: 800 }}
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
              🔧 Request Maintenance
            </Btn>
          )}
          <div style={{ display: "flex", gap: 5 }}>
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
          </div>
        </div>
      </div>

      {/* ── 🟢 2. INJECT ENCLOSED SCROLL TRACK CONTAINER FOR INTERIOR ELEMENTS ONLY ── */}
      <div 
        style={{
          flex: 1,
          overflowY: "auto",
          paddingRight: 6,
          paddingBottom: 24,
          scrollbarWidth: "thin", // Native Firefox layout alignment compatibility rules fallback
          scrollbarColor: "#cbd5e1 transparent"
        }}
      >
        {/* Fleet Grid Tracker */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(265px, 1fr))",
            gap: 14,
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
            const photo = vehPhotos[v.id];
            return (
              <div
                key={v.id}
                onClick={() => setSel(v)}
                style={{
                  background: C.w,
                  borderRadius: 12,
                  overflow: "hidden",
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
                  border: `2px solid ${bc}`,
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: "11px",
                    fontWeight: 800,
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
                          color: C.w,
                          borderRadius: 20,
                          fontSize: 10,
                          padding: "2px 8px",
                          fontWeight: 800,
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
                        fontWeight: 800,
                        color: photo ? C.w : C.navy,
                        fontSize: 14,
                    }}
                    >
                      {v.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
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
                        fontSize: 10,
                        color: C.blue,
                        fontWeight: 700,
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
                          fontSize: 11,
                          marginBottom: 3,
                        }}
                      >
                        <span style={{ color: C.sub }}>Mileage</span>
                        <span style={{ fontWeight: 700, color: C.navy }}>
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
                        style={{ fontSize: 10, color: oLeft <= 0 ? C.rd : C.sub }}
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
              gap: 8,
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
                    date: new Date().toISOString().split("T")[0],
                    mi: sel.mi,
                  });
                  setModal("mi");
                }}
              >
                📍 Log Mileage
              </Btn>
            )}
            {perms.fleet_edit && (
              <Btn
                v="outline"
                sz="sm"
                onClick={() => {
                  setForm({
                    type: "Oil Change",
                    date: new Date().toISOString().split("T")[0],
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
                borderRadius: 10,
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
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 8,
                }}
              >
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
              <Fld label="License Plate">
                <Inp
                  value={form.plate || ""}
                  onChange={(e) => setForm({ ...form, plate: e.target.value })}
                />
              </Fld>
              <Btn
                v="green"
                sz="sm"
                onClick={() => {
                  const updated = {
                    ...sel,
                    name: form.name,
                    yr: parseInt(form.yr) || sel.yr,
                    make: form.make,
                    model: form.model,
                    plate: form.plate,
                  };
                  setVehs((p) => p.map((v) => (v.id === sel.id ? updated : v)));
                  setSel(updated);
                  setIsEditingInfo(false);
                }}
              >
                Save Vehicle Changes
              </Btn>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <Fld label="Vehicle Photo">
              <PhotoUpload
                current={vehPhotos[sel.id] || null}
                onUpload={(data) => setPhoto(sel.id, data)}
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
              gap: 8,
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
                    ["Mileage", sel.mi.toLocaleString()],
                    ["Last Oil @ Mi", sel.lomi.toLocaleString()],
                    ["Miles Rem.", Math.max(0, sel.oii - (sel.mi - sel.lomi))],
                  ]
                : []),
              ["Last Detail", fd(sel.ldd)],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{ background: C.lg, borderRadius: 8, padding: 10 }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: C.sub,
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: C.navy,
                    marginTop: 1,
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          <h4
            style={{
              margin: "0 0 8px",
              color: C.navy,
              fontSize: 12,
              textTransform: "uppercase",
            }}
          >
            Service History
          </h4>
          {sel.sl.length === 0 ? (
            <p style={{ color: C.sub, fontSize: 12, margin: 0 }}>
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
                    borderRadius: 8,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div>
                      <Bdg color={s.type === "Oil Change" ? "blue" : "green"}>
                        {s.type}
                      </Bdg>
                      <div
                        style={{
                          fontWeight: 700,
                          color: C.navy,
                          marginTop: 4,
                          fontSize: 13,
                        }}
                      >
                        {fd(s.dt)}
                      </div>
                      <div style={{ fontSize: 11, color: C.sub }}>
                        {s.by}
                        {s.mi ? ` · ${s.mi.toLocaleString()} mi` : ""}
                      </div>
                    </div>
                    {s.cost > 0 && (
                      <div style={{ fontWeight: 800, color: C.blue }}>
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
          <div style={{ display: "flex", gap: 10 }}>
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
              borderRadius: 8,
              padding: 10,
              marginBottom: 12,
              fontSize: 12,
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
          <div style={{ display: "flex", gap: 10 }}>
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

      {modal === "svc" && sel && (
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
            <Fld label="Mileage">
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
          <div style={{ display: "flex", gap: 10 }}>
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
        <ReqModal
          vehs={vehs}
          user={user}
          preVid={reqVid}
          onSave={(r) => setReqs((p) => [r, ...p])}
          onClose={() => {
            setReqModal(false);
            setReqVid("");
          }}
        />
      )}

{isInspectOpen && (
        <Modal title="📋 File Vehicle Condition & Inspection Report" onClose={() => setIsInspectOpen(false)} wide>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            
            <Fld label="Select Fleet Vehicle *">
              <Sel 
                value={inspectionForm.vehicleId} 
                onChange={(e) => setInspectionForm({ ...inspectionForm, vehicleId: e.target.value })}
                disabled={inspectSubmitting}
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
                value={inspectionForm.notes} 
                onChange={(e) => setInspectionForm({ ...inspectionForm, notes: e.target.value })}
                disabled={inspectSubmitting}
              />
            </Fld>

            <Fld label="Upload Inspection Pictures / Condition Evidence">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <PhotoUpload 
                  current={null} 
                  onUpload={(base64) => setInspectionForm(prev => ({ ...prev, photos: [...prev.photos, base64] }))} 
                  maxDim={800}
                  quality={0.80}
                />
                {inspectionForm.photos.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {inspectionForm.photos.map((img, idx) => (
                      <div key={idx} style={{ position: "relative", width: 70, height: 70, borderRadius: 6, overflow: "hidden", border: "1px solid #cbd5e1" }}>
                        <img src={img} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        <button 
                          onClick={() => setInspectionForm(prev => ({ ...prev, photos: prev.photos.filter((_, i) => i !== idx) }))}
                          style={{ position: "absolute", top: 2, right: 2, background: "rgba(15,23,42,0.8)", color: "#fff", border: "none", borderRadius: "50%", width: 16, height: 16, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Fld>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Btn v="ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setIsInspectOpen(false)} disabled={inspectSubmitting}>Cancel</Btn>
              <Btn v="gold" style={{ flex: 1, justifyContent: "center" }} onClick={handleCreateInspection} disabled={inspectSubmitting}>
                {inspectSubmitting ? "⏳ Saving Log Entry..." : "💾 Commit Inspection Log"}
              </Btn>
            </div>

          </div>
        </Modal>
      )}

    </div>
  );
}