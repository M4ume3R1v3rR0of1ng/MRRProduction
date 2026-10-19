// src/shared/components/ChatWidget.jsx
//
// A.N.V.I.L.'s window. The conversation lives here; the backend is
// netlify/functions/chat.js.
//
// TWO THINGS THIS GAINED BEYOND "ASK AND READ"
//
//   A CONFIRM BAR. A.N.V.I.L. can now change things, and a reply may arrive with a
//   `pendingAction` attached: a write it has lined up but not performed. The
//   bar below renders that action's own summary with Confirm and Cancel, and
//   pressing Confirm sends the signed token back. See anvilActions.js for why
//   it is two round trips.
//
//   AN ASK BUS. The dashboard card and OmniSearch can hand this widget a
//   question from elsewhere in the tree — see ./anvil.js for why that is an
//   event rather than a context.
import { useEffect, useRef, useState } from "react";
import { Bot, X, AlertTriangle, Check } from "lucide-react";
import { translations } from "../utils/translations";
import { supabase } from "../utils/supabase";
import { C, compressImg } from "../utils/helpers";
import {
  LoadingState,
  Modal,
  Row,
  Stack,
  Muted,
  Callout,
  TextBtn,
  Inp,
  Btn,
  Text,
} from "./UIPrimitives";
import { ChatBubble, PendingPhoto, ChatComposer } from "./ChatParts";
import { ANVIL_EXPANSION, onAnvilAsk } from "./anvil";

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

// The two bits of type in the header that Text has no prop for — letter
// spacing on the acronym, and the subdued second line under it. Hoisted rather
// than written inline for the same reason LayoutPrimitives hoists TRUNCATE and
// CELL_PAD: a style object rebuilt on every render is a new object every
// render, and these never change.
const TITLE_ACRONYM = { letterSpacing: "0.06em" };
const TITLE_EXPANSION = { opacity: 0.75, lineHeight: 1.2 };
// The confirm bar's own shell. A subtle surface rather than a Callout tone, so
// a pending change reads as "your attention is needed" without borrowing
// Callout's danger/warning colors — nothing has gone wrong here.
//
// Colors come through C rather than naming a palette slot by hand — those
// slots are reachable directly, and src/shared/utils/palette.test.js fails the
// build on a view that takes the shortcut, which is what keeps per-company
// branding working. (That audit scans comments too, so this one says it in
// words.)
const CONFIRM_BAR = {
  padding: "var(--space-4)",
  borderTop: `1px solid ${C.lg}`,
  background: C.subtle,
};

