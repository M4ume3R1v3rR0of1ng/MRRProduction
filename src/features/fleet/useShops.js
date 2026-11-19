// src/features/fleet/useShops.js
//
// The company's shops (supabase/67_fleet_shops.sql), loaded by whichever screen
// needs them: the Shops tab, and the shop pickers on scheduling, completing and
// logging a service. A local hook rather than a slice of useAppData because only
// those screens read it, and the rest of the app should not pay for the query.
//
// `missing` is true when the shops table does not exist yet, i.e. the site was
// deployed before supabase/67 was run. Every picker then hides itself and the
// Shops tab says what to run, instead of the page erroring.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/shared/utils/supabase";

// PostgREST answers PGRST205 for a table it has never heard of; plain Postgres
// says 42P01. Either means "run the migration", not "something broke".
const isMissingTable = (error) => error?.code === "PGRST205" || error?.code === "42P01";

export function useShops(companyId) {
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!companyId) {
      setShops([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from("shops").select("*").eq("company_id", companyId);
    if (error) {
      setMissing(isMissingTable(error));
      setShops([]);
    } else {
      setMissing(false);
      setShops(data || []);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * Insert or update one shop. Throws on failure so the form can say why.
   * @param {Record<string, any>} shop  with `id` to update, without to insert
   */
  const saveShop = useCallback(
    async (shop) => {
      const { id, ...fields } = shop;
      const row = { ...fields, updated_at: new Date().toISOString() };
      const query = id
        ? supabase.from("shops").update(row).eq("company_id", companyId).eq("id", id)
        : supabase.from("shops").insert([{ ...row, company_id: companyId }]);
      const { data, error } = await query.select().single();
      if (error) throw error;
      setShops((prev) => (id ? prev.map((s) => (s.id === id ? data : s)) : [...prev, data]));
      return data;
    },
    [companyId],
  );

  return { shops, loading, missing, reload, saveShop };
}
