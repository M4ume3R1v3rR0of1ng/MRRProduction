// src/features/settings/AnvilProSettings.jsx
//
// The ANVIL Pro tab in Settings. Everyone who can open Settings sees whether the company
// has Pro (Active, Comped, Off). The automatic-reorder switch and the "also email" list
// render only for people with inv_edit, because netlify/functions/anvil-reorder.js refuses
// anyone else, and a control that cannot save is worse than no control.
//
// Subscribing to or cancelling Pro is a Stripe change and stays in Billing; this only links,
// and not at all in the iOS app, which has no Billing screen (App Store purchase rules).
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { callReorder } from "@/features/inventory/reorderApi";
import AutoReorderControls from "@/features/inventory/AutoReorderControls";
import { useNotify } from "@/shared/context/NotificationContext";
import { IS_IOS_APP } from "@/core/platform";
import { C } from "@/shared/utils/helpers";
import { Card, Stack, Text, Muted, Bdg, SectionTitle } from "@/shared/components/UIPrimitives";

const STATUS = {
  active: { color: "green", key: "stProStatusActive" },
  comped: { color: "gold", key: "stProStatusComped" },
  off: { color: "gray", key: "stProStatusOff" },
  error: { color: "red", key: "stProStatusError" },
};

export default function AnvilProSettings({ canEditInventory, companyId, t }) {
  const { showToast } = useNotify();
  const [status, setStatus] = useState(null); // "active" | "comped" | "off" | "error"
  const [settings, setSettings] = useState(null); // { enabled, notifyEmails }

  useEffect(() => {
    let live = true;
    // Scoped to the active company: RLS lets platform admins and people in several
    // companies read more than one row, and maybeSingle() errors on more than one.
    supabase
      .from("companies")
      .select("anvil_pro, anvil_pro_comped")
      .eq("id", companyId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        // A failed lookup is not "no Pro"; saying Off would upsell a paying company.
        if (error) return setStatus("error");
        setStatus(data?.anvil_pro_comped ? "comped" : data?.anvil_pro ? "active" : "off");
      });
    return () => {
      live = false;
    };
  }, [companyId]);

  const pro = status === "active" || status === "comped";
  const showControls = pro && canEditInventory;

  const load = useCallback(async () => {
    try {
      const data = await callReorder({ action: "list" });
      setSettings({ enabled: data.enabled === true, notifyEmails: data.notifyEmails || [] });
    } catch (err) {
      setSettings(null);
      showToast(`${t.stProLoadFail} ${err.message}`, "error");
    }
  }, [showToast, t]);

  useEffect(() => {
    if (showControls) load();
  }, [showControls, load]);

  const save = async (payload, done) => {
    try {
      await callReorder({ action: "settings", ...payload });
      showToast(done, "success");
      await load();
    } catch (err) {
      showToast(err.message, "error");
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
        {status === "off" && (
          <Stack gap={2} style={{ marginTop: 12 }}>
            <Text size="base" color={C.sub}>
              {IS_IOS_APP ? t.stProUpsellIos : t.stProUpsell}
            </Text>
            {!IS_IOS_APP && <Link to="/billing">{t.stProGoBilling}</Link>}
          </Stack>
        )}
        {pro && !canEditInventory && (
          <Text size="base" color={C.sub} style={{ marginTop: 12 }}>
            {t.stProNeedsInvEdit}
          </Text>
        )}
      </Card>

      {showControls && settings && (
        <AutoReorderControls
          enabled={settings.enabled}
          notifyEmails={settings.notifyEmails}
          onSave={save}
          t={t}
        />
      )}
    </Stack>
  );
}
