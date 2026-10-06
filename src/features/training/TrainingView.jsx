// src/features/training/TrainingView.jsx
//
// Training & help, inside the portal. Same videos as the public page off the
// landing-page Help button, different chrome.
//
// WHY THIS IS NOT JUST TrainingPage RENDERED IN THE APP
//
// TrainingPage carries a full-page shell: its own sticky brand bar, a "← Back"
// button, and a ~4 kB scoped stylesheet that redeclares colour, type and spacing
// from scratch because it has to survive outside the app's design system. None of
// that belongs inside the portal, where the sidebar is the navigation, the theme
// is already applied, and tokens.css already defines every value that stylesheet
// re-invents. Reusing it here would mean a page inside a page.
//
// So the chrome differs and the DATA is shared: both read
// src/data/trainingVideos.js, which is the only thing that would actually hurt to
// have in two places. Add a clip there and it appears in both.
import { useMemo, useRef, useState } from "react";
import {
  Video,
  Plus,
  Trash2,
  Pencil,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { C } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import { TRAINING_VIDEOS } from "@/shared/data/trainingVideos";
import { supabase } from "@/shared/utils/supabase";
import { useNotify } from "@/shared/context/NotificationContext";
import { logAction } from "@/shared/utils/logger";
import {
  Btn,
  Fld,
  Inp,
  TA,
  Row,
  Stack,
  Text,
  Muted,
  Callout,
  Card,
  Eyebrow,
  Meter,
  TextBtn,
} from "@/shared/components/UIPrimitives";
import { uploadFileToBucket, removeFromBucket } from "@/shared/utils/storageBucketUpload";
import {
  orderedMedia,
  validateMediaForm,
  mediaObjectPath,
  mediaRow,
  formatBytes,
  MAX_VIDEO_BYTES,
  MAX_IMAGE_BYTES,
  VIDEO_TYPES,
  IMAGE_TYPES,
} from "./trainingMedia";
import AssignTrainingModal from "./AssignTrainingModal";
import {
  outstandingFor,
  rosterFor,
  assignmentStatus,
  dueDescriptor,
  formatDue,
} from "./trainingAssignments";

// Status -> the colors and icon a due badge wears. Overdue takes rust (this
// brand's destructive color, never red), due-soon the warn amber, watched
// pasture. Each pairs the wash with its matching -ink token rather than the
// saturated one, which is too light to read as small type on its own wash.
const DUE_TONE = {
  overdue: { bg: C.rustWash, fg: C.rustInk, Icon: AlertTriangle },
  "due-soon": { bg: C.warnWash, fg: C.warnInk, Icon: Clock },
  watched: { bg: C.pastureWash, fg: C.pastureInk, Icon: CheckCircle2 },
  open: { bg: C.subtle, fg: C.sub, Icon: Clock },
};

const BUCKET = "training-media";

// The training page's own section label: amber and wider-tracked than the
// app's standard eyebrow, echoing the landing page it shares copy with.
const TRAINING_EYEBROW = { fontSize: "var(--text-2xs)", letterSpacing: ".14em", marginBottom: 6 };

export default function TrainingView({
  lang = "en",
  user,
  company,
  trainingMedia = [],
  setTrainingMedia,
  users = [],
  trainingAssignments = [],
  setTrainingAssignments,
}) {
  const t = translations[lang] || translations.en;
  const { showToast } = useNotify();
  // Two kinds of admin, two different reaches. A platform admin (Owner) can add,
  // edit or remove ANY clip, global or not. A company's own Admin can only add,
  // edit or remove their own company's private clips — never Steadwerk's global
  // ones, and never another company's. Matches
  // supabase/45_training_media_company_admin_edit.sql; the UI hiding a button is
  // convenience, the database RLS is what actually enforces it.
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const isCompanyAdmin = user?.role === "admin";
  const canManage = isPlatformAdmin || isCompanyAdmin;

  // Which clips have been started, keyed by id so several videos each track
  // their own poster rather than sharing one flag.
  const [started, setStarted] = useState({});
  const refs = useRef({});
  const fileRef = useRef(null);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: "", blurb: "", file: null });
  const [uploading, setUploading] = useState(false);

  // Which clip (if any) is mid-edit, keyed by id so opening one closes any other.
  // Only title and blurb are editable here — the file itself is not, so there is
  // no re-upload path or storage write involved in saving one of these.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ title: "", blurb: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Assignments (supabase/48) ──
  const [assignFor, setAssignFor] = useState(null);
  const [markingId, setMarkingId] = useState(null);

  const items = orderedMedia(TRAINING_VIDEOS, trainingMedia);

  // What is outstanding for the person looking at the page, in pressure order.
  // Everyone gets this, admins included: an owner who assigns themselves a clip
  // is as entitled to the reminder as anyone.
  const myOutstanding = useMemo(
    () => outstandingFor(user?.id, trainingAssignments),
    [user?.id, trainingAssignments],
  );
  const byMediaId = useMemo(() => new Map(items.map((c) => [c.id, c])), [items]);
  const myAssignmentFor = (mediaId) =>
    trainingAssignments.find((a) => a.media_id === mediaId && a.user_id === user?.id) || null;

  const dueChip = (assignment) => {
    const label = formatDue(dueDescriptor(assignment), t);
    if (!label) return null;
    const tone = DUE_TONE[assignmentStatus(assignment)] || DUE_TONE.open;
    return (
      <Row
        gap="5px"
        style={{
          background: tone.bg,
          color: tone.fg,
          borderRadius: "var(--radius-pill)",
          padding: "3px 10px",
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-extrabold)",
          flexShrink: 0,
        }}
      >
        <tone.Icon size={12} aria-hidden="true" /> {label}
      </Row>
    );
  };

  // The assignee sets their own completed_at. The guard trigger in supabase/48
  // is what actually holds them to that one column — this just sends the one
  // field, so a crew member cannot move their own deadline by any route.
  const markWatched = async (assignment) => {
    setMarkingId(assignment.id);
    try {
      const { data, error } = await supabase
        .from("training_assignments")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", assignment.id)
        .select();
      if (error) throw error;
      const row = data?.[0];
      if (row) setTrainingAssignments?.((prev) => prev.map((a) => (a.id === row.id ? row : a)));
      showToast(t.trMarkedWatchedOk, "success");
    } catch (err) {
      console.error(err);
      showToast(`${t.trMarkWatchedFail} ${err.message}`, "error");
    } finally {
      setMarkingId(null);
    }
  };

  const withdraw = async (assignment, clip) => {
    const who =
      assignment.person?.name || assignment.person?.full_name || assignment.person?.email || "—";
    if (!window.confirm(t.trWithdrawConfirm.replace("{title}", clip.title).replace("{name}", who)))
      return;
    try {
      const { error } = await supabase
        .from("training_assignments")
        .delete()
        .eq("id", assignment.id);
      if (error) throw error;
      setTrainingAssignments?.((prev) => prev.filter((a) => a.id !== assignment.id));
      showToast(t.trWithdrawnOk, "success");
    } catch (err) {
      console.error(err);
      showToast(`${t.trWithdrawFail} ${err.message}`, "error");
    }
  };

  const resetForm = () => {
    setForm({ title: "", blurb: "", file: null });
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitMedia = async () => {
    const check = validateMediaForm(form);
    if (!check.ok) {
      showToast(check.error, "info");
      return;
    }
    if (!company?.id) {
      showToast("No active company on this session, so there is nowhere to file this.", "error");
      return;
    }

    setUploading(true);
    let uploadedPath = null;
    try {
      const path = mediaObjectPath(company.id, form.file);
      const { url, path: storedPath } = await uploadFileToBucket(BUCKET, path, form.file);
      uploadedPath = storedPath;

      const row = {
        ...mediaRow({
          title: form.title,
          blurb: form.blurb,
          kind: check.kind,
          url,
          sortOrder: trainingMedia.length,
          user,
          // Only a platform admin's own upload ever lands in the shared, every-company
          // tier — the row-write policy pins this to false for anyone else regardless
          // of what gets sent, but there is no reason to send the wrong thing anyway.
          isGlobal: isPlatformAdmin,
        }),
        object_path: storedPath,
      };

      const { data, error } = await supabase.from("training_media").insert([row]).select();
      if (error) throw error;

      const created = data?.[0] || row;
      setTrainingMedia?.((p) => [...p, created]);

      await logAction(
        user.id,
        user.email,
        "TRAINING_MEDIA_ADD",
        `Added training ${check.kind}: "${row.title}"`,
        { media_id: created.id, kind: check.kind, object_path: storedPath },
        "training",
      );

      showToast(t.trAddedOk, "success");
      resetForm();
      setAddOpen(false);
    } catch (err) {
      // The file landed but the row did not, so nothing would ever reference it.
      // Clean it up rather than leaving a paid-for orphan in the bucket.
      if (uploadedPath) await removeFromBucket(BUCKET, uploadedPath);
      showToast(`${t.trAddFail} ${err.message}`, "error");
    } finally {
      setUploading(false);
    }
  };

  const removeMedia = async (item) => {
    if (!window.confirm(t.trRemoveConfirm.replace("{title}", item.title))) return;
    try {
      const { error } = await supabase.from("training_media").delete().eq("id", item.id);
      if (error) throw error;
      if (item.object_path) await removeFromBucket(BUCKET, item.object_path);
      setTrainingMedia?.((p) => p.filter((m) => m.id !== item.id));

      await logAction(
        user.id,
        user.email,
        "TRAINING_MEDIA_REMOVE",
        `Removed training ${item.kind}: "${item.title}"`,
        { media_id: item.id, object_path: item.object_path },
        "training",
      );

      showToast(t.trRemovedOk, "success");
    } catch (err) {
      showToast(`${t.trRemoveFail} ${err.message}`, "error");
    }
  };

  const startEdit = (clip) => {
    setEditingId(clip.id);
    setEditForm({ title: clip.title || "", blurb: clip.blurb || "" });
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (clip) => {
    const title = editForm.title.trim();
    if (!title) {
      showToast(t.trTitleRequired, "info");
      return;
    }
    const blurb = editForm.blurb.trim() || null;

    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from("training_media")
        .update({ title, blurb })
        .eq("id", clip.id);
      if (error) throw error;

      setTrainingMedia?.((p) => p.map((m) => (m.id === clip.id ? { ...m, title, blurb } : m)));

      await logAction(
        user.id,
        user.email,
        "TRAINING_MEDIA_EDIT",
        `Edited training ${clip.kind}: "${clip.title}" → "${title}"`,
        { media_id: clip.id },
        "training",
      );

      showToast(t.trEditedOk, "success");
      setEditingId(null);
    } catch (err) {
      showToast(`${t.trEditFail} ${err.message}`, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const start = (id) => () => {
    setStarted((p) => ({ ...p, [id]: true }));
    const v = refs.current[id];
    // play() rejects under some mobile autoplay policies even from a real tap.
    // The poster is already down by then, so the native controls take over.
    if (v) Promise.resolve(v.play()).catch(() => {});
  };

  return (
    <div>
      <Stack gap={0} style={{ marginBottom: "var(--space-6)" }}>
        <Text as="h2" size="2xl" weight="extrabold" color={C.navy} style={{ margin: 0 }}>
          {t.trainingTitle}
        </Text>
        <Muted as="p" size="sm" style={{ margin: "6px 0 0", maxWidth: "70ch" }}>
          {t.trainingSubtitle}
        </Muted>
      </Stack>

      {/* ── Assigned to you ──
        Above the library on purpose. The library is a shelf you browse; this is
        a short list of things somebody is actually waiting on, and burying it
        under the shelf would make it indistinguishable from the shelf. Renders
        nothing at all when there is nothing outstanding, rather than an empty
        "all caught up" panel that would then sit above the library forever. */}
      {myOutstanding.length > 0 && (
        <Card
          variant="raised"
          pad={5}
          style={{ marginBottom: "var(--space-6)", borderLeft: `4px solid ${C.am}` }}
        >
          <Stack gap={4}>
            <Stack gap={0}>
              <Row
                gap="7px"
                style={{
                  fontWeight: "var(--weight-extrabold)",
                  color: C.navy,
                  fontSize: "var(--text-md)",
                }}
              >
                <UserCheck size={15} aria-hidden="true" /> {t.trAssignedToYou} (
                {myOutstanding.length})
              </Row>
              <Muted size="sm" style={{ marginTop: 4 }}>
                {t.trAssignedToYouBlurb}
              </Muted>
            </Stack>

            <Stack gap={2}>
              {myOutstanding.map((assignment) => {
                const clip = byMediaId.get(assignment.media_id);
                // An assignment can outlive what it points at only briefly — the
                // FK cascades on delete — but trainingMedia and assignments load
                // as two separate queries, so one can arrive before the other.
                // Skip rather than render a card with no title.
                if (!clip) return null;
                return (
                  <Callout key={assignment.id} tone="neutral" pad="sm" bordered>
                    <Row gap={3} justify="space-between" wrap>
                      <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                        <Text weight="bold" color={C.navy}>
                          {clip.title}
                        </Text>
                        {assignment.assigned_by_name && (
                          <Muted size="2xs" style={{ marginTop: 2 }}>
                            {t.trAssignedBy.replace("{name}", assignment.assigned_by_name)}
                          </Muted>
                        )}
                      </Stack>
                      <Row gap={2} wrap style={{ flexShrink: 0 }}>
                        {dueChip(assignment)}
                        <Btn
                          v="green"
                          sz="sm"
                          onClick={() => markWatched(assignment)}
                          disabled={markingId === assignment.id}
                        >
                          {markingId === assignment.id ? (
                            t.trMarkingWatched
                          ) : (
                            <>
                              <CheckCircle2 size={13} aria-hidden="true" /> {t.trMarkWatched}
                            </>
                          )}
                        </Btn>
                      </Row>
                    </Row>
                  </Callout>
                );
              })}
            </Stack>
          </Stack>
        </Card>
      )}

      {canManage && (
        <Card pad={5} style={{ marginBottom: "var(--space-6)" }}>
          <Row gap={4} justify="space-between" wrap>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Row
                gap="7px"
                style={{
                  fontWeight: "var(--weight-extrabold)",
                  color: C.navy,
                  fontSize: "var(--text-md)",
                }}
              >
                <Video size={15} aria-hidden="true" />{" "}
                {isPlatformAdmin ? t.trAdminTitleGlobal : t.trAdminTitle}
              </Row>
              <Muted size="sm" style={{ marginTop: 4, maxWidth: "70ch" }}>
                {isPlatformAdmin ? t.trAdminBlurbGlobal : t.trAdminBlurb}
              </Muted>
            </Stack>
            <Btn
              v={addOpen ? "ghost" : "primary"}
              sz="sm"
              onClick={() => {
                setAddOpen(!addOpen);
                resetForm();
              }}
            >
              {addOpen ? (
                t.trCancel
              ) : (
                <>
                  <Plus size={13} aria-hidden="true" /> {t.trAddMedia}
                </>
              )}
            </Btn>
          </Row>

          {addOpen && (
            <Stack
              gap={0}
              style={{
                marginTop: "var(--space-5)",
                borderTop: `1px solid ${C.bd}`,
                paddingTop: "var(--space-5)",
              }}
            >
              <Fld label={t.trTitle}>
                <Inp
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. How we tarp a roof"
                  disabled={uploading}
                />
              </Fld>
              <Fld label={t.trBlurb} hint={t.trBlurbHint}>
                <TA
                  value={form.blurb}
                  onChange={(e) => setForm({ ...form, blurb: e.target.value })}
                  disabled={uploading}
                />
              </Fld>
              <Fld
                label={t.trFile}
                hint={`${t.trFileHint} ${formatBytes(MAX_VIDEO_BYTES)} ${t.trFileHintVideo}, ${formatBytes(MAX_IMAGE_BYTES)} ${t.trFileHintPhoto}.`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept={[...VIDEO_TYPES, ...IMAGE_TYPES].join(",")}
                  disabled={uploading}
                  onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })}
                  style={{ fontSize: "var(--text-sm)", color: C.navy }}
                />
              </Fld>
              {form.file && (
                <Muted style={{ marginBottom: 12 }}>
                  {form.file.name} — {formatBytes(form.file.size)}
                </Muted>
              )}
              <Btn v="primary" onClick={submitMedia} disabled={uploading}>
                {uploading ? t.trUploading : t.trUpload}
              </Btn>
              {uploading && <Muted style={{ marginTop: 8 }}>{t.trUploadingNote}</Muted>}
            </Stack>
          )}
        </Card>
      )}

      <Stack gap={6}>
        {items.map((clip) => {
          const isEditing = editingId === clip.id;
          const mine = clip.bundled ? null : myAssignmentFor(clip.id);
          const roster = clip.bundled ? null : rosterFor(clip.id, trainingAssignments, users);
          return (
            <Card key={clip.id} variant="raised" pad="none" style={{ overflow: "hidden" }}>
              <Stack gap={0} style={{ padding: "var(--space-5) var(--space-5) var(--space-4)" }}>
                <Row gap={4} align="flex-start" justify="space-between">
                  <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                    <Eyebrow color={C.am} style={TRAINING_EYEBROW}>
                      {/* Uploads carry no eyebrow. Falling back to who added it is more
                        use than an empty strip of whitespace above the title. */}
                      {clip.eyebrow ||
                        (clip.created_by_name
                          ? `${t.trAddedBy} ${clip.created_by_name}`
                          : t.trYourLibrary)}
                    </Eyebrow>
                    {isEditing ? (
                      <Inp
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        disabled={savingEdit}
                      />
                    ) : (
                      <Text size="lg" weight="extrabold" color={C.navy}>
                        {clip.title}
                      </Text>
                    )}
                  </Stack>
                  {/* Bundled clips ship in the build and belong to Steadwerk, so there is
                    nothing a tenant admin could edit or delete even if the button were
                    here — "The Full Tour" included, since supabase/44 made it a real
                    row. Beyond that: a platform admin (Owner) can edit anything; a
                    company Admin can only edit their own company's clips, never a
                    global one Steadwerk added — the row-write RLS policy refuses that
                    regardless of whether this button is shown. */}
                  <Row gap={2} style={{ flexShrink: 0 }}>
                    {/* Assign reaches further than Edit: a company admin may
                      direct Steadwerk's GLOBAL clips at their own crew even
                      though they cannot edit one. The assignment is their
                      company's row, not a change to Steadwerk's clip, and
                      supabase/48's trigger allows exactly that — a global clip
                      or one of their own, never another company's. Bundled
                      clips are excluded because they have no training_media row
                      for the foreign key to point at. */}
                    {!clip.bundled && canManage && (
                      <Btn v="outline" sz="sm" onClick={() => setAssignFor(clip)}>
                        <UserCheck size={13} aria-hidden="true" /> {t.trAssign}
                      </Btn>
                    )}
                    {!clip.bundled && (isPlatformAdmin || (isCompanyAdmin && !clip.is_global)) && (
                      <Btn
                        v="ghost"
                        sz="sm"
                        onClick={() => (isEditing ? cancelEdit() : startEdit(clip))}
                      >
                        {isEditing ? (
                          t.trCancel
                        ) : (
                          <>
                            <Pencil size={13} aria-hidden="true" /> {t.trEdit}
                          </>
                        )}
                      </Btn>
                    )}
                  </Row>
                </Row>
                {isEditing ? (
                  <Stack gap={0} style={{ marginTop: "var(--space-3)" }}>
                    <Fld label={t.trBlurb} hint={t.trBlurbHint}>
                      <TA
                        value={editForm.blurb}
                        onChange={(e) => setEditForm({ ...editForm, blurb: e.target.value })}
                        disabled={savingEdit}
                      />
                    </Fld>
                    <Row align="stretch" wrap>
                      <Btn v="primary" sz="sm" onClick={() => saveEdit(clip)} disabled={savingEdit}>
                        {savingEdit ? t.trUploading : t.trSaveChanges}
                      </Btn>
                      <Btn
                        v="danger"
                        sz="sm"
                        onClick={() => removeMedia(clip)}
                        disabled={savingEdit}
                      >
                        <Trash2 size={13} aria-hidden="true" /> {t.trRemove}
                      </Btn>
                    </Row>
                  </Stack>
                ) : (
                  <Muted as="p" size="sm" style={{ margin: "6px 0 0", maxWidth: "72ch" }}>
                    {clip.blurb}
                  </Muted>
                )}

                {/* The viewer's own standing on this clip, beside the clip
                  itself. The "Assigned to you" panel above is the to-do list and
                  drops a clip the moment it is watched; this is the record, so
                  it keeps showing "Watched" afterwards. */}
                {mine && (
                  <Row gap={2} wrap style={{ marginTop: "var(--space-3)" }}>
                    {mine.completed_at ? (
                      <Row
                        gap="5px"
                        style={{
                          background: C.pastureWash,
                          color: C.pastureInk,
                          borderRadius: "var(--radius-pill)",
                          padding: "3px 10px",
                          fontSize: "var(--text-2xs)",
                          fontWeight: "var(--weight-extrabold)",
                        }}
                      >
                        <CheckCircle2 size={12} aria-hidden="true" /> {t.trWatched}
                      </Row>
                    ) : (
                      <>
                        {dueChip(mine)}
                        <Btn
                          v="green"
                          sz="sm"
                          onClick={() => markWatched(mine)}
                          disabled={markingId === mine.id}
                        >
                          {markingId === mine.id ? (
                            t.trMarkingWatched
                          ) : (
                            <>
                              <CheckCircle2 size={13} aria-hidden="true" /> {t.trMarkWatched}
                            </>
                          )}
                        </Btn>
                      </>
                    )}
                  </Row>
                )}

                {/* ── Admin roster ──
                  Who this was given to and who has actually watched it. The
                  whole reason assignment is worth having: "assigned" without
                  "and here is who is outstanding" is a message sent into the
                  dark. Only rendered once somebody has been assigned, so an
                  unassigned clip stays as quiet as it was before. */}
                {canManage && !clip.bundled && roster && roster.total > 0 && (
                  <Stack gap={2} style={{ marginTop: "var(--space-4)" }}>
                    <Row gap={3} wrap>
                      <Eyebrow color={C.sub}>
                        {t.trRoster
                          .replace("{done}", String(roster.watchedCount))
                          .replace("{total}", String(roster.total))}
                      </Eyebrow>
                      {roster.overdueCount > 0 && (
                        <Text size="2xs" weight="extrabold" color={C.rustInk}>
                          {t.trRosterOverdue.replace("{n}", String(roster.overdueCount))}
                        </Text>
                      )}
                    </Row>
                    <Meter
                      value={roster.total ? roster.watchedCount / roster.total : 0}
                      color={C.pasture}
                    />
                    <Row gap={2} wrap>
                      {[...roster.watched, ...roster.outstanding].map((a) => {
                        const label =
                          a.person?.name || a.person?.full_name || a.person?.email || "—";
                        const done = !!a.completed_at;
                        const overdue = assignmentStatus(a) === "overdue";
                        return (
                          <Row
                            key={a.id}
                            gap="5px"
                            style={{
                              background: done ? C.pastureWash : overdue ? C.rustWash : C.subtle,
                              color: done ? C.pastureInk : overdue ? C.rustInk : C.sub,
                              borderRadius: "var(--radius-pill)",
                              padding: "3px 4px 3px 10px",
                              fontSize: "var(--text-2xs)",
                              fontWeight: "var(--weight-bold)",
                            }}
                          >
                            {done ? (
                              <CheckCircle2 size={11} aria-hidden="true" />
                            ) : (
                              <Clock size={11} aria-hidden="true" />
                            )}
                            {label}
                            {/* Withdrawing a watched assignment would delete the
                              record that they watched it, so it is only offered
                              while one is still outstanding. */}
                            {!done && (
                              <TextBtn
                                onClick={() => withdraw(a, clip)}
                                title={t.trWithdraw}
                                aria-label={`${t.trWithdraw}: ${label}`}
                                style={{ color: "inherit", padding: "0 6px", opacity: 0.75 }}
                              >
                                ×
                              </TextBtn>
                            )}
                          </Row>
                        );
                      })}
                    </Row>
                  </Stack>
                )}
              </Stack>

              {/* The poster is a real button so it is focusable and keyboard
                operable. Once play starts it drops away and the video's native
                controls own everything after that — no custom transport to
                maintain or to get wrong on mobile. */}
              {/* sw-video-half caps this at half width on desktop. The poster
                button below is inset:0 against THIS element, so the cap has to
                live here rather than on the <video>, or the overlay would keep
                the old full-width footprint and sit off the frame. */}
              {/* Rounded and inset now that it no longer bleeds to the card edge.
                At full width it borrowed the card's own bottom corners; centered
                with gutters either side it needs its own, or it reads as a black
                block someone forgot to finish. */}
              <div
                className="sw-video-half"
                style={{
                  position: "relative",
                  background: C.mediaBackdrop,
                  borderRadius: "var(--radius-lg)",
                  overflow: "hidden",
                  marginBottom: "var(--space-5)",
                }}
              >
                {/* Bundled clips carry `src` (a path under public/); uploads carry `url`
                  (a Supabase CDN link, which is why public/_headers now names that
                  origin under media-src). */}
                {clip.kind === "photo" ? (
                  <img
                    src={clip.url || clip.src}
                    alt={clip.title}
                    loading="lazy"
                    style={{
                      display: "block",
                      width: "100%",
                      aspectRatio: "16 / 9",
                      objectFit: "contain",
                      background: C.mediaBackdrop,
                    }}
                  />
                ) : (
                  <video
                    ref={(el) => {
                      refs.current[clip.id] = el;
                    }}
                    controls
                    preload="metadata"
                    playsInline
                    poster={clip.poster || undefined}
                    onPlay={() => setStarted((p) => ({ ...p, [clip.id]: true }))}
                    style={{
                      display: "block",
                      width: "100%",
                      aspectRatio: "16 / 9",
                      objectFit: "contain",
                      background: C.mediaBackdrop,
                    }}
                  >
                    <source src={clip.src || clip.url} />
                    {t.trainingNoVideo}{" "}
                    <Text href={clip.src || clip.url} as="a" color={C.am}>
                      {t.trainingDownload}
                    </Text>
                  </video>
                )}

                {clip.kind !== "photo" && !started[clip.id] && (
                  <button
                    type="button"
                    onClick={start(clip.id)}
                    aria-label={`${t.trainingPlay}: ${clip.title}`}
                    style={{
                      position: "absolute",
                      inset: 0,
                      border: 0,
                      padding: 0,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 14,
                      font: "inherit",
                      // shellInk, not a literal: this poster is the same "stays dark
                      // in both themes" chrome as the sidebar, and the palette audit
                      // in utils/palette.test.js rejects hardcoded light ink for
                      // exactly the reason it would break here if the gradient ever
                      // stopped being dark.
                      color: C.shellInk,
                      background:
                        "repeating-linear-gradient(115deg, transparent 0 46px, rgba(201,123,45,.07) 46px 48px), radial-gradient(ellipse at 50% 34%, #2F353C 0%, #23282D 55%, #171B1F 100%)",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 68,
                        height: 68,
                        borderRadius: "50%",
                        display: "grid",
                        placeItems: "center",
                        background: C.am,
                        color: C.onAccent,
                        fontSize: 21,
                        paddingLeft: 5,
                        boxShadow: "0 10px 34px rgba(0,0,0,.42)",
                      }}
                    >
                      ▶
                    </span>
                    <Text
                      as="span"
                      size="md"
                      weight="extrabold"
                      style={{ padding: "0 20px", textAlign: "center" }}
                    >
                      {clip.title}
                    </Text>
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </Stack>

      <Callout
        as="p"
        pad="var(--space-5)"
        size="sm"
        color={C.sub}
        style={{ marginTop: "var(--space-6)", borderRadius: "var(--radius-xl)" }}
      >
        {t.trainingMoreComing}
      </Callout>

      {/* Native <details>/<summary>: no accordion library to ship, keyboard-operable
          for free, and stays open to Ctrl+F. Same pattern as the FAQ on the public
          landing page. */}
      <Card pad={5} style={{ marginTop: "var(--space-6)" }}>
        <Eyebrow color={C.am} style={TRAINING_EYEBROW}>
          {t.trainingFaqEyebrow}
        </Eyebrow>
        <Text
          size="lg"
          weight="extrabold"
          color={C.navy}
          style={{ marginBottom: "var(--space-3)" }}
        >
          {t.trainingFaqHeading}
        </Text>
        <Stack gap="2px">
          {[
            [t.trFaqQ1, t.trFaqA1Lead, t.trFaqA1Rest],
            [t.trFaqQ2, t.trFaqA2Lead, t.trFaqA2Rest],
            [t.trFaqQ3, t.trFaqA3Lead, t.trFaqA3Rest],
            [t.trFaqQ4, t.trFaqA4Lead, t.trFaqA4Rest],
          ].map(([q, lead, rest]) => (
            <details
              key={q}
              style={{ borderTop: `1px solid ${C.bd}`, padding: "var(--space-3) 0" }}
            >
              <Text
                as="summary"
                size="sm"
                weight="bold"
                color={C.navy}
                style={{ cursor: "pointer" }}
              >
                {q}
              </Text>
              <Muted size="sm" style={{ marginTop: 8, maxWidth: "70ch" }}>
                <Text as="b" color={C.navy}>
                  {lead}
                </Text>{" "}
                {rest}
              </Muted>
            </details>
          ))}
        </Stack>
      </Card>

      <Muted
        as="p"
        size="sm"
        style={{ margin: 0, marginTop: "var(--space-4)", padding: "0 var(--space-2)" }}
      >
        {t.trainingHelpIntro}{" "}
        <Text href="mailto:Sam@steadwerk.com" as="a" color={C.am}>
          Sam@steadwerk.com
        </Text>{" "}
        {t.trainingHelpOr}{" "}
        <Text href="tel:+12605792995" as="a" color={C.am}>
          (260) 579-2995
        </Text>{" "}
        {t.trainingHelpOutro}
      </Muted>

      {assignFor && (
        <AssignTrainingModal
          clip={assignFor}
          users={users}
          assignments={trainingAssignments}
          user={user}
          lang={lang}
          onAssigned={(rows) => setTrainingAssignments?.((prev) => [...prev, ...rows])}
          onClose={() => setAssignFor(null)}
        />
      )}
    </div>
  );
}
