// src/components/WeatherCard.jsx
// Warehouse weather + 5-day outlook for the dashboard. Data comes from the
// /.netlify/functions/weather proxy (Open-Meteo), so no API key touches the browser.
import { useState, useEffect } from "react";
import { C } from "../utils/helpers";
import { getAccessToken } from "../utils/supabase";
import { Spinner } from "./UIPrimitives";

// WMO weather code -> { icon, label }. Emoji match the app's existing icon style.
function describeWeather(code) {
  if (code === 0) return { icon: "☀️", label: "Clear" };
  if (code === 1) return { icon: "🌤️", label: "Mainly Clear" };
  if (code === 2) return { icon: "⛅", label: "Partly Cloudy" };
  if (code === 3) return { icon: "☁️", label: "Overcast" };
  if (code === 45 || code === 48) return { icon: "🌫️", label: "Fog" };
  if (code >= 51 && code <= 57) return { icon: "🌦️", label: "Drizzle" };
  if (code >= 61 && code <= 67) return { icon: "🌧️", label: "Rain" };
  if (code >= 71 && code <= 77) return { icon: "🌨️", label: "Snow" };
  if (code >= 80 && code <= 82) return { icon: "🌧️", label: "Rain Showers" };
  if (code === 85 || code === 86) return { icon: "🌨️", label: "Snow Showers" };
  if (code >= 95) return { icon: "⛈️", label: "Thunderstorm" };
  return { icon: "🌡️", label: "—" };
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const cardStyle = {
  background: C.w,
  borderRadius: "var(--radius-lg)",
  padding: 10,
  border: `1px solid ${C.bd}`,
  boxShadow: "var(--shadow-xs)",
};

export default function WeatherCard() {
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
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: "var(--space-2)" }}>
      <h3 style={{ margin: 0, fontSize: "var(--text-xs)", fontWeight: "var(--weight-extrabold)", color: C.navy }}>
        🌤️ Warehouse Weather
      </h3>
      <span style={{ fontSize: "var(--text-2xs)", color: C.sub, fontWeight: "var(--weight-semibold)" }}>
        Saint Joe Road · Fort Wayne, IN
      </span>
    </div>
  );

  if (state.loading) {
    return (
      <div style={cardStyle}>
        {header}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-2)", padding: "6px 0", color: C.sub, fontSize: "var(--text-xs)" }}>
          <Spinner size={13} /> Loading forecast…
        </div>
      </div>
    );
  }

  if (state.error || !state.data?.current || !state.data?.daily) {
    return (
      <div style={cardStyle}>
        {header}
        <div style={{ color: C.sub, fontSize: "var(--text-xs)", padding: "4px 0" }}>
          Weather is unavailable right now.
        </div>
      </div>
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
        ? { text: `High winds (${Math.round(todayWind)} mph) — caution on roofs.`, color: C.am, bg: C.aB }
        : null;

  return (
    <div style={cardStyle}>
      {header}

      {/* Current conditions — single compact row */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: 8 }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{cur.icon}</span>
        <span style={{ fontSize: "var(--text-xl)", fontWeight: "var(--weight-black)", color: C.navy, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {Math.round(current.temperature_2m)}°
        </span>
        <span style={{ fontSize: "var(--text-2xs)", color: C.sub, fontWeight: "var(--weight-semibold)" }}>{cur.label}</span>
        <span style={{ marginLeft: "auto", fontSize: "var(--text-2xs)", color: C.sub }}>
          💨 {Math.round(current.wind_speed_10m)} · 💧 {todayRain}%
        </span>
      </div>

      {advisory && (
        <div style={{ background: advisory.bg, color: advisory.color, borderRadius: "var(--radius-sm)", padding: "4px 8px", fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", marginBottom: 8 }}>
          ⚠️ {advisory.text}
        </div>
      )}

      {/* 5-day outlook — one line per day */}
      <div style={{ display: "flex", gap: "var(--space-1)", overflowX: "auto" }}>
        {daily.time.map((iso, i) => {
          const d = describeWeather(daily.weather_code[i]);
          const date = new Date(iso + "T00:00:00");
          const isToday = i === 0;
          return (
            <div key={iso} style={{ flex: 1, minWidth: 44, textAlign: "center", padding: "3px 2px", borderRadius: "var(--radius-sm)", background: isToday ? C.lg : "transparent" }}>
              <div style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-bold)", color: C.sub }}>
                {isToday ? "Today" : DAY[date.getDay()]}
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.2 }}>{d.icon}</div>
              <div style={{ fontSize: "var(--text-2xs)", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ fontWeight: "var(--weight-bold)", color: C.navy }}>{Math.round(daily.temperature_2m_max[i])}°</span>
                <span style={{ color: C.sub }}>/{Math.round(daily.temperature_2m_min[i])}°</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
