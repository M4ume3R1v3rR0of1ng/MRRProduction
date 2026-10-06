// src/features/auth/ResetPasswordScreen.jsx
//
// Shown when someone opens a password-reset link from their email.
//
// The "Forgot password?" flow (LoginScreen) sends a Supabase recovery link that
// redirects back to the app root with a recovery token in the URL. The Supabase
// client detects that token and quietly establishes a session — which, without
// this screen, dropped the person straight into the portal with no way to set a
// new password. The link "worked" (they were signed in) but the password was
// never changed, so the next visit still rejected the old one.
//
// This screen breaks that cycle: while a recovery session is active we collect a
// new password, write it with supabase.auth.updateUser(), then sign out and send
// them back to the login form to sign in fresh with it.
import { useState } from "react";
import { supabase } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import { validatePassword, PASSWORD_HINT } from "./passwordPolicy";
import { translations } from "@/shared/utils/translations";
import { Fld, Row, Text, Callout, Stack, Btn } from "@/shared/components/UIPrimitives";
import { SteadwerkLockup, BRAND } from "@/shared/components/SteadwerkMark";

export default function ResetPasswordScreen({ onDone, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const inputStyle = {
    width: "100%",
    padding: "12px 14px",
    border: `1.5px solid ${C.bd}`,
    borderRadius: "var(--radius-md)",
    fontSize: 15,
    boxSizing: "border-box",
  };

  const submit = async () => {
    setErr("");
    const problem = validatePassword(pass);
    if (problem) {
      return setErr(problem);
    }
    if (pass !== confirm) {
      return setErr("The two passwords don't match.");
    }
    setSubmitting(true);
    // The recovery session established from the link authorizes this one write:
    // the account's own password. On success we sign out so the new password has
    // to be used from a clean login — no half-authenticated session left behind.
    const { error } = await supabase.auth.updateUser({ password: pass });
    if (error) {
      setErr(
        error.message ||
          "Could not update your password. The link may have expired — request a new one.",
      );
      setSubmitting(false);
      return;
    }
    try {
      await supabase.auth.signOut();
    } catch {
      /* the password is already changed; a failed sign-out shouldn't block success */
    }
    setSubmitting(false);
    setDone(true);
  };

  return (
    <Row
      gap={0}
      justify="center"
      style={{
        minHeight: "100vh",
        background: `
          repeating-linear-gradient(
            115deg,
            transparent 0px,
            transparent 46px,
            rgba(201, 123, 45, 0.05) 46px,
            rgba(201, 123, 45, 0.05) 48px
          ),
          radial-gradient(ellipse at 50% 0%, #2F353C 0%, ${BRAND.barnwood} 55%, #171B1F 100%)
        `,
        padding: 24,
      }}
    >
      <div
        style={{
          background: `color-mix(in srgb, ${C.surface} 96%, transparent)`,
          backdropFilter: "blur(8px)",
          borderRadius: 20,
          padding: "48px 56px",
          width: "100%",
          maxWidth: 400,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          margin: "auto",
        }}
      >
        <Stack gap={6} align="center" style={{ textAlign: "center", marginBottom: 32 }}>
          <SteadwerkLockup size={64} />
          <Text size="base" color={C.sub}>
            {done ? "Password updated" : "Set a new password"}
          </Text>
        </Stack>

        {done ? (
          <>
            <Callout
              tone="success"
              size="base"
              weight="semibold"
              color={BRAND.pasture}
              style={{ marginBottom: 20 }}
            >
              {t.rpChanged}
            </Callout>
            <Btn v="gold" sz="xl" block onClick={onDone}>
              {t.rpContinueSignIn}
            </Btn>
          </>
        ) : (
          <>
            {err && (
              <Callout tone="danger" size="base" color={C.rd} style={{ marginBottom: 16 }}>
                {err}
              </Callout>
            )}

            <Fld label={t.rpNewPassword} hint={PASSWORD_HINT}>
              <input
                className="mrr-input"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder={t.rpNewPlaceholder}
                style={inputStyle}
                disabled={submitting}
                autoFocus
              />
            </Fld>
            <Fld label={t.rpConfirmPassword}>
              <input
                className="mrr-input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !submitting && submit()}
                placeholder={t.rpConfirmPlaceholder}
                style={inputStyle}
                disabled={submitting}
              />
            </Fld>

            <Btn
              v="gold"
              sz="xl"
              block
              onClick={submit}
              disabled={submitting}
              style={{ marginTop: 8 }}
            >
              {submitting ? "Saving…" : "Update password"}
            </Btn>
          </>
        )}
      </div>
    </Row>
  );
}
