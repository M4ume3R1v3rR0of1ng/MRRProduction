// src/features/inventory/ReorderTab.jsx
//
// The approval queue for Anvil Pro's automatic reorders: what A.N.V.I.L. thinks is low, what
// it suggests ordering, and a yes/no for each.
//
// Every read and write goes through netlify/functions/anvil-reorder.js, which re-checks Pro,
// inv_edit and the company. This component only decides what to show.
//
// ⚠️ "Approve" records a person's yes and the quantity they settled on. It does NOT place an
// order with a supplier; that step is not built yet. The copy says so, because a button that
// reads "Approve" under a heading about ordering would otherwise promise a purchase order
// that nobody is sending.
import { useCallback, useEffect, useState } from "react";
import { getAccessToken } from "@/shared/utils/supabase";
import {
  Btn,
  Inp,
  Card,
  Stack,
  Row,
  Text,
  Muted,
  Bdg,
  EmptyState,
  Eyebrow,
} from "@/shared/components/UIPrimitives";
import { C } from "@/shared/utils/helpers";
import { useNotify } from "@/shared/context/NotificationContext";

async function call(payload) {
  const accessToken = await getAccessToken();
  const res = await fetch("/.netlify/functions/anvil-reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.code = data.code;
    throw err;
  }
  return data;
}

const fmt = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));

export default function ReorderTab({ pro }) {
  const { showToast } = useNotify();
  const [state, setState] = useState(null); // { enabled, notifyEmails, pending, recent }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState({}); // proposal id -> edited quantity
  const [emails, setEmails] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await call({ action: "list" });
      setState(data);
      setEmails((data.notifyEmails || []).join(", "));
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

  const saveEmails = () =>
    act(
      {
        action: "settings",
        notifyEmails: emails
          .split(/[,\s]+/)
          .map((e) => e.trim())
          .filter(Boolean),
      },
      "Notification list saved.",
    );

  return (
    <Stack gap={4}>
      <Card variant="flat" pad="var(--space-8)">
        <Row justify="space-between" align="center" wrap gap={4}>
          <Stack gap={1}>
            <Eyebrow>Automatic reordering</Eyebrow>
            <Text size="base" color={C.sub}>
              Each weekday A.N.V.I.L. checks every item against its low-stock line, drafts a reorder
              for anything at or below it, and emails the people who can edit inventory. Nothing is
              ordered until someone approves it here.
            </Text>
          </Stack>
          <Btn
            v={state.enabled ? "ghost" : "gold"}
            disabled={busy}
            onClick={() =>
              act(
                { action: "settings", enabled: !state.enabled },
                state.enabled ? "Automatic reordering is off." : "Automatic reordering is on.",
              )
            }
          >
            {state.enabled ? "Turn off" : "Turn on"}
          </Btn>
        </Row>
        <Row gap={4} align="flex-end" wrap style={{ marginTop: 14 }}>
          <Stack gap={0} style={{ flex: 1, minWidth: 220 }}>
            <Muted>Also email (team members only, comma separated)</Muted>
            <Inp value={emails} onChange={(e) => setEmails(e.target.value)} disabled={busy} />
          </Stack>
          <Btn v="ghost" onClick={saveEmails} disabled={busy}>
            Save
          </Btn>
        </Row>
      </Card>

      <Eyebrow>Waiting on approval ({state.pending.length})</Eyebrow>
      {state.pending.length === 0 ? (
        <EmptyState
          message="Nothing waiting"
          subtitle={
            state.enabled
              ? "Nothing is at or below its low-stock line right now."
              : "Turn automatic reordering on and A.N.V.I.L. will draft reorders here."
          }
        />
      ) : (
        state.pending.map((p) => {
          const value = qty[p.id] ?? (p.suggested_qty === null ? "" : String(p.suggested_qty));
          const valid = Number(value) > 0;
          return (
            <Card key={p.id} variant="flat" pad="var(--space-6)">
              <Row justify="space-between" align="center" wrap gap={4}>
                <Stack gap={0}>
                  <Text size="md" weight="bold" color={C.navy}>
                    {p.item_name}
                  </Text>
                  <Muted>
                    {fmt(p.on_hand)} {p.unit || ""} left · low-stock line {fmt(p.alert_level)}
                    {p.supplier_name ? ` · ${p.supplier_name}` : ""}
                  </Muted>
                  {p.suggested_qty === null && (
                    <Muted>No reorder quantity is set for this item. Enter one to approve.</Muted>
                  )}
                </Stack>
                <Row gap={3} align="center">
                  <Inp
                    type="number"
                    min="0"
                    value={value}
                    onChange={(e) => setQty((q) => ({ ...q, [p.id]: e.target.value }))}
                    style={{ width: 90 }}
                    aria-label={`Quantity to order of ${p.item_name}`}
                    disabled={busy}
                  />
                  <Btn
                    v="gold"
                    disabled={busy || !valid}
                    onClick={() =>
                      act({ action: "approve", id: p.id, qty: Number(value) }, "Approved.")
                    }
                  >
                    Approve
                  </Btn>
                  <Btn
                    v="ghost"
                    disabled={busy}
                    onClick={() => act({ action: "dismiss", id: p.id }, "Dismissed.")}
                  >
                    Dismiss
                  </Btn>
                </Row>
              </Row>
            </Card>
          );
        })
      )}

      {state.recent.length > 0 && (
        <>
          <Eyebrow>Recently decided</Eyebrow>
          {state.recent.map((p) => (
            <Row key={p.id} justify="space-between" align="center" wrap gap={3}>
              <Text size="base" color={C.sub}>
                {p.item_name}
                {p.status === "approved" && p.approved_qty
                  ? ` · ${fmt(p.approved_qty)} ${p.unit || ""}`
                  : ""}
              </Text>
              <Bdg color={p.status === "approved" ? "green" : "gray"}>
                {p.status === "approved" ? "Approved, not yet ordered" : "Dismissed"}
              </Bdg>
            </Row>
          ))}
        </>
      )}
    </Stack>
  );
}
