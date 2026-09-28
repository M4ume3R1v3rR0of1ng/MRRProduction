// src/shared/components/ChatWidget.jsx
import { useEffect, useRef, useState } from "react";
import { Bot, X, AlertTriangle, Camera } from "lucide-react";
import { translations } from "../utils/translations";
import { supabase } from "../utils/supabase";
import { C, compressImg } from "../utils/helpers";
import { LoadingState, Modal } from "./UIPrimitives";

// data:image/jpeg;base64,XXXX -> { media_type: "image/jpeg", data: "XXXX" }
function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;
  return { media_type: match[1], data: match[2] };
}

function toApiContent(msg) {
  const blocks = [];
  if (msg.image) {
    const parsed = parseDataUrl(msg.image);
    if (parsed) blocks.push({ type: "image", source: { type: "base64", ...parsed } });
  }
  if (msg.text) blocks.push({ type: "text", text: msg.text });
  return blocks.length === 1 && blocks[0].type === "text" ? blocks[0].text : blocks;
}

// A per-browser marker of when this user last opened the chat — NOT the
// conversation itself (that's chat_messages, see supabase/41, genuinely
// persisted server-side and synced across devices). This is only for the
// unread badge, which doesn't need to survive a browser switch to be useful.
const lastSeenKey = (userId) => `mrr-chat-last-seen-${userId}`;

