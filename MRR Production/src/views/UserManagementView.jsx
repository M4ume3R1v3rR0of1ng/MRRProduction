// ── Users ─────────────────────────────────────────
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
  users,
  setUsers,
  currentUser,
  rolePerms,
  userOverrides,
  setUserOverrides,
}) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [editing, setEditing] = useState(null);
  const [permUser, setPermUser] = useState(null);

  const { showToast } = useNotify();

  const save = async () => {
    if (!form.name || !form.email || !form.role) return;

    try {
      if (editing) {
        const { error } = await supabase
          .from("profiles")
          .update({ name: form.name, email: form.email, role: form.role })
          .eq("id", editing);
        if (error) throw error;

        setUsers((p) =>
          p.map((u) => (u.id === editing ? { ...u, ...form } : u)),
        );
      } else {
        const newUserId = uid();
        const newUserPayload = {
          id: newUserId,
          active: true,
          name: form.name,
          email: form.email,
          role: form.role,
        };

        const { error } = await supabase
          .from("profiles")
          .insert([newUserPayload]);
        if (error) throw error;

        setUsers((p) => [...p, newUserPayload]);
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
    } catch (err) {
      console.error("Failed to delete user overrides context:", err);
      showToast(
        `Database Error: Clearances modification failure. ${err.message}`,
        "error",
      );
    }
  };

  const handleToggleActive = async (targetUser) => {
    const nextActiveState = !targetUser.active;
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ active: nextActiveState })
        .eq("id", targetUser.id);
      if (error) throw error;

      setUsers((p) =>
        p.map((x) =>
          x.id === targetUser.id ? { ...x, active: nextActiveState } : x,
        ),
      );
    } catch (err) {
      console.error("Failed to change user status metrics:", err);
      showToast(
        `Database Error: Status update failed. ${err.message}`,
        "error",
      );
    }
  };

  const handleUpdatePermissions = async (targetUser, newRole, overrides) => {
    await logAction(
      currentUser.id,
      currentUser.email,
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>
          👥 User Management
        </h1>
        <Btn
          v="primary"
          onClick={() => {
            setForm({ role: "employee" });
            setEditing(null);
            setModal("user");
          }}
        >
          + Add User
        </Btn>
      </div>
      <div
        style={{
          background: C.gL,
          border: `1px solid ${C.gold}`,
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 14,
          fontSize: 12,
          color: C.navy,
          lineHeight: 1.7,
        }}
      >
        Role permissions are set in <strong>Settings → Role Permissions</strong>
        . You can also give individual users custom permission overrides here
        using the 🔒 button.
      </div>
      <div
        style={{
          background: C.w,
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
        }}
      >
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr style={{ background: C.lg }}>
              {["Name", "Email", "Role", "Status", ""].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "9px 14px",
                    textAlign: "left",
                    color: C.sub,
                    fontWeight: 700,
                    fontSize: 11,
                    textTransform: "uppercase",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          {/* Example snippet inside your UserManagementView table body component */}
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                {/* 1. FIXED NAME REFERENCE (Using full_name to match your profiles schema) */}
                <td style={{ padding: "12px", fontWeight: 600, color: C.navy }}>
                  {u.full_name || u.name || "—"}
                </td>

                {/* 2. FIXED EMAIL REFERENCE */}
                <td style={{ padding: "12px", color: C.sub }}>
                  {u.email || "—"}
                </td>

                <td style={{ padding: "12px" }}>
                  <Bdg color="red">{u.role}</Bdg>
                </td>

                <td style={{ padding: "12px" }}>
                  <Bdg color={u.active ? "green" : "gray"}>
                    {u.active ? "Active" : "Inactive"}
                  </Bdg>
                </td>

                <td style={{ padding: "12px", textAlign: "right" }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      justifyContent: "flex-end",
                      alignItems: "center",
                    }}
                  >
                    {/* 3. RESTORED MISSING INDIVIDUAL PERMISSION OVERRIDE BUTTON */}
                    <Btn
                      v="ghost"
                      sz="sm"
                      onClick={() => handleOpenPermissionOverrides(u)}
                      title="Configure individual user permission overrides"
                    >
                      🔒 Override
                    </Btn>

                    <Btn v="ghost" sz="sm" onClick={() => handleEditUser(u)}>
                      Edit
                    </Btn>

                    {u.active && (
                      <Btn
                        v="danger-ghost"
                        sz="sm"
                        onClick={() => handleDeactivateUser(u.id)}
                      >
                        Deactivate
                      </Btn>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal === "user" && (
        <Modal
          title={editing ? "Edit User" : "Add New User"}
          onClose={() => setModal(null)}
        >
          <Fld label="Full Name">
            <Inp
              value={form.name || ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Fld>
          <Fld label="Email">
            <Inp
              type="email"
              value={form.email || ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="user@maumeeriverroofing.com"
            />
          </Fld>
          <Fld label="Role">
            <Sel
              value={form.role || "field"}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="admin"> — Full System Access</option>
              <option value="warehouse">Warehouse Manager</option>
              <option value="coordinator">Production Coordinator</option>
              <option value="manager">Manager</option>
              <option value="field">Site Supervisor (Field)</option>
              <option value="employee">Employee / Field Staff</option>
            </Sel>
          </Fld>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <Btn
              v="ghost"
              onClick={() => setModal(null)}
              style={{ flex: 1, justifyContent: "center" }}
            >
              Cancel
            </Btn>
            <Btn
              v="primary"
              onClick={save}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {editing ? "Save Changes" : "Add User"}
            </Btn>
          </div>
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
          <div
            style={{
              background: C.aB,
              border: `1.5px solid ${C.am}`,
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 14,
              fontSize: 12,
              color: C.am,
              fontWeight: 600,
            }}
          >
            ⚠️ Overrides apply <em>on top of</em> the{" "}
            <strong>{ROLES[permUser.role]?.label}</strong> role permissions and
            only affect <strong>{permUser.name}</strong>.
          </div>
          {userOverrides[permUser.id] &&
            Object.keys(userOverrides[permUser.id]).length > 0 && (
              <div
                style={{
                  marginBottom: 10,
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <Btn
                  v="danger"
                  sz="sm"
                  onClick={() => clearOverrides(permUser.id)}
                >
                  Clear All Overrides
                </Btn>
              </div>
            )}
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ background: C.lg }}>
                  <th
                    style={{
                      padding: "10px 14px",
                      textAlign: "left",
                      color: C.sub,
                      fontWeight: 700,
                      fontSize: 11,
                      textTransform: "uppercase",
                      minWidth: 220,
                    }}
                  >
                    Permission
                  </th>
                  <th
                    style={{
                      padding: "10px 14px",
                      textAlign: "center",
                      color: C.sub,
                      fontWeight: 700,
                      fontSize: 11,
                      textTransform: "uppercase",
                      width: 110,
                    }}
                  >
                    Role Default
                  </th>
                  <th
                    style={{
                      padding: "10px 14px",
                      textAlign: "center",
                      color: C.sub,
                      fontWeight: 700,
                      fontSize: 11,
                      textTransform: "uppercase",
                      width: 110,
                    }}
                  >
                    This User
                  </th>
                </tr>
              </thead>
              {PERM_GROUPS.map(([groupName, keys]) => (
                <tbody key={groupName}>
                  <tr>
                    <td
                      colSpan={3}
                      style={{
                        padding: "8px 14px",
                        fontWeight: 900,
                        color: C.w,
                        background: C.navy,
                        fontSize: 12,
                      }}
                    >
                      {groupName}
                    </td>
                  </tr>
                  {keys.map((key) => {
                    const baseVal =
                      (rolePerms[permUser.role] || {})[key] || false;
                    const ovVal = (userOverrides[permUser.id] || {})[key];
                    const effective = ovVal !== undefined ? ovVal : baseVal;
                    const hasOverride = ovVal !== undefined;
                    return (
                      <tr
                        key={key}
                        style={{
                          borderTop: `1px solid ${C.lg}`,
                          background: hasOverride
                            ? "rgba(217,119,6,0.07)"
                            : "transparent",
                        }}
                      >
                        <td style={{ padding: "10px 14px" }}>
                          <div
                            style={{
                              fontWeight: 700,
                              color: C.navy,
                              fontSize: 12,
                            }}
                          >
                            {PERM_DEFS[key].label}
                            {hasOverride && (
                              <span
                                style={{
                                  marginLeft: 6,
                                  fontSize: 10,
                                  color: C.am,
                                  fontWeight: 700,
                                }}
                              >
                                OVERRIDDEN
                              </span>
                            )}
                          </div>
                          <div
                            style={{ fontSize: 10, color: C.sub, marginTop: 2 }}
                          >
                            {PERM_DEFS[key].desc}
                          </div>
                        </td>
                        <td
                          style={{ padding: "10px 14px", textAlign: "center" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "center",
                            }}
                          >
                            <Toggle on={baseVal} disabled={true} />
                          </div>
                        </td>
                        <td
                          style={{ padding: "10px 14px", textAlign: "center" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "center",
                            }}
                          >
                            <Toggle
                              on={effective}
                              onChange={() =>
                                toggleOverride(permUser.id, key, baseVal)
                              }
                            />
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
