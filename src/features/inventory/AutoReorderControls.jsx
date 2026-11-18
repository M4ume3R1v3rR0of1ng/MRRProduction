// src/features/inventory/AutoReorderControls.jsx
//
// The automatic-reorder switch and the "also email" list. One component, two homes:
// Settings → ANVIL Pro, and Inventory → Reorders for inventory editors who cannot open
// Settings (manager, coordinator and field have inv_edit but not settings_manage, and the
// server only asks for inv_edit). The caller owns loading and saving; this owns the form.
import { useEffect, useState } from "react";
import { Btn, Inp, Card, Stack, Row, Text, Muted, Eyebrow } from "@/shared/components/UIPrimitives";
import { C } from "@/shared/utils/helpers";

export default function AutoReorderControls({ enabled, notifyEmails, onSave, t }) {
  const [emails, setEmails] = useState((notifyEmails || []).join(", "));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEmails((notifyEmails || []).join(", "));
  }, [notifyEmails]);

  const save = async (payload, done) => {
    setBusy(true);
    try {
      await onSave(payload, done);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad="lg">
      <Row justify="space-between" align="center" wrap gap={4}>
        <Stack gap={1}>
          <Eyebrow>{t.stProReorderTitle}</Eyebrow>
          <Text size="base" color={C.sub}>
            {t.stProReorderDesc}
          </Text>
        </Stack>
        <Btn
          v={enabled ? "ghost" : "gold"}
          disabled={busy}
          onClick={() =>
            save({ enabled: !enabled }, enabled ? t.stProReorderOff : t.stProReorderOn)
          }
        >
          {enabled ? t.stProTurnOff : t.stProTurnOn}
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
  );
}
