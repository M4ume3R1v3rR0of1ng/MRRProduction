// src/features/inventory/ReorderWaitingPanel.jsx
//
// "Waiting on you", inside A.N.V.I.L.'s chat window: the reorders that need a person's yes, with
// the same Approve / Dismiss / Review-and-send buttons as the Reorder screen, because it renders
// the same ReorderCards. Approving here and approving there are one code path.
//
// Collapsible, because the window is small and the conversation is why it is open. It shows
// errors inline rather than as toasts: the chat is a floating widget and has no toast host of
// its own to rely on.
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Row, Stack, Text, Muted, TextBtn } from "@/shared/components/UIPrimitives";
import { C } from "@/shared/utils/helpers";
import { callReorder, waitingCount } from "./reorderApi";
import ReorderCards from "./ReorderCards";

/** @param {{ onChanged?: () => void }} props */
export default function ReorderWaitingPanel({ onChanged }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await callReorder({ action: "list" }));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (payload) => {
    setBusy(true);
    setError("");
    try {
      await callReorder(payload);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const n = waitingCount(state);
  if (!state && !error)
    return <Muted style={{ padding: "var(--space-3) var(--space-5)" }}>…</Muted>;
  if (state && n === 0 && !error) return null;

  return (
    <div style={{ borderBottom: `1px solid ${C.lg}`, background: C.subtle }}>
      <Row
        justify="space-between"
        align="center"
        style={{ padding: "var(--space-3) var(--space-5)", cursor: "pointer" }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <Text size="sm" weight="bold" color={C.navy}>
          Waiting on you ({n})
        </Text>
        <TextBtn color={C.sub} size="xs" aria-label={collapsed ? "Show" : "Hide"}>
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </TextBtn>
      </Row>
      {!collapsed && (
        <Stack
          gap={2}
          style={{ padding: "0 var(--space-4) var(--space-3)", maxHeight: 200, overflowY: "auto" }}
        >
          {error && (
            <Text size="xs" color={C.rd}>
              {error}
            </Text>
          )}
          {state && <ReorderCards state={state} act={act} busy={busy} hideEmpty />}
        </Stack>
      )}
    </div>
  );
}
