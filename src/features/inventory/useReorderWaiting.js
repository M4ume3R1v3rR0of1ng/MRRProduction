// src/features/inventory/useReorderWaiting.js
//
// How many reorders are waiting on this person, for the number on A.N.V.I.L.'s launcher button.
//
// A cheap head-count straight off the proposals table (supabase/65 gives browsers SELECT),
// not the full list: the badge has to be right without a Netlify function call per minute per
// person. Re-checked once a minute while the tab is visible and whenever the tab regains focus,
// and again on demand after the person acts (refresh).
//
// Counted: waiting on approval, and approved but not yet sent. Not counted: ordered (waiting on
// a delivery), because nobody has to decide anything about those.
//
// Scoped to the company EXPLICITLY. A platform admin's RLS reads every company, so relying on
// RLS alone would add every tenant's reorders into one number.
//
// Fails to zero: if the table or columns are missing (migration 65/66 not applied) or the
// query errors, the badge simply does not appear and nothing else is affected.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/shared/utils/supabase";

const POLL_MS = 60 * 1000;

/**
 * @param {boolean} eligible - Pro is on and this person can edit inventory. A hint for the UI;
 *   the server re-checks before anything can be approved.
 * @param {string | null | undefined} companyId
 */
export default function useReorderWaiting(eligible, companyId) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!eligible || !companyId) {
      setCount(0);
      return;
    }
    const { count: n, error } = await supabase
      .from("anvil_reorder_proposals")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["pending", "approved"]);
    setCount(error ? 0 : n || 0);
  }, [eligible, companyId]);

  useEffect(() => {
    refresh();
    if (!eligible || !companyId) return undefined;
    const tick = () => {
      if (!document.hidden) refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [eligible, companyId, refresh]);

  return { count, refresh };
}
