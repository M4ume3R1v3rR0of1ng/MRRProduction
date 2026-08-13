// src/views/LoginScreen.jsx
//
// Phase 3 — multi-tenant login.
//
// Two things changed from the single-company version:
//
//   1. NO SELF-SIGNUP. The "create account" flow and the @maumeeriverroofing.com
//      domain gate are both gone. Access is granted by a company admin adding you in
//      User Management, which creates the membership row. Without a membership,
//      active_company_id() returns NULL and every RLS policy denies — so a
//      self-registered user would land in an empty portal anyway. Better to not let
//      them register at all than to let them in and show them nothing.
//
//   2. A COMPANY PICKER, but only after authentication and only when it's needed.
//      There is deliberately no public list of companies on this page: it renders
//      before anyone logs in, so any list on it would publish the customer roster to
//      the world. Your email already determines your company via memberships.
import { useState, useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { Fld } from "../components/UIPrimitives";
import { logAction } from "../utils/logger";
import { translations } from "../utils/translations";
import { SteadwerkLockup, BRAND } from "../components/SteadwerkMark";

// Display-only prices for the plan toggle. These must match the amounts on the
// Stripe Prices that create-checkout bills (STRIPE_BASE_PRICE_ID / STRIPE_ANNUAL_PRICE_ID);
// the actual charge always comes from Stripe, these just render the choice.
const MONTHLY_PRICE = 99;
const ANNUAL_PRICE = 990; // "2 months free" vs 12 × monthly
const ANNUAL_SAVINGS_PCT = Math.round((1 - ANNUAL_PRICE / (MONTHLY_PRICE * 12)) * 100);

// Google sign-in needs an OAuth client created in Google Cloud Console and pasted
// into Supabase → Authentication → Providers. Until that exists the provider is
// disabled and Supabase answers "Unsupported provider", so the button would be a
// dead control on the login screen. It stays hidden until this is set to "true"
// in the Netlify environment — a config change, not a code change.
//
// The plumbing behind it (session pickup on return, the company fallback) is NOT
// gated: it is what makes any redirect-based sign-in land correctly, and it is
// harmless when no provider is enabled.
const GOOGLE_AUTH_ENABLED = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";

export default function LoginScreen({ onLogin, activeLogo, lang = "en", setLang, initialMode = "login", onBack, onShowTerms }) {
  const t = translations[lang] || translations.en;
  // "login" = existing user signing in · "signup" = public "start a company" flow.
  // initialMode lets the landing page open us straight on the right tab.
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Self-serve signup fields.
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  // Monthly (default) vs the discounted annual prepay — passed to create-checkout,
  // which maps it to the matching Stripe Price.
  const [billingInterval, setBillingInterval] = useState("monthly");

  // Set only when an authenticated user belongs to more than one company.
  const [choices, setChoices] = useState(null); // [{ company_id, role, companies: {name, slug} }]
  const [pendingUser, setPendingUser] = useState(null);
  // Set once an existing session has been picked up, so the effect below can't
  // resolve the same session twice and log two LOGIN entries.
  const resolvedSessionRef = useRef(false);
  // Non-null while a verified TOTP factor still has to be satisfied:
  // { user, factorId, remember }. The session exists but sits at aal1.
  const [mfaStep, setMfaStep] = useState(null);
  const [mfaCode, setMfaCode] = useState("");

  useEffect(() => {
    const savedEmail = localStorage.getItem("mrr_remember_email") || "";
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
    // Returning from Stripe Checkout. They're not signed in yet (the account was made
    // server-side during signup), so land them on the login form with a nudge.
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (checkout === "success") {
      setNotice("Payment received — your company is live. Sign in to enter your portal.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (checkout === "cancel") {
      setErr("Checkout was cancelled. Your company isn't active yet — you can try again anytime.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // The OAuth return. Google sends the browser back with a session already
  // established, so there is no form submit to hang the post-login work off.
  // useAppData restores the session by itself when profiles.active_company_id is
  // set; this covers when it isn't — a first-ever Google sign-in, or someone in
  // more than one company who hasn't picked yet — which would otherwise leave
  // them staring at a login form while holding a perfectly valid session.
  useEffect(() => {
    if (resolvedSessionRef.current) return;
    let cancelled = false;
    (async () => {
      const { data: { session } = {} } = await supabase.auth.getSession();
      if (cancelled || !session?.user || resolvedSessionRef.current) return;
      // Guard against StrictMode's double-mount replaying the login audit entry.
      resolvedSessionRef.current = true;
      setSubmitting(true);
      // Same MFA gate as the password path — a restored session sitting at aal1
      // must not skip the factor just because it arrived by redirect.
      await gateOnMfa(session.user);
    })();
    return () => { cancelled = true; };
  }, []);

  // Self-serve "start a company": provision + redirect to Stripe Checkout.
  const trySignup = async () => {
    setErr("");
    setNotice("");
    if (!companyName.trim() || !fullName.trim() || !email.trim()) {
      return setErr("Company name, your name, and email are all required.");
    }
    if (!pass || pass.length < 8) {
      return setErr(t.lgChoosePassword8);
    }
    setSubmitting(true);
    try {
      const res = await fetch("/.netlify/functions/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          name: fullName.trim(),
          email: email.trim().toLowerCase(),
          password: pass,
          billingInterval,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setErr(data.error || "Could not start checkout. Please try again.");
        setSubmitting(false);
        return;
      }
      // Hand off to Stripe's hosted checkout.
      window.location.href = data.url;
    } catch {
      setErr("Network error starting checkout.");
      setSubmitting(false);
    }
  };

  // ── Google sign-in ─────────────────────────────────────────────────────────
  // The redirect flow, deliberately NOT the Google Identity Services widget. The
  // production CSP in public/_headers is `script-src 'self'` with no frame-src,
  // which blocks that SDK and One Tap outright; a top-level redirect needs no CSP
  // change at all.
  //
  // Supabase attaches this identity to the EXISTING account when Google returns a
  // verified email matching one, so auth.users.id is preserved. That matters more
  // here than anywhere else in the app: profiles.is_platform_admin and
  // memberships.user_id both hang off that id, and a new id would mean a fresh
  // profile with no membership and no owner access. Password sign-in stays enabled
  // as the fallback and is not replaced by this.
  const signInWithGoogle = async () => {
    setErr("");
    setNotice("");
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    // On success the browser is already navigating to Google, so `submitting` is
    // left on deliberately — the form stays disabled through the handoff.
    if (error) {
      setErr(error.message);
      setSubmitting(false);
    }
  };

  // Hand control to the app for one specific company.
  const enterCompany = async (user, membership) => {
    // set_active_company() re-verifies membership server-side. The client asking for
    // a company it isn't in gets an exception, not access.
    const { error } = await supabase.rpc("set_active_company", { target: membership.company_id });
    if (error) {
      setErr(error.message);
      setSubmitting(false);
      return;
    }

    await logAction(user.id, user.email, "LOGIN", `Signed in to ${membership.companies?.name || "company"}.`, {}, "login");

    onLogin({
      id: user.id,
      email: user.email,
      name: user.full_name,
      // Role is per-company now — it comes from the membership, not from profiles.
      role: membership.role,
      active: true,
      companyId: membership.company_id,
      companyName: membership.companies?.name || null,
      isPlatformAdmin: user.is_platform_admin === true,
    });
  };

  const forgotPassword = async () => {
    setErr("");
    setNotice("");
    const target = email.trim().toLowerCase();
    if (!target) {
      setErr(t.lgEnterEmailFirst);
      return;
    }
    setSubmitting(true);
    // The link lands back in the app (redirectTo must be allow-listed in Supabase →
    // Auth → URL Configuration). We always show the same confirmation whether or not
    // the address is registered — never reveal which emails have accounts.
    try {
      await supabase.auth.resetPasswordForEmail(target, { redirectTo: window.location.origin });
    } catch {
      /* swallowed on purpose — see note above */
    } finally {
      setSubmitting(false);
      setNotice(`If an account exists for ${target}, a password-reset link is on its way. Check your inbox (and spam).`);
    }
  };

  const tryLogin = async () => {
    setErr("");
    setSubmitting(true);

    let authData;
    try {
      const result = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: pass,
      });
      if (result.error) {
        setErr(result.error.message);
        setSubmitting(false);
        return;
      }
      authData = result.data;
    } catch {
      setErr(t.errNetworkAuth);
      setSubmitting(false);
      return;
    }

    const user = authData?.user;
    if (!user) {
      setErr(t.errNetworkAuth);
      setSubmitting(false);
      return;
    }

    await gateOnMfa(user, { remember: true });
  };

  // The second factor, between "password accepted" and "you're in".
  //
  // signInWithPassword returns a real session at aal1 even when the account has a
  // verified TOTP factor — Supabase does not withhold it. So this is not merely a
  // prompt: the matching database gate in supabase/29_mfa_enforcement.sql is what
  // makes aal1 useless for a platform admin. This step is how someone reaches aal2
  // rather than the thing that stops them without it.
  const gateOnMfa = async (user, opts = {}) => {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    // nextLevel climbs to aal2 only when a verified factor exists. Equal levels
    // mean there is nothing to step up to, so never show the prompt.
    if (aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2") {
      const { data: list } = await supabase.auth.mfa.listFactors();
      const factor = (list?.totp || []).find((f) => f.status === "verified");
      if (factor) {
        setMfaStep({ user, factorId: factor.id, remember: !!opts.remember });
        setMfaCode("");
        setSubmitting(false);
        return;
      }
    }
    await resolveAuthedUser(user, opts);
  };

  const submitMfaCode = async (e) => {
    e.preventDefault();
    if (!mfaStep || mfaCode.trim().length < 6) return;
    setErr("");
    setSubmitting(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: mfaStep.factorId,
      code: mfaCode.trim(),
    });
    if (error) {
      setErr(error.message);
      setMfaCode("");
      setSubmitting(false);
      return;
    }
    const { user, remember } = mfaStep;
    setMfaStep(null);
    await resolveAuthedUser(user, { remember });
  };

  // Backing out of the code prompt has to end the session, not just hide the form.
  // The aal1 session is already live at this point; leaving it in place would mean
  // "Cancel" quietly logged you in one rung below where you belong.
  const cancelMfa = async () => {
    setMfaStep(null);
    setMfaCode("");
    setErr("");
    resolvedSessionRef.current = true;
    await supabase.auth.signOut();
    setSubmitting(false);
  };

  // Everything that happens AFTER the identity is proven, regardless of how it was
  // proven. Password sign-in calls this with the user it just got back; the OAuth
  // return calls it with the user off the restored session. Keeping one copy means
  // a Google sign-in can never drift from the password path on the checks that
  // matter — deactivated accounts, missing memberships, which company you land in.
  const resolveAuthedUser = async (user, { remember = false } = {}) => {
    try {
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, active, is_platform_admin")
        .eq("id", user.id)
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

      // Which companies is this person actually in? This is the whole authorization
      // story now — no membership, no access.
      const { data: memberships, error: memberError } = await supabase
        .from("memberships")
        .select("company_id, role, companies ( name, slug )")
        .eq("user_id", user.id)
        .eq("active", true);

      if (memberError) {
        setErr(memberError.message);
        setSubmitting(false);
        return;
      }

      if (!memberships || memberships.length === 0) {
        // Signed in successfully, but attached to nothing. Sign them straight back
        // out — leaving a valid session lying around for an account with no access
        // is pointless and confusing.
        await supabase.auth.signOut();
        // Same dead end, two very different causes. Reached through Google it
        // almost always means the identity was NOT linked to the existing account
        // and a brand-new auth user was created instead, which is a Supabase
        // provider-config problem, not a missing invite. Saying "ask your
        // administrator" there sends the one person who could fix it looking in
        // the wrong place.
        const viaOAuth = (user.app_metadata?.provider || "email") !== "email";
        setErr(
          viaOAuth
            ? "That Google account isn't linked to a Steadwerk login. Sign in with your email and password instead."
            : "Your account isn't attached to a company yet. Ask your administrator to add you.",
        );
        setSubmitting(false);
        return;
      }

      // Only the password form owns the "remember my email" box. An OAuth return
      // must not clear a saved address just because that checkbox isn't on screen.
      if (remember) {
        if (rememberMe) {
          localStorage.setItem("mrr_remember_email", email.trim().toLowerCase());
        } else {
          localStorage.removeItem("mrr_remember_email");
        }
      }

      const withName = { ...user, full_name: profileData.full_name, is_platform_admin: profileData.is_platform_admin };

      if (memberships.length === 1) {
        await enterCompany(withName, memberships[0]);
        return;
      }

      // More than one — let them choose. Shown only to the handful of people this
      // actually applies to (you, Sam), never to the internet.
      setPendingUser(withName);
      setChoices(memberships);
      setSubmitting(false);
    } catch {
      setErr(t.errProfileResolution);
      setSubmitting(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "12px 14px",
    border: `1.5px solid ${C.bd}`,
    borderRadius: "var(--radius-md)",
    fontSize: 15,
    boxSizing: "border-box",
  };

  return (
    // Barnwood ground with a faint truss lattice — the timber frame, repeated.
    //
    // The old background was a photo of a Maumee River Roofing property with THEIR
    // mascot and logo baked into the image. On a platform login page that every
    // company reaches, that greeted his brother's crew with your branding. The
    // platform ground has to be neutral; a tenant's identity starts after sign-in.
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
          background: "color-mix(in srgb, var(--c-surface) 96%, transparent)",
          backdropFilter: "blur(8px)",
          borderRadius: 20,
          padding: "48px 56px",
          width: "100%",
          maxWidth: 400,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          margin: "auto",
        }}
      >
        {/* Back to the public landing page. Hidden during the company picker, where
            "back" would be ambiguous. */}
        {onBack && !choices && (
          <button
            type="button"
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              color: C.sub,
              fontWeight: 600,
              cursor: "pointer",
              padding: 0,
              marginBottom: 20,
              fontSize: "var(--text-base)",
            }}
          >
            ← Back to home
          </button>
        )}

        {/* PLATFORM branding, not tenant branding. The login page is rendered before
            anyone authenticates, so it cannot know whose portal you're headed for —
            and it must not, since a company list here would be public. Steadwerk owns
            this screen; the company's own logo appears once you're inside. */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ marginBottom: 14 }}>
            <SteadwerkLockup size={64} />
          </div>
          <div style={{ fontSize: "var(--text-base)", color: C.sub, marginTop: 4 }}>
            {choices ? t.lgChooseCompany : mode === "signup" ? t.lgStartCompany : t.loginSubtitle}
          </div>
        </div>

        {notice && (
          <div style={{ background: "var(--c-pasture-wash)", color: BRAND.pasture, padding: "10px 14px", borderRadius: "var(--radius-md)", fontSize: "var(--text-base)", marginBottom: 16, fontWeight: "var(--weight-semibold)" }}>
            {notice}
          </div>
        )}

        {setLang && !choices && (
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

        {/* ── Second factor ──
            Comes before the company picker: which company you enter is a question
            for someone whose identity is already fully established. */}
        {mfaStep ? (
          <form onSubmit={submitMfaCode}>
            <p style={{ margin: "0 0 16px", color: C.navy, fontSize: "var(--text-base)", lineHeight: 1.6, textAlign: "center" }}>
              {t.mfaChallengePrompt}
            </p>
            <Fld label={t.mfaCodeLabel}>
              <input
                className="mrr-input"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                disabled={submitting}
                style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 22, letterSpacing: 6, textAlign: "center" }}
              />
            </Fld>
            <button
              className="mrr-btn"
              type="submit"
              disabled={submitting || mfaCode.length < 6}
              style={{
                width: "100%",
                padding: "14px",
                background: submitting || mfaCode.length < 6 ? C.bd : C.gold,
                color: C.navy,
                border: "none",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-lg)",
                fontWeight: "var(--weight-extrabold)",
                cursor: submitting || mfaCode.length < 6 ? "not-allowed" : "pointer",
                marginBottom: 12,
              }}
            >
              {submitting ? t.mfaVerifying : t.mfaVerify}
            </button>
            <button
              type="button"
              onClick={cancelMfa}
              style={{ width: "100%", background: "none", border: "none", color: C.sub, fontWeight: 700, cursor: "pointer", padding: 6, fontSize: "var(--text-2xs)" }}
            >
              {t.cancel}
            </button>
          </form>
        ) : choices ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {choices.map((m) => (
              <button
                key={m.company_id}
                className="mrr-btn"
                onClick={() => {
                  setSubmitting(true);
                  enterCompany(pendingUser, m);
                }}
                disabled={submitting}
                style={{
                  width: "100%",
                  padding: "16px",
                  background: "var(--c-surface)",
                  color: C.navy,
                  border: `1.5px solid ${C.bd}`,
                  borderRadius: "var(--radius-md)",
                  fontSize: "var(--text-lg)",
                  fontWeight: "var(--weight-bold)",
                  cursor: submitting ? "not-allowed" : "pointer",
                  textAlign: "left",
                }}
              >
                {m.companies?.name || "Company"}
                <div style={{ fontSize: "var(--text-2xs)", color: C.sub, fontWeight: "var(--weight-semibold)", marginTop: 2 }}>
                  {m.role}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <>
            {/* Signup-only: the company being created + the person creating it. */}
            {mode === "signup" && (
              <>
                <Fld label={t.lgCompanyName}>
                  <input
                    className="mrr-input"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder={t.lgCompanyPlaceholder}
                    style={inputStyle}
                    disabled={submitting}
                  />
                </Fld>
                <Fld label={t.lgYourName}>
                  <input
                    className="mrr-input"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t.lgYourNamePlaceholder}
                    style={inputStyle}
                    disabled={submitting}
                  />
                </Fld>
              </>
            )}

            <Fld label={t.email}>
              <input
                className="mrr-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.lgEmailPlaceholder}
                style={inputStyle}
                disabled={submitting}
              />
            </Fld>
            <Fld label={t.password}>
              <input
                className="mrr-input"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !submitting && (mode === "signup" ? trySignup() : tryLogin())}
                placeholder={mode === "signup" ? t.lgPasswordPlaceholder : t.password}
                style={inputStyle}
                disabled={submitting}
              />
            </Fld>

            {mode === "login" && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, marginTop: -4 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    fontSize: "var(--text-base)",
                    color: C.navy,
                    fontWeight: "var(--weight-bold)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    style={{ transform: "scale(1.15)", cursor: "pointer", accentColor: C.gold }}
                    disabled={submitting}
                  />
                  {t.rememberMe}
                </label>
                <button
                  type="button"
                  onClick={forgotPassword}
                  disabled={submitting}
                  style={{ background: "none", border: "none", color: BRAND.amberDeep, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", padding: 0, fontSize: "var(--text-base)" }}
                >
                  {t.lgForgotPassword}
                </button>
              </div>
            )}

            {mode === "signup" && (
              <Fld label={t.lgBilling}>
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                    { id: "monthly", title: `$${MONTHLY_PRICE}/mo`, note: "Billed monthly" },
                    { id: "annual", title: `$${ANNUAL_PRICE}/yr`, note: `Save ${ANNUAL_SAVINGS_PCT}%` },
                  ].map((opt) => {
                    const active = billingInterval === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setBillingInterval(opt.id)}
                        disabled={submitting}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: "var(--radius-md)",
                          border: `2px solid ${active ? C.gold : C.bd}`,
                          background: active ? "color-mix(in srgb, var(--c-amber) 10%, transparent)" : "var(--c-surface)",
                          cursor: submitting ? "not-allowed" : "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ fontWeight: "var(--weight-extrabold)", color: C.navy, fontSize: 15 }}>{opt.title}</div>
                        <div style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", color: opt.id === "annual" ? BRAND.pasture : C.sub }}>{opt.note}</div>
                      </button>
                    );
                  })}
                </div>
              </Fld>
            )}

            <button
              className="mrr-btn"
              onClick={mode === "signup" ? trySignup : tryLogin}
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
                marginTop: mode === "signup" ? 8 : 0,
                marginBottom: 16,
                opacity: submitting ? 0.7 : 1,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
              disabled={submitting}
            >
              {submitting
                ? (mode === "signup" ? t.lgStartingCheckout : t.processingQuery)
                : (mode === "signup" ? t.lgContinuePayment : t.signIn)}
            </button>

            {/* Google sign-in. Offered only on the sign-in tab — the signup tab has to
                collect a company name and a card, which an OAuth redirect skips past.
                The mark is an inline SVG on purpose: img-src in the production CSP
                does not allow Google's CDN, so a hosted logo would render broken. */}
            {mode === "login" && GOOGLE_AUTH_ENABLED && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 16px" }}>
                  <span style={{ flex: 1, height: 1, background: C.bd }} />
                  <span style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", color: C.sub, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {t.lgOr}
                  </span>
                  <span style={{ flex: 1, height: 1, background: C.bd }} />
                </div>

                <button
                  className="mrr-btn"
                  type="button"
                  onClick={signInWithGoogle}
                  disabled={submitting}
                  style={{
                    width: "100%",
                    padding: "13px",
                    background: "var(--c-surface)",
                    color: C.navy,
                    border: `1.5px solid ${C.bd}`,
                    borderRadius: "var(--radius-md)",
                    fontSize: "var(--text-base)",
                    fontWeight: "var(--weight-bold)",
                    cursor: submitting ? "not-allowed" : "pointer",
                    opacity: submitting ? 0.7 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
                    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                    <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
                    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
                  </svg>
                  {t.lgGoogle}
                </button>
              </>
            )}

            {mode === "login" && (
              <p style={{ fontSize: "var(--text-2xs)", color: C.sub, textAlign: "center", lineHeight: 1.6, margin: "0 0 16px" }}>
                By logging in, you agree to the{" "}
                <button
                  type="button"
                  onClick={onShowTerms}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: BRAND.amberDeep,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "inherit",
                    fontFamily: "inherit",
                    textDecoration: "underline",
                    textUnderlineOffset: 2,
                  }}
                >
                  {t.lgTerms}
                </button>.
              </p>
            )}

            {mode === "login" ? (
              <div style={{ fontSize: "var(--text-2xs)", color: C.sub, textAlign: "center", lineHeight: 1.6 }}>
                {t.lgNeedAccess}
                <br />
                <button
                  onClick={() => { setMode("signup"); setErr(""); setNotice(""); }}
                  style={{ background: "none", border: "none", color: BRAND.amberDeep, fontWeight: 800, cursor: "pointer", padding: "6px 0 0", fontSize: "var(--text-base)" }}
                >
                  {t.lgStartOwn}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: "var(--text-2xs)", color: C.sub, textAlign: "center", lineHeight: 1.6 }}>
                You'll enter payment details on the next screen. Your portal goes live the moment payment clears.
                <br />
                <button
                  onClick={() => { setMode("login"); setErr(""); setNotice(""); }}
                  style={{ background: "none", border: "none", color: BRAND.amberDeep, fontWeight: 800, cursor: "pointer", padding: "6px 0 0", fontSize: "var(--text-base)" }}
                >
                  ← Back to sign in
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
