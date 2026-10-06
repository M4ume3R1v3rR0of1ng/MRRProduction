// src/features/auth/MfaPanel.jsx
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
import { Shield, CheckCircle2 } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import {
  Btn,
  Inp,
  Fld,
  Card,
  Row,
  Stack,
  Text,
  Muted,
  Callout,
} from "@/shared/components/UIPrimitives";
import { translations } from "@/shared/utils/translations";

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

  useEffect(() => {
    loadFactors();
  }, []);

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

  return (
    <Card variant="raised" pad="lg">
      <Row
        as="h2"
        style={{
          margin: "0 0 6px",
          fontSize: "var(--text-xl)",
          fontWeight: "var(--weight-black)",
          color: C.navy,
        }}
      >
        <Shield size={18} aria-hidden="true" /> {t.mfaTitle}
      </Row>
      <Text as="p" size="base" color={C.sub} style={{ margin: "0 0 20px" }}>
        {t.mfaIntro}
      </Text>

      {msg.text && (
        <Callout
          tone={msg.isError ? "danger" : "success"}
          size="base"
          weight="semibold"
          color={msg.isError ? C.rd : C.gr}
          style={{ marginBottom: 16 }}
        >
          {msg.text}
        </Callout>
      )}

      {loading ? (
        <Text size="base" color={C.sub}>
          {t.mfaLoading}
        </Text>
      ) : pending ? (
        <form onSubmit={confirmEnroll}>
          <Text
            as="ol"
            size="base"
            color={C.navy}
            style={{ margin: "0 0 16px", paddingLeft: 20, lineHeight: 1.7 }}
          >
            <li>{t.mfaStep1}</li>
            <li>{t.mfaStep2}</li>
          </Text>

          {pending.qr && (
            <Row gap={0} align="stretch" justify="center" style={{ marginBottom: 14 }}>
              {/* Supabase returns the QR as an SVG data: URI, which the production
                  CSP allows under img-src. A hosted chart image would not load.
                  The backing stays paper-white in both themes (see --c-scan-paper):
                  the modules are black on transparent, so a dark surface would make
                  this unscannable. */}
              <img
                src={pending.qr}
                alt={t.mfaQrAlt}
                style={{
                  width: 200,
                  height: 200,
                  background: C.scanPaper,
                  padding: 8,
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${C.bd}`,
                }}
              />
            </Row>
          )}

          {/* The typed fallback matters more than it looks: the QR is unscannable
              when the app is already open on the phone doing the enrolling. */}
          <Fld label={t.mfaSecretLabel} hint={t.mfaSecretHint}>
            <Callout
              bordered
              size="base"
              color={C.navy}
              style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}
            >
              {pending.secret}
            </Callout>
          </Fld>

          <Fld label={t.mfaCodeLabel}>
            <Inp
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 20,
                letterSpacing: 4,
                textAlign: "center",
              }}
            />
          </Fld>

          <Row align="stretch">
            <Btn
              v="ghost"
              type="button"
              onClick={cancelEnroll}
              disabled={busy}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {t.cancel}
            </Btn>
            <Btn
              v="gold"
              type="submit"
              disabled={busy || code.length < 6}
              style={{ flex: 2, justifyContent: "center" }}
            >
              {busy ? t.mfaVerifying : t.mfaTurnOn}
            </Btn>
          </Row>
        </form>
      ) : verified.length > 0 ? (
        <>
          <Stack gap={3} style={{ marginBottom: 16 }}>
            {verified.map((f) => (
              <Callout key={f.id} tone="success" bordered>
                <Row gap={4} justify="space-between">
                  <div>
                    <Row
                      gap={2}
                      style={{
                        fontWeight: "var(--weight-bold)",
                        color: C.navy,
                        fontSize: "var(--text-base)",
                      }}
                    >
                      <CheckCircle2 size={14} color={C.gr} aria-hidden="true" />{" "}
                      {f.friendly_name || t.mfaAuthenticator}
                    </Row>
                    <Muted size="2xs">
                      {t.mfaAddedOn} {new Date(f.created_at).toLocaleDateString()}
                    </Muted>
                  </div>
                  <Btn v="danger" sz="sm" onClick={() => removeFactor(f.id)} disabled={busy}>
                    {t.mfaRemove}
                  </Btn>
                </Row>
              </Callout>
            ))}
          </Stack>
          <Muted as="p" size="2xs" style={{ margin: 0, lineHeight: 1.6 }}>
            {t.mfaLostDevice}
          </Muted>
        </>
      ) : (
        <>
          <Btn
            v="gold"
            onClick={startEnroll}
            disabled={busy}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {busy ? t.mfaStarting : t.mfaSetUp}
          </Btn>
          {user?.isPlatformAdmin && (
            <Text
              as="p"
              size="2xs"
              weight="bold"
              color={C.rd}
              style={{ margin: "14px 0 0", lineHeight: 1.6 }}
            >
              {t.mfaOwnerNudge}
            </Text>
          )}
        </>
      )}
    </Card>
  );
}
