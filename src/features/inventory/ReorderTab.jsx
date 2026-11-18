// src/features/inventory/ReorderTab.jsx
//
// The approval queue for Anvil Pro's automatic reorders: what A.N.V.I.L. thinks is low, what
// it suggests ordering, and a yes/no for each.
//
// Every read and write goes through netlify/functions/anvil-reorder.js, which re-checks Pro,
// inv_edit and the company. This component only decides what to show.
//
// The life of a reorder here: waiting on approval -> approved -> ordered -> received.
//
// ⚠️ "Approve" records a person's yes and the quantity they settled on. It does NOT email
// anyone. Sending the purchase order is its own step, with a preview of who it goes to,
// because an email to a supplier cannot be taken back. The "Approved" section is where that
// happens, and "Ordered" is where a delivery is marked received.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callReorder as call } from "./reorderApi";
import ReorderCards from "./ReorderCards";
import AutoReorderControls from "./AutoReorderControls";
import { Card, Stack, Row, Text, Muted, Bdg, Eyebrow } from "@/shared/components/UIPrimitives";
import { C } from "@/shared/utils/helpers";
import { useNotify } from "@/shared/context/NotificationContext";

const fmt = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));

export default function ReorderTab({ pro, canOpenSettings = false, t }) {
  const { showToast } = useNotify();
  const [state, setState] = useState(null); // { enabled, notifyEmails, pending, recent }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await call({ action: "list" });
      setState(data);
    } catch (err) {
      showToast(`Could not load reorders: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (pro) load();
    else setLoading(false);
  }, [pro, load]);

  if (!pro) {
    return (
      <Card variant="flat" pad="var(--space-8)">
        <Eyebrow style={{ marginBottom: 8 }}>Anvil Pro</Eyebrow>
        <Text size="base" color={C.sub}>
          Automatic reordering is part of Anvil Pro. A.N.V.I.L. watches each item against its
          low-stock line, drafts a reorder when one runs low, emails the people who approve orders,
          and waits for a yes. An admin can add Anvil Pro from the Billing tab.
        </Text>
      </Card>
    );
  }

  if (loading && !state) return <Muted>Loading…</Muted>;
  if (!state) return null;

  const act = async (payload, done) => {
    setBusy(true);
    try {
      await call(payload);
      if (done) showToast(done, "success");
      await load();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={4}>
      {canOpenSettings ? (
        <Muted>
          Automatic reordering, and who gets emailed about it, are in{" "}
          <Link to="/settings">Settings → ANVIL Pro</Link>.
        </Muted>
      ) : (
        <AutoReorderControls
          enabled={state.enabled}
          notifyEmails={state.notifyEmails}
          onSave={(payload, done) => act({ action: "settings", ...payload }, done)}
          t={t}
        />
      )}

      <ReorderCards state={state} act={act} busy={busy} />

      {state.recent.length > 0 && (
        <>
          <Eyebrow>Recently decided</Eyebrow>
          {state.recent.map((p) => (
            <Row key={p.id} justify="space-between" align="center" wrap gap={3}>
              <Text size="base" color={C.sub}>
                {p.item_name}
                {p.status === "received" && p.approved_qty
                  ? ` · ${fmt(p.approved_qty)} ${p.unit || ""}`
                  : ""}
              </Text>
              <Bdg color={p.status === "received" ? "green" : "gray"}>
                {p.status === "received" ? "Received" : "Dismissed"}
              </Bdg>
            </Row>
          ))}
        </>
      )}
    </Stack>
  );
}
