// netlify/functions/_shared/weatherLocation.js
// Where the dashboard weather card points, and the place search that sets it.
//
// A company picks its location in Settings > Warehouses, which saves it to
// companies.branding.weather via set_company_branding. branding is not a
// secret (every member can read it) and set_company_branding is open to anyone
// holding settings_manage, so this is the same group of people who can already
// rename the company. companies.integrations.weather is still read as a
// fallback, because it is where a location could be set by hand before there
// was a screen for it.
//
// branding is written from the browser, so nothing in it is trusted: the
// coordinates end up in an Open-Meteo URL and are only used once they have
// been parsed as finite numbers within range.

// The Saint Joe Road warehouse, Fort Wayne IN: what every company saw before
// locations were configurable, and still what one sees until it picks its own.
export const DEFAULT_WEATHER_LOCATION = Object.freeze({
  lat: 41.0793,
  lon: -85.1394,
  timezone: "America/New_York",
  label: "Saint Joe Road · Fort Wayne, IN",
});

function validCoord(value, limit) {
  // Number("") is 0, which would quietly forecast for the Gulf of Guinea.
  const n = typeof value === "string" ? (value.trim() ? Number(value) : NaN) : value;
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

// IANA zone names only ("America/Chicago", "UTC"). Anything else would be
// passed to Open-Meteo, which rejects it and blanks the card.
function validTimezone(value) {
  return typeof value === "string" &&
    /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(value) &&
    value.length <= 64
    ? value
    : null;
}

function cleanLabel(value) {
  if (typeof value !== "string") return null;
  const s = value.trim().slice(0, 120);
  return s || null;
}

/** Normalise one stored location, or null if it is missing or unusable. */
export function parseWeatherLocation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lat = validCoord(raw.lat, 90);
  const lon = validCoord(raw.lon, 180);
  if (lat === null || lon === null) return null;
  return {
    lat,
    lon,
    timezone: validTimezone(raw.timezone) || "auto",
    label: cleanLabel(raw.label),
  };
}

/**
 * The location to forecast for: the one set in Settings, else one set by hand
 * in integrations, else Fort Wayne. A configured location without a name is
 * labelled by its coordinates rather than borrowing Fort Wayne's name.
 */
export function resolveWeatherLocation(branding, integrations) {
  const chosen =
    parseWeatherLocation(branding?.weather) || parseWeatherLocation(integrations?.weather);
  if (!chosen) return { ...DEFAULT_WEATHER_LOCATION, isDefault: true };
  return {
    ...chosen,
    label: chosen.label || `${chosen.lat.toFixed(2)}, ${chosen.lon.toFixed(2)}`,
    isDefault: false,
  };
}

/** "Toledo, Ohio" for a US place, "Windsor, Ontario, Canada" elsewhere. */
export function placeLabel(place) {
  const parts = [place?.name, place?.admin1];
  if (place?.country_code && place.country_code !== "US") parts.push(place.country);
  return parts.filter((p) => typeof p === "string" && p.trim()).join(", ");
}

/** Open-Meteo geocoding results, trimmed to what Settings shows and saves. */
export function toPlaceResults(json) {
  const results = Array.isArray(json?.results) ? json.results : [];
  return results
    .map((r) => {
      const loc = parseWeatherLocation({
        lat: r.latitude,
        lon: r.longitude,
        timezone: r.timezone,
        label: placeLabel(r),
      });
      if (!loc || !loc.label) return null;
      return { ...loc, postcodes: Array.isArray(r.postcodes) ? r.postcodes.slice(0, 3) : [] };
    })
    .filter(Boolean);
}
