// src/features/training/AssignTrainingModal.jsx
//
// "Who should watch this, and by when." Opened from a clip in TrainingView by a
// company Admin (or a platform admin); writes rows into training_assignments
// (supabase/48).
//
// The role shortcuts are the point of this dialog. An owner with a 20-person
// crew assigning a ladder-safety clip does not want to tick twenty boxes, and
// the thing they actually mean is "the field crew". The shortcut selects that
// role's people and then gets out of the way — what is SAVED is always the
// explicit list of people, never "the field role", so nobody has to wonder
// whether a hire three months from now silently inherited a deadline they were
// never told about.
//
// Anyone already assigned this clip shows ticked and disabled. Their row exists;
// re-sending it would just hit the unique constraint, and offering to "assign"
// someone who is already assigned reads like the first attempt did not work.
import { useMemo, useState } from "react";
import { UserCheck, Users } from "lucide-react";
import { C, todayLocal } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import { ROLES } from "@/shared/database/permissions";
import { supabase } from "@/shared/utils/supabase";
import { useNotify } from "@/shared/context/NotificationContext";
import { logAction } from "@/shared/utils/logger";
import {
  Btn,
  Fld,
  Inp,
  Modal,
  Row,
  Stack,
  Text,
  Muted,
  Callout,
  CheckChip,
  Divider,
  RoleBdg,
} from "@/shared/components/UIPrimitives";
import {
  assignmentRows,
  assignableUsers,
  roleShortcuts,
  alreadyAssigned,
} from "./trainingAssignments";

export default function AssignTrainingModal({
  clip,
  users = [],
  assignments = [],
  user,
  lang = "en",
  onAssigned,
  onClose,
}) {
  const t = translations[lang] || translations.en;
  const { showToast } = useNotify();

  const people = useMemo(() => assignableUsers(users), [users]);
  const shortcuts = useMemo(() => roleShortcuts(users), [users]);
  const existing = useMemo(() => alreadyAssigned(clip.id, assignments), [clip.id, assignments]);

  const [picked, setPicked] = useState(() => new Set());
  const [dueOn, setDueOn] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A role shortcut is "on" once every one of its still-assignable people is
  // picked, so tapping it again clears them. Members already assigned are
  // ignored on both counts — they are not ours to select or deselect.
  const roleMembers = (userIds) => userIds.filter((id) => !existing.has(id));
  const roleIsOn = (userIds) => {
    const mine = roleMembers(userIds);
    return mine.length > 0 && mine.every((id) => picked.has(id));
  };
  const toggleRole = (userIds) => {
    const mine = roleMembers(userIds);
    setPicked((prev) => {
      const next = new Set(prev);
      if (mine.every((id) => next.has(id))) mine.forEach((id) => next.delete(id));
      else mine.forEach((id) => next.add(id));
      return next;
    });
  };

  const save = async () => {
    const userIds = [...picked];
    if (userIds.length === 0) {
      showToast(t.trAssignNobody, "info");
      return;
    }

    setSaving(true);
    try {
      const rows = assignmentRows({ mediaId: clip.id, userIds, dueOn, user });
      const { data, error } = await supabase.from("training_assignments").insert(rows).select();
      if (error) throw error;

      onAssigned?.(data || []);
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "TRAINING_ASSIGNED",
        `Assigned training "${clip.title}" to ${userIds.length} ${
          userIds.length === 1 ? "person" : "people"
        }${dueOn ? `, due ${dueOn}` : ""}`,
        { media_id: clip.id, user_ids: userIds, due_on: dueOn || null },
        "training",
      );

      showToast(t.trAssignDone.replace("{n}", String(userIds.length)), "success");
      onClose?.();
    } catch (err) {
      console.error(err);
      showToast(`${t.trAssignFailed} ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <Row gap={3}>
          <UserCheck size={17} aria-hidden="true" /> {t.trAssignTitle}
        </Row>
      }
      onClose={() => !saving && onClose?.()}
      wide
    >
      <Stack gap={5}>
        <Callout tone="neutral" pad="sm">
          <Text weight="bold" color={C.navy}>
            {clip.title}
          </Text>
          <Muted size="sm" style={{ marginTop: 2 }}>
            {t.trAssignBlurb}
          </Muted>
        </Callout>

        {people.length === 0 ? (
          <Callout tone="warn" bordered icon={Users} color={C.warnInk}>
            {t.trAssignNoCrew}
          </Callout>
        ) : (
          <>
            {shortcuts.length > 1 && (
              <Stack gap={2}>
                <Muted size="xs" weight="bold">
                  {t.trAssignShortcuts}
                </Muted>
                <Row gap={2} wrap>
                  {shortcuts.map(({ role, userIds }) => {
                    const selectable = roleMembers(userIds).length;
                    return (
                      <CheckChip
                        key={role}
                        checked={roleIsOn(userIds)}
                        disabled={saving || selectable === 0}
                        onChange={() => toggleRole(userIds)}
                      >
                        {(ROLES[role]?.label || role) + ` (${userIds.length})`}
                      </CheckChip>
                    );
                  })}
                </Row>
              </Stack>
            )}

            <Stack gap={2}>
              <Muted size="xs" weight="bold">
                {t.trAssignTo}
              </Muted>
              <Stack gap={0} style={{ maxHeight: 280, overflowY: "auto" }}>
                {people.map((p) => {
                  const done = existing.has(p.id);
                  return (
                    <Row
                      as="label"
                      key={p.id}
                      gap={3}
                      justify="space-between"
                      style={{
                        padding: "8px 10px",
                        borderBottom: `1px solid ${C.subtle}`,
                        cursor: done || saving ? "default" : "pointer",
                        opacity: done ? 0.6 : 1,
                      }}
                    >
                      <Row gap={3} style={{ minWidth: 0 }}>
                        <input
                          type="checkbox"
                          checked={done || picked.has(p.id)}
                          disabled={done || saving}
                          onChange={() => toggle(p.id)}
                          style={{ margin: 0, flexShrink: 0 }}
                        />
                        <Text
                          weight="semibold"
                          color={C.navy}
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.name || p.full_name || p.email}
                        </Text>
                      </Row>
                      <Row gap={2} style={{ flexShrink: 0 }}>
                        {done && <Muted size="2xs">{t.trAssignAlready}</Muted>}
                        <RoleBdg role={p.role} lang={lang} />
                      </Row>
                    </Row>
                  );
                })}
              </Stack>
            </Stack>

            <Divider space={1} />

            <Fld label={t.trAssignDue} hint={t.trAssignDueHint}>
              <Inp
                type="date"
                value={dueOn}
                // Nothing stops an admin backdating a deadline in the database,
                // but the picker should not invite it: an assignment that is
                // overdue the moment it lands teaches people to ignore the badge.
                min={todayLocal()}
                onChange={(e) => setDueOn(e.target.value)}
                disabled={saving}
              />
            </Fld>

            <Row gap={4}>
              <Btn
                v="ghost"
                onClick={() => onClose?.()}
                disabled={saving}
                style={{ flex: 1, justifyContent: "center" }}
              >
                {t.trCancel}
              </Btn>
              <Btn
                v="primary"
                onClick={save}
                disabled={saving || picked.size === 0}
                style={{ flex: 1, justifyContent: "center" }}
              >
                {saving ? t.trAssignSaving : t.trAssignAction.replace("{n}", String(picked.size))}
              </Btn>
            </Row>
          </>
        )}
      </Stack>
    </Modal>
  );
}