export default function ChatWidget({ user, lang = "en", context = null }) {
  const t = translations[lang] || translations.en;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  // A write A.N.V.I.L. has lined up and described, waiting on this person to say
  // yes. Exactly one at a time — the backend sends at most one per reply (see
  // chat.js's "The FIRST valid preview wins"), because one button cannot
  // honestly mean two changes.
  const [pendingAction, setPendingAction] = useState(null);
  const [applying, setApplying] = useState(false);
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
  // Which page the user is on, read at SEND time rather than captured when
  // sendFrom was defined. The ask-bus effect below runs once and would
  // otherwise close over whatever view happened to be open at mount.
  const contextRef = useRef(context);
  contextRef.current = context;
  // The conversation as it stands, for the ask-bus effect below — which is
  // registered once and so cannot read `messages` directly.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending, pendingAction]);

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

  const sendFrom = async (baseMessages, text, image, askContext = null) => {
    if ((!text && !image) || sending) return;
    setError("");
    setSending(true);
    setDraft("");
    setPendingPhoto(null);
    setEditingIndex(null);
    // A new question supersedes any write still waiting on a yes. Leaving the
    // old bar up would let someone confirm a correction they have since talked
    // A.N.V.I.L. out of.
    setPendingAction(null);

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
          // The caller's own context wins when it supplied one (OmniSearch and
          // the dashboard card know what the question is about better than the
          // route does).
          context: askContext || contextRef.current || null,
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
      if (result.pendingAction) setPendingAction(result.pendingAction);
    } catch (err) {
      console.error("Chat widget error:", err);
      setError(err.message || "Something went wrong.");
    } finally {
      setSending(false);
    }
  };

  const send = () => sendFrom(messages, draft.trim(), pendingPhoto);

  // ── Confirming a write ───────────────────────────────────────────────────
  //
  // Sends the signed token back and nothing else: no new user turn, and the
  // model is not consulted again. chat.js commits the action and returns the
  // outcome in its own words, which is appended here as A.N.V.I.L.'s next message.
  const confirmPending = async () => {
    if (!pendingAction || applying) return;
    setApplying(true);
    setError("");
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
          confirmAction: pendingAction,
        }),
      });
      const raw = await response.text();
      let result;
      try {
        result = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`Server returned an unreadable response (${response.status}).`);
      }
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);

      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: result.reply, id: result.assistantMessageId },
      ]);
      // Cleared whether or not the write succeeded. A refused action (the
      // ticket moved, the item is gone) must not leave a button that invites a
      // second attempt at something that will fail the same way — A.N.V.I.L.'s
      // reply above already says what happened.
      setPendingAction(null);
    } catch (err) {
      console.error("Chat widget confirm error:", err);
      setError(err.message || "Something went wrong.");
    } finally {
      setApplying(false);
    }
  };

  // Local only: there is nothing on the server to cancel, since the preview
  // never wrote anything. The note is appended so the transcript reads
  // honestly on reload — it is NOT persisted, because chat_messages is
  // insert-only from the server (supabase/41) and a "cancelled" line is not
  // worth a round trip.
  const cancelPending = () => {
    if (applying) return;
    setPendingAction(null);
    setMessages((prev) => [...prev, { role: "assistant", text: t.cwCancelled }]);
  };

  // A question handed over from elsewhere in the app — the dashboard card,
  // OmniSearch. Opens the widget so the answer is not delivered to a closed
  // bubble. See ./anvil.js for why this is an event.
  useEffect(
    () =>
      onAnvilAsk((question, askContext) => {
        setOpen(true);
        setHasUnread(false);
        // messagesRef, not the `messages` closure: this effect registers once,
        // and closing over the list would silently discard the conversation so
        // far. Not read through a setMessages updater either — React may
        // invoke an updater twice in development, and sending the question
        // from inside one would ask it twice.
        sendFrom(messagesRef.current, question, null, askContext);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
          <Row
            gap={0}
            justify="space-between"
            style={{
              background: C.shell,
              color: C.shellInk,
              padding: "var(--space-5) var(--space-6)",
            }}
          >
            {/* The acronym with its expansion under it. An acronym nobody can
                unpack is just noise on a button, and this is the one place
                there is room to say what it stands for.

                Both lines inherit the header's own ink (C.shellInk) rather
                than naming a color — Text defaults to the body color, which is
                navy and unreadable on this bar. */}
            <Row gap="7px" align="center">
              <Bot size={17} aria-hidden="true" />
              <Stack gap={0}>
                <Text size="md" weight="extrabold" color="inherit" style={TITLE_ACRONYM}>
                  {t.cwAssistant}
                </Text>
                <Text as="span" size="2xs" color="inherit" style={TITLE_EXPANSION}>
                  {t.cwAssistantExpansion || ANVIL_EXPANSION}
                </Text>
              </Stack>
            </Row>
            <TextBtn
              onClick={() => setOpen(false)}
              color={C.shellInk}
              weight="normal"
              size="xl"
              style={{ lineHeight: 1, padding: "1px 6px" }}
            >
              ×
            </TextBtn>
          </Row>

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
              <Muted as="p" size="sm" style={{ textAlign: "center", margin: "var(--space-8) 0" }}>
                {t.cwIntro}
              </Muted>
            )}
            {messages.map((m, i) => {
              const mine = m.role === "user";
              const isEditing = editingIndex === i;
              return (
                <Stack
                  key={m.id ?? `local-${i}`}
                  gap={0}
                  style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%" }}
                >
                  {!isEditing && (
                    <ChatBubble
                      mine={mine}
                      photo={m.image}
                      photoAlt={t.chAttachment}
                      onPhotoClick={() => setLightboxPhoto(m.image)}
                    >
                      {m.text}
                    </ChatBubble>
                  )}

                  {isEditing && (
                    <Stack gap={2}>
                      {pendingPhoto && (
                        <img
                          src={pendingPhoto}
                          alt={t.chAttachment}
                          style={{ maxWidth: 120, borderRadius: "var(--radius-md)" }}
                        />
                      )}
                      <Inp
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        style={{ padding: "7px 10px", fontSize: "var(--text-base)" }}
                      />
                      <Row align="stretch" justify="flex-end">
                        <TextBtn
                          onClick={cancelEdit}
                          color={C.sub}
                          size="xs"
                          style={{ padding: "1px 6px" }}
                        >
                          {t.chCancel}
                        </TextBtn>
                        <TextBtn onClick={saveEdit} size="xs" style={{ padding: "1px 6px" }}>
                          {t.chSaveResend}
                        </TextBtn>
                      </Row>
                    </Stack>
                  )}

                  {mine && !isEditing && (
                    <Row align="stretch" justify="flex-end" style={{ marginTop: 2 }}>
                      <TextBtn onClick={() => startEdit(i)} disabled={sending} size="2xs">
                        {t.chEdit}
                      </TextBtn>
                      <TextBtn
                        onClick={() => deleteMessage(i)}
                        disabled={sending}
                        color={C.rd}
                        size="2xs"
                      >
                        {t.chDelete}
                      </TextBtn>
                    </Row>
                  )}
                </Stack>
              );
            })}
            {sending && <LoadingState label={t.cwThinking} compact />}
          </div>

          {error && (
            <Callout
              tone="danger"
              pad="var(--space-2) var(--space-5)"
              size="xs"
              weight="semibold"
              color={C.rd}
              style={{ borderRadius: 0 }}
            >
              <Row as="span" gap="5px">
                <AlertTriangle size={12} aria-hidden="true" /> {error}
              </Row>
            </Callout>
          )}

          {/* ── The confirm bar ──
              A write A.N.V.I.L. has described but not performed. It sits above the
              composer, in the amber used for "your attention is needed"
              elsewhere, and repeats the backend's OWN summary verbatim rather
              than A.N.V.I.L.'s paraphrase of it in the bubble above — what is
              confirmed here has to be what the signed token actually commits
              (see anvilActions.js). */}
          {pendingAction && (
            <Stack gap={2} style={CONFIRM_BAR}>
              <Text size="2xs" weight="bold" color={C.sub} style={{ letterSpacing: "0.04em" }}>
                {t.cwConfirmTitle}
              </Text>
              <Text size="sm" color={C.navy}>
                {pendingAction.summary}
              </Text>
              <Row align="stretch" justify="flex-end" gap={2}>
                <Btn v="ghost" sz="sm" onClick={cancelPending} disabled={applying}>
                  {t.cwCancel}
                </Btn>
                <Btn v="primary" sz="sm" onClick={confirmPending} disabled={applying}>
                  <Check size={14} aria-hidden="true" /> {applying ? t.cwApplying : t.cwConfirm}
                </Btn>
              </Row>
            </Stack>
          )}

          {pendingPhoto && editingIndex === null && (
            <PendingPhoto
              src={pendingPhoto}
              alt={t.chPendingAttachment}
              onRemove={() => setPendingPhoto(null)}
              size={52}
              style={{ margin: "var(--space-2) 0 0 var(--space-4)" }}
            />
          )}

          <ChatComposer
            gap={2}
            style={{ padding: "var(--space-4)", borderTop: `1px solid ${C.lg}` }}
            fileInputRef={fileInputRef}
            onPickFile={attachPhoto}
            attachTitle={t.chAttachPhoto}
            attachDisabled={sending || applying || editingIndex !== null}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.cwAskQuestion}
            // Locked while a confirmed write is in flight: a question typed
            // mid-commit clears pendingAction (see sendFrom), which would
            // leave the user watching a write they can no longer see.
            inputDisabled={sending || applying || editingIndex !== null}
            onSend={send}
            sendDisabled={
              sending || applying || editingIndex !== null || (!draft.trim() && !pendingPhoto)
            }
            sendLabel={t.chSend}
          />
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
