// src/features/auth/DeleteAccountPanel.jsx
//
// "Delete my account", on the one screen every user can reach (Profile — the
// Settings screen is permission-gated, so a crew member would never see it).
//
// It sends a REQUEST, not an instant delete: accounts are created and owned by
// the company, and the company's admins remove them. The reasoning, and who is
// emailed, is in netlify/functions/request-account-deletion.js. Apple requires
// that the user can start deletion inside the app (App Review Guideline
// 5.1.1(v)); a request flow satisfies that for organization-managed accounts.
//
// Two steps on purpose: the first button only explains and asks, the second
// sends. Nothing is sent by a single stray tap.
import { useState } from "react";
import { UserX } from "lucide-react";
import { getAccessToken } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import { Fld, Inp, Btn, Row, Text, Card, Callout } from "@/shared/components/UIPrimitives";
import { translations } from "@/shared/utils/translations";

export default function DeleteAccountPanel({ lang = "en" }) {
  const t = translations[lang] || translations.en;
  // idle -> confirming -> sending -> sent. An error drops back to confirming
  // so the person can retry without retyping their reason.
  const [stage, setStage] = useState("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const send = async () => {
    setError("");
    setStage("sending");
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/request-account-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, reason }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || `Request failed (${res.status})`);
      setStage("sent");
    } catch (err) {
      setError(err.message);
      setStage("confirming");
    }
  };

  return (
    <Card variant="raised" pad="lg">
      <Row
        as="h2"
        gap="9px"
        style={{
          margin: "0 0 6px",
          fontSize: "var(--text-xl)",
          fontWeight: "var(--weight-black)",
          color: C.navy,
        }}
      >
        <UserX size={18} aria-hidden="true" /> {t.profDeleteTitle}
      </Row>
      <Text as="p" size="base" color={C.sub} style={{ margin: "0 0 16px", lineHeight: 1.6 }}>
        {t.profDeleteIntro}
      </Text>

      {stage === "sent" ? (
        <Callout tone="success" size="base" weight="semibold" color={C.gr} role="status">
          {t.profDeleteSent}
        </Callout>
      ) : stage === "idle" ? (
        <Btn v="outline" tone={C.rust} block onClick={() => setStage("confirming")}>
          {t.profDeleteRequest}
        </Btn>
      ) : (
        <>
          <Fld label={t.profDeleteReason}>
            <Inp
              type="text"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              disabled={stage === "sending"}
            />
          </Fld>
          <Text as="p" size="base" weight="semibold" color={C.navy} style={{ margin: "0 0 12px" }}>
            {t.profDeleteConfirm}
          </Text>
          {error && (
            <Callout
              tone="danger"
              size="base"
              weight="semibold"
              color={C.rd}
              style={{ marginBottom: 12 }}
            >
              {error}
            </Callout>
          )}
          <Row gap={4}>
            <Btn
              v="ghost"
              onClick={() => {
                setStage("idle");
                setError("");
              }}
              disabled={stage === "sending"}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {t.profDeleteCancel}
            </Btn>
            <Btn
              v="danger"
              onClick={send}
              disabled={stage === "sending"}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {stage === "sending" ? t.profDeleteSending : t.profDeleteYes}
            </Btn>
          </Row>
        </>
      )}
    </Card>
  );
}
