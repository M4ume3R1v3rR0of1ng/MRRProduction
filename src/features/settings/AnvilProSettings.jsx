// src/features/settings/AnvilProSettings.jsx
//
// The ANVIL Pro tab in Settings. Everyone who can open Settings sees whether the company
// has Pro (Active, Comped, Off). The automatic-reorder switch and the "also email" list
// render only for people with inv_edit, because netlify/functions/anvil-reorder.js refuses
// anyone else, and a control that cannot save is worse than no control.
//
// Subscribing to or cancelling Pro is a Stripe change and stays in Billing; this only links.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { callReorder } from "@/features/inventory/reorderApi";
import { useNotify } from "@/shared/context/NotificationContext";
import { C } from "@/shared/utils/helpers";
import {
  Btn,
  Inp,
  Card,
  Stack,
  Row,
  Text,
  Muted,
  Bdg,
  Eyebrow,
  SectionTitle,
} from "@/shared/components/UIPrimitives";

const STATUS = {
  active: { color: "green", key: "stProStatusActive" },
  comped: { color: "gold", key: "stProStatusComped" },
  off: { color: "gray", key: "stProStatusOff" },
};

export default function AnvilProSettings({ canEditInventory, t }) {
  const { showToast } = useNotify();
  const [status, setStatus] = useState(null); // "active" | "comped" | "off"
  const [settings, setSettings] = useState(null); // { enabled, notifyEmails }
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    supabase
      .from("companies")
      .select("anvil_pro, anvil_pro_comped")
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error || !data) return setStatus("off");
        setStatus(data.anvil_pro_comped ? "comped" : data.anvil_pro ? "active" : "off");
      });
    return () => {
      live = false;
    };
  }, []);

  const pro = status === "active" || status === "comped";
  const showControls = pro && canEditInventory;

  const load = useCallback(async () => {
    try {
      const data = await callReorder({ action: "list" });
      setSettings({ enabled: data.enabled === true, notifyEmails: data.notifyEmails || [] });
      setEmails((data.notifyEmails || []).join(", "));
    } catch (err) {
      setSettings(null);
      showToast(`${t.stProLoadFail} ${err.message}`, "error");
    }
  }, [showToast, t]);

  useEffect(() => {
    if (showControls) load();
  }, [showControls, load]);

  const save = async (payload, done) => {
    setBusy(true);
    try {
      await callReorder({ action: "settings", ...payload });
      showToast(done, "success");
      await load();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <Muted>…</Muted>;
  const s = STATUS[status];

  return (
    <Stack gap={4}>
      <Card pad="lg">
        <SectionTitle icon={Sparkles} size="lg" actions={<Bdg color={s.color}>{t[s.key]}</Bdg>}>
          {t.stProTitle}
        </SectionTitle>
        {!pro && (
          <Stack gap={2} style={{ marginTop: 12 }}>
            <Text size="base" color={C.sub}>
              {t.stProUpsell}
            </Text>
            <Link to="/billing">{t.stProGoBilling}</Link>
          </Stack>
        )}
        {pro && !canEditInventory && (
          <Text size="base" color={C.sub} style={{ marginTop: 12 }}>
            {t.stProNeedsInvEdit}
          </Text>
        )}
      </Card>

      {showControls && settings && (
        <Card pad="lg">
          <Row justify="space-between" align="center" wrap gap={4}>
            <Stack gap={1}>
              <Eyebrow>{t.stProReorderTitle}</Eyebrow>
              <Text size="base" color={C.sub}>
                {t.stProReorderDesc}
              </Text>
            </Stack>
            <Btn
              v={settings.enabled ? "ghost" : "gold"}
              disabled={busy}
              onClick={() =>
                save(
                  { enabled: !settings.enabled },
                  settings.enabled ? t.stProReorderOff : t.stProReorderOn,
                )
              }
            >
              {settings.enabled ? t.stProTurnOff : t.stProTurnOn}
            </Btn>
          </Row>
          <Row gap={4} align="flex-end" wrap style={{ marginTop: 14 }}>
            <Stack gap={0} style={{ flex: 1, minWidth: 220 }}>
              <Muted as="label" htmlFor="anvil-pro-emails">
                {t.stProAlsoEmail}
              </Muted>
              <Inp
                id="anvil-pro-emails"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                disabled={busy}
              />
            </Stack>
            <Btn
              v="ghost"
              disabled={busy}
              onClick={() =>
                save(
                  {
                    notifyEmails: emails
                      .split(/[,\s]+/)
                      .map((e) => e.trim())
                      .filter(Boolean),
                  },
                  t.stProEmailsSaved,
                )
              }
            >
              {t.stProSave}
            </Btn>
          </Row>
        </Card>
      )}
    </Stack>
  );
}
