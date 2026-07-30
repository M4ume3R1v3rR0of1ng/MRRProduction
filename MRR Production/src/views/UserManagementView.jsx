// src/views/UserManagementView.jsx
import { useState, useEffect } from "react";
import { supabase, getAccessToken } from "../utils/supabase";
import { C, uid } from "../utils/helpers";
import { validatePassword, PASSWORD_HINT } from "../utils/passwordPolicy";
import {
  PERM_DEFS,
  PERM_GROUPS,
  ROLE_COLS,
  ROLES,
} from "../database/permissions";
import {
  Btn,
  Bdg,
  RoleBdg,
  Toggle,
  Modal,
  Fld,
  Sel,
  Inp,
} from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { translations } from "../utils/translations";
import { useNotify } from "../context/NotificationContext";

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

    // ✅ Map input cleanly to match your actual profiles table columns
    const profilePayload = {
      name: form.name.trim(),
      full_name: form.name.trim(),
      email: form.email.trim(),
      role: form.role
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

        setUsers((p) =>
          p.map((u) => (u.id === editing ? { ...u, ...profilePayload } : u)),
        );
        // If an admin edited their OWN row, refresh the live session so the new name
        // and email show immediately (Personal Profile, sidebar) without a re-login.
        if (editing === currentUser?.id && typeof onUpdateUser === "function") {
          onUpdateUser({ ...currentUser, name: profilePayload.name, full_name: profilePayload.name, email: profilePayload.email });
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
          body: JSON.stringify({ accessToken, password: form.password, sendInvite, ...profilePayload }),
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
      showToast(
        `${t.umProfileAborted} ${err.message}`,
        "error",
      );
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
      showToast(
        `${t.umClearanceSyncFail} ${err.message}`,
        "error",
      );
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
      showToast(
        `${t.umClearanceModFail} ${err.message}`,
        "error",
      );
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
      role: targetUser.role || "field"
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

    const matchedUser = users.find(u => u.id === targetUserId);
    if (!matchedUser) return;

    if (!window.confirm(t.umRemoveConfirm.replace("{name}", matchedUser.name || t.umThisUser))) return;

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
        `Permanently removed user account: ${matchedUser.email}`
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy }}>👥 User Management</h1>
        <Btn v="primary" onClick={() => { setForm({ role: "field" }); setEditing(null); setModal("user"); }}>+ Add User</Btn>
      </div>
      
      <div style={{ background: C.gL, border: `1px solid ${C.gold}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.navy, lineHeight: 1.7 }}>
        {t.umRolePermsBlurb.split("{link}")[0]}<strong>{t.umRolePermsLink}</strong>{t.umRolePermsBlurb.split("{link}")[1]}
      </div>
      
      <div style={{ background: C.w, borderRadius: "var(--radius-xl)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        <div className="sw-table-scroll">
          <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)" }}>
            <thead>
              <tr style={{ background: C.lg }}>
                {["Name", "Email", "Role", "Status", ""].map((h) => (
                  <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: `1px solid ${C.lg}`, ...(u.active ? {} : { background: "var(--c-subtle)" }) }}>
                  <td style={{ padding: "14px 14px", fontWeight: "var(--weight-bold)", color: C.navy }}>{u.full_name || u.name || "—"}</td>
                  <td style={{ padding: "14px 14px", color: C.sub }}>{u.email || "—"}</td>
                  <td style={{ padding: "14px 14px" }}>
                    <RoleBdg role={u.role} lang={lang} />
                  </td>
                  <td style={{ padding: "14px 14px" }}>
                    <Bdg color={u.active ? "green" : "gray"}>{u.active ? "Active" : "Inactive"}</Bdg>
                  </td>
                  <td style={{ padding: "14px 14px", textAlign: "right" }}>
                    <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", alignItems: "center" }}>
                      <Btn v="ghost" sz="sm" onClick={() => handleOpenPermissionOverrides(u)} title={t.umPermOverridesTitle}>
                        🔒 Override
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
                        🗑️ Remove
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal === "user" && (
        <Modal title={editing ? t.umModalEditUser : t.umModalAddUser} onClose={() => { setModal(null); setEditing(null); setForm({}); setPwForm({}); }}>
          <Fld label={t.umFullName}><Inp value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label={t.umEmail}><Inp type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t.umEmailPlaceholder} /></Fld>
          <Fld label={t.umRole}>
            <Sel value={form.role || "field"} onChange={(e) => setForm({ ...form, role: e.target.value })}>
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
                <Inp type="password" value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={t.umPasswordPlaceholder} />
              </Fld>
              <Fld label={t.umConfirmPassword}>
                <Inp type="password" value={form.confirmPassword || ""} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
              </Fld>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", marginTop: 4 }}>
                <Toggle on={sendInvite} onChange={() => setSendInvite((v) => !v)} />
                <div>
                  <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>
                    {t.umEmailInvite}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginTop: 1 }}>
                    {sendInvite
                      ? t.umInviteOn
                      : t.umInviteOff}
                  </div>
                </div>
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 14 }}>
            <Btn v="ghost" onClick={() => { setModal(null); setEditing(null); setForm({}); setPwForm({}); }} style={{ flex: 1, justifyContent: "center" }}>{t.cancel}</Btn>
            <Btn v="primary" onClick={save} style={{ flex: 1, justifyContent: "center" }}>{editing ? t.umSaveChanges : t.umAddUser}</Btn>
          </div>

          {editing && (
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.lg}` }}>
              <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)", marginBottom: 8 }}>
                🔑 Reset Password
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: C.sub, marginBottom: 10 }}>
                Forgot their password? Set a new temporary one here. Share it with them directly and they will be prompted to change it on next login.
              </div>
              <Fld label={t.umNewTempPassword} hint={PASSWORD_HINT}>
                <Inp type="password" value={pwForm.password || ""} onChange={(e) => setPwForm({ ...pwForm, password: e.target.value })} placeholder={t.umPasswordPlaceholder} />
              </Fld>
              <Fld label={t.umConfirmNewPassword}>
                <Inp type="password" value={pwForm.confirmPassword || ""} onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })} />
              </Fld>
              <Btn v="outline" onClick={submitResetPassword} style={{ width: "100%", justifyContent: "center" }}>{t.umSetNewPassword}</Btn>
            </div>
          )}
        </Modal>
      )}

      {modal === "perms" && permUser && (
        <Modal title={`Custom Permissions — ${permUser.name}`} onClose={() => { setModal(null); setPermUser(null); }} extraWide>
          <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.am, fontWeight: "var(--weight-semibold)" }}>
            ⚠️ Overrides apply <em>on top of</em> the <strong>{ROLES[permUser.role]?.label || permUser.role}</strong> role permissions and only affect <strong>{permUser.name}</strong>.
          </div>
          {userOverrides[permUser.id] && Object.keys(userOverrides[permUser.id]).length > 0 && (
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "flex-end" }}>
              <Btn v="danger" sz="sm" onClick={() => clearOverrides(permUser.id)}>{t.umClearOverrides}</Btn>
            </div>
          )}
          <div style={{ overflowX: "auto", maxHeight: "380px" }}>
            <table className="mrr-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
              <thead>
                <tr style={{ background: C.lg }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)", textTransform: "uppercase", minWidth: 220 }}>{t.umColPermission}</th>
                  <th style={{ padding: "10px 14px", textAlign: "center", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)", textTransform: "uppercase", width: 110 }}>{t.umColRoleDefault}</th>
                  <th style={{ padding: "10px 14px", textAlign: "center", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)", textTransform: "uppercase", width: 110 }}>{t.umColThisUser}</th>
                </tr>
              </thead>
              {PERM_GROUPS.map(([groupName, keys]) => (
                <tbody key={groupName}>
                  <tr>
                    <td colSpan={3} style={{ padding: "8px 14px", fontWeight: "var(--weight-black)", color: C.shellInk, background: C.shell, fontSize: "var(--text-sm)" }}>{groupName}</td>
                  </tr>
                  {keys.map((key) => {
                    const baseVal = (rolePerms[permUser.role] || {})[key] || false;
                    const ovVal = (userOverrides[permUser.id] || {})[key];
                    const effective = ovVal !== undefined ? ovVal : baseVal;
                    const hasOverride = ovVal !== undefined;
                    return (
                      <tr key={key} style={{ borderTop: `1px solid ${C.lg}`, background: hasOverride ? "rgba(217,119,6,0.07)" : "transparent" }}>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>
                            {PERM_DEFS[key]?.label || key}
                            {hasOverride && <span style={{ marginLeft: 6, fontSize: "var(--text-2xs)", color: C.am, fontWeight: "var(--weight-bold)" }}>{t.umOverridden}</span>}
                          </div>
                          <div style={{ fontSize: "var(--text-2xs)", color: C.sub, marginTop: 2 }}>{PERM_DEFS[key]?.desc || ""}</div>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <div style={{ display: "flex", justifyContent: "center" }}><Toggle on={baseVal} disabled={true} /></div>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <Toggle on={effective} onChange={() => toggleOverride(permUser.id, key, baseVal)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}