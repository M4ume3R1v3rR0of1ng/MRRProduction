// src/features/maintenance/MaintenanceRequestsView.jsx
import { useState, useEffect } from "react";
import {
  Wrench,
  Bell,
  ClipboardList,
  Calendar,
  Plus,
  Repeat,
  TrendingUp,
  AlertOctagon,
  CheckCircle2,
  FileText,
  Trash2,
  History,
} from "lucide-react";
import { supabase, updateRowStrict } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import { useStickySort } from "@/shared/hooks/useStickySort";
import { detectChronicIssues, detectFleetTrends } from "@/features/fleet/patterns";
import {
  Btn,
  Bdg,
  Fld,
  Inp,
  Sel,
  TA,
  Modal,
  PhotoUpload,
  EmptyState,
  Row,
  Stack,
  Text,
  Muted,
  Callout,
  PageHeader,
  Segmented,
  Card,
  TextBtn,
} from "@/shared/components/UIPrimitives";
import { notifyMaintFiled, notifyMaintStatus } from "@/shared/utils/maintenanceNotifications";
import { useNotify } from "@/shared/context/NotificationContext";
import { logAction } from "@/shared/utils/logger";
import MaintenanceCalendar from "./MaintenanceCalendar";
import SearchBar, { matchesQuery } from "@/shared/components/SearchBar";
import CompleteServiceModal from "./CompleteServiceModal";
import { generateMaintenancePdf } from "./maintenancePdf";

// The values of the <option> list in this view's sort dropdown, in the same
// order. useStickySort checks a remembered choice against this before trusting
// it, so a sort that is renamed or removed later degrades to the default rather
// than leaving the control blank. Keep it in step with the JSX.
const SORTS = ["newest", "oldest", "urgency", "vehicle_az", "vehicle_za", "status"];

