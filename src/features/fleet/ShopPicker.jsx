// src/features/fleet/ShopPicker.jsx
//
// The one shop dropdown, used wherever a service is scheduled or recorded:
// scheduling a maintenance ticket, completing it, and logging a service on the
// Fleet page. Renders nothing when the company has no shops yet (or the shops
// table is not there yet, see useShops), so those forms look exactly as they did
// before Shops existed until someone adds one.
import { Fld, Sel } from "@/shared/components/UIPrimitives";
import { translations } from "@/shared/utils/translations";
import { pickableShops } from "./shops";

export default function ShopPicker({ shops, value, onChange, lang = "en", hint }) {
  const t = translations[lang] || translations.en;
  const options = pickableShops(shops, value);
  if (options.length === 0) return null;
  return (
    <Fld label={t.shPicker} hint={hint}>
      <Sel value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t.shPickerNone}</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.active === false ? ` (${t.shArchived})` : ""}
          </option>
        ))}
      </Sel>
    </Fld>
  );
}
