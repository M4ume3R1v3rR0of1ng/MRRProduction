// src/components/TeamChatBox.jsx
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { C, ft } from '../utils/helpers';

export default function TeamChatBox({ user, limit = 30 }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const scrollRef = useRef(null);

  const senderName = user?.name || user?.full_name || user?.email || 'User';

  const addMessage = (msg) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-limit)));
  };

  const replaceMessage = (msg) => {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
  };

  const removeMessage = (id) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const fetchMessages = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('team_chat_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (fetchError) throw fetchError;
      setError('');
      setMessages((data || []).slice().reverse());
    } catch (err) {
      console.error('Failed to fetch team chat messages:', err);
      setError(err.message || 'Failed to load messages.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel('realtime-team-chat')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_chat_messages' }, (payload) => {
        if (payload.eventType === 'INSERT') addMessage(payload.new);
        else if (payload.eventType === 'UPDATE') replaceMessage(payload.new);
        else if (payload.eventType === 'DELETE') removeMessage(payload.old.id);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    try {
      const { data, error: sendError } = await supabase
        .from('team_chat_messages')
        .insert([{ user_id: user?.id || null, user_name: senderName, message: text }])
        .select()
        .single();
      if (sendError) throw sendError;
      setError('');
      if (data) addMessage(data);
    } catch (err) {
      console.error('Failed to send chat message:', err);
      setError(err.message || 'Failed to send message.');
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditDraft(m.message);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
  };

  const saveEdit = async () => {
    const text = editDraft.trim();
    if (!text) return;
    try {
      const { data, error: editError } = await supabase
        .from('team_chat_messages')
        .update({ message: text, edited_at: new Date().toISOString() })
        .eq('id', editingId)
        .select()
        .single();
      if (editError) throw editError;
      setError('');
      if (data) replaceMessage(data);
      cancelEdit();
    } catch (err) {
      console.error('Failed to edit chat message:', err);
      setError(err.message || 'Failed to edit message.');
    }
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  const deleteMessage = async (m) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      const { error: deleteError } = await supabase.from('team_chat_messages').delete().eq('id', m.id);
      if (deleteError) throw deleteError;
      setError('');
      removeMessage(m.id);
    } catch (err) {
      console.error('Failed to delete chat message:', err);
      setError(err.message || 'Failed to delete message.');
    }
  };

  return (
    <div style={{ background: C.w, borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column', height: 420 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: C.navy }}>💬 Team Chat</h3>
        <button onClick={fetchMessages} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
          🔄 Refresh
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          paddingRight: 4,
          marginBottom: 12,
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e1 transparent',
        }}
      >
        {loading ? (
          <div style={{ color: C.sub, fontSize: 13 }}>Loading messages...</div>
        ) : messages.length === 0 ? (
          <p style={{ color: C.sub, fontSize: 13, margin: 0, textAlign: 'center', padding: '20px 0' }}>No messages yet. Say hello 👋</p>
        ) : (
          messages.map((m) => {
            const mine = !!(m.user_id && user?.id && m.user_id === user.id);
            const isEditing = editingId === m.id;
            return (
              <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                  {m.user_name || 'Teammate'}
                </div>

                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      style={{ padding: '7px 10px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={cancelEdit} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Cancel</button>
                      <button onClick={saveEdit} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Save</button>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    background: mine ? C.blue : C.lg,
                    color: mine ? C.w : C.navy,
                    borderRadius: 12,
                    borderBottomRightRadius: mine ? 3 : 12,
                    borderBottomLeftRadius: mine ? 12 : 3,
                    padding: '8px 12px',
                    fontSize: 13,
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  }}>
                    {m.message}
                  </div>
                )}

                {!isEditing && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 2, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <span style={{ fontSize: 10, color: C.sub }}>
                      {ft(m.created_at)}{m.edited_at ? ' · edited' : ''}
                    </span>
                    {mine && (
                      <>
                        <button onClick={() => startEdit(m)} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 10, fontWeight: 700, padding: 0 }}>Edit</button>
                        <button onClick={() => deleteMessage(m)} style={{ background: 'none', border: 'none', color: C.rd, cursor: 'pointer', fontSize: 10, fontWeight: 700, padding: 0 }}>Delete</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {error && (
        <div style={{ color: C.rd, background: C.rB, borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          style={{ flex: 1, padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
        />
        <button
          onClick={send}
          disabled={!draft.trim() || sending}
          style={{ background: C.blue, color: C.w, border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'default', opacity: draft.trim() ? 1 : 0.6 }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
