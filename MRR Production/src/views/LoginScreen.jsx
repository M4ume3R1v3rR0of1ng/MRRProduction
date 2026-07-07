// src/views/LoginScreen.jsx
import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { Fld } from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { translations } from "../utils/translations";
import backgroundImage from "../assets/image_79f79a.jpg";
import mrrpic from "../assets/mrrpic.jpg";

const COMPANY_DOMAIN = "@maumeeriverroofing.com";

export default function LoginScreen({ onLogin, activeLogo, lang = "en", setLang }) {
  const t = translations[lang] || translations.en;
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // ── 🟢 EFFECT: AUTO-LOAD DISPATCH SAVED CREDENTIALS ON MOUNT ──
  useEffect(() => {
    const savedEmail = localStorage.getItem("mrr_remember_email") || "";

    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  const tryLogin = async () => {
    setErr("");
    setSuccessMsg("");
    setSubmitting(true);

    let authData = null;
    let authError = null;

    try {
      const result = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: pass,
      });

      authData = result.data;
      authError = result.error;
    } catch (e) {
      return setErr(t.errNetworkAuth);
    } finally {
      if (authError || !authData?.user) {
        setSubmitting(false);
      }
    }

    if (authError) {
      setErr(authError.message);
      return;
    }

    if (authData?.user) {
      try {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("full_name, role, active")
          .eq("id", authData.user.id)
          .single();

        if (profileError) {
          setErr(t.errProfileAccess);
          setSubmitting(false);
          return;
        }
        if (!profileData.active) {
          setErr(t.errAccountDeactivated);
          setSubmitting(false);
          return;
        }

        // ── 🟢 SAVING STRATEGY EVALUATION ──
        // Only the email is remembered — Supabase's own session persistence handles
        // staying logged in, so the raw password never needs to touch localStorage.
        if (rememberMe) {
          localStorage.setItem("mrr_remember_email", email.trim().toLowerCase());
        } else {
          localStorage.removeItem("mrr_remember_email");
        }
        localStorage.removeItem("mrr_remember_pass");

        await logAction(
          authData.user.id,
          authData.user.email,
          "LOGIN",
          "Authenticated credentials successfully via secure gateway lock.",
          {},
          "login",
        );

        onLogin({
          id: authData.user.id,
          email: authData.user.email,
          name: profileData.full_name,
          role: profileData.role,
          active: profileData.active,
        });
      } catch (profileCatchError) {
        setErr(t.errProfileResolution);
        setSubmitting(false);
      }
    }
  };

  const trySignup = async () => {
    setErr("");
    setSuccessMsg("");
    const trimmedEmail = email.trim().toLowerCase();

    if (!name.trim()) return setErr(t.errEnterFullName);
    if (!trimmedEmail.endsWith(COMPANY_DOMAIN))
      return setErr(t.errUseCompanyEmail.replace("{domain}", COMPANY_DOMAIN));
    if (!pass) return setErr(t.errChoosePassword);
    if (pass.length < 8)
      return setErr(t.errPasswordLength);
    if (pass !== confirm) return setErr(t.errPasswordMismatch);

    setSubmitting(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password: pass,
        options: { data: { full_name: name.trim(), role: "employee" } },
      });

      if (authError) {
        setErr(authError.message);
        return;
      }

      if (authData?.user?.identities?.length === 0) {
        setErr(t.errAccountExists);
        return;
      }

      if (authData?.user) {
        await logAction(
          authData?.user?.id,
          authData?.user?.email,
          "SIGNUP",
          `Initiated employee profile registration request for ${trimmedEmail}`,
          {},
          "signup",
        );

        setSuccessMsg(t.signupSuccess);
        setName("");
        setPass("");
        setConfirm("");
        setMode("login");
      }
    } catch (e) {
      setErr(t.errRegistrationAborted);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundImage: `linear-gradient(rgba(15, 16, 20, 0.6), rgba(15, 23, 42, 0.75)), url(${backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center 90%",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed",
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
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-7)",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                background: activeLogo ? "transparent" : C.gold,
                borderRadius: "var(--radius-2xl)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {activeLogo ? (
                <img
                  src={activeLogo}
                  alt="Logo"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : (
                <img
                  src={mrrpic}
                  alt="Maumee River Roofing Mascot"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              )}
            </div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: "var(--text-2xl)", fontWeight: "var(--weight-black)", color: C.navy, letterSpacing: "0.5px" }}>
                MAUMEE RIVER
              </div>
              <div
                style={{
                  fontSize: "var(--text-md)",
                  fontWeight: "var(--weight-bold)",
                  color: C.blue,
                  letterSpacing: "1.5px",
                }}
              >
                ROOFING
              </div>
            </div>
          </div>
          <div style={{ fontSize: "var(--text-base)", color: C.sub, marginTop: 4 }}>
            {mode === "login"
              ? t.loginSubtitle
              : `${t.loginRegisterWith} ${COMPANY_DOMAIN}`}
          </div>
        </div>

        {setLang && (
          <div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 20 }}>
            {[
              { id: "en", label: "EN" },
              { id: "es", label: "ES" },
            ].map((langObj) => {
              const active = lang === langObj.id;
              return (
                <button
                  key={langObj.id}
                  onClick={() => setLang(langObj.id)}
                  style={{
                    background: active ? C.gold : "transparent",
                    color: active ? C.navy : C.sub,
                    border: `1px solid ${active ? C.gold : C.bd}`,
                    borderRadius: "var(--radius-xl)",
                    padding: "3px 10px",
                    fontSize: "var(--text-2xs)",
                    fontWeight: "var(--weight-black)",
                    cursor: "pointer",
                  }}
                >
                  {langObj.label}
                </button>
              );
            })}
          </div>
        )}

        {successMsg && (
          <div
            style={{
              background: "#ecfdf5",
              border: "1.5px solid #10b981",
              color: "#065f46",
              padding: "16px",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--text-md)",
              marginBottom: 20,
              fontWeight: "var(--weight-semibold)",
              lineHeight: "1.4",
            }}
          >
            ✅ {successMsg}
          </div>
        )}

        {mode === "signup" && (
          <Fld label={t.fullName}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.fullNamePlaceholder}
              style={{
                width: "100%",
                padding: "12px 14px",
                border: `1.5px solid ${C.bd}`,
                borderRadius: "var(--radius-md)",
                fontSize: 15,
                boxSizing: "border-box",
              }}
              disabled={submitting}
            />
          </Fld>
        )}
        <Fld label={t.email}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@maumeeriverroofing.com"
            style={{
              width: "100%",
              padding: "12px 14px",
              border: `1.5px solid ${C.bd}`,
              borderRadius: "var(--radius-md)",
              fontSize: 15,
              boxSizing: "border-box",
            }}
            disabled={submitting}
          />
        </Fld>
        <Fld label={t.password}>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              !submitting &&
              (mode === "login" ? tryLogin() : trySignup())
            }
            placeholder={t.password}
            style={{
              width: "100%",
              padding: "12px 14px",
              border: `1.5px solid ${C.bd}`,
              borderRadius: "var(--radius-md)",
              fontSize: 15,
              boxSizing: "border-box",
            }}
            disabled={submitting}
          />
        </Fld>
        {mode === "signup" && (
          <Fld label={t.confirmPassword}>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !submitting && trySignup()}
              placeholder={t.confirmPasswordPlaceholder}
              style={{
                width: "100%",
                padding: "12px 14px",
                border: `1.5px solid ${C.bd}`,
                borderRadius: "var(--radius-md)",
                fontSize: 15,
                boxSizing: "border-box",
              }}
              disabled={submitting}
            />
          </Fld>
        )}

        {/* ── 🟢 NEW: REMEMBER ME CHECKBOX SWITCH TOGGLE TIER ── */}
        {mode === "login" && (
          <div style={{ display: "flex", alignItems: "center", marginBottom: 16, marginTop: -4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", fontSize: "var(--text-base)", color: C.navy, fontWeight: "var(--weight-bold)", cursor: "pointer" }}>
              <input 
                type="checkbox" 
                checked={rememberMe} 
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ transform: "scale(1.15)", cursor: "pointer", accentColor: C.gold }}
                disabled={submitting}
              />
              {t.rememberMe}
            </label>
          </div>
        )}

        {err && (
          <div
            style={{
              background: C.rB,
              color: C.rd,
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--text-base)",
              marginBottom: 16,
            }}
          >
            {err}
          </div>
        )}

        <button
          onClick={() => (mode === "login" ? tryLogin() : trySignup())}
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
            marginBottom: 16,
            opacity: submitting ? 0.7 : 1,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
          disabled={submitting}
        >
          {submitting
            ? t.processingQuery
            : mode === "login"
              ? t.signIn
              : t.createAccountBtn}
        </button>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "var(--text-base)",
            color: C.sub,
            marginTop: 20,
          }}
        >
          <button
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setErr("");
              setSuccessMsg("");
            }}
            style={{
              background: "none",
              border: "none",
              color: C.blue,
              cursor: "pointer",
              padding: 0,
              fontWeight: "var(--weight-bold)",
            }}
            disabled={submitting}
          >
            {mode === "login" ? t.createAccountLink : t.backToSignIn}
          </button>
          <span style={{ opacity: 0.7 }}>{COMPANY_DOMAIN}</span>
        </div>
      </div>
    </div>
  );
}