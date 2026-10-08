// src/features/fleet/LendSpareModal.jsx
//
// Lend a spare vehicle to the driver of one that is going in for service.
//
// This lived inline in FleetManagementView until the Maintenance tab needed it too.
// Scheduling a service is the moment the need for a loaner appears, and that happens
// in Maintenance — but the only button for it sat on the fleet board, on the card of a
// truck whose service date had already arrived. Someone who booked a truck in for next
// Tuesday had nowhere in the app to arrange the replacement, and someone who had just
// scheduled one for today had to go and find the right card on another tab. Both views
// now mount this component, so the two entry points cannot drift apart.
//
// The three writes a loan implies (remember the current driver, move them onto the
// spare, clear the serviced truck) go through one RPC because they must land together.
// As three supabase calls from here, a failure on the second leaves a driver on two
// vehicles or on none, and the fleet screen is the only place anyone would notice.
// See supabase/19_maintenance_vehicle_swap.sql.
import { useState } from "react";
import { Truck, Tractor } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import {
  Btn,
  Bdg,
  Modal,
  Row,
  Stack,
  Text,
  Muted,
  Callout,
  Card,
} from "@/shared/components/UIPrimitives";
import { C } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import { logAction } from "@/shared/utils/logger";
import { useNotify } from "@/shared/context/NotificationContext";
import { availableSpares } from "./fleetStatus";

export default function LendSpareModal({
  req,
  vehs,
  setVehs,
  reqs,
  setReqs,
  user,
  lang = "en",
  onClose,
}) {
  const { showToast } = useNotify();
  const t = translations[lang] || translations.en;

  // In-flight flag so a double click can't fire the RPC twice. The function refuses a
  // second loan anyway, but the second click would surface that refusal as an error
  // toast on a swap that actually succeeded.
  const [swapping, setSwapping] = useState(false);
  const spares = availableSpares(vehs, reqs, req);

  const confirmSwap = async (replacementId) => {
    if (!req || !replacementId || swapping) return;
    setSwapping(true);
    try {
      const { error } = await supabase.rpc("assign_replacement_vehicle", {
        p_request_id: req.id,
        p_replacement_vehicle_id: replacementId,
      });
      if (error) throw error;

      const driverId = vehs.find((x) => x.id === req.vid)?.assignedTo || null;

      // Mirror the RPC locally instead of refetching. Both views render their grids off
      // these two lists, and a refetch would blank and repaint everything for a change
      // that touches three rows.
      setVehs((p) =>
        p.map((x) =>
          x.id === replacementId
            ? { ...x, assignedTo: driverId }
            : x.id === req.vid
              ? { ...x, assignedTo: null }
              : x,
        ),
      );
      setReqs((p) =>
        p.map((r) =>
          r.id === req.id
            ? { ...r, replacement_vehicle_id: replacementId, original_driver_id: driverId }
            : r,
        ),
      );

      await logAction(
        user.id,
        user.email,
        "FLEET_STATUS_CHANGE",
        `Lent "${vehs.find((x) => x.id === replacementId)?.name || replacementId}" to the driver of "${req.vname || req.vid}" while it is in for service.`,
        { vehicle_id: req.vid, request_id: req.id, replacement_id: replacementId },
        "fleet",
      );

      showToast(t.flSpareLent, "success");
      onClose();
    } catch (err) {
      showToast(`${t.flSpareLendFailed} ${err.message}`, "error");
    } finally {
      setSwapping(false);
    }
  };

  return (
    <Modal
      title={`${t.flLendSpare} — ${req.vname || req.vid}`}
      onClose={() => {
        if (!swapping) onClose();
      }}
    >
      <Text as="p" size="sm" color={C.sub} style={{ marginBottom: 14 }}>
        {t.flLendSpareHelp}
      </Text>

      {spares.length === 0 ? (
        // Say why there is nothing to pick. "No vehicles available" alone sends people
        // hunting for a bug when the real answer is that every truck already has a driver.
        <Callout pad={7} size="sm" color={C.sub} style={{ borderRadius: "var(--radius-lg)" }}>
          {t.flNoSparesFree}
        </Callout>
      ) : (
        <Stack gap={3}>
          {spares.map((x) => (
            <Card
              as="button"
              type="button"
              key={x.id}
              disabled={swapping}
              onClick={() => confirmSwap(x.id)}
              pad="sm"
              style={{
                border: `2px solid ${C.lg}`,
                borderRadius: "var(--radius-lg)",
                textAlign: "left",
                width: "100%",
              }}
            >
              <Row gap={5} justify="space-between">
                <span>
                  <Row
                    inline
                    as="span"
                    gap="5px"
                    style={{ fontWeight: "var(--weight-extrabold)", color: C.navy }}
                  >
                    {x.type === "truck" ? (
                      <Truck size={13} aria-hidden="true" />
                    ) : (
                      <Tractor size={13} aria-hidden="true" />
                    )}{" "}
                    {x.name}
                  </Row>
                  <Muted as="span" size="2xs" style={{ display: "block" }}>
                    {x.yr} {x.make} {x.model} · #{x.plate}
                  </Muted>
                </span>
                <Bdg color="green">{t.flUnassigned}</Bdg>
              </Row>
            </Card>
          ))}
        </Stack>
      )}

      <Row gap={0} align="stretch" justify="flex-end" style={{ marginTop: 16 }}>
        <Btn v="ghost" onClick={onClose} disabled={swapping}>
          {t.cancel}
        </Btn>
      </Row>
    </Modal>
  );
}
