// src/components/MfaPanel.jsx
//
// Two-factor authentication for the signed-in account, using Supabase Auth's
// built-in TOTP factors. Lives in ProfileView, which every role can reach — this
// is about your own login, not a company setting, so it is deliberately not gated
// behind settings_manage.
//
// Enrolling is what raises the bar. supabase/29_mfa_enforcement.sql only requires
// aal2 from accounts that HAVE a verified factor, so turning this on is opt-in per
// user and can never lock out someone who never enrolled.
import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";
import { Btn, Inp, Fld } from "../components/UIPrimitives";
import { translations } from "../utils/translations";

export default function MfaPanel({ user, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const [factors, setFactors] = useState([]);
  const [loading, setLoading] = useState(true);
  // The in-progress enrollment: { factorId, qr, secret }. Non-null means a factor
  // row exists server-side but is not verified yet, so cancelling has to clean it
  // up rather than just closing the panel.
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: "", isError: false });

  // Only verified factors count as protection. An unverified row is an abandoned
  // enrollment, not a second factor, and showing it as "on" would tell someone
  // they are protected when a password alone still opens the account.
  const verified = factors.filter((f) => f.status === "verified");

  const loadFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) setMsg({ text: error.message, isError: true });
    else setFactors(data?.all || []);
    setLoading(false);
  };

  useEffect(() => { loadFactors(); }, []);

  const startEnroll = async () => {
    setBusy(true);
    setMsg({ text: "", isError: false });
    try {
      // Clear out any abandoned enrollment first. Supabase rejects a second factor
      // with the same friendly name, so a cancelled attempt would otherwise block
      // every retry with a confusing "already exists".
      for (const f of factors.filter((x) => x.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (error) throw error;

      setPending({ factorId: data.id, qr: data.totp?.qr_code, secret: data.totp?.secret });
      setCode("");
      await loadFactors();
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setBusy(false);
    }
  };

  const cancelEnroll = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await supabase.auth.mfa.unenroll({ factorId: pending.factorId });
    } catch {
      // Nothing actionable: the factor is unverified, so it grants no access
      // either way and the next enrollment sweeps it up.
    }
    setPending(null);
    setCode("");
    setBusy(false);
    await loadFactors();
  };

  const confirmEnroll = async (e) => {
    e.preventDefault();
    if (!pending || code.trim().length < 6) return;
    setBusy(true);
    setMsg({ text: "", isError: false });
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: pending.factorId,
        code: code.trim(),
      });
      if (error) throw error;
      // Verifying upgrades THIS session to aal2 on the spot, so the owner console
      // keeps working without a sign-out round trip.
      setPending(null);
      setCode("");
      setMsg({ text: t.mfaEnabled, isError: false });
      await loadFactors();
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setBusy(false);
    }
  };

  const removeFactor = async (factorId) => {
    if (!window.confirm(t.mfaRemoveConfirm)) return;
    setBusy(true);
    setMsg({ text: "", isError: false });
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) setMsg({ text: error.message, isError: true });
    else setMsg({ text: t.mfaRemoved, isError: false });
    setBusy(false);
    await loadFactors();
  };

  const card = {
    background: C.w,
    borderRadius: "var(--radius-xl)",
    padding: 24,
    boxShadow: "var(--shadow-sm)",
  };

  return (
    <div style={card}>
      <h2 style={{ margin: "0 0 6px", fontSize: "var(--text-xl)", fontWeight: "var(--weight-black)", color: C.navy }}>
        🛡️ {t.mfaTitle}
      </h2>
      <p style={{ margin: "0 0 20px", color: C.sub, fontSize: "var(--text-base)" }}>
        {t.mfaIntro}
      </p>

      {msg.text && (
        <div
          style={{
            background: msg.isError ? C.rB : C.gB,
            color: msg.isError ? C.rd : C.gr,
            padding: "10px 14px",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--text-base)",
            marginBottom: 16,
            fontWeight: "var(--weight-semibold)",
          }}
        >
          {msg.text}
        </div>
      )}

      {loading ? (
        <div style={{ color: C.sub, fontSize: "var(--text-base)" }}>{t.mfaLoading}</div>
      ) : pending ? (
        <form onSubmit={confirmEnroll}>
          <ol style={{ margin: "0 0 16px", paddingLeft: 20, color: C.navy, fontSize: "var(--text-base)", lineHeight: 1.7 }}>
            <li>{t.mfaStep1}</li>
            <li>{t.mfaStep2}</li>
          </ol>

          {pending.qr && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              {/* Supabase returns the QR as an SVG data: URI, which the production
                  CSP allows under img-src. A hosted chart image would not load.
                  The backing stays paper-white in both themes (see --c-scan-paper):
                  the modules are black on transparent, so a dark surface would make
                  this unscannable. */}
              <img
                src={pending.qr}
                alt={t.mfaQrAlt}
                style={{ width: 200, height: 200, background: "var(--c-scan-paper)", padding: 8, borderRadius: "var(--radius-md)", border: `1px solid ${C.bd}` }}
              />
            </div>
          )}

          {/* The typed fallback matters more than it looks: the QR is unscannable
              when the app is already open on the phone doing the enrolling. */}
          <Fld label={t.mfaSecretLabel} hint={t.mfaSecretHint}>
            <div
              style={{
                background: C.lg,
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-base)",
                color: C.navy,
                wordBreak: "break-all",
                border: `1.5px solid ${C.bd}`,
              }}
            >
              {pending.secret}
            </div>
          </Fld>

          <Fld label={t.mfaCodeLabel}>
            <Inp
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              style={{ fontFamily: "var(--font-mono)", fontSize: 20, letterSpacing: 4, textAlign: "center" }}
            />
          </Fld>

          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <Btn v="ghost" type="button" onClick={cancelEnroll} disabled={busy} style={{ flex: 1, justifyContent: "center" }}>
              {t.cancel}
            </Btn>
            <Btn v="gold" type="submit" disabled={busy || code.length < 6} style={{ flex: 2, justifyContent: "center" }}>
              {busy ? t.mfaVerifying : t.mfaTurnOn}
            </Btn>
          </div>
        </form>
      ) : verified.length > 0 ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: 16 }}>
            {verified.map((f) => (
              <div
                key={f.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 14px",
                  background: C.gB,
                  border: `1.5px solid ${C.gr}`,
                  borderRadius: "var(--radius-md)",
                }}
              >
                <div>
                  <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-base)" }}>
                    ✅ {f.friendly_name || t.mfaAuthenticator}
                  </div>
                  <div style={{ fontSize: "var(--text-2xs)", color: C.sub }}>
                    {t.mfaAddedOn} {new Date(f.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Btn v="danger" sz="sm" onClick={() => removeFactor(f.id)} disabled={busy}>
                  {t.mfaRemove}
                </Btn>
              </div>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: "var(--text-2xs)", color: C.sub, lineHeight: 1.6 }}>
            {t.mfaLostDevice}
          </p>
        </>
      ) : (
        <>
          <Btn v="gold" onClick={startEnroll} disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
            {busy ? t.mfaStarting : t.mfaSetUp}
          </Btn>
          {user?.isPlatformAdmin && (
            <p style={{ margin: "14px 0 0", fontSize: "var(--text-2xs)", color: C.rd, fontWeight: "var(--weight-bold)", lineHeight: 1.6 }}>
              {t.mfaOwnerNudge}
            </p>
          )}
        </>
      )}
    </div>
  );
}
