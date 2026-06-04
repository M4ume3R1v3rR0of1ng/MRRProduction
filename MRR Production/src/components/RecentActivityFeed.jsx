import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { C, fd } from '../utils/helpers';
import { Bdg } from './UIPrimitives';

export default function RecentActivityFeed({ limit = 5 }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchActivities = async () => {
    try {
      // Changed from activity_logs to audit_logs to match logAction()
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      setActivities(data || []);
    } catch (err) {
      console.error('Failed to fetch recent activities:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();

    // Standardized real-time subscription to listen to audit_logs
    const channel = supabase
      .channel('realtime-audit-activity')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, () => {
        fetchActivities();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [limit]);

  const getActivityMarker = (actionType) => {
    switch (actionType) {
      case 'INVENTORY_PULL': return { icon: '🚛', color: 'teal' };
      case 'INV_MUTATION':   return { icon: '⚖️', color: 'amber' }; // Captured stock adjust / counting balances
      case 'JOB_APPROVE':    return { icon: '✅', color: 'green' };
      case 'JOB_STATUS_CHANGE': return { icon: '🔄', color: 'blue' }; // Captured active/completed pipeline updates
      case 'MAT_RECEIVE':    return { icon: '📦', color: 'sky' };
      case 'MAINTENANCE':    return { icon: '🔧', color: 'red' };
      case 'PERM_CHANGE':    return { icon: '🔒', color: 'purple' };
      case 'LOGOUT':         return { icon: '🚪', color: 'rose' };  // Captured user session terminations
      default:               return { icon: '📋', color: 'stone' };
    }
  };

  if (loading) {
    return <div style={{ padding: 16, color: C.sub, fontSize: 13 }}>Loading recent activity...</div>;
  }

  return (
    <div style={{ background: C.w, borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: C.navy }}>⚡ Recent Activity</h3>
        <button onClick={fetchActivities} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
          🔄 Refresh
        </button>
      </div>

      {activities.length === 0 ? (
        <p style={{ color: C.sub, fontSize: 13, margin: 0, textAlign: 'center', padding: '20px 0' }}>No recent system actions logged.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {activities.map((act) => {
            const marker = getActivityMarker(act.action_type);
            return (
              <div key={act.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 16, marginTop: 2 }}>{marker.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: C.navy, fontWeight: 600, lineHeight: 1.4 }}>
                    {act.description}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: C.sub }}>{act.user_email || 'System'}</span>
                    <span style={{ fontSize: 11, color: C.sub }}>•</span>
                    <span style={{ fontSize: 11, color: C.sub }}>{fd(act.created_at)}</span>
                  </div>
                </div>
                <Bdg color={marker.color} sz="sm" style={{ flexShrink: 0, fontSize: 9 }}>
                  {act.action_type ? act.action_type.replace('_', ' ') : 'SYSTEM'}
                </Bdg>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}