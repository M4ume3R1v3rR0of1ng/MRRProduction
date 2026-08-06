// src/views/inventory/ItemDetailModal.jsx
//
// One catalog item: its photo, its specs, and its full FIFO batch history.
// The hub the other inventory dialogs are opened from.
//
// Extracted from InventoryView. The buttons here used to seed the parent's
// shared `form` object before switching modals, so each one had to know the
// exact field shape the destination dialog expected. They now just say which
// dialog to open, and the dialog seeds itself.
import { C, fd, fm, tot, newestPrice } from "../../utils/helpers";
import { resolveBatchPerson } from "../../utils/people";
import { Btn, Modal, PhotoUpload } from "../../components/UIPrimitives";

// Oldest first: the batch FIFO will draw from next is the first one with stock
// left on it, which is what the ACTIVE marker points at.
export const batchesOldestFirst = (item) =>
  [...(item?.batches || [])].sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd));

export default function ItemDetailModal({
  item, users = [], perms = {},
  onSetPhoto, onEdit, onReceive, onAdjust, onDelete, onCorrectBatch, onClose,
}) {
  const specs = [
    ["Total Stock", `${tot(item)} ${item.unit}`],
    ["Category", item.cat],
    ["Unit", item.unit],
    ...(perms.inv_pricing_view
      ? [["Current Price", fm(newestPrice(item))], ["Low Alert", `${item.alrt} ${item.unit}`]]
      : [["Low Alert", `${item.alrt} ${item.unit}`]]),
    ["Batches", (item.batches || []).length],
  ];

  const batches = batchesOldestFirst(item);

  return (
    <Modal title={item.name} onClose={onClose} wide>
      <div className="sw-grid-2" style={{ gap: "var(--space-7)", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Product Photo</div>
          <PhotoUpload current={item.photo_url || null} onUpload={(data) => onSetPhoto?.(item.id, data)} label="Upload product photo" previewHeight={180} />
        </div>
        <div>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: C.navy, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Item Details</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {specs.map(([k, v]) => (
              <div key={k} style={{ background: C.lg, borderRadius: "var(--radius-md)", padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "var(--text-xs)", color: C.sub, fontWeight: "var(--weight-bold)", textTransform: "uppercase" }}>{k}</span>
                <span style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: 12, flexWrap: "wrap" }}>
            {perms.inv_edit && <Btn v="outline" sz="sm" onClick={onEdit}>✏️ Edit Materials</Btn>}
            {perms.inv_receive && <Btn v="primary" sz="sm" onClick={onReceive}>+ Receive Batch</Btn>}
            {perms.inv_adjust && <Btn v="gold" sz="sm" onClick={onAdjust}>🔧 Adjust Stock</Btn>}
            {perms.inv_edit && <Btn v="danger" sz="sm" onClick={onDelete}>🗑️ Delete Product</Btn>}
          </div>
        </div>
      </div>

      <h4 style={{ margin: "0 0 8px", color: C.navy, fontSize: "var(--text-sm)", textTransform: "uppercase" }}>Batch History (FIFO)</h4>
      {batches.map((b, i) => {
        const isActive = i === 0 && b.rem > 0;
        const unpriced = (parseFloat(b.price) || 0) === 0;
        return (
          <div
            key={b.id}
            style={{
              padding: "10px 14px",
              background: isActive ? "color-mix(in srgb, var(--c-leather) 10%, transparent)" : C.lg,
              borderRadius: "var(--radius-md)",
              border: isActive ? `1.5px solid ${C.blue}` : "none",
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)" }}>
              <div>
                <div style={{ fontWeight: "var(--weight-bold)", color: C.navy, fontSize: "var(--text-sm)" }}>
                  {isActive && <span style={{ color: C.blue }}>▶ ACTIVE · </span>}
                  {fd(b.rcvd)}
                  {b.vendor && <span style={{ color: C.sub }}> · {b.vendor}</span>}
                  {b.ref && <span style={{ color: C.tl }}> · {b.ref}</span>}
                </div>
                {/* `?.name || "Unknown"` here found the right person and threw the
                    answer away — profiles keep the name in full_name — and could
                    never resolve a pre-Auth id at all. See utils/people. */}
                <div style={{ fontSize: "var(--text-xs)", color: C.sub }}>By: {resolveBatchPerson(users, b)}</div>
              </div>
              <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <div>
                  <div style={{ fontWeight: "var(--weight-extrabold)", color: b.rem === 0 ? C.sub : C.gr, fontSize: "var(--text-sm)" }}>{b.rem}/{b.qty} remaining</div>
                  {perms.inv_pricing_view && (
                    <div style={{ fontSize: "var(--text-xs)", color: unpriced ? C.rd : C.blue, fontWeight: "var(--weight-bold)" }}>
                      {fm(b.price)} ea.{unpriced && b.rem > 0 ? " ⚠️ unpriced" : ""}
                    </div>
                  )}
                </div>
                {(perms.inv_receive || perms.inv_pricing_edit) && (
                  <Btn v="ghost" sz="sm" onClick={() => onCorrectBatch?.(b)} title="Correct this batch's price, PO or vendor">✏️</Btn>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {batches.length === 0 && <p style={{ color: C.sub, fontSize: "var(--text-base)" }}>No receipt stacks logged yet.</p>}
    </Modal>
  );
}
