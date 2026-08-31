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
  precipMm: number;    // precipitation amount (mm)
  windKmh: number;     // wind speed km/h
}

export interface WeatherForecast {
  city: string;
  hours: HourlyWeather[];
  todayMaxC: number;
  todayMinC: number;
  todayPrecipMm: number;   // total precipitation today (mm)
  todayMaxWindKmh: number; // peak wind gust-ish today (km/h)
}

// Normalize for accent/case-insensitive comparison ("Québec" === "quebec").
function normalizePlace(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

// Canadian province abbreviations → full names, so "QC" matches admin1 "Québec".
const CA_PROVINCES: Record<string, string> = {
  qc: 'quebec', on: 'ontario', bc: 'british columbia', ab: 'alberta',
  mb: 'manitoba', sk: 'saskatchewan', ns: 'nova scotia', nb: 'new brunswick',
  nl: 'newfoundland and labrador', pe: 'prince edward island',
  yt: 'yukon', nt: 'northwest territories', nu: 'nunavut',
};

// Read the org's city (fallback to address). Coordinates aren't stored on the
// org, so we geocode the city name with Open-Meteo's free geocoding API.
// Homonyms are common (e.g. Wickham exists in Australia, England AND Québec),
// so we fetch several candidates and pick the one matching the org's
// province/country instead of blindly taking the first result.
async function getOrgLocation(): Promise<{ city: string; lat: number; lng: number; countryCode: string } | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  // The company's address lives in company_settings (not orgs).
  const { data, error } = await supabase
    .from('company_settings')
    .select('city, street1, postal_code, province, country')
    .eq('org_id', orgId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  const query = String(data.city || data.street1 || '').trim();
  if (!query) return null;

  const geoUrl =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=fr&format=json`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) return null;
  const geo = await geoRes.json();
  const results: any[] = geo?.results || [];
  if (!results.length) return null;

  const rawProvince = normalizePlace(String(data.province || ''));
  const wantProvince = CA_PROVINCES[rawProvince] || rawProvince;
  const wantCountry = normalizePlace(String(data.country || ''));

  let hit = results[0];
  let bestScore = -1;
  for (const r of results) {
    const admin1 = normalizePlace(String(r.admin1 || ''));
    const country = normalizePlace(String(r.country || ''));
    const cc = normalizePlace(String(r.country_code || ''));
    let score = 0;
    if (wantProvince && (admin1 === wantProvince || admin1.includes(wantProvince) || wantProvince.includes(admin1))) score += 3;
    if (wantCountry && (country === wantCountry || cc === wantCountry)) score += 2;
    if (score > bestScore) { bestScore = score; hit = r; }
  }

  return {
    city: hit.name || query,
    lat: hit.latitude,
    lng: hit.longitude,
    countryCode: String(hit.country_code || '').toUpperCase(),
  };
}

/**
 * Fetch the hourly forecast for the org's city. Returns the current hour plus
 * the next `hours` hours. Null if the city can't be resolved.
 */
export async function getOrgHourlyWeather(hours = 12): Promise<WeatherForecast | null> {
  const loc = await getOrgLocation();
  if (!loc) return null;

  // For Canadian orgs, force Environment Canada's GEM models (incl. HRDPS,
  // 2.5 km resolution) instead of the generic global blend — precipitation is
  // dramatically more accurate. Elsewhere, keep Open-Meteo's best match.
  const models = loc.countryCode === 'CA' ? '&models=gem_seamless' : '';
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}` +
    `&hourly=temperature_2m,weather_code,is_day,precipitation_probability,precipitation,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
    `&timezone=auto&forecast_days=2${models}`;
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
      precipMm: Math.round(Number(h.precipitation?.[i] ?? 0) * 10) / 10,
      windKmh: Math.round(Number(h.wind_speed_10m?.[i] ?? 0)),
    });
  }

  const d = data?.daily;
  return {
    city: loc.city,
    hours: slice,
    todayMaxC: Math.round(Number(d?.temperature_2m_max?.[0] ?? slice[0]?.tempC ?? 0)),
    todayMinC: Math.round(Number(d?.temperature_2m_min?.[0] ?? slice[0]?.tempC ?? 0)),
    todayPrecipMm: Math.round(Number(d?.precipitation_sum?.[0] ?? 0) * 10) / 10,
    todayMaxWindKmh: Math.round(Number(d?.wind_speed_10m_max?.[0] ?? 0)),
  };
}

/**
 * Outdoor-work verdict for service crews (window cleaning, exterior work…).
 * Based on today's rain and peak wind. Returns a level + short label.
 */
export function outdoorWorkVerdict(
  precipMm: number,
  maxWindKmh: number,
  fr: boolean,
): { level: 'good' | 'ok' | 'bad'; label: string } {
  if (precipMm >= 5 || maxWindKmh >= 45) {
    return { level: 'bad', label: fr ? 'Peu propice au travail' : 'Poor for outdoor work' };
  }
  if (precipMm >= 1 || maxWindKmh >= 30) {
    return { level: 'ok', label: fr ? 'Conditions variables' : 'Variable conditions' };
  }
  return { level: 'good', label: fr ? 'Bon pour travailler' : 'Good for outdoor work' };
}

// WMO weather code → short human label (fr/en).
export function weatherLabel(code: number, fr: boolean): string {
  if (code === 0) return fr ? 'Ciel dégagé' : 'Clear sky';
  if (code <= 2) return fr ? 'Peu nuageux' : 'Partly cloudy';
  if (code === 3) return fr ? 'Couvert' : 'Overcast';
  if (code >= 45 && code <= 48) return fr ? 'Brouillard' : 'Fog';
  if (code >= 51 && code <= 57) return fr ? 'Bruine' : 'Drizzle';
  if (code >= 61 && code <= 67) return fr ? 'Pluie' : 'Rain';
  if (code >= 71 && code <= 77) return fr ? 'Neige' : 'Snow';
  if (code >= 80 && code <= 82) return fr ? 'Averses' : 'Showers';
  if (code >= 85 && code <= 86) return fr ? 'Averses de neige' : 'Snow showers';
  if (code >= 95) return fr ? 'Orage' : 'Thunderstorm';
  return fr ? 'Variable' : 'Variable';
}

// WMO weather code → emoji + short label (fr/en). Day/night aware for clear sky.
export function weatherIcon(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code === 1) return isDay ? '🌤️' : '🌙';
  if (code === 2) return isDay ? '⛅' : '☁️';
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
