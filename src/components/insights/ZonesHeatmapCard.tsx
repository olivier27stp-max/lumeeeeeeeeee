/**
 * Revenue heatmap — the real map the prototype could only mock. Renders scheduled
 * jobs for the selected period on a monochrome Leaflet basemap (Carto light/dark)
 * with a revenue-weighted heat layer (darker/brighter = more revenue). Reuses the
 * app's existing Leaflet + leaflet.heat stack (leaflet CSS is imported in main.tsx).
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

/** Fit the view to the points whenever they change. */
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
  const dark = useIsDark();

  const q = useQuery({
    queryKey: ['zones-heat', range.from, range.to],
    queryFn: () => fetchMapJobsInRange(`${range.from}T00:00:00.000Z`, `${range.to}T23:59:59.999Z`),
    staleTime: 60_000,
  });

  const points = useMemo<[number, number, number][]>(() => {
    const pins = q.data?.pins || [];
    const max = Math.max(1, ...pins.map((p) => p.totalCents || 0));
    return pins
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !(p.latitude === 0 && p.longitude === 0))
      .map((p) => [p.latitude, p.longitude, Math.max(0.35, (p.totalCents || 0) / max)] as [number, number, number]);
  }, [q.data]);

  const count = points.length;

  return (
    <div className="flex flex-col">
      <div className="flex items-end justify-between gap-3 px-6 pb-3 border-b border-border">
        <div className="flex items-baseline gap-2">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary leading-none">{fr ? 'Carte thermique du revenu' : 'Revenue heatmap'}</div>
          {!q.isLoading && <span className="text-[11.5px] font-semibold text-text-tertiary">· {count} {fr ? 'jobs géocodés' : 'geocoded jobs'}</span>}
        </div>
        <PeriodSelector value={period} onChange={onPeriod} />
      </div>

      <div className="relative isolate mt-4 h-[420px] rounded-xl overflow-hidden border border-border">
        <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="h-full w-full" zoomControl={false} attributionControl={false} style={{ background: dark ? '#0a0a0a' : '#f0f0f0' }}>
          <TileLayer url={dark ? TILE_DARK : TILE_LIGHT} attribution={TILE_ATTR} maxZoom={19} />
          <HeatLayer points={points} dark={dark} />
          <FitBounds points={points} />
        </MapContainer>

        {/* legend */}
        <div className="absolute right-3 bottom-3 z-[500] rounded-lg border border-border bg-surface-card/90 backdrop-blur px-3 py-2.5 shadow-sm">
          <div className="text-[10px] uppercase tracking-wide text-text-tertiary font-bold mb-1.5">{fr ? 'Revenu' : 'Revenue'}</div>
          <div className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(90deg, var(--color-surface-tertiary), var(--color-text-primary))' }} />
          <div className="flex justify-between text-[9.5px] font-semibold text-text-tertiary mt-1"><span>{fr ? 'Faible' : 'Low'}</span><span>{fr ? 'Élevé' : 'High'}</span></div>
        </div>

        {!q.isLoading && points.length === 0 && (
          <div className="absolute inset-0 z-[400] flex items-center justify-center bg-surface-card/70 backdrop-blur-sm">
            <div className="text-center px-6">
              <div className="text-[13px] font-semibold text-text-secondary">{fr ? 'Aucun job géocodé sur la période' : 'No geocoded jobs for this period'}</div>
              <div className="text-[11.5px] text-text-tertiary mt-1.5 max-w-[280px]">{fr ? 'Les jobs planifiés avec une adresse géocodée apparaîtront ici, colorés selon le revenu.' : 'Scheduled jobs with a geocoded address appear here, shaded by revenue.'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
