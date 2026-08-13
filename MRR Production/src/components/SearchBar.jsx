// src/components/SearchBar.jsx
//
// The list-filter control used by Build Jobs, Pull Inventory, Fleet and
// Maintenance. Four screens had (or wanted) the same input, the same clear
// button and the same result count, so it lives in one place — a search box that
// behaves differently on each screen is a small betrayal every time.
//
// The result count only appears once something has been typed. Showing "12
// results" over an unfiltered list states the obvious and competes with the
// counts on the status filters, which mean something quite different.
import { Inp, Btn } from "./UIPrimitives";
import { C } from "../utils/helpers";
import { translations } from "../utils/translations";

export default function SearchBar({
  value,
  onChange,
  placeholder,
  resultCount,
  lang = "en",
  children,
}) {
  // The label and the result count are the component's own copy, so they are
  // translated here rather than passed in by four separate callers — the whole
  // point of sharing this is that the callers only supply what differs.
  const t = translations[lang] || translations.en;

  return (
    <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
      <Inp
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type="search"
        style={{ flex: 1, minWidth: 220, maxWidth: 380 }}
      />
      {/* Anything the screen wants beside the box — usually its sort dropdown. */}
      {children}
      {value && (
        <>
          <Btn v="ghost" sz="sm" onClick={() => onChange("")}>✕ {t.searchClear}</Btn>
          <span style={{ fontSize: "var(--text-sm)", color: C.sub, fontWeight: "var(--weight-semibold)" }}>
            {resultCount === 1 ? t.searchOneResult : t.searchNResults.replace("{n}", resultCount)}
          </span>
        </>
      )}
    </div>
  );
}

// The shared matcher. Case-insensitive, trimmed, and true for an empty query so
// callers can drop it straight into .filter() without a guard.
//
// Fields are read defensively because these records are denormalised and older
// rows do not all carry every key — a missing addr must narrow nothing rather
// than throw.
export function matchesQuery(query, fields) {
  const q = (query || "").toLowerCase().trim();
  if (!q) return true;
  return fields.some((f) => String(f ?? "").toLowerCase().includes(q));
}
