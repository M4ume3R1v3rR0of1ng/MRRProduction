// src/features/inventory/ItemDetailModal.jsx
//
// One catalog item: its photo, its specs, and its full FIFO batch history.
// The hub the other inventory dialogs are opened from.
//
// Extracted from InventoryView. The buttons here used to seed the parent's
// shared `form` object before switching modals, so each one had to know the
// exact field shape the destination dialog expected. They now just say which
// dialog to open, and the dialog seeds itself.
import { Pencil, Wrench, Trash2, AlertTriangle } from "lucide-react";
import { C, fd, fm, tot, newestPrice } from "@/shared/utils/helpers";
import { resolveBatchPerson } from "@/shared/utils/people";
import {
  Btn,
  Modal,
  PhotoUpload,
  Stack,
  Row,
  Eyebrow,
  Text,
  Muted,
  Grid,
} from "@/shared/components/UIPrimitives";

// Oldest first: the batch FIFO will draw from next is the first one with stock
// left on it, which is what the ACTIVE marker points at.
export const batchesOldestFirst = (item) =>
  [...(item?.batches || [])].sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd));

export default function ItemDetailModal({
  item,
  users = [],
  perms = {},
  onSetPhoto,
  onEdit,
  onReceive,
  onAdjust,
  onDelete,
  onCorrectBatch,
  onClose,
}) {
  const specs = [
    ["Total Stock", `${tot(item)} ${item.unit}`],
    ["Category", item.cat],
    ["Unit", item.unit],
    ...(perms.inv_pricing_view
      ? [
          ["Current Price", fm(newestPrice(item))],
          ["Low Alert", `${item.alrt} ${item.unit}`],
        ]
      : [["Low Alert", `${item.alrt} ${item.unit}`]]),
    ["Batches", (item.batches || []).length],
  ];

  const batches = batchesOldestFirst(item);

  return (
    <Modal title={item.name} onClose={onClose} wide>
      <Grid gap={7} style={{ marginBottom: 16 }}>
        <div>
          <Eyebrow color={C.navy} style={{ fontWeight: "var(--weight-bold)", marginBottom: 8 }}>
            Product Photo
          </Eyebrow>
          <PhotoUpload
            current={item.photo_url || null}
            onUpload={(data) => onSetPhoto?.(item.id, data)}
            label="Upload product photo"
            previewHeight={180}
          />
        </div>
        <div>
          <Eyebrow color={C.navy} style={{ fontWeight: "var(--weight-bold)", marginBottom: 8 }}>
            Item Details
          </Eyebrow>
          <Stack gap={2}>
            {specs.map(([k, v]) => (
              <Row
                key={k}
                gap={0}
                justify="space-between"
                style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "8px 12px" }}
              >
                <Text
                  as="span"
                  size="xs"
                  weight="bold"
                  color={C.sub}
                  style={{ textTransform: "uppercase" }}
                >
                  {k}
                </Text>
                <Text as="span" size="base" weight="extrabold" color={C.navy}>
                  {v}
                </Text>
              </Row>
            ))}
          </Stack>
          <Row align="stretch" wrap style={{ marginTop: 12 }}>
            {perms.inv_edit && (
              <Btn v="outline" sz="sm" onClick={onEdit}>
                <Pencil size={13} aria-hidden="true" /> Edit Materials
              </Btn>
            )}
            {perms.inv_receive && (
              <Btn v="primary" sz="sm" onClick={onReceive}>
                + Receive Batch
              </Btn>
            )}
            {perms.inv_adjust && (
              <Btn v="gold" sz="sm" onClick={onAdjust}>
                <Wrench size={13} aria-hidden="true" /> Adjust Stock
              </Btn>
            )}
            {perms.inv_edit && (
              <Btn v="danger" sz="sm" onClick={onDelete}>
                <Trash2 size={13} aria-hidden="true" /> Delete Product
              </Btn>
            )}
          </Row>
        </div>
      </Grid>

      <Text
        as="h4"
        size="sm"
        color={C.navy}
        style={{ margin: "0 0 8px", textTransform: "uppercase" }}
      >
        Batch History (FIFO)
      </Text>
      {batches.map((b, i) => {
        const isActive = i === 0 && b.rem > 0;
        const unpriced = (parseFloat(b.price) || 0) === 0;
        return (
          <div
            key={b.id}
            style={{
              padding: "10px 14px",
              background: isActive ? `color-mix(in srgb, ${C.leather} 10%, transparent)` : C.lg,
              borderRadius: "var(--radius-md)",
              border: isActive ? `1.5px solid ${C.blue}` : "none",
              marginBottom: 8,
            }}
          >
            <Row align="stretch" justify="space-between" wrap>
              <div>
                <Text size="sm" weight="bold" color={C.navy}>
                  {isActive && (
                    <Text as="span" color={C.blue}>
                      ▶ ACTIVE ·{" "}
                    </Text>
                  )}
                  {fd(b.rcvd)}
                  {b.vendor && (
                    <Text as="span" color={C.sub}>
                      {" "}
                      · {b.vendor}
                    </Text>
                  )}
                  {b.ref && (
                    <Text as="span" color={C.tl}>
                      {" "}
                      · {b.ref}
                    </Text>
                  )}
                </Text>
                {/* `?.name || "Unknown"` here found the right person and threw the
                    answer away — profiles keep the name in full_name — and could
                    never resolve a pre-Auth id at all. See utils/people. */}
                <Muted>By: {resolveBatchPerson(users, b)}</Muted>
              </div>
              <Row style={{ textAlign: "right" }}>
                <div>
                  <Text size="sm" weight="extrabold" color={b.rem === 0 ? C.sub : C.gr}>
                    {b.rem}/{b.qty} remaining
                  </Text>
                  {perms.inv_pricing_view && (
                    <Text size="xs" weight="bold" color={unpriced ? C.rd : C.blue}>
                      {fm(b.price)} ea.
                      {unpriced && b.rem > 0 && (
                        <>
                          {" "}
                          <AlertTriangle
                            size={10}
                            style={{ verticalAlign: -1 }}
                            aria-hidden="true"
                          />{" "}
                          unpriced
                        </>
                      )}
                    </Text>
                  )}
                </div>
                {(perms.inv_receive || perms.inv_pricing_edit) && (
                  <Btn
                    v="ghost"
                    sz="sm"
                    onClick={() => onCorrectBatch?.(b)}
                    title="Correct this batch's price, PO or vendor"
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </Btn>
                )}
              </Row>
            </Row>
          </div>
        );
      })}
      {batches.length === 0 && (
        <Text as="p" size="base" color={C.sub}>
          No receipt stacks logged yet.
        </Text>
      )}
    </Modal>
  );
}
