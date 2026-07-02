// src/components/ChatWidget.jsx
import { useEffect, useRef, useState } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { LoadingState } from "./UIPrimitives";

export default function ChatWidget({ user }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setError("");
    setSending(true);
    setDraft("");

    const nextMessages = [...messages, { role: "user", content: text }];
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
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);

      setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
    } catch (err) {
      console.error("Chat widget error:", err);
      setError(err.message || "Something went wrong.");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ position: "fixed", bottom: "var(--space-8)", right: "var(--space-8)", zIndex: 2000 }}>
      {open && (
        <div
          style={{
            width: 340,
            height: 460,
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
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                <div
                  style={{
                    background: m.role === "user" ? C.blue : C.lg,
                    color: m.role === "user" ? C.w : C.navy,
                    borderRadius: "var(--radius-xl)",
                    borderBottomRightRadius: m.role === "user" ? 3 : "var(--radius-xl)",
                    borderBottomLeftRadius: m.role === "user" ? "var(--radius-xl)" : 3,
                    padding: "var(--space-3) var(--space-5)",
                    fontSize: "var(--text-base)",
                    lineHeight: 1.4,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && <LoadingState label="Thinking..." compact />}
          </div>

          {error && (
            <div style={{ color: C.rd, background: C.rB, padding: "var(--space-2) var(--space-5)", fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" }}>
              ⚠️ {error}
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-2)", padding: "var(--space-4)", borderTop: `1px solid ${C.lg}` }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              disabled={sending}
              style={{ flex: 1, padding: "9px 11px", border: `1.5px solid ${C.bd}`, borderRadius: "var(--radius-md)", fontSize: "var(--text-base)", boxSizing: "border-box" }}
            />
            <button
              onClick={send}
              disabled={sending || !draft.trim()}
              style={{
                background: C.blue,
                color: C.w,
                border: "none",
                borderRadius: "var(--radius-md)",
                padding: "9px var(--space-6)",
                fontSize: "var(--text-base)",
                fontWeight: "var(--weight-bold)",
                cursor: draft.trim() ? "pointer" : "default",
                opacity: draft.trim() ? 1 : 0.6,
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
    </div>
  );
}
