/**
 * Revenue heatmap + zone analytics — the real map the prototype could only mock.
 * Renders scheduled jobs for the selected period on a monochrome Leaflet basemap
 * (Carto light/dark) with a revenue-weighted heat layer, plus a stats strip and a
 * "top paying zones" ranking clustered automatically by city (from the address).
 * Reuses the app's Leaflet + leaflet.heat stack (leaflet CSS is in main.tsx).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../i18n';
import { fetchMapJobsInRange } from '../../lib/mapApi';
import PeriodSelector from './PeriodSelector';
import { type InsightsPeriod, type InsightsRange } from '../../lib/insightsPeriod';

const DEFAULT_CENTER: L.LatLngTuple = [45.5017, -73.5673];
const DEFAULT_ZOOM = 10;
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';
const GRAD_LIGHT = { 0.1: '#c4c4c4', 0.35: '#8a8a8a', 0.65: '#4a4a4a', 1.0: '#171717' };
const GRAD_DARK = { 0.1: '#4a4a52', 0.35: '#7d7d86', 0.65: '#c0c0c6', 1.0: '#fafafa' };

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/** Best-effort city name from a Québec-style address ("123 Rue X, Beloeil, QC J3G 1A1"). */
function cityFromAddress(addr?: string | null): string | null {
  if (!addr) return null;
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    let p = parts[i];
    if (/^\d/.test(p)) continue;
    if (/^(qc|q[ée]bec|quebec|canada|on|ontario|ca)$/i.test(p)) continue;
    if (/^[A-Za-z]\d[A-Za-z]/.test(p)) continue; // postal code
    p = p.replace(/\b(QC|Q[ée]bec|Quebec|Canada)\b/gi, '').replace(/[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d/g, '').trim();
    if (p) return p;
  }
  return null;
}

/** Heat layer via dynamic import of leaflet.heat (same approach as FieldSales). */
function HeatLayer({ points, dark }: { points: [number, number, number][]; dark: boolean }) {
  const map = useMap();
  const layerRef = useRef<L.Layer | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if ((L as unknown as { heatLayer?: unknown }).heatLayer) { setLoaded(true); return; }
    import('leaflet.heat').then(() => setLoaded(true)).catch(() => setLoaded(false));
  }, []);

  useEffect(() => {
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    const heat = (L as unknown as { heatLayer?: (p: unknown, o: unknown) => L.Layer }).heatLayer;
    if (!loaded || points.length === 0 || !heat) return;
    layerRef.current = heat(points, { radius: 45, blur: 30, maxZoom: 15, max: 1.0, minOpacity: 0.35, gradient: dark ? GRAD_DARK : GRAD_LIGHT }).addTo(map);
    return () => { if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; } };
  }, [map, points, loaded, dark]);

  return null;
}

function FitBounds({ points }: { points: [number, number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const b = L.latLngBounds(points.map((p) => [p[0], p[1]] as L.LatLngTuple));
    map.fitBounds(b, { padding: [40, 40], maxZoom: 12 });
  }, [points, map]);
  return null;
}