export default function ChatWidget({ user, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  // A message the assistant volunteered on its own (an oil-due reminder, see
  // send-maintenance-push-notices.js) rather than one it was asked for.
  // Drives the unread badge on the launcher button below.
  const [hasUnread, setHasUnread] = useState(false);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  // Tags every message THIS TAB sends, so its own realtime echo can be told
  // apart from a message that genuinely arrived from elsewhere — see the
  // realtime effect below and supabase/41's "WHY origin_session_id".
  const sessionIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // Load recent history on login (or when the signed-in user changes) — this
  // is what makes the conversation survive a reload instead of starting blank
  // every time. Capped at 50: plenty of "memory" for continuity without
  // pulling in a driver's entire multi-month history on every mount (chat.js
  // only ever forwards the last 20 turns to the model anyway).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    supabase
      .from("chat_messages")
      .select("id, role, text, proactive, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) {
          console.error("ChatWidget: failed to load chat history:", loadError.message);
          return;
        }
        const rows = data || [];
        setMessages(
          [...rows]
            .reverse()
            .map((r) => ({ id: r.id, role: r.role, text: r.text, proactive: r.proactive })),
        );

        // The newest row (rows[0], since this fetch is newest-first) is a
        // reminder the assistant raised on its own and hasn't been opened
        // since — show the badge without needing to have been in the tab
        // when it was written.
        const newest = rows[0];
        if (newest?.proactive) {
          try {
            const lastSeen = window.localStorage.getItem(lastSeenKey(user.id));
            if (!lastSeen || new Date(newest.created_at) > new Date(lastSeen)) setHasUnread(true);
          } catch {
            // Private browsing / storage disabled — badge just won't persist
            // across a reload for this viewer, nothing else is affected.
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Live delivery while mounted: another tab's message, or — the actual point
  // of this — a reminder send-maintenance-push-notices.js writes directly
  // into chat_messages. RLS (supabase/41) already scopes what Realtime will
  // ever fan to this subscriber to this user's own rows, same reasoning as
  // useAppData.js's other realtime effects.
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("realtime-chat-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const row = payload.new;
          // This tab already rendered its own optimistic copy the moment
          // chat.js's HTTP response came back — skip the echo of that same
          // row rather than showing it twice. A row with no origin_session_id
          // at all (every backend-job-written row) never matches and always
          // gets through.
          if (row.origin_session_id && row.origin_session_id === sessionIdRef.current) return;

          setMessages((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [...prev, { id: row.id, role: row.role, text: row.text, proactive: row.proactive }],
          );
          if (row.proactive && !open) setHasUnread(true);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, open]);

  const toggleOpen = () => {
    if (!open) {
      setHasUnread(false);
      if (user?.id) {
        try {
          window.localStorage.setItem(lastSeenKey(user.id), new Date().toISOString());
        } catch {
          // Nothing to persist to — the badge just re-derives from scratch
          // next load, same fallback as above.
        }
      }
    }
    setOpen((o) => !o);
  };

  const attachPhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImg(
      file,
      800,
      0.75,
      (base64) => setPendingPhoto(base64),
      (msg) => setError(msg),
    );
    e.target.value = "";
  };

  const sendFrom = async (baseMessages, text, image) => {
    if ((!text && !image) || sending) return;
    setError("");
    setSending(true);
    setDraft("");
    setPendingPhoto(null);
    setEditingIndex(null);

    const nextMessages = [...baseMessages, { role: "user", text, image }];
    setMessages(nextMessages);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("Not signed in.");

      const response = await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          sessionId: sessionIdRef.current,
          messages: nextMessages.map((m) => ({ role: m.role, content: toApiContent(m) })),
        }),
      });

      // Read as text first. A crashed or missing function returns an empty body,
      // and calling .json() on that throws "Unexpected end of JSON input" — which
      // hides the status code that actually explains the failure.
      const raw = await response.text();
      let result;
      try {
        result = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`Server returned an unreadable response (${response.status}).`);
      }
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);

      setMessages((prev) => {
        // Tag the user turn we just optimistically rendered with its real
        // persisted id, so a later edit/delete of it can clean up that row
        // too — it's always the last entry, since sendFrom is the only thing
        // that ever appends one.
        const tagged = prev.map((m, i) =>
          i === prev.length - 1 && m.role === "user" && !m.id && result.userMessageId
            ? { ...m, id: result.userMessageId }
            : m,
        );
        return [
          ...tagged,
          { role: "assistant", text: result.reply, id: result.assistantMessageId },
        ];
      });
    } catch (err) {
      console.error("Chat widget error:", err);
      setError(err.message || "Something went wrong.");
    } finally {
      setSending(false);
    }
  };

  const send = () => sendFrom(messages, draft.trim(), pendingPhoto);

  const startEdit = (index) => {
    const msg = messages[index];
    if (msg.role !== "user" || sending) return;
    setEditingIndex(index);
    setDraft(msg.text || "");
    setPendingPhoto(msg.image || null);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setDraft("");
    setPendingPhoto(null);
  };

  const saveEdit = () => {
    const text = draft.trim();
    if (!text && !pendingPhoto) return;
    // Re-send from the point of the edited message — everything after it (including
    // the old reply) is discarded locally, since it was a response to the
    // un-edited version. Their persisted rows need cleaning up too, or a
    // reload would resurrect content nobody can see here anymore.
    const idsToDrop = messages
      .slice(editingIndex)
      .map((m) => m.id)
      .filter(Boolean);
    if (idsToDrop.length) {
      supabase
        .from("chat_messages")
        .delete()
        .in("id", idsToDrop)
        .then(({ error: deleteError }) => {
          if (deleteError) {
            console.error("ChatWidget: failed to clean up edited messages:", deleteError.message);
          }
        });
    }
    sendFrom(messages.slice(0, editingIndex), text, pendingPhoto);
  };

  const deleteMessage = (index) => {
    if (!window.confirm(t.chDeleteConfirm)) return;
    const target = messages[index];
    setMessages((prev) => prev.filter((_, i) => i !== index));
    if (target?.id) {
      supabase
        .from("chat_messages")
        .delete()
        .eq("id", target.id)
        .then(({ error: deleteError }) => {
          if (deleteError) {
            console.error("ChatWidget: failed to delete persisted message:", deleteError.message);
          }
        });
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      editingIndex !== null ? saveEdit() : send();
    } else if (e.key === "Escape" && editingIndex !== null) {
      cancelEdit();
    }
  };

  // Offsets clear the iOS home indicator and, in landscape, the rounded corner.
  // Both insets are 0px off a notched device, so this is the same corner
  // placement it always had.
  return (
    <div
      style={{
        position: "fixed",
        bottom: "calc(var(--space-8) + var(--safe-bottom))",
        right: "calc(var(--space-8) + var(--safe-right))",
        zIndex: 2000,
      }}
    >
      {open && (
        <div
          style={{
            width: 340,
            height: 500,
            background: C.w,
            borderRadius: "var(--radius-2xl)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
            display: "flex",
            flexDirection: "column",
            marginBottom: "var(--space-4)",
            overflow: "hidden",
            border: `1px solid ${C.bd}`,
          }}
        >
          <div
            style={{
              background: C.shell,
              color: C.shellInk,
              padding: "var(--space-5) var(--space-6)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontWeight: "var(--weight-extrabold)",
                fontSize: "var(--text-md)",
              }}
            >
              <Bot size={17} aria-hidden="true" /> Steadwerk Assistant
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: "none",
                border: "none",
                color: C.shellInk,
                cursor: "pointer",
                fontSize: "var(--text-xl)",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          <div
            ref={scrollRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "var(--space-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            {messages.length === 0 && (
              <p
                style={{
                  color: C.sub,
                  fontSize: "var(--text-sm)",
                  textAlign: "center",
                  margin: "var(--space-8) 0",
                }}
              >
                {t.cwIntro}
              </p>
            )}
            {messages.map((m, i) => {
              const mine = m.role === "user";
              const isEditing = editingIndex === i;
              return (
                <div
                  key={m.id ?? `local-${i}`}
                  style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%" }}
                >
                  {!isEditing && (
                    <div
                      style={{
                        background: mine ? C.blue : C.lg,
                        color: mine ? C.onAccent : C.navy,
                        borderRadius: "var(--radius-xl)",
                        borderBottomRightRadius: mine ? 3 : "var(--radius-xl)",
                        borderBottomLeftRadius: mine ? "var(--radius-xl)" : 3,
                        padding: "var(--space-3) var(--space-5)",
                        fontSize: "var(--text-base)",
                        lineHeight: 1.4,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {m.image && (
                        <img
                          src={m.image}
                          alt={t.chAttachment}
                          onClick={() => setLightboxPhoto(m.image)}
                          style={{
                            display: "block",
                            maxWidth: "100%",
                            maxHeight: 160,
                            borderRadius: "var(--radius-md)",
                            marginBottom: m.text ? "var(--space-2)" : 0,
                            cursor: "pointer",
                          }}
                        />
                      )}
                      {m.text}
                    </div>
                  )}

                  {isEditing && (
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
                    >
                      {pendingPhoto && (
                        <img
                          src={pendingPhoto}
                          alt={t.chAttachment}
                          style={{ maxWidth: 120, borderRadius: "var(--radius-md)" }}
                        />
                      )}
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        style={{
                          padding: "7px 10px",
                          border: `1.5px solid ${C.bd}`,
                          borderRadius: "var(--radius-md)",
                          fontSize: "var(--text-base)",
                          boxSizing: "border-box",
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--space-3)",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          onClick={cancelEdit}
                          style={{
                            background: "none",
                            border: "none",
                            color: C.sub,
                            cursor: "pointer",
                            fontSize: "var(--text-xs)",
                            fontWeight: "var(--weight-bold)",
                          }}
                        >
                          {t.chCancel}
                        </button>
                        <button
                          onClick={saveEdit}
                          style={{
                            background: "none",
                            border: "none",
                            color: C.blue,
                            cursor: "pointer",
                            fontSize: "var(--text-xs)",
                            fontWeight: "var(--weight-bold)",
                          }}
                        >
                          {t.chSaveResend}
                        </button>
                      </div>
                    </div>
                  )}

                  {mine && !isEditing && (
                    <div
                      style={{
                        display: "flex",
                        gap: "var(--space-3)",
                        marginTop: 2,
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        onClick={() => startEdit(i)}
                        disabled={sending}
                        style={{
                          background: "none",
                          border: "none",
                          color: C.blue,
                          cursor: "pointer",
                          fontSize: 10,
                          fontWeight: "var(--weight-bold)",
                          padding: 0,
                        }}
                      >
                        {t.chEdit}
                      </button>
                      <button
                        onClick={() => deleteMessage(i)}
                        disabled={sending}
                        style={{
                          background: "none",
                          border: "none",
                          color: C.rd,
                          cursor: "pointer",
                          fontSize: 10,
                          fontWeight: "var(--weight-bold)",
                          padding: 0,
                        }}
                      >
                        {t.chDelete}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {sending && <LoadingState label={t.cwThinking} compact />}
          </div>

          {error && (
            <div
              style={{
                color: C.rd,
                background: C.rB,
                padding: "var(--space-2) var(--space-5)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-semibold)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <AlertTriangle size={12} aria-hidden="true" /> {error}
              </span>
            </div>
          )}

          {pendingPhoto && editingIndex === null && (
            <div
              style={{
                position: "relative",
                width: 52,
                height: 52,
                margin: "var(--space-2) 0 0 var(--space-4)",
              }}
            >
              <img
                src={pendingPhoto}
                alt={t.chPendingAttachment}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  borderRadius: "var(--radius-md)",
                  border: `1.5px solid ${C.bd}`,
                }}
              />
              <button
                onClick={() => setPendingPhoto(null)}
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  background: C.rd,
                  color: C.onAccent,
                  border: "none",
                  borderRadius: "50%",
                  width: 16,
                  height: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <X size={10} aria-hidden="true" />
              </button>
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: "var(--space-2)",
              padding: "var(--space-4)",
              borderTop: `1px solid ${C.lg}`,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={attachPhoto}
              style={{ display: "none" }}
            />
            <button
              onClick={() => fileInputRef.current.click()}
              disabled={sending || editingIndex !== null}
              title={t.chAttachPhoto}
              style={{
                background: C.lg,
                border: "none",
                borderRadius: "var(--radius-md)",
                padding: "9px var(--space-4)",
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
              }}
            >
              <Camera size={16} color={C.navy} aria-hidden="true" />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.cwAskQuestion}
              disabled={sending || editingIndex !== null}
              style={{
                flex: 1,
                padding: "9px 11px",
                border: `1.5px solid ${C.bd}`,
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-base)",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={send}
              disabled={sending || editingIndex !== null || (!draft.trim() && !pendingPhoto)}
              style={{
                background: C.blue,
                color: C.onAccent,
                border: "none",
                borderRadius: "var(--radius-md)",
                padding: "9px var(--space-6)",
                fontSize: "var(--text-base)",
                fontWeight: "var(--weight-bold)",
                cursor: draft.trim() || pendingPhoto ? "pointer" : "default",
                opacity: draft.trim() || pendingPhoto ? 1 : 0.6,
              }}
            >
              {t.chSend}
            </button>
          </div>
        </div>
      )}

      <button
        onClick={toggleOpen}
        title={t.cwAssistant}
        style={{
          position: "relative",
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: C.gold,
          color: C.navy,
          border: "none",
          boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {open ? <X size={24} aria-hidden="true" /> : <Bot size={26} aria-hidden="true" />}
        {/* The assistant has something to say that wasn't asked for — see the
            history-load and realtime effects above. Cleared the moment this opens. */}
        {hasUnread && !open && (
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: C.rd,
              border: `2px solid ${C.w}`,
            }}
          />
        )}
      </button>

      {lightboxPhoto && (
        <Modal title={t.chAttachmentLabel} onClose={() => setLightboxPhoto(null)}>
          <img
            src={lightboxPhoto}
            alt={t.chFullSize}
            style={{ width: "100%", borderRadius: "var(--radius-md)" }}
          />
        </Modal>
      )}
    </div>
  );
}
