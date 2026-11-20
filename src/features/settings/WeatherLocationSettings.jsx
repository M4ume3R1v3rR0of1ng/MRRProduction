// src/features/settings/WeatherLocationSettings.jsx
//
// Settings > Warehouses: where the dashboard weather card forecasts for. Type a
// city or ZIP, pick the right match, save. The choice goes to
// companies.branding.weather through set_company_branding, the same RPC and the
// same people (admin or settings_manage) as the company name and logo.
//
// The place search runs through /.netlify/functions/weather rather than straight
// at Open-Meteo, because the app's CSP only allows connect-src to 'self' and
// Supabase. That function also re-checks whatever is saved here before using it,
// since branding is written from the browser.
import { useState } from "react";
import { CloudSun, MapPin, Search } from "lucide-react";
import { supabase, getAccessToken } from "@/shared/utils/supabase";
import { useNotify } from "@/shared/context/NotificationContext";
import { C } from "@/shared/utils/helpers";
import {
  Btn,
  Card,
  Fld,
  Inp,
  Row,
  Stack,
  Text,
  Callout,
  SectionTitle,
} from "@/shared/components/UIPrimitives";

export default function WeatherLocationSettings({ company, setCompany, t }) {
  const { showToast } = useNotify();
  const saved = company?.branding?.weather;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [savingLabel, setSavingLabel] = useState(null);

  const search = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/weather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, search: q }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
      setResults(Array.isArray(json.results) ? json.results : []);
    } catch (err) {
      showToast(`${t.stWeatherSearchFail} ${err.message}`, "error");
    } finally {
      setSearching(false);
    }
  };

  const save = async (place) => {
    setSavingLabel(place.label);
    try {
      const weather = {
        label: place.label,
        lat: place.lat,
        lon: place.lon,
        timezone: place.timezone,
      };
      const { data, error } = await supabase.rpc("set_company_branding", {
        patch: { weather },
      });
      if (error) throw error;
      if (typeof setCompany === "function") {
        setCompany((prev) =>
          prev ? { ...prev, branding: data || { ...prev.branding, weather } } : prev,
        );
      }
      setResults(null);
      setQuery("");
      showToast(t.stWeatherSaved, "success");
    } catch (err) {
      showToast(`${t.stCouldNotSave} ${err.message}`, "error");
    } finally {
      setSavingLabel(null);
    }
  };

  return (
    <Card pad="lg" style={{ marginTop: 20 }}>
      <Stack gap={1} style={{ marginBottom: 20 }}>
        <SectionTitle icon={CloudSun} size="lg">
          {t.stWeatherTitle}
        </SectionTitle>
        <Text as="p" size="base" color={C.sub} style={{ margin: 0, lineHeight: 1.6 }}>
          {t.stWeatherDesc}
        </Text>
      </Stack>

      <Row gap={2} style={{ marginBottom: 16, fontSize: "var(--text-base)" }}>
        <MapPin size={14} aria-hidden="true" color={C.sub} />
        <Text as="span" size="base" color={C.sub}>
          {t.stWeatherCurrent}
        </Text>
        <Text as="span" size="base" weight="bold" color={C.navy}>
          {saved?.label || t.stWeatherNotSet}
        </Text>
      </Row>

      <form onSubmit={search}>
        <Row gap={3} align="flex-end" wrap>
          <Fld label={t.stWeatherSearchLabel} style={{ flex: 1, minWidth: 200 }}>
            <Inp
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.stWeatherSearchPlaceholder}
              maxLength={80}
            />
          </Fld>
          <Btn
            v="primary"
            type="submit"
            disabled={searching || query.trim().length < 2}
            style={{ height: 38, marginBottom: 1 }}
          >
            <Search size={14} aria-hidden="true" />{" "}
            {searching ? t.stWeatherSearching : t.stWeatherSearch}
          </Btn>
        </Row>
      </form>

      {results && results.length === 0 && (
        <Text as="p" size="base" color={C.sub} style={{ margin: "14px 0 0" }}>
          {t.stWeatherNoResults}
        </Text>
      )}

      {results && results.length > 0 && (
        <Stack gap={2} style={{ marginTop: 14 }}>
          {results.map((place) => (
            <Callout key={`${place.lat},${place.lon}`} bordered pad="11px 16px">
              <Row justify="space-between" gap={3} wrap>
                <div>
                  <Text as="div" size="md" weight="bold" color={C.navy}>
                    {place.label}
                  </Text>
                  <Text as="div" size="sm" color={C.sub}>
                    {place.postcodes?.length ? `${place.postcodes.join(", ")} · ` : ""}
                    {place.lat.toFixed(3)}, {place.lon.toFixed(3)}
                  </Text>
                </div>
                <Btn
                  v="outline"
                  sz="sm"
                  disabled={savingLabel !== null}
                  onClick={() => save(place)}
                >
                  {savingLabel === place.label ? t.stWeatherSaving : t.stWeatherUse}
                </Btn>
              </Row>
            </Callout>
          ))}
        </Stack>
      )}
    </Card>
  );
}
