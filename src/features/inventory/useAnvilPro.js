// src/features/inventory/useAnvilPro.js
//
// Does this company have Anvil Pro? For deciding what to SHOW, never what is allowed.
//
// Reads the two entitlement columns on the caller's own company row (supabase/65). The
// server re-checks on every Pro endpoint and chat tool (netlify/functions/_shared/anvilPro.js),
// so a client that lies here gets an empty tab and a 402, not a feature. This is a hint
// for the UI and nothing more.
//
// Fails to "no": if the columns are missing (migration 65 not applied yet), the query errors
// and the hook reports false, so the app behaves exactly as it did before Anvil Pro.
import { useEffect, useState } from "react";
import { supabase } from "@/shared/utils/supabase";

export default function useAnvilPro() {
  const [pro, setPro] = useState(false);
  useEffect(() => {
    let live = true;
    supabase
      .from("companies")
      .select("anvil_pro, anvil_pro_comped")
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        setPro(!error && (data?.anvil_pro === true || data?.anvil_pro_comped === true));
      });
    return () => {
      live = false;
    };
  }, []);
  return pro;
}
