// src/features/dashboard/TeamChatBox.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, RefreshCw, AlertTriangle } from "lucide-react";
import { translations } from "@/shared/utils/translations";
import { ChatBubble, PendingPhoto, ChatComposer } from "@/shared/components/ChatParts";
import { supabase } from "@/shared/utils/supabase";
import { C, ft, compressImg } from "@/shared/utils/helpers";
import { knownNamesFrom, mentionPattern } from "@/shared/utils/mentions";
import { notifyChatMention } from "@/shared/utils/chatNotifications";
import {
  Modal,
  LoadingState,
  Row,
  Stack,
  Text,
  Muted,
  TextBtn,
  Card,
  SectionTitle,
  Inp,
  Callout,
  PickRow,
} from "@/shared/components/UIPrimitives";

// The pattern comes from utils/mentions, which is also what decides who gets emailed
// about a mention. Keeping one matcher means the blue highlight and the notification can
// never disagree about what counts as a mention — see the header of that file.
function renderWithMentions(text, names) {
  const pattern = mentionPattern(names);
  if (!pattern) return text;
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    names.some((n) => part === `@${n}`) ? (
      <Text
        as="span"
        key={i}
        weight="bold"
        color={C.blue}
        style={{
          // A wash of the mention's own color — the old rgba() was a fixed light
          // blue that sat on the dark surface as a bright smear.
          background: `color-mix(in srgb, ${C.leather} 10%, transparent)`,
          borderRadius: "var(--radius-xs)",
          padding: "0 3px",
        }}
      >
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

export default function TeamChatBox({
  user,
  users = [],
  limit = 30,
  onMarkRead,
  lang = "en",
  chatNotifications,
}) {
  const t = translations[lang] || translations.en;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  const senderName = user?.name || user?.full_name || user?.email || "User";
  // Deactivated staff are included on purpose: supabase/21 keeps their profiles readable
  // so their names still render on the history they made. They are dropped at the point
  // of emailing, not here — see resolveMentionedUsers in utils/mentions.
  const knownNames = useMemo(() => knownNamesFrom(users), [users]);

  const mentionMatch = draft.match(/@([\w'-]*)$/);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const mentionCandidates =
    mentionQuery !== null
      ? users
          .filter((u) => u.id !== user?.id)
          // Deactivated staff are readable now (supabase/21) so their names still
          // appear on the history they made. They must not be @-mentionable: the
          // mention would notify nobody and imply they are still on the crew.
          .filter((u) => u.active !== false)
          .filter((u) => (u.full_name || u.name || "").toLowerCase().includes(mentionQuery))
          .slice(0, 5)
      : [];

  const selectMention = (u) => {
    const name = u.full_name || u.name;
    setDraft((d) => d.replace(/@([\w'-]*)$/, `@${name} `));
  };

  const addMessage = (msg) => {
    setMessages((prev) =>
      prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-limit),
    );
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
        .from("team_chat_messages")
        .select("*")
        .eq("company_id", user?.companyId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (fetchError) throw fetchError;
      setError("");
      setMessages((data || []).slice().reverse());
    } catch (err) {
      console.error("Failed to fetch team chat messages:", err);
      setError(err.message || "Failed to load messages.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel("realtime-team-chat")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_chat_messages" },
        (payload) => {
          if (payload.eventType === "INSERT") addMessage(payload.new);
          else if (payload.eventType === "UPDATE") replaceMessage(payload.new);
          else if (payload.eventType === "DELETE") removeMessage(payload.old.id);
        },
      )
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
    if (typeof onMarkRead === "function") onMarkRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

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

  const send = async () => {
    const text = draft.trim();
    if ((!text && !pendingPhoto) || sending) return;
    setSending(true);
    setDraft("");
    const photoToSend = pendingPhoto;
    setPendingPhoto(null);
    try {
      const { data, error: sendError } = await supabase
        .from("team_chat_messages")
        .insert([
          {
            user_id: user?.id || null,
            user_name: senderName,
            message: text,
            photo: photoToSend || null,
          },
        ])
        .select()
        .single();
      if (sendError) throw sendError;
      setError("");
      if (data) addMessage(data);

      // Email anyone named in it. No previousMessage, so every mention is new.
      // Deliberately not awaited: the message is already posted and visible to the room,
      // and a slow or failed relay must not hold up the composer or surface as a send
      // error. notifyChatMention resolves either way.
      notifyChatMention({
        message: text,
        users,
        prefs: chatNotifications,
        actorId: user?.id,
        senderName,
        hasPhoto: !!photoToSend,
      });
    } catch (err) {
      console.error("Failed to send chat message:", err);
      setError(err.message || "Failed to send message.");
      setDraft(text);
      setPendingPhoto(photoToSend);
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

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditDraft(m.message);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const saveEdit = async () => {
    const text = editDraft.trim();
    if (!text) return;
    // Captured BEFORE the update, and before `messages` is replaced below: it is the only
    // record of who the message already named, which is what keeps a typo fix from
    // re-emailing everyone in it.
    const priorText = messages.find((m) => m.id === editingId)?.message ?? "";
    try {
      const { data, error: editError } = await supabase
        .from("team_chat_messages")
        .update({ message: text, edited_at: new Date().toISOString() })
        .eq("id", editingId)
        .eq("user_id", user?.id)
        .select()
        .single();
      if (editError) throw editError;
      setError("");
      if (data) replaceMessage(data);
      cancelEdit();

      // An edit can add a name that was not there before. Only those people are told;
      // `priorText` subtracts everyone the message already mentioned, so correcting a
      // word emails nobody. Not awaited, same reasoning as in send().
      notifyChatMention({
        message: text,
        previousMessage: priorText,
        users,
        prefs: chatNotifications,
        actorId: user?.id,
        senderName,
      });
    } catch (err) {
      console.error("Failed to edit chat message:", err);
      setError(err.message || "Failed to edit message.");
    }
  };

  const handleEditKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const deleteMessage = async (m) => {
    if (!window.confirm(t.chDeleteConfirm)) return;
    try {
      const { error: deleteError } = await supabase
        .from("team_chat_messages")
        .delete()
        .eq("id", m.id)
        .eq("user_id", user?.id);
      if (deleteError) throw deleteError;
      setError("");
      removeMessage(m.id);
    } catch (err) {
      console.error("Failed to delete chat message:", err);
      setError(err.message || "Failed to delete message.");
    }
  };

  return (
    <Card
      variant="raised"
      pad={8}
      style={{ display: "flex", flexDirection: "column", height: 420 }}
    >
      <SectionTitle
        as="h3"
        size="lg"
        icon={MessageSquare}
        style={{ marginBottom: 12 }}
        actions={
          <TextBtn onClick={fetchMessages} size="sm">
            <Row inline as="span" gap="5px">
              <RefreshCw size={13} aria-hidden="true" /> Refresh
            </Row>
          </TextBtn>
        }
      >
        Team Chat
      </SectionTitle>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          paddingRight: 4,
          marginBottom: 12,
          scrollbarWidth: "thin",
          scrollbarColor: `${C.line} transparent`,
        }}
      >
        {loading ? (
          <LoadingState label={t.chLoadingMessages} compact />
        ) : messages.length === 0 ? (
          <Text
            as="p"
            size="base"
            color={C.sub}
            style={{ margin: 0, textAlign: "center", padding: "20px 0" }}
          >
            {t.chNoMessages}
          </Text>
        ) : (
          messages.map((m) => {
            const mine = !!(m.user_id && user?.id && m.user_id === user.id);
            const isEditing = editingId === m.id;
            return (
              <Stack
                key={m.id}
                gap={0}
                style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%" }}
              >
                <Text
                  size="xs"
                  weight="bold"
                  color={C.sub}
                  style={{ marginBottom: 2, textAlign: mine ? "right" : "left" }}
                >
                  {m.user_name || "Teammate"}
                </Text>

                {isEditing ? (
                  <Stack gap={2}>
                    <Inp
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={handleEditKeyDown}
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
                        {t.chSave}
                      </TextBtn>
                    </Row>
                  </Stack>
                ) : (
                  <ChatBubble
                    mine={mine}
                    photo={m.photo}
                    photoAlt={t.chAttachment}
                    onPhotoClick={() => setLightboxPhoto(m.photo)}
                  >
                    {m.message && renderWithMentions(m.message, knownNames)}
                  </ChatBubble>
                )}

                {!isEditing && (
                  <Row
                    align="stretch"
                    justify={mine ? "flex-end" : "flex-start"}
                    style={{ marginTop: 2 }}
                  >
                    <Muted as="span" size="2xs">
                      {ft(m.created_at)}
                      {m.edited_at ? " · edited" : ""}
                    </Muted>
                    {mine && (
                      <>
                        <TextBtn onClick={() => startEdit(m)} size="2xs">
                          {t.chEdit}
                        </TextBtn>
                        <TextBtn onClick={() => deleteMessage(m)} color={C.rd} size="2xs">
                          {t.chDelete}
                        </TextBtn>
                      </>
                    )}
                  </Row>
                )}
              </Stack>
            );
          })
        )}
      </div>

      {error && (
        <Callout
          tone="danger"
          icon={AlertTriangle}
          pad="6px 10px"
          size="sm"
          weight="semibold"
          color={C.rd}
          style={{ marginBottom: 8 }}
        >
          {error}
        </Callout>
      )}

      {mentionCandidates.length > 0 && (
        <Card
          variant="flat"
          pad="none"
          style={{
            borderWidth: 1.5,
            borderRadius: "var(--radius-md)",
            marginBottom: 8,
            overflow: "hidden",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {mentionCandidates.map((u) => (
            <PickRow
              key={u.id}
              onClick={() => selectMention(u)}
              style={{ padding: "6px 10px", borderBottom: "none" }}
            >
              <Text size="sm" weight="semibold" color={C.navy}>
                @{u.full_name || u.name}
              </Text>
            </PickRow>
          ))}
        </Card>
      )}

      {pendingPhoto && (
        <PendingPhoto
          src={pendingPhoto}
          alt={t.chPendingAttachment}
          onRemove={() => setPendingPhoto(null)}
          style={{ marginBottom: 8 }}
        />
      )}

      <ChatComposer
        fileInputRef={fileInputRef}
        onPickFile={attachPhoto}
        attachTitle={t.chAttachPhoto}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t.chTypeMessage}
        onSend={send}
        sendDisabled={(!draft.trim() && !pendingPhoto) || sending}
        sendLabel={t.chSend}
      />

      {lightboxPhoto && (
        <Modal title={t.chAttachmentLabel} onClose={() => setLightboxPhoto(null)}>
          <img
            src={lightboxPhoto}
            alt={t.chFullSize}
            style={{ width: "100%", borderRadius: "var(--radius-md)" }}
          />
        </Modal>
      )}
    </Card>
  );
}
