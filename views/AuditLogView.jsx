// src/views/AuditLogView.jsx
import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";
import { C, fd } from "../utils/helpers"; // Assuming fd formats dates

export default function AuditLogView({ perms }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLogs() {
      setLoading(true);
      const { data, error } = await supabase
        .from("system_logs")
        .select("*")
        .order("created_at", { ascending: false }) // Shows newest logs first
        .limit(200); // Guard rails to prevent crashing on giant tables

      if (error) {
        console.error("Error fetching audit trail:", error.message);
      } else {
        setLogs(data || []);
      }
      setLoading(false);
      
    }
    

    if (perms.users_manage) { // Basic security check
      fetchLogs();
    }
  }, [perms]);

  
export default function UserManagementView({ users, setUsers, currentUser, rolePerms, userOverrides, setUserOverrides }) {
  
  const handleUpdateUserRole = async (targetUserId, targetUserEmail, newRole) => {
    try {
      // ... your existing Supabase/State logic to update the user's role ...
      
      // Track the mutation right after it completes successfully
      await logAction(
        currentUser.id,
        currentUser.email,
        'PERM_CHANGE',
        `Changed role for ${targetUserEmail} to ${newRole}`,
        { target_user_id: targetUserId, new_role: newRole }
      );
      
    } catch (err) {
      console.error("Failed to update user role:", err);
    }
  };
  const badgeStyles = {
  PERM_CHANGE: { bg: '#fee2e2', text: '#991b1b' },     // Red
  INV_MUTATION: { bg: '#fef3c7', text: '#92400e' },    // Amber
  LOGOUT: { bg: '#f3f4f6', text: '#374151' },          // Gray
  DEFAULT: { bg: '#e0f2fe', text: '#0369a1' }          // Blue[cite: 6]
};

const style = badgeStyles[log.action_type] || badgeStyles.DEFAULT;
  return (
    <div style={{ background: C.w, padding: 20, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <h2 style={{ color: C.navy, marginBottom: 4 }}>System Audit Trail</h2>
      <p style={{ color: C.sub, fontSize: 13, marginBottom: 20 }}>Immutable historical record of mutations and security actions.</p>

      {loading ? (
        <div>Loading log entries...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.lg, textAlign: "left" }}>
                <th style={{ padding: 10 }}>Timestamp</th>
                <th style={{ padding: 10 }}>User</th>
                <th style={{ padding: 10 }}>Action</th>
                <th style={{ padding: 10 }}>Description</th>
                <th style={{ padding: 10 }}>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: `1px solid ${C.lg}` }}>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{fd(log.created_at) || log.created_at}</td>
                  <td style={{ padding: 10 }}>
                    <strong>{log.user_email}</strong> <br />
                    <span style={{ fontSize: 11, color: C.sub }}>ID: {log.user_id}</span>
                  </td>
                  <td style={{ padding: 10 }}>
                    <span style={{ 
                      background: log.action_type === 'PERM_CHANGE' ? '#fee2e2' : '#e0f2fe', 
                      color: log.action_type === 'PERM_CHANGE' ? '#991b1b' : '#0369a1',
                      padding: '2px 6px', borderRadius: 4, fontWeight: 'bold', fontSize: 11
                    }}>
                      {log.action_type}
                    </span>
                  </td>
                  <td style={{ padding: 10 }}>{log.description}</td>
                  <td style={{ padding: 10 }}>
                    {log.metadata && Object.keys(log.metadata).length > 0 ? (
                      <pre style={{ margin: 0, fontSize: 11, background: '#f8fafc', padding: 6, borderRadius: 4, overflow: 'auto', maxWidth: 250 }}>
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    ) : (
                      <span style={{ color: C.sub }}>--</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
}