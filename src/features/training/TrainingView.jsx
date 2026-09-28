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
import { useRef, useState } from "react";
import { Video, Plus, Trash2, Pencil } from "lucide-react";
import { C } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import { TRAINING_VIDEOS } from "@/shared/data/trainingVideos";
import { supabase } from "@/shared/utils/supabase";
import { useNotify } from "@/shared/context/NotificationContext";
import { logAction } from "@/shared/utils/logger";
import { Btn, Fld, Inp, TA } from "@/shared/components/UIPrimitives";
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

const BUCKET = "training-media";

export default function TrainingView({
  lang = "en",
  user,
  company,
  trainingMedia = [],
  setTrainingMedia,
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

  const items = orderedMedia(TRAINING_VIDEOS, trainingMedia);

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
      <div style={{ marginBottom: "var(--space-6)" }}>
        <h2
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: "var(--weight-extrabold)",
            color: C.navy,
            margin: 0,
          }}
        >
          {t.trainingTitle}
        </h2>
        <p
          style={{ color: C.sub, fontSize: "var(--text-sm)", margin: "6px 0 0", maxWidth: "70ch" }}
        >
          {t.trainingSubtitle}
        </p>
      </div>

      {canManage && (
        <div
          style={{
            background: C.w,
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--shadow-sm)",
            padding: "var(--space-5)",
            marginBottom: "var(--space-6)",
            border: `1px solid ${C.bd}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-4)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontWeight: "var(--weight-extrabold)",
                  color: C.navy,
                  fontSize: "var(--text-md)",
                }}
              >
                <Video size={15} aria-hidden="true" />{" "}
                {isPlatformAdmin ? t.trAdminTitleGlobal : t.trAdminTitle}
              </div>
              <div
                style={{ color: C.sub, fontSize: "var(--text-sm)", marginTop: 4, maxWidth: "70ch" }}
              >
                {isPlatformAdmin ? t.trAdminBlurbGlobal : t.trAdminBlurb}
              </div>
            </div>
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
          </div>

          {addOpen && (
            <div
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
                <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginBottom: 12 }}>
                  {form.file.name} — {formatBytes(form.file.size)}
                </div>
              )}
              <Btn v="primary" onClick={submitMedia} disabled={uploading}>
                {uploading ? t.trUploading : t.trUpload}
              </Btn>
              {uploading && (
                <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 8 }}>
                  {t.trUploadingNote}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        {items.map((clip) => {
          const isEditing = editingId === clip.id;
          return (
          <div
            key={clip.id}
            style={{
              background: C.w,
              borderRadius: "var(--radius-xl)",
              boxShadow: "var(--shadow-sm)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "var(--space-5) var(--space-5) var(--space-4)" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "var(--space-4)",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: "var(--text-2xs)",
                      letterSpacing: ".14em",
                      textTransform: "uppercase",
                      fontWeight: "var(--weight-extrabold)",
                      color: C.am,
                      marginBottom: 6,
                    }}
                  >
                    {/* Uploads carry no eyebrow. Falling back to who added it is more
                        use than an empty strip of whitespace above the title. */}
                    {clip.eyebrow ||
                      (clip.created_by_name
                        ? `${t.trAddedBy} ${clip.created_by_name}`
                        : t.trYourLibrary)}
                  </div>
                  {isEditing ? (
                    <Inp
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      disabled={savingEdit}
                    />
                  ) : (
                    <div
                      style={{
                        fontSize: "var(--text-lg)",
                        fontWeight: "var(--weight-extrabold)",
                        color: C.navy,
                      }}
                    >
                      {clip.title}
                    </div>
                  )}
                </div>
                {/* Bundled clips ship in the build and belong to Steadwerk, so there is
                    nothing a tenant admin could edit or delete even if the button were
                    here — "The Full Tour" included, since supabase/44 made it a real
                    row. Beyond that: a platform admin (Owner) can edit anything; a
                    company Admin can only edit their own company's clips, never a
                    global one Steadwerk added — the row-write RLS policy refuses that
                    regardless of whether this button is shown. */}
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
              </div>
              {isEditing ? (
                <div style={{ marginTop: "var(--space-3)" }}>
                  <Fld label={t.trBlurb} hint={t.trBlurbHint}>
                    <TA
                      value={editForm.blurb}
                      onChange={(e) => setEditForm({ ...editForm, blurb: e.target.value })}
                      disabled={savingEdit}
                    />
                  </Fld>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                  </div>
                </div>
              ) : (
                <p
                  style={{
                    color: C.sub,
                    fontSize: "var(--text-sm)",
                    margin: "6px 0 0",
                    maxWidth: "72ch",
                  }}
                >
                  {clip.blurb}
                </p>
              )}
            </div>

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
                background: "#000",
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
                    background: "#000",
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
                    background: "#000",
                  }}
                >
                  <source src={clip.src || clip.url} />
                  {t.trainingNoVideo}{" "}
                  <a href={clip.src || clip.url} style={{ color: C.am }}>
                    {t.trainingDownload}
                  </a>
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
                  <span
                    style={{
                      fontWeight: "var(--weight-extrabold)",
                      fontSize: "var(--text-md)",
                      padding: "0 20px",
                      textAlign: "center",
                    }}
                  >
                    {clip.title}
                  </span>
                </button>
              )}
            </div>
          </div>
          );
        })}
      </div>

      <p
        style={{
          marginTop: "var(--space-6)",
          padding: "var(--space-5)",
          borderRadius: "var(--radius-xl)",
          background: C.lg,
          color: C.sub,
          fontSize: "var(--text-sm)",
        }}
      >
        {t.trainingMoreComing}
      </p>

      {/* Native <details>/<summary>: no accordion library to ship, keyboard-operable
          for free, and stays open to Ctrl+F. Same pattern as the FAQ on the public
          landing page. */}
      <div
        style={{
          marginTop: "var(--space-6)",
          background: C.w,
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-sm)",
          padding: "var(--space-5)",
          border: `1px solid ${C.bd}`,
        }}
      >
        <div
          style={{
            fontSize: "var(--text-2xs)",
            letterSpacing: ".14em",
            textTransform: "uppercase",
            fontWeight: "var(--weight-extrabold)",
            color: C.am,
            marginBottom: 6,
          }}
        >
          {t.trainingFaqEyebrow}
        </div>
        <div
          style={{
            fontSize: "var(--text-lg)",
            fontWeight: "var(--weight-extrabold)",
            color: C.navy,
            marginBottom: "var(--space-3)",
          }}
        >
          {t.trainingFaqHeading}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
              <summary
                style={{
                  cursor: "pointer",
                  fontWeight: "var(--weight-bold)",
                  color: C.navy,
                  fontSize: "var(--text-sm)",
                }}
              >
                {q}
              </summary>
              <div
                style={{
                  color: C.sub,
                  fontSize: "var(--text-sm)",
                  marginTop: 8,
                  maxWidth: "70ch",
                }}
              >
                <b style={{ color: C.navy }}>{lead}</b> {rest}
              </div>
            </details>
          ))}
        </div>
      </div>

      <p
        style={{
          marginTop: "var(--space-4)",
          padding: "0 var(--space-2)",
          color: C.sub,
          fontSize: "var(--text-sm)",
        }}
      >
        {t.trainingHelpIntro}{" "}
        <a href="mailto:Sam@steadwerk.com" style={{ color: C.am }}>
          Sam@steadwerk.com
        </a>{" "}
        {t.trainingHelpOr}{" "}
        <a href="tel:+12605792995" style={{ color: C.am }}>
          (260) 579-2995
        </a>{" "}
        {t.trainingHelpOutro}
      </p>
    </div>
  );
}
