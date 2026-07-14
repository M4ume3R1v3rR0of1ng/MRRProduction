// src/components/CompanySwitcher.jsx
//
// Renders nothing at all for the ~99% of users who belong to exactly one company.
// Only someone with memberships in several (you, Sam) ever sees it.
import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { C } from "../utils/helpers";

export default function CompanySwitcher({ user }) {
  const [memberships, setMemberships] = useState([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("memberships")
        .select("company_id, role, companies ( name )")
        .eq("user_id", user.id)
        .eq("active", true);
      setMemberships(data || []);
    })();
  }, [user?.id]);

  if (memberships.length < 2) return null;

  const switchTo = async (companyId) => {
    if (companyId === user.companyId || switching) return;
    setSwitching(true);

    const { error } = await supabase.rpc("set_active_company", { target: companyId });
    if (error) {
      console.error("Company switch failed:", error);
      setSwitching(false);
      return;
    }

    // Full reload rather than refetching in place. Every list, count, and permission
    // in memory belongs to the old company; a hard reload guarantees not one row of
    // it survives into the new one. Showing a stale Maumee River job inside his
    // brother's portal is exactly the bug this whole phase exists to prevent.
    window.location.reload();
  };

  return (
    <select
      value={user.companyId || ""}
      onChange={(e) => switchTo(e.target.value)}
      disabled={switching}
      title="Switch company"
      style={{
        background: "#fff",
        color: C.navy,
        border: `1.5px solid ${C.bd}`,
        borderRadius: "var(--radius-md)",
        padding: "6px 10px",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-bold)",
        cursor: switching ? "wait" : "pointer",
        maxWidth: 200,
      }}
    >
      {memberships.map((m) => (
        <option key={m.company_id} value={m.company_id}>
          {m.companies?.name || "Company"}
        </option>
      ))}
    </select>
  );
}
