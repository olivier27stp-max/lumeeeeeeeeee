/**
 * HomeWeatherStrip — a full-width weather block across the top of the Home page.
 * Left: the current conditions in large type. Right: the next hours spread
 * across the full width. Org city's forecast (Open-Meteo, free, no key).
 * Renders nothing if the org has no resolvable city.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Wind, Droplets, ArrowUp, ArrowDown } from 'lucide-react';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import { getOrgHourlyWeather, weatherIcon, weatherLabel, outdoorWorkVerdict } from '../lib/weatherApi';

export default function HomeWeatherStrip() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  // La météo dépend de la ville du PROFIL (chaque employé voit son coin, cf.
  // weatherApi.getOrgLocation). La clé de cache DOIT donc porter l'id de
  // l'utilisateur : sans lui, la clé « home-weather » était partagée, et le
  // premier user à charger figeait sa météo pour tous les suivants sur le même
  // navigateur pendant 30 min (bug « la météo ne concorde pas / n'est pas la
  // mienne »).
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['home-weather', userId],
    queryFn: () => getOrgHourlyWeather(12),
    enabled: userId !== null,
    staleTime: 30 * 60_000, // 30 min — weather doesn't change fast
    refetchOnWindowFocus: false,
  });

  // Squelette tant qu'on résout l'utilisateur ou qu'on charge la météo. On ne
  // se fie pas à `isLoading` : la query étant `enabled` seulement une fois
  // l'user connu, il faut aussi couvrir la résolution de l'user.
  if (userId === null || (isFetching && !data)) {
    return <div className="mb-6 h-[140px] w-full rounded-2xl bg-surface-secondary/60 animate-pulse" />;
  }

  // No city on the org (or fetch failed) → don't clutter the home.
  if (!data || data.hours.length === 0) return null;

  const now = data.hours[0];
  const rest = data.hours.slice(1);
  const verdict = outdoorWorkVerdict(data.todayPrecipMm, data.todayMaxWindKmh, fr);
  const verdictDot =
    verdict.level === 'good' ? 'bg-green-500' : verdict.level === 'ok' ? 'bg-amber-500' : 'bg-red-500';

  const hourFmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString(fr ? 'fr-CA' : 'en-CA', { hour: 'numeric', hour12: !fr });
  };

  return (
    <div className="mb-6 w-full overflow-hidden rounded-2xl border border-outline bg-gradient-to-br from-sky-50 to-blue-100/60 dark:from-slate-800 dark:to-slate-900">
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-stretch">
        {/* Current conditions — big */}
        <div className="flex items-center gap-4 md:w-[280px] md:shrink-0 md:border-r md:border-outline/40 md:pr-5">
          <span className="text-[56px] leading-none">{weatherIcon(now.code, now.isDay)}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[12px] font-semibold text-text-secondary">
              <MapPin size={12} /> {data.city}
            </div>
            <div className="text-[44px] font-bold leading-none text-text-primary">{now.tempC}°</div>
            <div className="text-[13px] font-medium text-text-secondary">{weatherLabel(now.code, fr)}</div>

            {/* Compact useful stats for field crews */}
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-medium text-text-tertiary">
              <span className="inline-flex items-center gap-0.5">
                <ArrowUp size={11} className="text-red-500" />{data.todayMaxC}°
                <ArrowDown size={11} className="ml-0.5 text-blue-500" />{data.todayMinC}°
              </span>
              <span className="inline-flex items-center gap-0.5"><Wind size={11} />{data.todayMaxWindKmh}<span className="text-[9px]">km/h</span></span>
              <span className="inline-flex items-center gap-0.5"><Droplets size={11} className="text-blue-500" />{data.todayPrecipMm}<span className="text-[9px]">mm</span></span>
            </div>
            <div className="mt-1 inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${verdictDot}`} />
              <span className="text-[11px] font-semibold text-text-secondary">{verdict.label}</span>
            </div>
          </div>
        </div>

        {/* Next hours — spread across the remaining width */}
        <div className="flex flex-1 gap-1 overflow-x-auto md:grid md:auto-cols-fr md:grid-flow-col md:overflow-visible">
          {rest.map((h) => (
            <div
              key={h.time}
              className="flex min-w-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 hover:bg-white/40 dark:hover:bg-white/5"
            >
              <span className="text-[12px] font-medium text-text-tertiary">{hourFmt(h.time)}</span>
              <span className="text-[26px] leading-none">{weatherIcon(h.code, h.isDay)}</span>
              <span className="text-[16px] font-bold text-text-primary">{h.tempC}°</span>
              <span className="text-[11px] font-medium text-blue-500">
                {h.precipMm >= 0.2 ? `${h.precipMm} mm` : h.precipProb >= 30 ? `${h.precipProb}%` : ' '}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
