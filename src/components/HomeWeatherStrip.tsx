/**
 * HomeWeatherStrip — a slim hourly-weather band across the top of the Home page.
 * Shows the org city's forecast hour by hour (Open-Meteo, free, no key).
 * Renders nothing if the org has no resolvable city.
 */
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { useTranslation } from '../i18n';
import { getOrgHourlyWeather, weatherIcon } from '../lib/weatherApi';

export default function HomeWeatherStrip() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const { data, isLoading } = useQuery({
    queryKey: ['home-weather'],
    queryFn: () => getOrgHourlyWeather(12),
    staleTime: 30 * 60_000, // 30 min — weather doesn't change fast
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="mb-6 h-[76px] rounded-2xl bg-surface-secondary/60 animate-pulse" />
    );
  }

  // No city on the org (or fetch failed) → don't clutter the home.
  if (!data || data.hours.length === 0) return null;

  const hourFmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString(fr ? 'fr-CA' : 'en-CA', { hour: 'numeric', hour12: !fr });
  };

  return (
    <div className="mb-6 rounded-2xl border border-outline bg-surface px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <MapPin size={13} className="text-text-tertiary" />
        <span className="text-[12px] font-semibold text-text-secondary">
          {fr ? 'Météo' : 'Weather'} · {data.city}
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {data.hours.map((h, i) => (
          <div
            key={h.time}
            className="flex min-w-[58px] flex-col items-center gap-0.5 rounded-xl bg-surface-secondary/60 px-2 py-2"
          >
            <span className="text-[11px] font-medium text-text-tertiary">
              {i === 0 ? (fr ? 'Maint.' : 'Now') : hourFmt(h.time)}
            </span>
            <span className="text-[20px] leading-none">{weatherIcon(h.code, h.isDay)}</span>
            <span className="text-[13px] font-bold text-text-primary">{h.tempC}°</span>
            {h.precipProb >= 30 ? (
              <span className="text-[10px] font-medium text-blue-500">{h.precipProb}%</span>
            ) : (
              <span className="text-[10px]">&nbsp;</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
