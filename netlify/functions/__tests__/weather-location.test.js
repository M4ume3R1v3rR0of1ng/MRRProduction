import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEATHER_LOCATION,
  parseWeatherLocation,
  resolveWeatherLocation,
  placeLabel,
  toPlaceResults,
} from "../_shared/weatherLocation.js";

describe("resolveWeatherLocation", () => {
  it("falls back to Fort Wayne when nothing is set", () => {
    const loc = resolveWeatherLocation({}, {});
    expect(loc).toMatchObject({ ...DEFAULT_WEATHER_LOCATION, isDefault: true });
  });

  it("prefers the location chosen in Settings over one set by hand", () => {
    const loc = resolveWeatherLocation(
      { weather: { lat: 41.66, lon: -83.55, timezone: "America/New_York", label: "Toledo, Ohio" } },
      { weather: { lat: 1, lon: 2 } },
    );
    expect(loc).toEqual({
      lat: 41.66,
      lon: -83.55,
      timezone: "America/New_York",
      label: "Toledo, Ohio",
      isDefault: false,
    });
  });

  it("still honours a location set by hand in integrations", () => {
    const loc = resolveWeatherLocation({}, { weather: { lat: 39.1, lon: -84.5 } });
    expect(loc).toMatchObject({ lat: 39.1, lon: -84.5, timezone: "auto", isDefault: false });
    // Labelled by its coordinates, never by Fort Wayne's name.
    expect(loc.label).toBe("39.10, -84.50");
  });

  it("ignores a stored location that could tamper with the forecast URL", () => {
    const loc = resolveWeatherLocation(
      { weather: { lat: "41&daily=x", lon: -83.5, label: "Bad" } },
      {},
    );
    expect(loc.isDefault).toBe(true);
  });
});

describe("parseWeatherLocation", () => {
  it("rejects out-of-range coordinates", () => {
    expect(parseWeatherLocation({ lat: 91, lon: 0 })).toBeNull();
    expect(parseWeatherLocation({ lat: 0, lon: 181 })).toBeNull();
    expect(parseWeatherLocation({ lat: NaN, lon: 0 })).toBeNull();
  });

  it("replaces a malformed timezone with auto", () => {
    expect(parseWeatherLocation({ lat: 1, lon: 1, timezone: "x&y=z" }).timezone).toBe("auto");
    expect(parseWeatherLocation({ lat: 1, lon: 1, timezone: "America/Chicago" }).timezone).toBe(
      "America/Chicago",
    );
  });
});

describe("place search results", () => {
  it("names US places by state and foreign ones by country too", () => {
    expect(
      placeLabel({ name: "Toledo", admin1: "Ohio", country_code: "US", country: "United States" }),
    ).toBe("Toledo, Ohio");
    expect(
      placeLabel({ name: "Windsor", admin1: "Ontario", country_code: "CA", country: "Canada" }),
    ).toBe("Windsor, Ontario, Canada");
  });

  it("maps Open-Meteo geocoding results and drops unusable ones", () => {
    const out = toPlaceResults({
      results: [
        {
          name: "Toledo",
          admin1: "Ohio",
          country_code: "US",
          latitude: 41.66394,
          longitude: -83.55521,
          timezone: "America/New_York",
          postcodes: ["43601", "43603", "43604", "43605"],
        },
        { name: "Nowhere", latitude: null, longitude: 5 },
      ],
    });
    expect(out).toEqual([
      {
        lat: 41.66394,
        lon: -83.55521,
        timezone: "America/New_York",
        label: "Toledo, Ohio",
        postcodes: ["43601", "43603", "43604"],
      },
    ]);
  });

  it("handles an empty search", () => {
    expect(toPlaceResults({})).toEqual([]);
  });
});
