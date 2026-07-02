// src/components/ChatWidget.jsx
import { useEffect, useRef, useState } from "react";
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

export default function ChatWidget({ user }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const attachPhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImg(file, 800, 0.75, (base64) => setPendingPhoto(base64));
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
          messages: nextMessages.map((m) => ({ role: m.role, content: toApiContent(m) })),
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);

      setMessages((prev) => [...prev, { role: "assistant", text: result.reply }]);
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
    // the old reply) is discarded, since it was a response to the un-edited version.
    sendFrom(messages.slice(0, editingIndex), text, pendingPhoto);
  };

  const deleteMessage = (index) => {
    if (!window.confirm("Delete this message?")) return;
    setMessages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      editingIndex !== null ? saveEdit() : send();
    } else if (e.key === "Escape" && editingIndex !== null) {
      cancelEdit();
    }
  };

  return (
    <div style={{ position: "fixed", bottom: "var(--space-8)", right: "var(--space-8)", zIndex: 2000 }}>
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
              background: C.navy,
              color: C.w,
              padding: "var(--space-5) var(--space-6)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: "var(--weight-extrabold)", fontSize: "var(--text-md)" }}>🤖 MRR Assistant</div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", color: C.w, cursor: "pointer", fontSize: "var(--text-xl)", lineHeight: 1 }}
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
              <p style={{ color: C.sub, fontSize: "var(--text-sm)", textAlign: "center", margin: "var(--space-8) 0" }}>
                Ask me about jobs, inventory, fleet status, or maintenance requests.
              </p>
            )}
            {messages.map((m, i) => {
              const mine = m.role === "user";
              const isEditing = editingIndex === i;
              return (
                <div key={i} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                  {!isEditing && (
                    <div
                      style={{
                        background: mine ? C.blue : C.lg,
                        color: mine ? C.w : C.navy,
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
                          alt="Attachment"
                          onClick={() => setLightboxPhoto(m.image)}
                          style={{ display: "block", maxWidth: "100%", maxHeight: 160, borderRadius: "var(--radius-md)", marginBottom: m.text ? "var(--space-2)" : 0, cursor: "pointer" }}
                        />
                      )}
                      {m.text}
                    </div>
                  )}

                  {isEditing && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                      {pendingPhoto && (
                        <img src={pendingPhoto} alt="Attachment" style={{ maxWidth: 120, borderRadius: "var(--radius-md)" }} />
                      )}
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        style={{ padding: "7px 10px", border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", fontSize: "var(--text-base)", boxSizing: "border-box" }}
                      />
                      <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
                        <button onClick={cancelEdit} style={{ background: "none", border: "none", color: C.sub, cursor: "pointer", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)" }}>Cancel</button>
                        <button onClick={saveEdit} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)" }}>Save &amp; Resend</button>
                      </div>
                    </div>
                  )}

                  {mine && !isEditing && (
                    <div style={{ display: "flex", gap: "var(--space-3)", marginTop: 2, justifyContent: "flex-end" }}>
                      <button onClick={() => startEdit(i)} disabled={sending} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 10, fontWeight: "var(--weight-bold)", padding: 0 }}>Edit</button>
                      <button onClick={() => deleteMessage(i)} disabled={sending} style={{ background: "none", border: "none", color: C.rd, cursor: "pointer", fontSize: 10, fontWeight: "var(--weight-bold)", padding: 0 }}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
            {sending && <LoadingState label="Thinking..." compact />}
          </div>

          {error && (
            <div style={{ color: C.rd, background: C.rB, padding: "var(--space-2) var(--space-5)", fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" }}>
              ⚠️ {error}
            </div>
          )}

          {pendingPhoto && editingIndex === null && (
            <div style={{ position: "relative", width: 52, height: 52, margin: "var(--space-2) 0 0 var(--space-4)" }}>
              <img src={pendingPhoto} alt="Pending attachment" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "var(--radius-md)", border: `1.5px solid ${C.bd}` }} />
              <button
                onClick={() => setPendingPhoto(null)}
                style={{ position: "absolute", top: -6, right: -6, background: C.rd, color: C.w, border: "none", borderRadius: "50%", width: 16, height: 16, fontSize: 10, cursor: "pointer", lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-2)", padding: "var(--space-4)", borderTop: `1px solid ${C.lg}` }}>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={attachPhoto} style={{ display: "none" }} />
            <button
              onClick={() => fileInputRef.current.click()}
              disabled={sending || editingIndex !== null}
              title="Attach a photo"
              style={{ background: C.lg, border: "none", borderRadius: "var(--radius-md)", padding: "9px var(--space-4)", fontSize: "var(--text-md)", cursor: "pointer" }}
            >
              📷
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              disabled={sending || editingIndex !== null}
              style={{ flex: 1, padding: "9px 11px", border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", fontSize: "var(--text-base)", boxSizing: "border-box" }}
            />
            <button
              onClick={send}
              disabled={sending || editingIndex !== null || (!draft.trim() && !pendingPhoto)}
              style={{
                background: C.blue,
                color: C.w,
                border: "none",
                borderRadius: "var(--radius-md)",
                padding: "9px var(--space-6)",
                fontSize: "var(--text-base)",
                fontWeight: "var(--weight-bold)",
                cursor: draft.trim() || pendingPhoto ? "pointer" : "default",
                opacity: draft.trim() || pendingPhoto ? 1 : 0.6,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        title="MRR Assistant"
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: C.gold,
          color: C.navy,
          border: "none",
          boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
          cursor: "pointer",
          fontSize: 26,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {open ? "×" : "🤖"}
      </button>

      {lightboxPhoto && (
        <Modal title="📷 Attachment" onClose={() => setLightboxPhoto(null)}>
          <img src={lightboxPhoto} alt="Full size attachment" style={{ width: "100%", borderRadius: "var(--radius-md)" }} />
        </Modal>
      )}
    </div>
  );
}
