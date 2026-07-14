// src/utils/jobTemplates.js
// Job material templates: named material packages applied in the Build Jobs
// wizard. Custom templates are stored in the `settings` table under the
// "job_templates" key and managed from Inventory → 🧰 Templates.
import { supabase } from "./supabase";

// Built-in starter packages, used only until custom templates are saved.
// Each material matches a live inventory item by keywords (every keyword
// must appear in the item name, case-insensitive).
const DEFAULT_TEMPLATE_DEFS = [
  {
    name: "Economy Roof",
    icon: "🏠",
    materials: [
      { label: "Atlas Ice and Water", match: ["ice", "water"] },
      { label: "Summit Underlayment", match: ["underlayment"] },
      { label: "Atlas Pro Ridgevent", match: ["ridge"] },
      { label: "Box Vents — Brown", match: ["box vent", "brown"] },
      { label: "Box Vents — Black", match: ["box vent", "black"] },
      { label: "Stinger Cap Nails", match: ["stinger"] },
      { label: "OSB", match: ["osb"] },
      { label: "Smooth Shank Coil Nails", match: ["smooth shank"] },
    ],
  },
  {
    name: "Elite Roof",
    icon: "⭐",
    materials: [
      { label: "Atlas Ice and Water", match: ["ice", "water"] },
      { label: "Summit Underlayment", match: ["underlayment"] },
      { label: "Atlas Pro Ridgevent", match: ["ridge"] },
      { label: "Box Vents — Brown", match: ["box vent", "brown"] },
      { label: "Box Vents — Black", match: ["box vent", "black"] },
      { label: "Stinger Cap Nails", match: ["stinger"] },
      { label: "OSB", match: ["osb"] },
      { label: "Ring Shank Coil Nails", match: ["ring shank"] },
    ],
  },
];

// Convert the keyword-based defaults into concrete templates against the
// live inventory. Unmatched materials keep iid: null so the editor and the
// wizard can flag them instead of dropping them silently.
export const resolveDefaultTemplates = (inv = []) =>
  DEFAULT_TEMPLATE_DEFS.map((tpl) => ({
    id: "tpl_" + tpl.name.toLowerCase().replace(/\W+/g, "_"),
    name: tpl.name,
    icon: tpl.icon,
    items: tpl.materials.map((m) => {
      const item = inv.find(
        (i) => i && m.match.every((kw) => (i.name || "").toLowerCase().includes(kw)),
      );
      return item
        ? { iid: item.id, iname: item.name, qty: 1 }
        : { iid: null, iname: m.label, qty: 1 };
    }),
  }));

// Returns the saved templates array, or null when none have been saved yet
// (callers fall back to resolveDefaultTemplates).
export async function fetchJobTemplates() {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "job_templates")
    .maybeSingle();
  if (error) throw error;
  if (!data?.value) return null;
  try {
    const parsed = JSON.parse(data.value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveJobTemplates(templates) {
  // settings is keyed (company_id, key) now — two companies each have their own
  // 'job_templates' row. company_id comes from the column DEFAULT.
  const { error } = await supabase.from("settings").upsert(
    {
      key: "job_templates",
      value: JSON.stringify(templates),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,key" },
  );
  if (error) throw error;
}
