/* ═══════════════════════════════════════════════════════════════
   Weather API — hourly forecast for the organization's city.
   Uses Open-Meteo (free, no API key): geocoding + hourly forecast.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export interface HourlyWeather {
  time: string;        // ISO hour
  tempC: number;       // temperature in °C
  code: number;        // WMO weather code
  isDay: boolean;
  precipProb: number;  // precipitation probability %
}

export interface WeatherForecast {
  city: string;
  hours: HourlyWeather[];
}

// Read the org's city (fallback to address). Coordinates aren't stored on the
// org, so we geocode the city name with Open-Meteo's free geocoding API.
async function getOrgLocation(): Promise<{ city: string; lat: number; lng: number } | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('orgs')
    .select('city, address, postal_code')
    .eq('id', orgId)
    .maybeSingle();
  if (error || !data) return null;

  const query = String(data.city || data.address || '').trim();
  if (!query) return null;

  const geoUrl =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=fr&format=json`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) return null;
  const geo = await geoRes.json();
  const hit = geo?.results?.[0];
  if (!hit) return null;

  return { city: hit.name || query, lat: hit.latitude, lng: hit.longitude };
}

/**
 * Fetch the hourly forecast for the org's city. Returns the current hour plus
 * the next `hours` hours. Null if the city can't be resolved.
 */
export async function getOrgHourlyWeather(hours = 12): Promise<WeatherForecast | null> {
  const loc = await getOrgLocation();
  if (!loc) return null;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}` +
    `&hourly=temperature_2m,weather_code,is_day,precipitation_probability` +
    `&timezone=auto&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  const h = data?.hourly;
  if (!h?.time?.length) return null;

  // Find the index of the current hour (or the next available one).
  const nowMs = Date.now();
  const times: string[] = h.time;
  let start = times.findIndex((t) => new Date(t).getTime() >= nowMs - 30 * 60_000);
  if (start < 0) start = 0;

  const slice: HourlyWeather[] = [];
  for (let i = start; i < Math.min(start + hours, times.length); i += 1) {
    slice.push({
      time: times[i],
      tempC: Math.round(Number(h.temperature_2m?.[i] ?? 0)),
      code: Number(h.weather_code?.[i] ?? 0),
      isDay: Number(h.is_day?.[i] ?? 1) === 1,
      precipProb: Math.round(Number(h.precipitation_probability?.[i] ?? 0)),
    });
  }

  return { city: loc.city, hours: slice };
}

// WMO weather code → emoji + short label (fr/en). Day/night aware for clear sky.
export function weatherIcon(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code <= 2) return isDay ? '🌤️' : '☁️';
  if (code === 3) return '☁️';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}
