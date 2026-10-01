// src/features/dashboard/WeatherCard.jsx
// Warehouse weather + 5-day outlook for the dashboard. Data comes from the
// /.netlify/functions/weather proxy (Open-Meteo), so no API key touches the browser.
import { useState, useEffect } from "react";
import {
  Sun,
  CloudSun,
  Cloudy,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudLightning,
  Thermometer,
  Wind,
  Droplets,
  AlertTriangle,
} from "lucide-react";
import { translations } from "@/shared/utils/translations";
import { C } from "@/shared/utils/helpers";
import { getAccessToken } from "@/shared/utils/supabase";
import { Spinner, Card, Row, Text } from "@/shared/components/UIPrimitives";

// WMO weather code -> { icon, label }.
function describeWeather(code) {
  if (code === 0) return { icon: Sun, label: "Clear" };
  if (code === 1) return { icon: CloudSun, label: "Mainly Clear" };
  if (code === 2) return { icon: Cloudy, label: "Partly Cloudy" };
  if (code === 3) return { icon: Cloud, label: "Overcast" };
  if (code === 45 || code === 48) return { icon: CloudFog, label: "Fog" };
  if (code >= 51 && code <= 57) return { icon: CloudDrizzle, label: "Drizzle" };
  if (code >= 61 && code <= 67) return { icon: CloudRain, label: "Rain" };
  if (code >= 71 && code <= 77) return { icon: CloudSnow, label: "Snow" };
  if (code >= 80 && code <= 82) return { icon: CloudRainWind, label: "Rain Showers" };
  if (code === 85 || code === 86) return { icon: CloudSnow, label: "Snow Showers" };
  if (code >= 95) return { icon: CloudLightning, label: "Thunderstorm" };
  return { icon: Thermometer, label: "—" };
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function WeatherCard({ lang = "en" }) {
  const t = translations[lang] || translations.en;
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const res = await fetch("/.netlify/functions/weather", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
        if (!cancelled) setState({ loading: false, error: null, data: json });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const header = (
    <Row gap={2} justify="space-between" wrap style={{ marginBottom: 6 }}>
      <Text as="h3" size="xs" weight="extrabold" color={C.navy} style={{ margin: 0 }}>
        {t.wcTitle}
      </Text>
      <Text as="span" size="2xs" weight="semibold" color={C.sub}>
        Saint Joe Road · Fort Wayne, IN
      </Text>
    </Row>
  );

  if (state.loading) {
    return (
      <Card pad="var(--space-4)" style={{ borderRadius: "var(--radius-lg)" }}>
        {header}
        <Row
          gap={2}
          justify="center"
          style={{ padding: "6px 0", color: C.sub, fontSize: "var(--text-xs)" }}
        >
          <Spinner size={13} /> {t.wcLoading}
        </Row>
      </Card>
    );
  }

  if (state.error || !state.data?.current || !state.data?.daily) {
    return (
      <Card pad="var(--space-4)" style={{ borderRadius: "var(--radius-lg)" }}>
        {header}
        <div style={{ color: C.sub, fontSize: "var(--text-xs)", padding: "4px 0" }}>
          {t.wcUnavailable}
        </div>
      </Card>
    );
  }

  const { current, daily } = state.data;
  const cur = describeWeather(current.weather_code);
  const todayRain = daily.precipitation_probability_max?.[0] ?? 0;
  const todayWind = daily.wind_speed_10m_max?.[0] ?? 0;

  // Roofing-relevant advisory: rain or high wind makes roof work risky.
  const advisory =
    todayRain >= 50
      ? { text: `Rain likely (${todayRain}%) — plan roof work around it.`, color: C.blue, bg: C.sB }
      : todayWind >= 25
        ? {
            text: `High winds (${Math.round(todayWind)} mph) — caution on roofs.`,
            color: C.am,
            bg: C.aB,
          }
        : null;

  return (
    <Card pad="var(--space-4)" style={{ borderRadius: "var(--radius-lg)" }}>
      {header}

      {/* Current conditions — single compact row */}
      <Row style={{ marginBottom: 8 }}>
        <cur.icon size={22} color={C.navy} strokeWidth={1.75} aria-hidden="true" />
        <Text
          as="span"
          size="xl"
          weight="black"
          color={C.navy}
          style={{ lineHeight: 1, fontVariantNumeric: "tabular-nums" }}
        >
          {Math.round(current.temperature_2m)}°
        </Text>
        <Text as="span" size="2xs" weight="semibold" color={C.sub}>
          {cur.label}
        </Text>
        <Row
          as="span"
          gap="3px"
          style={{ marginLeft: "auto", fontSize: "var(--text-2xs)", color: C.sub }}
        >
          <Wind size={11} aria-hidden="true" /> {Math.round(current.wind_speed_10m)} ·{" "}
          <Droplets size={11} aria-hidden="true" /> {todayRain}%
        </Row>
      </Row>

      {advisory && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            background: advisory.bg,
            color: advisory.color,
            borderRadius: "var(--radius-sm)",
            padding: "4px 8px",
            fontSize: "var(--text-2xs)",
            fontWeight: "var(--weight-bold)",
            marginBottom: 8,
          }}
        >
          <AlertTriangle size={12} aria-hidden="true" /> {advisory.text}
        </div>
      )}

      {/* 5-day outlook — one line per day */}
      <Row gap={1} align="stretch" style={{ overflowX: "auto" }}>
        {daily.time.map((iso, i) => {
          const d = describeWeather(daily.weather_code[i]);
          const date = new Date(iso + "T00:00:00");
          const isToday = i === 0;
          return (
            <div
              key={iso}
              style={{
                flex: 1,
                minWidth: 44,
                textAlign: "center",
                padding: "3px 2px",
                borderRadius: "var(--radius-sm)",
                background: isToday ? C.lg : "transparent",
              }}
            >
              <Text size="2xs" weight="bold" color={C.sub}>
                {isToday ? "Today" : DAY[date.getDay()]}
              </Text>
              <Row gap={0} align="stretch" justify="center" style={{ lineHeight: 1.2 }}>
                <d.icon size={15} color={C.navy} strokeWidth={1.75} aria-hidden="true" />
              </Row>
              <Text size="2xs" style={{ fontVariantNumeric: "tabular-nums" }}>
                <Text as="span" weight="bold" color={C.navy}>
                  {Math.round(daily.temperature_2m_max[i])}°
                </Text>
                <Text as="span" color={C.sub}>
                  /{Math.round(daily.temperature_2m_min[i])}°
                </Text>
              </Text>
            </div>
          );
        })}
      </Row>
    </Card>
  );
}
