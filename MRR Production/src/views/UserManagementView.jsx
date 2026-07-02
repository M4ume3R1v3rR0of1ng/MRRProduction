// src/views/UserManagementView.jsx
import { useState } from "react";
import { supabase } from "../utils/supabase";
import { C, uid } from "../utils/helpers";
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
import { useNotify } from "../context/NotificationContext";

export default function Users({
  users = [],
  setUsers,
  currentUser,
  rolePerms = {},
  userOverrides = {},
  setUserOverrides,
}) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [editing, setEditing] = useState(null);
  const [permUser, setPermUser] = useState(null);

  const { showToast } = useNotify();

  const save = async () => {
    if (!form.name || !form.email || !form.role) return;

    // ✅ Map input cleanly to match your actual profiles table columns
    const profilePayload = { 
      name: form.name.trim(),
      full_name: form.name.trim(), 
      email: form.email.trim(), 
      role: form.role 
    };
    
    try {
      if (editing) {
        // ✅ Fixed: Now passing profilePayload containing full_name directly to Supabase
        const { error } = await supabase
          .from("profiles")
          .update(profilePayload)
          .eq("id", editing);
        if (error) throw error;

        setUsers((p) =>
          p.map((u) => (u.id === editing ? { ...u, ...profilePayload } : u)),
        );
        showToast("User updates saved successfully.", "success");
      } else {
        const newUserId = crypto.randomUUID();
        const newUserPayload = {
          id: newUserId,
          active: true,
          ...profilePayload
        };

        const { error } = await supabase
          .from("profiles")
          .insert([newUserPayload]);
        if (error) throw error;

        setUsers((p) => [...p, newUserPayload]);
        showToast("New user added successfully.", "success");
      }
      setModal(null);
      setForm({});
      setEditing(null);
    } catch (err) {
      console.error("Failed to save profile metrics:", err);
      showToast(
        `Database Error: Profile updates aborted. ${err.message}`,
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
          { onConflict: "user_id" },
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
        `Database Error: Clearances failed to sync. ${err.message}`,
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
      showToast("All user permission overrides wiped clean.", "success");
    } catch (err) {
      console.error("Failed to delete user overrides context:", err);
      showToast(
        `Database Error: Clearances modification failure. ${err.message}`,
        "error",
      );
    }
  };

  const handleOpenPermissionOverrides = (targetUser) => {
    setPermUser(targetUser);
    setModal("perms");
  };

  const handleEditUser = (targetUser) => {
    setForm({
      name: targetUser.full_name || targetUser.name || "",
      email: targetUser.email || "",
      role: targetUser.role || "field"
    });
    setEditing(targetUser.id);
    setModal("user");
  };

  const handleDeactivateUser = async (targetUserId) => {
    if (targetUserId === currentUser?.id) {
      showToast("Security Violation: You cannot lock your own profile session!", "warning");
      return;
    }

    const matchedUser = users.find(u => u.id === targetUserId);
    if (!matchedUser) return;

    const nextActiveState = !matchedUser.active;
    const msg = nextActiveState 
      ? `Reactivate permissions access for ${matchedUser.name || 'this user'}?`
      : `Deactivate ${matchedUser.name || 'this user'}? They will immediately lose WMS system clearance.`;

    if (!window.confirm(msg)) return;

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ active: nextActiveState })
        .eq("id", targetUserId);
      if (error) throw error;

      setUsers((p) =>
        p.map((x) =>
          x.id === targetUserId ? { ...x, active: nextActiveState } : x,
        ),
      );

      await logAction(
        currentUser?.id ?? null,
        currentUser?.email ?? null,
        "USER_MANAGEMENT",
        `Set profile active state to ${nextActiveState} for user: ${matchedUser.email}`
      );
      
      showToast(nextActiveState ? "User profile reactivated." : "User account deactivated.", "success");
    } catch (err) {
      console.error("Failed to change user status metrics:", err);
      showToast(`Database Error: Status update failed. ${err.message}`, "error");
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
        Role permissions are set in <strong>Settings → Role Permissions</strong>. You can also give individual users custom permission overrides here using the 🔒 button.
      </div>
      
      <div style={{ background: C.w, borderRadius: "var(--radius-xl)", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)" }}>
          <thead>
            <tr style={{ background: C.lg }}>
              {["Name", "Email", "Role", "Status", ""].map((h) => (
                <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: `1px solid ${C.lg}`, background: u.active ? "transparent" : "#fafafa" }}>
                <td style={{ padding: "14px 14px", fontWeight: "var(--weight-bold)", color: C.navy }}>{u.full_name || u.name || "—"}</td>
                <td style={{ padding: "14px 14px", color: C.sub }}>{u.email || "—"}</td>
                <td style={{ padding: "14px 14px" }}>
                  <Bdg color={u.role === "admin" ? "red" : u.role === "manager" ? "purple" : "blue"}>{u.role}</Bdg>
                </td>
                <td style={{ padding: "14px 14px" }}>
                  <Bdg color={u.active ? "green" : "gray"}>{u.active ? "Active" : "Inactive"}</Bdg>
                </td>
                <td style={{ padding: "14px 14px", textAlign: "right" }}>
                  <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", alignItems: "center" }}>
                    <Btn v="ghost" sz="sm" onClick={() => handleOpenPermissionOverrides(u)} title="Configure individual user permission overrides">
                      🔒 Override
                    </Btn>
                    <Btn v="ghost" sz="sm" onClick={() => handleEditUser(u)}>
                      Edit
                    </Btn>
                    <Btn 
                      v={u.active ? "danger-ghost" : "primary-ghost"} 
                      sz="sm" 
                      onClick={() => handleDeactivateUser(u.id)}
                      style={{ minWidth: 95, textAlign: "center" }}
                    >
                      {u.active ? "Deactivate" : "Activate"}
                    </Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal === "user" && (
        <Modal title={editing ? "Edit User" : "Add New User"} onClose={() => { setModal(null); setEditing(null); setForm({}); }}>
          <Fld label="Full Name *"><Inp value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label="Email Address"><Inp type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@maumeeriverroofing.com" /></Fld>
          <Fld label="Role *">
            <Sel value={form.role || "field"} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Administrator (Full Access)</option>
              <option value="manager">Operations Manager</option>
              <option value="coordinator">Production Coordinator</option>
              <option value="warehouse">Warehouse Manager</option>
              <option value="Site Supervisor">Site Supervisor</option>
              <option value="employee">Employee / Field Staff</option>
            </Sel>
          </Fld>
          <div style={{ display: "flex", gap: "var(--space-4)", marginTop: 14 }}>
            <Btn v="ghost" onClick={() => { setModal(null); setEditing(null); setForm({}); }} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
            <Btn v="primary" onClick={save} style={{ flex: 1, justifyContent: "center" }}>{editing ? "Save Changes" : "Add User"}</Btn>
          </div>
        </Modal>
      )}

      {modal === "perms" && permUser && (
        <Modal title={`Custom Permissions — ${permUser.name}`} onClose={() => { setModal(null); setPermUser(null); }} extraWide>
          <div style={{ background: C.aB, border: `1.5px solid ${C.am}`, borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 14, fontSize: "var(--text-sm)", color: C.am, fontWeight: "var(--weight-semibold)" }}>
            ⚠️ Overrides apply <em>on top of</em> the <strong>{ROLES[permUser.role]?.label || permUser.role}</strong> role permissions and only affect <strong>{permUser.name}</strong>.
          </div>
          {userOverrides[permUser.id] && Object.keys(userOverrides[permUser.id]).length > 0 && (
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "flex-end" }}>
              <Btn v="danger" sz="sm" onClick={() => clearOverrides(permUser.id)}>Clear All Overrides</Btn>
            </div>
          )}
          <div style={{ overflowX: "auto", maxHeight: "380px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
              <thead>
                <tr style={{ background: C.lg }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)", textTransform: "uppercase", minWidth: 220 }}>Permission</th>
                  <th style={{ padding: "10px 14px", textAlign: "center", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)", textTransform: "uppercase", width: 110 }}>Role Default</th>
                  <th style={{ padding: "10px 14px", textAlign: "center", color: C.sub, fontWeight: "var(--weight-bold)", fontSize: "var(--text-xs)", textTransform: "uppercase", width: 110 }}>This User</th>
                </tr>
              </thead>
              {PERM_GROUPS.map(([groupName, keys]) => (
                <tbody key={groupName}>
                  <tr>
                    <td colSpan={3} style={{ padding: "8px 14px", fontWeight: "var(--weight-black)", color: C.w, background: C.navy, fontSize: "var(--text-sm)" }}>{groupName}</td>
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
                            {hasOverride && <span style={{ marginLeft: 6, fontSize: "var(--text-2xs)", color: C.am, fontWeight: "var(--weight-bold)" }}>OVERRIDDEN</span>}
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