export default function ZonesHeatmapCard({
  range,
  period,
  onPeriod,
}: {
  range: InsightsRange;
  period: InsightsPeriod;
  onPeriod: (p: InsightsPeriod) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const dark = useIsDark();

  const q = useQuery({
    queryKey: ['zones-heat', range.from, range.to],
    queryFn: () => fetchMapJobsInRange(`${range.from}T00:00:00.000Z`, `${range.to}T23:59:59.999Z`),
    staleTime: 60_000,
  });

  const kc = (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);

  const { points, stats } = useMemo(() => {
    const pins = (q.data?.pins || []).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !(p.latitude === 0 && p.longitude === 0));
    const max = Math.max(1, ...pins.map((p) => p.totalCents || 0));
    const points = pins.map((p) => [p.latitude, p.longitude, Math.max(0.35, (p.totalCents || 0) / max)] as [number, number, number]);

    const totalRev = pins.reduce((s, p) => s + (p.totalCents || 0), 0);
    const byZone = new Map<string, { rev: number; jobs: number }>();
    for (const p of pins) {
      const name = cityFromAddress(p.address) || (fr ? 'Autres' : 'Other');
      const e = byZone.get(name) || { rev: 0, jobs: 0 };
      e.rev += p.totalCents || 0; e.jobs += 1;
      byZone.set(name, e);
    }
    const zones = Array.from(byZone.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.rev - a.rev);
    return { points, stats: { totalRev, jobs: pins.length, avg: pins.length ? totalRev / pins.length : 0, zoneCount: zones.length, topZones: zones.slice(0, 5) } };
  }, [q.data, fr]);

  const empty = !q.isLoading && stats.jobs === 0;
  const zoneMax = Math.max(1, ...stats.topZones.map((z) => z.rev));

  return (
    <div className="flex flex-col">
      <div className="flex items-end justify-between gap-3 px-6 pb-3 border-b border-border">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary leading-none">{fr ? 'Carte thermique du revenu' : 'Revenue heatmap'}</div>
        <PeriodSelector value={period} onChange={onPeriod} />
      </div>

      {/* stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 px-6 pt-4">
        {[
          { v: kc(stats.totalRev), l: fr ? 'Revenu cartographié' : 'Mapped revenue' },
          { v: String(stats.jobs), l: fr ? 'Jobs géocodés' : 'Geocoded jobs' },
          { v: kc(stats.avg), l: fr ? 'Revenu moy. / job' : 'Avg revenue / job' },
          { v: String(stats.zoneCount), l: fr ? 'Zones actives' : 'Active zones' },
        ].map((s, i) => (
          <div key={i}>
            <div className="text-[22px] font-bold tracking-tight leading-none tabular-nums text-text-primary">{s.v}</div>
            <div className="text-[11.5px] text-text-tertiary font-medium mt-1.5">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 px-6 pt-5 pb-2">
        {/* map */}
        <div className="lg:col-span-2 relative isolate h-[380px] rounded-xl overflow-hidden border border-border">
          <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="h-full w-full" zoomControl={false} attributionControl={false} style={{ background: dark ? '#0a0a0a' : '#f0f0f0' }}>
            <TileLayer url={dark ? TILE_DARK : TILE_LIGHT} attribution={TILE_ATTR} maxZoom={19} />
            <HeatLayer points={points} dark={dark} />
            <FitBounds points={points} />
          </MapContainer>
          <div className="absolute right-3 bottom-3 z-[500] rounded-lg border border-border bg-surface-card/90 backdrop-blur px-3 py-2.5 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-text-tertiary font-bold mb-1.5">{fr ? 'Revenu' : 'Revenue'}</div>
            <div className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(90deg, var(--color-surface-tertiary), var(--color-text-primary))' }} />
            <div className="flex justify-between text-[9.5px] font-semibold text-text-tertiary mt-1"><span>{fr ? 'Faible' : 'Low'}</span><span>{fr ? 'Élevé' : 'High'}</span></div>
          </div>
          {empty && (
            <div className="absolute inset-0 z-[400] flex items-center justify-center bg-surface-card/70 backdrop-blur-sm">
              <div className="text-center px-6">
                <div className="text-[13px] font-semibold text-text-secondary">{fr ? 'Aucun job géocodé sur la période' : 'No geocoded jobs for this period'}</div>
                <div className="text-[11.5px] text-text-tertiary mt-1.5 max-w-[280px]">{fr ? 'Les jobs planifiés avec une adresse géocodée apparaîtront ici, colorés selon le revenu.' : 'Scheduled jobs with a geocoded address appear here, shaded by revenue.'}</div>
              </div>
            </div>
          )}
        </div>

        {/* top zones */}
        <div className="flex flex-col">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-tertiary mb-1">{fr ? 'Zones les plus payantes' : 'Top paying zones'}</div>
          {empty ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-text-tertiary">{fr ? 'Aucune donnée' : 'No data'}</div>
          ) : (
            <div className="flex flex-col">
              {stats.topZones.map((z, i) => (
                <div key={z.name} className="py-2.5 border-b border-border-light last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold text-text-primary truncate">{i + 1}. {z.name}</span>
                    <span className="text-[13px] font-bold text-text-primary tabular-nums shrink-0">{kc(z.rev)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-tertiary overflow-hidden mt-2"><span className="block h-full rounded-full" style={{ width: `${Math.round((z.rev / zoneMax) * 100)}%`, background: 'var(--color-text-primary)' }} /></div>
                  <div className="text-[11px] text-text-tertiary font-semibold mt-1.5">{z.jobs} {z.jobs > 1 ? (fr ? 'jobs' : 'jobs') : 'job'} · {kc(z.jobs ? z.rev / z.jobs : 0)} {fr ? 'moy.' : 'avg'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
