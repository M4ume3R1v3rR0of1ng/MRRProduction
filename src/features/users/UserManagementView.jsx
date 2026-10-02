// src/features/users/UserManagementView.jsx
import { useState, useEffect } from "react";
import { Users as UsersIcon, Lock, Trash2, KeyRound, AlertTriangle } from "lucide-react";
import { supabase, getAccessToken } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import { validatePassword, PASSWORD_HINT } from "@/features/auth/passwordPolicy";
import { PERM_DEFS, PERM_GROUPS, ROLES } from "@/shared/database/permissions";
import {
  Btn,
  Bdg,
  RoleBdg,
  Toggle,
  Modal,
  Fld,
  Sel,
  Inp,
  PageHeader,
  Row,
  Text,
  Muted,
  Table,
  Callout,
  Card,
  Stack,
} from "@/shared/components/UIPrimitives";
import { logAction } from "@/shared/utils/logger";
import { translations } from "@/shared/utils/translations";
import { useNotify } from "@/shared/context/NotificationContext";

export default function Users({
  lang = "en",
  users = [],
  setUsers,
  currentUser,
  rolePerms = {},
  userOverrides = {},
  setUserOverrides,
  onUpdateUser,
  openItemId,
  onOpenItemHandled,
}) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [editing, setEditing] = useState(null);
  const [permUser, setPermUser] = useState(null);
  const [pwForm, setPwForm] = useState({});
  // Lives outside `form` so resetting the form doesn't silently turn invites off.
  const [sendInvite, setSendInvite] = useState(true);

  const { showToast } = useNotify();
  const t = translations[lang] || translations.en;

  const save = async () => {
    const missing = [];
    if (!form.name) missing.push(t.umFieldName);
    if (!form.email) missing.push(t.umFieldEmail);
    if (!form.role) missing.push(t.umFieldRole);
    if (missing.length) {
      showToast(t.umNothingSaved.replace("{fields}", missing.join(t.umJoinComma)), "warning");
      return;
    }

    // Map input cleanly to match your actual profiles table columns
    const profilePayload = {
      name: form.name.trim(),
      full_name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
    };

    try {
      if (editing) {
        // Name/email live on the shared profile; role does NOT. Role is per-company
        // (a person can be a manager here and an employee somewhere else), so it lives
        // on the membership and has to go through set_member_role(). Writing role into
        // profiles here would update a deprecated column and change nothing — the
        // admin would see "saved" and the user's permissions would be untouched.
        // Name + email go through the admin function: email is the login identity in
        // auth.users, which the browser can't change, and writing profiles.email alone
        // left the login and the Personal Profile out of sync. The function updates
        // auth AND profiles together. Role is per-company and still goes through
        // set_member_role().
        const accessToken = await getAccessToken();
        const response = await fetch("/.netlify/functions/update-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken,
            targetUserId: editing,
            name: profilePayload.name,
            email: profilePayload.email,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);

        const { error: roleError } = await supabase.rpc("set_member_role", {
          target_user: editing,
          new_role: form.role,
        });
        if (roleError) throw roleError;

        setUsers((p) => p.map((u) => (u.id === editing ? { ...u, ...profilePayload } : u)));
        // If an admin edited their OWN row, refresh the live session so the new name
        // and email show immediately (Personal Profile, sidebar) without a re-login.
        if (editing === currentUser?.id && typeof onUpdateUser === "function") {
          onUpdateUser({
            ...currentUser,
            name: profilePayload.name,
            full_name: profilePayload.name,
            email: profilePayload.email,
          });
        }
        showToast(t.umUpdatesSaved, "success");
      } else {
        const problem = validatePassword(form.password);
        if (problem) {
          showToast(problem, "warning");
          return;
        }
        if (form.password !== form.confirmPassword) {
          showToast(t.umPwMismatch, "warning");
          return;
        }
        // Creates a real Supabase Auth user directly so the auth.users -> profiles
        // trigger fires with a real, FK-valid id — a fabricated client-side UUID can
        // never satisfy profiles_id_fkey. The invite email is sent server-side after
        // the membership lands, so it can include a set-your-password link.
        const accessToken = await getAccessToken();
        const response = await fetch("/.netlify/functions/create-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken,
            password: form.password,
            sendInvite,
            ...profilePayload,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

        setUsers((p) => [...p, { id: result.id, active: true, ...profilePayload }]);
        // The account exists either way. Only the invite can half-fail, so say which
        // happened — an admin who thinks an invite went out and it didn't will leave
        // someone locked out waiting for an email.
        if (!sendInvite) {
          showToast(t.umCreatedShare, "success");
        } else if (result.invited) {
          showToast(t.umCreatedInvited.replace("{email}", profilePayload.email), "success");
        } else {
          showToast(
            `${t.umCreatedInviteFailed}${result.inviteError ? `: ${result.inviteError}` : ""}. ${t.umPwShareHint}`,
            "warning",
          );
        }
      }
      setModal(null);
      setForm({});
      setEditing(null);
    } catch (err) {
      console.error("Failed to save profile metrics:", err);
      showToast(`${t.umProfileAborted} ${err.message}`, "error");
    }
  };

  const toggleOverride = async (uid, perm, baseVal) => {
    const currentTargetOverrides = { ...(userOverrides[uid] || {}) };
    if (currentTargetOverrides[perm] === undefined) {
      currentTargetOverrides[perm] = !baseVal;
    } else if (currentTargetOverrides[perm] === !baseVal) {
      delete currentTargetOverrides[perm];
    } else {
      currentTargetOverrides[perm] = !currentTargetOverrides[perm];
    }

    try {
      const { error } = await supabase
        .from("user_permission_overrides")
        .upsert(
          { user_id: uid, overrides: currentTargetOverrides },
          { onConflict: "company_id,user_id" },
        );
      if (error) throw error;

      setUserOverrides((p) => ({ ...p, [uid]: currentTargetOverrides }));

      await handleUpdatePermissions(
        { id: uid, email: users.find((u) => u.id === uid)?.email },
        users.find((u) => u.id === uid)?.role,
        currentTargetOverrides,
      );
    } catch (err) {
      console.error("Failed to update explicit clearance criteria:", err);
      showToast(`${t.umClearanceSyncFail} ${err.message}`, "error");
    }
  };

  const clearOverrides = async (uid) => {
    try {
      const { error } = await supabase
        .from("user_permission_overrides")
        .delete()
        .eq("user_id", uid);
      if (error) throw error;

      setUserOverrides((p) => {
        const n = { ...p };
        delete n[uid];
        return n;
      });
      showToast(t.umOverridesWiped, "success");
    } catch (err) {
      console.error("Failed to delete user overrides context:", err);
      showToast(`${t.umClearanceModFail} ${err.message}`, "error");
    }
  };

  const handleOpenPermissionOverrides = (targetUser) => {
    setPermUser(targetUser);
    setModal("perms");
  };

  const submitResetPassword = async () => {
    const problem = validatePassword(pwForm.password);
    if (problem) {
      showToast(problem, "warning");
      return;
    }
    if (pwForm.password !== pwForm.confirmPassword) {
      showToast(t.umPwMismatch, "warning");
      return;
    }

    try {
      const accessToken = await getAccessToken();
      const response = await fetch("/.netlify/functions/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, targetUserId: editing, password: pwForm.password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

      await logAction(
        currentUser?.id ?? null,
        currentUser?.email ?? null,
        "USER_MANAGEMENT",
        `Reset password for user: ${form.email}`,
      );

      showToast(t.umTempPwSet, "success");
      setPwForm({});
    } catch (err) {
      console.error("Failed to reset password:", err);
      showToast(`${t.umPwResetFail} ${err.message}`, "error");
    }
  };

  const handleEditUser = (targetUser) => {
    setForm({
      name: targetUser.full_name || targetUser.name || "",
      email: targetUser.email || "",
      role: targetUser.role || "field",
    });
    setEditing(targetUser.id);
    setPwForm({});
    setModal("user");
  };

  // Deep-link from OmniSearch: open the matching user's edit card on arrival
  useEffect(() => {
    if (!openItemId) return;
    const target = users.find((u) => String(u.id) === String(openItemId));
    if (target) handleEditUser(target);
    onOpenItemHandled?.();
  }, [openItemId]);

  const handleRemoveUser = async (targetUserId) => {
    if (targetUserId === currentUser?.id) {
      showToast(t.umCannotRemoveSelf, "warning");
      return;
    }

    const matchedUser = users.find((u) => u.id === targetUserId);
    if (!matchedUser) return;

    if (!window.confirm(t.umRemoveConfirm.replace("{name}", matchedUser.name || t.umThisUser)))
      return;

    try {
      const accessToken = await getAccessToken();
      const response = await fetch("/.netlify/functions/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, targetUserId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

      setUsers((p) => p.filter((x) => x.id !== targetUserId));

      await logAction(
        currentUser?.id ?? null,
        currentUser?.email ?? null,
        "USER_MANAGEMENT",
        `Permanently removed user account: ${matchedUser.email}`,
      );

      showToast(t.umUserRemoved, "success");
    } catch (err) {
      console.error("Failed to remove user:", err);
      showToast(`${t.umRemovalFail} ${err.message}`, "error");
    }
  };

  const handleUpdatePermissions = async (targetUser, newRole, overrides) => {
    await logAction(
      currentUser?.id ?? null,
      currentUser?.email ?? null,
      "PERM_CHANGE",
      `Modified access profile/role for user: ${targetUser.email}`,
      {
        targetUserId: targetUser.id,
        assignedRole: newRole,
        activeOverrides: overrides,
      },
    );
  };

  return (
    <div>
      <PageHeader
        icon={UsersIcon}
        title="User Management"
        actions={
          <Btn
            v="primary"
            onClick={() => {
              setForm({ role: "field" });
              setEditing(null);
              setModal("user");
            }}
          >
            + Add User
          </Btn>
        }
      />

      <Callout
        tone="gold"
        bordered
        size="sm"
        color={C.navy}
        style={{ marginBottom: 14, lineHeight: 1.7 }}
      >
        {t.umRolePermsBlurb.split("{link}")[0]}
        <strong>{t.umRolePermsLink}</strong>
        {t.umRolePermsBlurb.split("{link}")[1]}
      </Callout>

      <Card variant="raised" pad="none" style={{ overflow: "hidden" }}>
        <Table pad="xl" size="base">
          <thead>
            <tr>
              {["Name", "Email", "Role", "Status", ""].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ background: u.active ? undefined : "var(--c-subtle)" }}>
                <Text as="td" weight="bold" color={C.navy}>
                  {u.full_name || u.name || "—"}
                </Text>
                <Text as="td" color={C.sub}>
                  {u.email || "—"}
                </Text>
                <td>
                  <RoleBdg role={u.role} lang={lang} />
                </td>
                <td>
                  <Bdg color={u.active ? "green" : "gray"}>{u.active ? "Active" : "Inactive"}</Bdg>
                </td>
                <td>
                  <Row gap={2} justify="flex-end">
                    <Btn
                      v="ghost"
                      sz="sm"
                      onClick={() => handleOpenPermissionOverrides(u)}
                      title={t.umPermOverridesTitle}
                    >
                      <Lock size={13} aria-hidden="true" /> Override
                    </Btn>
                    <Btn v="ghost" sz="sm" onClick={() => handleEditUser(u)}>
                      {t.umEdit}
                    </Btn>
                    <Btn
                      v="danger"
                      sz="sm"
                      onClick={() => handleRemoveUser(u.id)}
                      style={{ minWidth: 95, textAlign: "center" }}
                    >
                      <Trash2 size={13} aria-hidden="true" /> Remove
                    </Btn>
                  </Row>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {modal === "user" && (
        <Modal
          title={editing ? t.umModalEditUser : t.umModalAddUser}
          onClose={() => {
            setModal(null);
            setEditing(null);
            setForm({});
            setPwForm({});
          }}
        >
          <Fld label={t.umFullName}>
            <Inp
              value={form.name || ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Fld>
          <Fld label={t.umEmail}>
            <Inp
              type="email"
              value={form.email || ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder={t.umEmailPlaceholder}
            />
          </Fld>
          <Fld label={t.umRole}>
            <Sel
              value={form.role || "field"}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="admin">{t.roleLongAdmin}</option>
              <option value="manager">{t.roleLongManager}</option>
              <option value="coordinator">{t.roleLongCoordinator}</option>
              <option value="warehouse">{t.roleLongWarehouse}</option>
              <option value="field">{t.roleLongField}</option>
              <option value="employee">{t.roleLongEmployee}</option>
              <option value="bookkeeper">{t.roleLongBookkeeper}</option>
            </Sel>
          </Fld>
          {!editing && (
            <>
              <Fld
                label={t.umTempPassword}
                hint={`${PASSWORD_HINT}. ${sendInvite ? t.umPwFallbackHint : t.umPwShareHint}`}
              >
                <Inp
                  type="password"
                  value={form.password || ""}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={t.umPasswordPlaceholder}
                />
              </Fld>
              <Fld label={t.umConfirmPassword}>
                <Inp
                  type="password"
                  value={form.confirmPassword || ""}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                />
              </Fld>
              <Row gap={4} style={{ marginTop: 4 }}>
                <Toggle on={sendInvite} onChange={() => setSendInvite((v) => !v)} />
                <div>
                  <Text size="sm" weight="bold" color={C.navy}>
                    {t.umEmailInvite}
                  </Text>
                  <Muted style={{ marginTop: 1 }}>
                    {sendInvite ? t.umInviteOn : t.umInviteOff}
                  </Muted>
                </div>
              </Row>
            </>
          )}
          <Row gap={4} align="stretch" style={{ marginTop: 14 }}>
            <Btn
              v="ghost"
              onClick={() => {
                setModal(null);
                setEditing(null);
                setForm({});
                setPwForm({});
              }}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {t.cancel}
            </Btn>
            <Btn v="primary" onClick={save} style={{ flex: 1, justifyContent: "center" }}>
              {editing ? t.umSaveChanges : t.umAddUser}
            </Btn>
          </Row>

          {editing && (
            <Stack
              gap={0}
              style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.lg}` }}
            >
              <Row
                gap={2}
                style={{
                  fontWeight: "var(--weight-bold)",
                  color: C.navy,
                  fontSize: "var(--text-sm)",
                  marginBottom: 8,
                }}
              >
                <KeyRound size={13} aria-hidden="true" /> Reset Password
              </Row>
              <Muted style={{ marginBottom: 10 }}>
                Forgot their password? Set a new temporary one here. Share it with them directly and
                they will be prompted to change it on next login.
              </Muted>
              <Fld label={t.umNewTempPassword} hint={PASSWORD_HINT}>
                <Inp
                  type="password"
                  value={pwForm.password || ""}
                  onChange={(e) => setPwForm({ ...pwForm, password: e.target.value })}
                  placeholder={t.umPasswordPlaceholder}
                />
              </Fld>
              <Fld label={t.umConfirmNewPassword}>
                <Inp
                  type="password"
                  value={pwForm.confirmPassword || ""}
                  onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
                />
              </Fld>
              <Btn
                v="outline"
                onClick={submitResetPassword}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {t.umSetNewPassword}
              </Btn>
            </Stack>
          )}
        </Modal>
      )}

      {modal === "perms" && permUser && (
        <Modal
          title={`Custom Permissions — ${permUser.name}`}
          onClose={() => {
            setModal(null);
            setPermUser(null);
          }}
          extraWide
        >
          <Callout
            tone="warn"
            bordered
            icon={AlertTriangle}
            size="sm"
            weight="semibold"
            color={C.am}
            style={{ marginBottom: 14 }}
          >
            Overrides apply <em>on top of</em> the{" "}
            <strong>{ROLES[permUser.role]?.label || permUser.role}</strong> role permissions and
            only affect <strong>{permUser.name}</strong>.
          </Callout>
          {userOverrides[permUser.id] && Object.keys(userOverrides[permUser.id]).length > 0 && (
            <Row gap={0} align="stretch" justify="flex-end" style={{ marginBottom: 10 }}>
              <Btn v="danger" sz="sm" onClick={() => clearOverrides(permUser.id)}>
                {t.umClearOverrides}
              </Btn>
            </Row>
          )}

          <Table pad="lg" maxHeight={"380px"}>
            <thead className="mrr-thead-sticky">
              <tr>
                <th style={{ minWidth: 220 }}>{t.umColPermission}</th>
                <th style={{ textAlign: "center", width: 110 }}>{t.umColRoleDefault}</th>
                <th style={{ textAlign: "center", width: 110 }}>{t.umColThisUser}</th>
              </tr>
            </thead>
            {PERM_GROUPS.map(([groupName, keys]) => (
              <tbody key={groupName}>
                <tr>
                  <Text
                    as="td"
                    colSpan={3}
                    size="sm"
                    weight="black"
                    color={C.shellInk}
                    style={{ background: C.shell }}
                  >
                    {groupName}
                  </Text>
                </tr>
                {keys.map((key) => {
                  const baseVal = (rolePerms[permUser.role] || {})[key] || false;
                  const ovVal = (userOverrides[permUser.id] || {})[key];
                  const effective = ovVal !== undefined ? ovVal : baseVal;
                  const hasOverride = ovVal !== undefined;
                  return (
                    <tr
                      key={key}
                      style={{
                        background: hasOverride
                          ? "color-mix(in srgb, var(--c-warn) 7%, transparent)"
                          : "transparent",
                      }}
                    >
                      <td>
                        <Text size="sm" weight="bold" color={C.navy}>
                          {PERM_DEFS[key]?.label || key}
                          {hasOverride && (
                            <Text
                              as="span"
                              size="2xs"
                              weight="bold"
                              color={C.am}
                              style={{ marginLeft: 6 }}
                            >
                              {t.umOverridden}
                            </Text>
                          )}
                        </Text>
                        <Muted size="2xs" style={{ marginTop: 2 }}>
                          {PERM_DEFS[key]?.desc || ""}
                        </Muted>
                      </td>
                      <td>
                        <Row gap={0} align="stretch" justify="center">
                          <Toggle on={baseVal} disabled={true} />
                        </Row>
                      </td>
                      <td>
                        <Row gap={0} align="stretch" justify="center">
                          <Toggle
                            on={effective}
                            onChange={() => toggleOverride(permUser.id, key, baseVal)}
                          />
                        </Row>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </Table>
        </Modal>
      )}
    </div>
  );
}
