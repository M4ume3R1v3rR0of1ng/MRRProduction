// src/components/TeamChatBox.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { C, ft, compressImg } from '../utils/helpers';
import { Modal, LoadingState } from './UIPrimitives';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function renderWithMentions(text, names) {
  if (!names.length) return text;
  const pattern = new RegExp(`(@(?:${names.map(escapeRegex).join('|')}))(?![\\w'-])`, 'g');
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    names.some((n) => part === `@${n}`) ? (
      <span key={i} style={{ color: C.blue, fontWeight: "var(--weight-bold)", background: 'rgba(27,82,184,0.1)', borderRadius: "var(--radius-xs)", padding: '0 3px' }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export default function TeamChatBox({ user, users = [], limit = 30, onMarkRead }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  const senderName = user?.name || user?.full_name || user?.email || 'User';
  const knownNames = useMemo(
    () => [...new Set(users.map((u) => u.full_name || u.name).filter(Boolean))].sort((a, b) => b.length - a.length),
    [users],
  );

  const mentionMatch = draft.match(/@([\w'-]*)$/);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const mentionCandidates =
    mentionQuery !== null
      ? users
          .filter((u) => u.id !== user?.id)
          .filter((u) => (u.full_name || u.name || '').toLowerCase().includes(mentionQuery))
          .slice(0, 5)
      : [];

  const selectMention = (u) => {
    const name = u.full_name || u.name;
    setDraft((d) => d.replace(/@([\w'-]*)$/, `@${name} `));
  };

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

  // Mounting this box (i.e. viewing the Dashboard) means the user is caught up.
  useEffect(() => {
    if (typeof onMarkRead === 'function') onMarkRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const attachPhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImg(file, 800, 0.75, (base64) => setPendingPhoto(base64));
    e.target.value = '';
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && !pendingPhoto) || sending) return;
    setSending(true);
    setDraft('');
    const photoToSend = pendingPhoto;
    setPendingPhoto(null);
    try {
      const { data, error: sendError } = await supabase
        .from('team_chat_messages')
        .insert([{ user_id: user?.id || null, user_name: senderName, message: text, photo: photoToSend || null }])
        .select()
        .single();
      if (sendError) throw sendError;
      setError('');
      if (data) addMessage(data);
    } catch (err) {
      console.error('Failed to send chat message:', err);
      setError(err.message || 'Failed to send message.');
      setDraft(text);
      setPendingPhoto(photoToSend);
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
    <div style={{ background: C.w, borderRadius: "var(--radius-xl)", padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column', height: 420 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-black)", color: C.navy }}>💬 Team Chat</h3>
        <button onClick={fetchMessages} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)" }}>
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
          gap: "var(--space-4)",
          paddingRight: 4,
          marginBottom: 12,
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e1 transparent',
        }}
      >
        {loading ? (
          <LoadingState label="Loading messages..." compact />
        ) : messages.length === 0 ? (
          <p style={{ color: C.sub, fontSize: "var(--text-base)", margin: 0, textAlign: 'center', padding: '20px 0' }}>No messages yet. Say hello 👋</p>
        ) : (
          messages.map((m) => {
            const mine = !!(m.user_id && user?.id && m.user_id === user.id);
            const isEditing = editingId === m.id;
            return (
              <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                <div style={{ fontSize: "var(--text-xs)", color: C.sub, fontWeight: "var(--weight-bold)", marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                  {m.user_name || 'Teammate'}
                </div>

                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: "var(--space-2)" }}>
                    <input
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      style={{ padding: '7px 10px', border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", fontSize: "var(--text-base)", boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: "var(--space-3)", justifyContent: 'flex-end' }}>
                      <button onClick={cancelEdit} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer', fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)" }}>Cancel</button>
                      <button onClick={saveEdit} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)" }}>Save</button>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    background: mine ? C.blue : C.lg,
                    color: mine ? C.w : C.navy,
                    borderRadius: "var(--radius-xl)",
                    borderBottomRightRadius: mine ? 3 : 12,
                    borderBottomLeftRadius: mine ? 12 : 3,
                    padding: '8px 12px',
                    fontSize: "var(--text-base)",
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  }}>
                    {m.photo && (
                      <img
                        src={m.photo}
                        alt="Attachment"
                        onClick={() => setLightboxPhoto(m.photo)}
                        style={{ display: 'block', maxWidth: '100%', maxHeight: 160, borderRadius: "var(--radius-md)", marginBottom: m.message ? 6 : 0, cursor: 'pointer' }}
                      />
                    )}
                    {m.message && renderWithMentions(m.message, knownNames)}
                  </div>
                )}

                {!isEditing && (
                  <div style={{ display: 'flex', gap: "var(--space-3)", marginTop: 2, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <span style={{ fontSize: "var(--text-2xs)", color: C.sub }}>
                      {ft(m.created_at)}{m.edited_at ? ' · edited' : ''}
                    </span>
                    {mine && (
                      <>
                        <button onClick={() => startEdit(m)} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", padding: 0 }}>Edit</button>
                        <button onClick={() => deleteMessage(m)} style={{ background: 'none', border: 'none', color: C.rd, cursor: 'pointer', fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", padding: 0 }}>Delete</button>
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
        <div style={{ color: C.rd, background: C.rB, borderRadius: "var(--radius-md)", padding: '6px 10px', fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", marginBottom: 8 }}>
          ⚠️ {error}
        </div>
      )}

      {mentionCandidates.length > 0 && (
        <div style={{ border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", marginBottom: 8, overflow: 'hidden', background: C.w, boxShadow: '0 4px 10px rgba(0,0,0,0.08)' }}>
          {mentionCandidates.map((u) => (
            <div
              key={u.id}
              onClick={() => selectMention(u)}
              style={{ padding: '6px 10px', fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color: C.navy, cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.lg)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              @{u.full_name || u.name}
            </div>
          ))}
        </div>
      )}

      {pendingPhoto && (
        <div style={{ position: 'relative', width: 60, height: 60, marginBottom: 8 }}>
          <img src={pendingPhoto} alt="Pending attachment" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: "var(--radius-md)", border: `1.5px solid ${C.bd}` }} />
          <button
            onClick={() => setPendingPhoto(null)}
            style={{ position: 'absolute', top: -6, right: -6, background: C.rd, color: C.w, border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: "var(--text-xs)", cursor: 'pointer', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: "var(--space-3)" }}>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={attachPhoto} style={{ display: 'none' }} />
        <button
          onClick={() => fileInputRef.current.click()}
          title="Attach a photo"
          style={{ background: C.lg, border: 'none', borderRadius: "var(--radius-md)", padding: '9px 12px', fontSize: "var(--text-md)", cursor: 'pointer' }}
        >
          📷
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (@ to mention)"
          style={{ flex: 1, padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", fontSize: "var(--text-base)", boxSizing: 'border-box' }}
        />
        <button
          onClick={send}
          disabled={(!draft.trim() && !pendingPhoto) || sending}
          style={{ background: C.blue, color: C.w, border: 'none', borderRadius: "var(--radius-md)", padding: '9px 16px', fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", cursor: draft.trim() || pendingPhoto ? 'pointer' : 'default', opacity: draft.trim() || pendingPhoto ? 1 : 0.6 }}
        >
          Send
        </button>
      </div>

      {lightboxPhoto && (
        <Modal title="📷 Attachment" onClose={() => setLightboxPhoto(null)}>
          <img src={lightboxPhoto} alt="Full size attachment" style={{ width: '100%', borderRadius: "var(--radius-md)" }} />
        </Modal>
      )}
    </div>
  );
}
