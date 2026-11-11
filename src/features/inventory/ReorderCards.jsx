// src/features/inventory/ReorderCards.jsx
//
// The reorders that are waiting on a person, as cards with their buttons: waiting on approval,
// approved and ready to send, and ordered and waiting for delivery.
//
// ONE COMPONENT FOR TWO PLACES. The Reorder screen and the A.N.V.I.L. chat window both render
// this, so a reorder is approved, previewed and sent by exactly the same code wherever the
// person happens to be. In particular the "Review and send PO" preview, which names the
// recipient and says it cannot be undone, is not something the chat can skip: there is no
// second implementation to forget it.
//
// It only decides what to show. Every action goes to anvil-reorder.js through `act`, which the
// parent supplies, and the server re-checks Pro, inv_edit and the company each time.
import { useState } from "react";
import {
  Btn,
  Inp,
  Card,
  Stack,
  Row,
  Text,
  Muted,
  EmptyState,
  Eyebrow,
} from "@/shared/components/UIPrimitives";
import { C } from "@/shared/utils/helpers";

const fmt = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));

/**
 * @param {{ state: object, act: (payload: object, done?: string) => Promise<unknown>, busy: boolean, hideEmpty?: boolean }} props
 */
export default function ReorderCards({ state, act, busy, hideEmpty = false }) {
  const [qty, setQty] = useState({}); // proposal id -> edited quantity
  const [reviewing, setReviewing] = useState(null); // proposal id whose PO preview is open
  const [toDraft, setToDraft] = useState({}); // proposal id -> supplier email typed in

  return (
    <>
      {!(hideEmpty && state.pending.length === 0) && (
        <Eyebrow>Waiting on approval ({state.pending.length})</Eyebrow>
      )}
      {state.pending.length === 0 ? (
        hideEmpty ? null : (
          <EmptyState
            message="Nothing waiting"
            subtitle={
              state.enabled
                ? "Nothing is at or below its low-stock line right now."
                : "Turn automatic reordering on and A.N.V.I.L. will draft reorders here."
            }
          />
        )
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

      {(state.approved || []).length > 0 && (
        <>
          <Eyebrow>Approved, ready to send ({state.approved.length})</Eyebrow>
          {state.approved.map((p) => {
            const amount = p.approved_qty ?? p.suggested_qty;
            const to = (p.supplier_email || toDraft[p.id] || "").trim();
            const open = reviewing === p.id;
            return (
              <Card key={p.id} variant="flat" pad="var(--space-6)">
                <Row justify="space-between" align="center" wrap gap={4}>
                  <Stack gap={0}>
                    <Text size="md" weight="bold" color={C.navy}>
                      {p.item_name}
                    </Text>
                    <Muted>
                      Order {fmt(amount)} {p.unit || ""}
                      {p.supplier_name ? ` from ${p.supplier_name}` : ""}
                    </Muted>
                  </Stack>
                  <Row gap={3} align="center" wrap>
                    {!p.supplier_email && (
                      <Inp
                        type="email"
                        placeholder="Supplier email"
                        value={toDraft[p.id] || ""}
                        onChange={(e) => setToDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                        style={{ width: 210 }}
                        aria-label={`Supplier email for ${p.item_name}`}
                        disabled={busy}
                      />
                    )}
                    <Btn
                      v="gold"
                      disabled={busy || !to}
                      onClick={() => setReviewing(open ? null : p.id)}
                    >
                      Review and send PO
                    </Btn>
                    <Btn
                      v="ghost"
                      disabled={busy}
                      onClick={() => act({ action: "receive", id: p.id }, "Marked received.")}
                    >
                      Mark received
                    </Btn>
                  </Row>
                </Row>
                {open && (
                  <Stack gap={2} style={{ marginTop: 12 }}>
                    <Text size="base" color={C.navy}>
                      This emails a purchase order for {fmt(amount)} {p.unit || ""} of {p.item_name}{" "}
                      to <b>{to}</b>. Replies come to you. It can't be undone once sent.
                    </Text>
                    <Row gap={3}>
                      <Btn
                        v="gold"
                        disabled={busy}
                        onClick={async () => {
                          await act(
                            { action: "send_po", id: p.id, to: p.supplier_email ? undefined : to },
                            "Purchase order sent.",
                          );
                          setReviewing(null);
                        }}
                      >
                        Send purchase order
                      </Btn>
                      <Btn v="ghost" disabled={busy} onClick={() => setReviewing(null)}>
                        Cancel
                      </Btn>
                    </Row>
                  </Stack>
                )}
              </Card>
            );
          })}
        </>
      )}

      {(state.ordered || []).length > 0 && (
        <>
          <Eyebrow>Ordered, waiting for delivery ({state.ordered.length})</Eyebrow>
          {state.ordered.map((p) => (
            <Card key={p.id} variant="flat" pad="var(--space-6)">
              <Row justify="space-between" align="center" wrap gap={4}>
                <Stack gap={0}>
                  <Text size="md" weight="bold" color={C.navy}>
                    {p.item_name} · {fmt(p.approved_qty ?? p.suggested_qty)} {p.unit || ""}
                  </Text>
                  <Muted>
                    {p.po_number} sent to {p.ordered_to}
                    {p.ordered_at ? ` on ${new Date(p.ordered_at).toLocaleDateString()}` : ""}
                  </Muted>
                </Stack>
                <Btn
                  v="gold"
                  disabled={busy}
                  onClick={() => act({ action: "receive", id: p.id }, "Marked received.")}
                >
                  Mark received
                </Btn>
              </Row>
            </Card>
          ))}
        </>
      )}
    </>
  );
}
