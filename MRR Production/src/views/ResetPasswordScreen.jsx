// src/views/ResetPasswordScreen.jsx
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
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { Fld } from "../components/UIPrimitives";
import { SteadwerkLockup, BRAND } from "../components/SteadwerkMark";

export default function ResetPasswordScreen({ onDone }) {
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
    if (!pass || pass.length < 8) {
      return setErr("Choose a password of at least 8 characters.");
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
      setErr(error.message || "Could not update your password. The link may have expired — request a new one.");
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
    <div
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
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "rgba(255, 255, 255, 0.96)",
          backdropFilter: "blur(8px)",
          borderRadius: 20,
          padding: "48px 56px",
          width: "100%",
          maxWidth: 400,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          margin: "auto",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ marginBottom: 14 }}>
            <SteadwerkLockup size={64} />
          </div>
          <div style={{ fontSize: "var(--text-base)", color: C.sub, marginTop: 4 }}>
            {done ? "Password updated" : "Set a new password"}
          </div>
        </div>

        {done ? (
          <>
            <div style={{ background: "#E2EDE6", color: BRAND.pasture, padding: "10px 14px", borderRadius: "var(--radius-md)", fontSize: "var(--text-base)", marginBottom: 20, fontWeight: "var(--weight-semibold)" }}>
              Your password has been changed. Sign in with your new password to continue.
            </div>
            <button
              className="mrr-btn"
              onClick={onDone}
              style={{
                width: "100%",
                padding: "14px",
                background: C.gold,
                color: C.navy,
                border: "none",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-lg)",
                fontWeight: "var(--weight-extrabold)",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
            >
              Continue to sign in →
            </button>
          </>
        ) : (
          <>
            {err && (
              <div style={{ background: C.rB, color: C.rd, padding: "10px 14px", borderRadius: "var(--radius-md)", fontSize: "var(--text-base)", marginBottom: 16 }}>
                {err}
              </div>
            )}

            <Fld label="New password">
              <input
                className="mrr-input"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="At least 8 characters"
                style={inputStyle}
                disabled={submitting}
                autoFocus
              />
            </Fld>
            <Fld label="Confirm new password">
              <input
                className="mrr-input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !submitting && submit()}
                placeholder="Re-enter your new password"
                style={inputStyle}
                disabled={submitting}
              />
            </Fld>

            <button
              className="mrr-btn"
              onClick={submit}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "14px",
                background: submitting ? C.bd : C.gold,
                color: C.navy,
                border: "none",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-lg)",
                fontWeight: "var(--weight-extrabold)",
                cursor: submitting ? "not-allowed" : "pointer",
                marginTop: 8,
                opacity: submitting ? 0.7 : 1,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
            >
              {submitting ? "Saving…" : "Update password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