export default function MaintenanceRequestsView({
  reqs,
  setReqs,
  vehs,
  setVehs,
  users,
  user,
  perms,
  curUser,
  maintenanceNotifications,
  maintManagers = [],
  lang,
  openItemId,
  onOpenItemHandled,
  company,
  activeLogo,
}) {
  const { showToast } = useNotify();
  const t = translations[lang] || translations.en;
  const activeUser = user ||
    curUser || { id: "system", email: "unknown@mrr.com", name: "Crew Member" };

  const [filt, setFilt] = useState("all");
  const [sortBy, setSortBy] = useStickySort("maint", SORTS, "newest");
  const [srch, setSrch] = useState("");
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState({});
  const [subView, setSubView] = useState("list");

  // The ticket "Complete Service" was opened against. Separate from `sel` so the
  // review modal underneath stays mounted with its own state while this one is open.
  const [completeServiceReq, setCompleteServiceReq] = useState(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTicket, setNewTicket] = useState({
    vehicleId: "",
    type: [],
    urgency: "standard",
    notes: "",
    photo: null,
  });

  const urgencyRank = { urgent: 3, high: 3, priority: 2, standard: 2, normal: 2, low: 1 };
  const reqSorters = {
    newest: (a, b) => new Date(b.at || 0) - new Date(a.at || 0),
    oldest: (a, b) => new Date(a.at || 0) - new Date(b.at || 0),
    vehicle_az: (a, b) =>
      (a.vname || "").localeCompare(b.vname || "", undefined, { numeric: true }),
    vehicle_za: (a, b) =>
      (b.vname || "").localeCompare(a.vname || "", undefined, { numeric: true }),
    urgency: (a, b) =>
      (urgencyRank[(b.urgency || "").toLowerCase()] || 0) -
      (urgencyRank[(a.urgency || "").toLowerCase()] || 0),
    status: (a, b) => (a.status || "").localeCompare(b.status || ""),
  };
  const filtered = reqs
    .filter((r) => {
      if (filt === "all") return true;
      if (filt === "active") return r.status === "pending" || r.status === "scheduled";
      return r.status === filt;
    })
    // vname and uname are the denormalised copies already on the row, so the
    // vehicle and the person who filed it are searchable without resolving ids —
    // which also means a ticket from a since-deleted account stays findable.
    // r.type can be an array; String() joins it, which is fine for a substring match.
    .filter((r) => matchesQuery(srch, [r.vname, r.uname, r.notes, r.type]))
    .sort(reqSorters[sortBy] || reqSorters.newest);

  // Deep-link from OmniSearch: open the matching ticket card on arrival
  useEffect(() => {
    if (!openItemId) return;
    const target = reqs.find((r) => String(r.id) === String(openItemId));
    if (target) {
      setSubView("list");
      setSel(target);
    }
    onOpenItemHandled?.();
  }, [openItemId]);

  const handleCreateRequest = async () => {
    if (!newTicket.vehicleId) {
      showToast(t.maintSelectVehicleErr, "error");
      return;
    }
    if (!Array.isArray(newTicket.type) || newTicket.type.length === 0) {
      showToast(t.maintSelectIssueErr, "error");
      return;
    }
    if (!newTicket.notes.trim()) {
      showToast(t.maintDescribeErr, "error");
      return;
    }

    const selectedVehicle = vehs.find(
      (v) => v.id === newTicket.vehicleId || String(v.id) === String(newTicket.vehicleId),
    );
    // Identify the vehicle the way the crew does — by its unit number (v.name, e.g.
    // "011"), matching the format FleetManagementView files tickets under. Make/model
    // alone can't tell two F-250s apart, and `plates` is not a column (it's `plate`),
    // so that read was always undefined and every ticket saved as "(No Plate)".
    const vehicleName = selectedVehicle
      ? `${selectedVehicle.name} (${selectedVehicle.plate || "No Plate"})`
      : "Unknown Vehicle";

    const requestPayload = {
      vid: newTicket.vehicleId,
      vname: vehicleName,
      vtype: selectedVehicle ? selectedVehicle.type : "truck",
      type: newTicket.type.join(", "),
      urgency: newTicket.urgency,
      notes: newTicket.notes.trim(),
      photo: newTicket.photo || null,
      uname: user.name || user.email,
      uid: user.id,
      status: "pending",
      at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("maintenance_requests")
      .insert([requestPayload])
      .select();

    if (error) {
      showToast(t.maintSubmitFail + " " + error.message, "error");
      return;
    }

    if (!data || !data[0]) {
      // The insert committed server-side but PostgREST couldn't read the row back
      // (most commonly a SELECT policy that doesn't match the new row yet). Falling
      // back to requestPayload here would add a ticket to local state with no id —
      // every later action on it (Approve & Schedule, status changes, delete) would
      // then match zero rows against the real row and fail with a confusing "record
      // no longer exists" error. Surface the problem now instead of silently faking
      // success.
      showToast(t.maintSubmitUnconfirmed, "error");
      return;
    }

    const createdRecord = data[0];

    // ── AUDIT LOG: NEW TICKET CREATED ──
    await logAction(
      user.id,
      user.email,
      "MAINTENANCE_REQUEST_CREATE",
      `Filed new maintenance request for vehicle: ${vehicleName} (Urgency: ${newTicket.urgency.toUpperCase()})`,
      {
        ticket_id: createdRecord.id || "N/A",
        vehicle_id: newTicket.vehicleId,
        issue_types: newTicket.type,
      },
      "maintenance",
    );

    // Same fire-and-forget dispatch as the Fleet view's copy of this flow: the ticket is
    // already saved, so the relay must never turn a successful filing into an error.
    notifyMaintFiled({
      req: createdRecord,
      recipients: maintManagers,
      prefs: maintenanceNotifications,
      excludeUserId: user.id,
    });

    setReqs((prev) => [createdRecord, ...prev]);
    showToast(t.maintFiledOk, "success");

    setNewTicket({
      vehicleId: "",
      type: [],
      urgency: "standard",
      notes: "",
      photo: null,
    });
    setIsCreateOpen(false);
  };

  const updateStatus = async (id, status, whNotes = "") => {
    const scheduledDate = form.scheduledDate || "";
    const completedAt = status === "completed" ? new Date().toISOString() : "";

    const currentTicket = reqs.find((r) => r.id === id);
    // Flag the change so the requester gets a dashboard alert (same pattern as jobs.newforassigned);
    // skipped when someone updates their own ticket so they don't alert themselves.
    const notifyRequester = !!currentTicket && String(currentTicket.uid) !== String(user.id);

    const { error } = await updateRowStrict(
      "maintenance_requests",
      id,
      {
        status,
        wh_notes: whNotes,
        scheduled_date: scheduledDate,
        completed_at: completedAt,
        newforrequester: notifyRequester,
      },
      user.companyId,
    );

    if (error) {
      showToast(t.maintUpdateErr + " " + error.message, "error");
      return;
    }

    const vehicleLabel = currentTicket ? currentTicket.vname : `Ticket ID: ${id}`;

    // ── AUDIT LOG: STATUS CHANGE WORKFLOW ──
    await logAction(
      user.id,
      user.email,
      status === "completed" ? "FLEET_MAINTENANCE" : "INV_MUTATION",
      `Updated vehicle request status for "${vehicleLabel}" to: ${status.toUpperCase()}`,
      { ticket_id: id, status_transition: status, scheduler_notes: whNotes },
      "maintenance",
    );

    // Email the requester the same news the dashboard popup carries. `notifyRequester`
    // already encodes "this wasn't the requester's own edit"; actorId re-checks it inside
    // the helper so the rule holds if this call is ever moved.
    if (notifyRequester) {
      notifyMaintStatus({
        status,
        req: {
          ...currentTicket,
          wh_notes: whNotes,
          scheduled_date: scheduledDate,
          completed_at: completedAt,
        },
        users,
        prefs: maintenanceNotifications,
        actorId: user.id,
      });
    }

    setReqs((p) =>
      p.map((r) =>
        r.id === id
          ? {
              ...r,
              status,
              wh_notes: whNotes,
              scheduled_date: scheduledDate,
              completed_at: completedAt,
              newforrequester: notifyRequester,
            }
          : r,
      ),
    );
    setSel(null);
    setForm({});
    showToast(t.maintStatusUpdated, "success");
  };

  const handleDeleteRequest = async (id) => {
    if (!window.confirm(t.maintDeleteConfirm)) {
      return;
    }

    const targetTicket = reqs.find((r) => r.id === id);
    const targetLabel = targetTicket ? targetTicket.vname : `ID: ${id}`;

    const { error } = await supabase.from("maintenance_requests").delete().eq("id", id);

    if (error) {
      showToast(t.maintDeleteFail + " " + error.message, "error");
      return;
    }

    // ── AUDIT LOG: REQUEST REMOVED / DELETED ──
    await logAction(
      user.id,
      user.email,
      "FLEET_STATUS_CHANGE",
      `Permanently purged maintenance request ticket file for vehicle: "${targetLabel}"`,
      { purged_ticket_id: id, metadata_backup: targetTicket || {} },
      "maintenance",
    );

    setReqs((p) => p.filter((r) => r.id !== id));
    setSel(null);
    setForm({});
    showToast(t.maintDeletedOk, "success");
  };

  // Close out a scheduled ticket in one step: log the service to the vehicle,
  // mark the request completed, and optionally reassign its driver — all in one
  // database round trip. See supabase/34_complete_maintenance_service.sql for why
  // this is a single RPC and not three separate writes from here.
  const completeService = async (req, details) => {
    const { data, error } = await supabase.rpc("complete_maintenance_service", {
      p_request_id: req.id,
      p_service_type: details.serviceType,
      p_service_date: details.serviceDate,
      p_performed_by: details.performedBy,
      p_notes: details.notes,
      p_cost: details.cost,
      p_mileage: details.mileage,
      // undefined here would drop the key entirely and the RPC's own default
      // (no change) would apply anyway — passed explicitly so the intent reads
      // the same in this call as it does in the SQL.
      p_reassign_driver_id:
        details.reassignDriverId === undefined ? null : details.reassignDriverId,
    });
    if (error) throw error;

    const nowIso = new Date().toISOString();
    const notifyRequester = String(req.uid) !== String(user.id);

    setReqs((p) =>
      p.map((r) =>
        r.id === req.id
          ? {
              ...r,
              status: "completed",
              wh_notes: details.notes || r.wh_notes,
              completed_at: nowIso,
              // Mirrors what supabase/38_complete_service_notifies_driver.sql now sets
              // server-side, so this session's own optimistic update doesn't disagree
              // with the row the RPC actually wrote.
              newforrequester: notifyRequester,
            }
          : r,
      ),
    );

    // Re-read the vehicle(s) the RPC touched rather than reconstructing the change
    // here. The service log entry's generated id, and — when this ticket had lent a
    // spare — what the completion trigger (19_maintenance_vehicle_swap.sql) decided
    // to do with both trucks' drivers, are only known to the database.
    // Scoped to this company as well as the ids: vehicles' PK is (company_id, id)
    // and those ids repeat across tenants, so an id-only filter can pull another
    // company's truck into this list — which setVehs below would then paste over
    // the real one.
    const vehicleIds = [req.vid, req.replacement_vehicle_id].filter(Boolean);
    const { data: freshVehs, error: refetchErr } = await supabase
      .from("vehicles")
      .select("*")
      .eq("company_id", user.companyId)
      .in("id", vehicleIds);
    if (!refetchErr && freshVehs) {
      setVehs((p) => p.map((v) => freshVehs.find((f) => f.id === v.id) || v));
    }

    await logAction(
      user.id,
      user.email,
      "FLEET_MAINTENANCE",
      `Completed service for "${req.vname}": ${details.serviceType}${details.cost ? ` ($${details.cost})` : ""}`,
      { ticket_id: req.id, vehicle_id: req.vid, service: data?.service || details },
      "maintenance",
    );

    if (notifyRequester) {
      notifyMaintStatus({
        status: "completed",
        req: { ...req, wh_notes: details.notes, completed_at: nowIso },
        users,
        prefs: maintenanceNotifications,
        actorId: user.id,
      });
    }

    setSel(null);
    setForm({});
    showToast(t.maintStatusUpdated, "success");
  };

  const downloadServiceReport = (req) => {
    if (!generateMaintenancePdf(req, company, activeLogo)) {
      showToast(t.maintPdfPopupBlocked, "warning");
    }
  };

  const pendingCount = reqs.filter((r) => r.status === "pending").length;
  const chronicIssues = perms.maint_manage ? detectChronicIssues(reqs) : [];
  const trendingIssues = perms.maint_manage ? detectFleetTrends(reqs) : [];

  return (
    <div>
      {/* Header Bar */}
      <PageHeader
        icon={Wrench}
        title={t.maintTitle}
        style={{ marginBottom: 20 }}
        actions={
          <>
            {pendingCount > 0 && (
              <Bdg color="red">
                <Row inline as="span" gap={2}>
                  <Bell size={13} aria-hidden="true" /> {pendingCount} {t.maintAwaiting}
                </Row>
              </Bdg>
            )}
            <Segmented
              value={subView}
              onChange={setSubView}
              style={{ marginRight: 4 }}
              options={[
                { value: "list", label: t.maintRequestList, icon: ClipboardList },
                { value: "calendar", label: t.maintScheduleCalendar, icon: Calendar },
              ]}
            />
            <Btn
              v="primary"
              sz="sm"
              onClick={() => setIsCreateOpen(true)}
              style={{ fontWeight: "var(--weight-extrabold)" }}
            >
              <Plus size={14} aria-hidden="true" /> {t.maintNewRequest}
            </Btn>
          </>
        }
      />

      {(chronicIssues.length > 0 || trendingIssues.length > 0) && (
        <Stack gap={2} style={{ marginBottom: 16 }}>
          {chronicIssues.map((c) => (
            <Callout
              key={`${c.vid}::${c.issueType}`}
              tone="danger"
              icon={Repeat}
              pad="8px 14px"
              size="sm"
              weight="bold"
              color={C.rust}
            >
              {c.vname} — "{c.issueType}" {t.maintReported} {c.count}x {t.maintInLast60}
            </Callout>
          ))}
          {trendingIssues.map((trend) => (
            <Callout
              key={trend.issueType}
              tone="warn"
              icon={TrendingUp}
              pad="8px 14px"
              size="sm"
              weight="bold"
              color={C.warn}
            >
              "{trend.issueType}" {t.maintTrendingUp} — {trend.recentCount} {t.maintInLast30}
              {!trend.isNew && ` (${trend.ratio}${t.maintBaselineRate})`}
            </Callout>
          ))}
        </Stack>
      )}

      {subView === "calendar" ? (
        <MaintenanceCalendar
          reqs={reqs}
          vehs={vehs}
          user={activeUser}
          setReqs={setReqs}
          onRequestClick={(r) => setSel(r)}
          lang={lang}
        />
      ) : (
        <>
          {/* Filter Tabs + Sort */}
          <Row wrap style={{ marginBottom: 16 }}>
            <Segmented
              value={filt}
              onChange={setFilt}
              options={[
                { value: "all", label: t.all },
                { value: "active", label: t.active },
                { value: "pending", label: t.pending },
                { value: "scheduled", label: t.scheduled },
                { value: "completed", label: t.completed },
              ]}
            />
            <Sel
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label={t.maintSortAria}
              style={{ width: "auto" }}
            >
              <option value="newest">↕ {t.sortDateNewest}</option>
              <option value="oldest">↕ {t.sortDateOldest}</option>
              <option value="urgency">↕ {t.sortUrgencyHigh}</option>
              <option value="vehicle_az">↕ {t.sortVehicleAZ}</option>
              <option value="vehicle_za">↕ {t.sortVehicleZA}</option>
              <option value="status">↕ {t.status}</option>
            </Sel>
          </Row>

          <SearchBar
            value={srch}
            onChange={setSrch}
            placeholder={t.maintSearchPlaceholder}
            resultCount={filtered.length}
            lang={lang}
          />

          {/* Cards Stream Canvas */}
          <Stack>
            {filtered.length === 0 ? (
              <EmptyState
                message={t.maintNoneFound}
                messageStyle={{ fontSize: "inherit", fontWeight: "inherit" }}
                style={{ border: `1px solid ${C.line}`, boxShadow: "none" }}
              />
            ) : (
              filtered.map((r) => {
                const isUrgent = r.urgency === "urgent";
                return (
                  <Card
                    key={r.id}
                    hover
                    style={isUrgent ? { background: C.rB, borderColor: C.rustWash } : undefined}
                  >
                    <Row gap={7} justify="space-between" wrap>
                      {/* Left Side Metadata Info */}
                      <Stack gap={0} style={{ flex: 1, minWidth: 260 }}>
                        <Row gap={2} wrap style={{ marginBottom: 6 }}>
                          <Bdg
                            color={
                              r.status === "pending"
                                ? "amber"
                                : r.status === "scheduled"
                                  ? "blue"
                                  : "green"
                            }
                          >
                            {{ pending: t.pending, scheduled: t.scheduled, completed: t.completed }[
                              r.status
                            ] || r.status}
                          </Bdg>
                          {isUrgent && (
                            <Bdg color="red">
                              <Row inline as="span" gap={1}>
                                <AlertOctagon size={11} aria-hidden="true" /> {t.maintUrgent}
                              </Row>
                            </Bdg>
                          )}
                          <Bdg color="gray">{r.type}</Bdg>
                        </Row>
                        <Text
                          as="h3"
                          weight="extrabold"
                          color={C.barnwood}
                          style={{ margin: "0 0 4px 0", fontSize: 15 }}
                        >
                          {r.vname}
                        </Text>
                        <Text
                          as="p"
                          size="base"
                          color={C.barnwood}
                          style={{ margin: "0 0 6px 0", lineHeight: 1.4 }}
                        >
                          {r.notes}
                        </Text>
                        <Muted>
                          {t.maintBy} {r.uname} •{" "}
                          {r.at ? new Date(r.at).toLocaleDateString() : "Recent"}
                          {r.scheduled_date && (
                            <Row
                              inline
                              as="span"
                              gap={1}
                              style={{
                                marginLeft: 8,
                                color: C.slate,
                                fontWeight: "var(--weight-bold)",
                              }}
                            >
                              <Calendar size={11} aria-hidden="true" /> {t.scheduled}:{" "}
                              {new Date(r.scheduled_date).toLocaleDateString()}
                            </Row>
                          )}
                        </Muted>
                      </Stack>

                      {/* Right Actions Block */}
                      <Row>
                        {r.status === "pending" && perms.maint_manage && (
                          <Btn v="primary" sz="sm" onClick={() => setSel(r)}>
                            <Calendar size={13} aria-hidden="true" /> {t.maintScheduleBtn}
                          </Btn>
                        )}
                        {r.status === "scheduled" && perms.maint_manage && (
                          <Btn v="green" sz="sm" onClick={() => setSel(r)}>
                            <CheckCircle2 size={13} aria-hidden="true" /> {t.maintCompleteBtn}
                          </Btn>
                        )}
                        {r.status === "completed" && (
                          <Btn
                            v="ghost"
                            sz="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadServiceReport(r);
                            }}
                          >
                            <FileText size={13} aria-hidden="true" /> {t.maintDownloadPdf}
                          </Btn>
                        )}
                        <Btn v="ghost" sz="sm" onClick={() => setSel(r)}>
                          {t.maintReview} →
                        </Btn>

                        {perms.maint_manage && (
                          <TextBtn
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRequest(r.id);
                            }}
                            color={C.rd}
                            title={t.maintRemoveTitle}
                            aria-label={t.maintRemoveTitle}
                            style={{ padding: "4px 8px", display: "flex" }}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </TextBtn>
                        )}
                      </Row>
                    </Row>
                  </Card>
                );
              })
            )}
          </Stack>
        </>
      )}

      {/* Create Modal Form Layout */}
      {isCreateOpen && (
        <Modal title={t.maintFileRequest} onClose={() => setIsCreateOpen(false)}>
          <Stack gap={6}>
            <Fld label={t.maintSelectVehicle}>
              <Sel
                value={newTicket.vehicleId}
                onChange={(e) => setNewTicket({ ...newTicket, vehicleId: e.target.value })}
              >
                <option value="">{t.maintChooseVehicle}</option>
                {vehs.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.yr} {v.make} {v.model} ({v.plate || "No Plate"})
                  </option>
                ))}
              </Sel>
            </Fld>

            <Fld label={`${t.maintIssueClassification} *`}>
              <Callout className="sw-grid-2" bordered pad={5} style={{ gap: "10px" }}>
                {[
                  "Routine Oil Change",
                  "Brake System Service",
                  "Tire Repair / Replacement",
                  "Engine / Powertrain Alert",
                  "Body Damage / Accident Report",
                  "Other / General Diagnostics",
                ].map((opt) => {
                  const isChecked = Array.isArray(newTicket.type) && newTicket.type.includes(opt);
                  return (
                    <Row
                      key={opt}
                      as="label"
                      style={{
                        fontSize: "var(--text-base)",
                        fontWeight: "var(--weight-semibold)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        style={{ transform: "scale(1.1)", cursor: "pointer" }}
                        onChange={() => {
                          const currentTypes = Array.isArray(newTicket.type) ? newTicket.type : [];
                          const nextTypes = isChecked
                            ? currentTypes.filter((item) => item !== opt)
                            : [...currentTypes, opt];
                          setNewTicket({ ...newTicket, type: nextTypes });
                        }}
                      />
                      {opt.replace(
                        /[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g,
                        "",
                      )}
                    </Row>
                  );
                })}
              </Callout>
            </Fld>

            <Fld label={t.urgency}>
              <Sel
                value={newTicket.urgency}
                onChange={(e) => setNewTicket({ ...newTicket, urgency: e.target.value })}
              >
                <option value="standard">{t.maintUrgStandard}</option>
                <option value="soon">{t.maintUrgSoon}</option>
                <option value="urgent">{t.maintUrgUrgent}</option>
              </Sel>
            </Fld>
            <Fld label={`${t.reportedNotes}*`}>
              <TA
                placeholder={t.maintDescribePlaceholder}
                value={newTicket.notes}
                onChange={(e) => setNewTicket({ ...newTicket, notes: e.target.value })}
              />
            </Fld>

            <Fld label={`${t.maintPhotoLabel}*`}>
              <PhotoUpload
                current={newTicket.photo}
                onUpload={(base64) => setNewTicket({ ...newTicket, photo: base64 })}
                maxDim={600}
                quality={0.75}
                previewHeight={140}
              />
            </Fld>

            <Row align="stretch" style={{ marginTop: 10 }}>
              <Btn
                v="ghost"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setIsCreateOpen(false)}
              >
                {t.cancel}
              </Btn>
              <Btn
                v="primary"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={handleCreateRequest}
              >
                {t.maintSubmit}
              </Btn>
            </Row>
          </Stack>
        </Modal>
      )}

      {/* Review & Management Modal Panel */}
      {sel && (
        <Modal
          title={`${t.maintReviewRequest} — ${sel.vname}`}
          onClose={() => {
            setSel(null);
            setForm({});
          }}
        >
          <Stack gap={6} style={{ fontSize: "var(--text-base)" }}>
            <Row gap={0} justify="space-between">
              <div>
                <strong>{t.maintSubmittedBy}</strong> {sel.uname} {t.maintOn}{" "}
                {new Date(sel.at).toLocaleDateString()}
              </div>
              {perms.maint_manage && (
                <Btn v="outline" sz="sm" tone={C.rust} onClick={() => handleDeleteRequest(sel.id)}>
                  {t.maintDeleteRequest}
                </Btn>
              )}
            </Row>
            <div>
              <strong>{t.maintIssueClassLabel}</strong> {sel.type}
            </div>
            <div>
              <strong>{t.maintNotesLabel}</strong>
              <Callout pad={5} style={{ marginTop: 4, fontStyle: "italic" }}>
                "{sel.notes}"
              </Callout>
              {(() => {
                const lastCompleted = reqs
                  .filter((r) => r.vid === sel.vid && r.status === "completed" && r.id !== sel.id)
                  .sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0))[0];
                if (!lastCompleted) return null;
                return (
                  <Callout tone="success" pad={4} style={{ marginTop: 8 }}>
                    <Row
                      as="strong"
                      gap="5px"
                      style={{
                        fontSize: "var(--text-xs)",
                        color: C.pasture,
                        textTransform: "uppercase",
                      }}
                    >
                      <History size={12} aria-hidden="true" /> {t.maintLastCompleted} — {sel.vname}
                    </Row>
                    <Text size="sm" color={C.pasture} style={{ marginTop: 4 }}>
                      {lastCompleted.wh_notes || t.maintNoResolutionNotes}
                    </Text>
                    {lastCompleted.completed_at && (
                      <Muted size="2xs" style={{ marginTop: 4 }}>
                        {t.completed} {new Date(lastCompleted.completed_at).toLocaleDateString()}
                      </Muted>
                    )}
                  </Callout>
                );
              })()}
            </div>

            {sel.photo && (
              <Stack gap={0} style={{ marginTop: 4 }}>
                <Text as="strong" color={C.navy} style={{ display: "block", marginBottom: 6 }}>
                  {t.maintPhotoAttached}
                </Text>
                <img
                  src={sel.photo}
                  alt={t.maintPhotoAlt}
                  style={{
                    width: "100%",
                    maxHeight: 280,
                    objectFit: "contain",
                    borderRadius: "var(--radius-lg)",
                    border: `1px solid ${C.bd}`,
                    background: C.lg,
                  }}
                />
              </Stack>
            )}

            {sel.status === "pending" && perms.maint_manage && (
              <Stack
                gap={0}
                style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6 }}
              >
                <Text as="h3" size="md" color={C.navy} style={{ margin: "0 0 10px 0" }}>
                  {t.maintMgmtActions}
                </Text>
                <Fld label={t.maintScheduleDate}>
                  <Inp
                    type="date"
                    onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                  />
                </Fld>
                <Fld label={t.maintResolutionNotes}>
                  <TA
                    placeholder={t.maintSchedNotesPlaceholder}
                    onChange={(e) => setForm({ ...form, whNotes: e.target.value })}
                  />
                </Fld>
                <Row align="stretch" style={{ marginTop: 10 }}>
                  <Btn
                    v="primary"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => updateStatus(sel.id, "scheduled", form.whNotes)}
                  >
                    {t.maintApproveSchedule}
                  </Btn>
                </Row>
              </Stack>
            )}

            {sel.status === "scheduled" && perms.maint_manage && (
              <Stack
                gap={0}
                style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 14, marginTop: 6 }}
              >
                <Text as="h3" size="md" color={C.navy} style={{ margin: "0 0 10px 0" }}>
                  {t.maintCompleteServiceLogs}
                </Text>
                {sel.wh_notes && (
                  <Text style={{ marginBottom: 10 }}>
                    <strong>{t.maintScheduleInfo}</strong> {sel.wh_notes}
                  </Text>
                )}
                <Btn
                  v="green"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => {
                    setCompleteServiceReq(sel);
                    setSel(null);
                  }}
                >
                  {t.maintCompleteClose}
                </Btn>
              </Stack>
            )}

            {sel.status === "completed" && (
              <Callout
                tone="success"
                pad={5}
                style={{ borderTop: `1px solid ${C.bd}`, marginTop: 6 }}
              >
                <Row align="flex-start" justify="space-between">
                  <Text as="strong" color={C.pasture}>
                    {t.maintRequestClosed}
                  </Text>
                  <Btn v="ghost" sz="sm" onClick={() => downloadServiceReport(sel)}>
                    <FileText size={13} aria-hidden="true" /> {t.maintDownloadPdf}
                  </Btn>
                </Row>
                {sel.wh_notes && (
                  <Text style={{ marginTop: 4 }}>
                    <strong>{t.maintResolutionNotesLabel}</strong> {sel.wh_notes}
                  </Text>
                )}
                {sel.completed_at && (
                  <Muted style={{ marginTop: 4 }}>
                    {t.maintClosedOn} {new Date(sel.completed_at).toLocaleString()}
                  </Muted>
                )}
              </Callout>
            )}
          </Stack>
        </Modal>
      )}

      {completeServiceReq && (
        <CompleteServiceModal
          req={completeServiceReq}
          vehs={vehs}
          users={users}
          user={activeUser}
          onClose={() => setCompleteServiceReq(null)}
          onSubmit={(details) => completeService(completeServiceReq, details)}
        />
      )}
    </div>
  );
}
