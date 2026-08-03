/**
 * Revenue by city — a proportional-symbol map: one monochrome circle per city on
 * a Leaflet basemap, sized & shaded by the revenue realized there. Hover a city →
 * a themed bubble shows how much you made and how many jobs; the top cities carry
 * permanent labels. Framed color legend (revenue buckets). Only realized jobs
 * count. Reuses the app's Leaflet stack (leaflet CSS is imported in main.tsx).
 */
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../i18n';
import { fetchMapJobsInRange } from '../../lib/mapApi';
import PeriodSelector from './PeriodSelector';
import { type InsightsPeriod, type InsightsRange } from '../../lib/insightsPeriod';

const DEFAULT_CENTER: L.LatLngTuple = [45.5017, -73.5673];
const DEFAULT_ZOOM = 9;
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';
const OPACITIES = [0.3, 0.45, 0.6, 0.78, 0.95];
const MAP_CSS = `
.leaflet-tooltip.zone-tip{background:var(--color-surface-card);color:var(--color-text-primary);border:1px solid var(--color-border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.22);padding:7px 11px;font-weight:600;font-family:inherit;}
.leaflet-tooltip.zone-tip::before{display:none;}
.zone-name{background:transparent!important;border:0!important;box-shadow:none!important;}
.zone-name>div{transform:translateY(-15px);font-weight:800;font-size:11px;letter-spacing:-.01em;color:var(--color-text-primary);white-space:nowrap;text-shadow:0 0 3px var(--color-surface),0 1px 2px var(--color-surface),0 0 2px var(--color-surface);}
`;

function isDone(status?: string | null): boolean {
  const s = String(status || '').toLowerCase().trim();
  return s === 'completed' || s === 'complete' || s === 'done' || s === 'terminé' || s === 'termine' || s === 'invoiced' || s === 'paid';
}

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function cityFromAddress(addr?: string | null): string | null {
  if (!addr) return null;
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    let p = parts[i];
    if (/^\d/.test(p)) continue;
    if (/^(qc|q[ée]bec|quebec|canada|on|ontario|ca)$/i.test(p)) continue;
    if (/^[A-Za-z]\d[A-Za-z]/.test(p)) continue;
    p = p.replace(/\b(QC|Q[ée]bec|Quebec|Canada)\b/gi, '').replace(/[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d/g, '').trim();
    if (p) return p;
  }
  return null;
}

interface Zone { name: string; lat: number; lng: number; rev: number; jobs: number; }

/** Frame the account's work zone: fit the cities, but never zoom out past the
 * regional (Québec) level; centre on the work zone when there's nothing to fit. */
function FitBounds({ zones, center }: { zones: Zone[]; center: L.LatLngTuple }) {
  const map = useMap();
  useEffect(() => {
    if (zones.length > 0) {
      const b = L.latLngBounds(zones.map((z) => [z.lat, z.lng] as L.LatLngTuple));
      map.fitBounds(b, { padding: [55, 55], maxZoom: 12 });
      if (map.getZoom() < 8) map.setView(center, 8);
    } else {
      map.setView(center, 9);
    }
  }, [zones, center, map]);
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
  const ink = dark ? '250,250,250' : '23,23,23';

  useEffect(() => {
    if (document.getElementById('zones-map-css')) return;
    const el = document.createElement('style');
    el.id = 'zones-map-css';
    el.textContent = MAP_CSS;
    document.head.appendChild(el);
  }, []);

  const q = useQuery({
    queryKey: ['zones-heat', range.from, range.to],
    queryFn: () => fetchMapJobsInRange(`${range.from}T00:00:00.000Z`, `${range.to}T23:59:59.999Z`),
    staleTime: 60_000,
  });

  const kc = (cents: number) => new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);

  const { zones, stats, maxRev, center } = useMemo(() => {
    const valid = (q.data?.pins || []).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !(p.latitude === 0 && p.longitude === 0));
    const center: L.LatLngTuple = valid.length
      ? [valid.reduce((s, p) => s + p.latitude, 0) / valid.length, valid.reduce((s, p) => s + p.longitude, 0) / valid.length]
      : DEFAULT_CENTER;
    // Un pin par schedule_event : un job multi-visites ajoutait son total à
    // chaque visite. On ne garde qu'un pin par job.
    const seenJobs = new Set<string>();
    const done = valid.filter((p) => isDone(p.status)).filter((p) => {
      if (seenJobs.has(p.jobId)) return false;
      seenJobs.add(p.jobId);
      return true;
    });
    const agg = new Map<string, { rev: number; jobs: number; lat: number; lng: number }>();
    for (const p of done) {
      const name = cityFromAddress(p.address) || (fr ? 'Autres' : 'Other');
      const e = agg.get(name) || { rev: 0, jobs: 0, lat: 0, lng: 0 };
      e.rev += p.totalCents || 0; e.jobs += 1; e.lat += p.latitude; e.lng += p.longitude;
      agg.set(name, e);
    }
    const zones: Zone[] = Array.from(agg.entries()).map(([name, v]) => ({ name, rev: v.rev, jobs: v.jobs, lat: v.lat / v.jobs, lng: v.lng / v.jobs })).sort((a, b) => b.rev - a.rev);
    const totalRev = zones.reduce((s, z) => s + z.rev, 0);
    const totalJobs = zones.reduce((s, z) => s + z.jobs, 0);
    const maxRev = Math.max(1, ...zones.map((z) => z.rev));
    return { zones, maxRev, center, stats: { totalRev, jobs: totalJobs, avg: totalJobs ? totalRev / totalJobs : 0, zoneCount: zones.length, top: zones.slice(0, 5) } };
  }, [q.data, fr]);

  const empty = !q.isLoading && zones.length === 0;
  const bucket = (rev: number) => Math.min(4, Math.max(0, Math.ceil((rev / maxRev) * 5) - 1));
  const legend = [4, 3, 2, 1, 0].map((i) => ({ i, lo: (maxRev * i) / 5, hi: (maxRev * (i + 1)) / 5 }));
  const labelNames = new Set(stats.top.map((z) => z.name));

  return (
    <div className="flex flex-col">
      <div className="flex items-end justify-between gap-3 px-6 pb-3 border-b border-border">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary leading-none">{fr ? 'Revenu par ville' : 'Revenue by city'}</div>
        <PeriodSelector value={period} onChange={onPeriod} />
      </div>

      {/* stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 px-6 pt-4">
        {[
          { v: kc(stats.totalRev), l: fr ? 'Revenu réalisé' : 'Revenue realized' },
          { v: String(stats.jobs), l: fr ? 'Jobs réalisés' : 'Completed jobs' },
          { v: String(stats.zoneCount), l: fr ? 'Villes actives' : 'Active cities' },
          { v: kc(stats.avg), l: fr ? 'Revenu moy. / job' : 'Avg revenue / job' },
        ].map((s, i) => (
          <div key={i}>
            <div className="text-[22px] font-bold tracking-tight leading-none tabular-nums text-text-primary">{s.v}</div>
            <div className="text-[11.5px] text-text-tertiary font-medium mt-1.5">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 px-6 pt-5 pb-2">
        {/* map */}
        <div className="lg:col-span-2 relative isolate h-[420px] rounded-xl overflow-hidden border border-border">
          <MapContainer center={center} zoom={DEFAULT_ZOOM} minZoom={6} className="h-full w-full" scrollWheelZoom={false} attributionControl={false} style={{ background: dark ? '#0a0a0a' : '#f0f0f0' }}>
            <TileLayer url={dark ? TILE_DARK : TILE_LIGHT} attribution={TILE_ATTR} maxZoom={19} />
            <FitBounds zones={zones} center={center} />
            {zones.map((z) => {
              const b = bucket(z.rev);
              const radius = 10 + (z.rev / maxRev) * 22;
              return (
                <CircleMarker
                  key={z.name}
                  center={[z.lat, z.lng]}
                  radius={radius}
                  pathOptions={{ color: `rgba(${ink},0.9)`, weight: 1.5, fillColor: `rgb(${ink})`, fillOpacity: OPACITIES[b] }}
                  eventHandlers={{
                    mouseover: (e) => (e.target as L.CircleMarker).setStyle({ weight: 3, fillOpacity: Math.min(1, OPACITIES[b] + 0.12) }),
                    mouseout: (e) => (e.target as L.CircleMarker).setStyle({ weight: 1.5, fillOpacity: OPACITIES[b] }),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -radius - 2]} opacity={1} className="zone-tip">
                    <div style={{ textAlign: 'center', lineHeight: 1.4 }}>
                      <div style={{ fontWeight: 800, fontSize: 12.5 }}>{z.name}</div>
                      <div style={{ fontSize: 12 }}>{kc(z.rev)} · {z.jobs} jobs</div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
            {zones.filter((z) => labelNames.has(z.name)).map((z) => (
              <Marker
                key={`${z.name}-label`}
                position={[z.lat, z.lng]}
                interactive={false}
                icon={L.divIcon({ className: 'zone-name', html: `<div>${z.name}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] })}
              />
            ))}
          </MapContainer>

          {/* framed color legend */}
          <div className="absolute right-3 bottom-3 z-[500] rounded-lg border border-border bg-surface-card/95 backdrop-blur px-3 py-2.5 shadow-md">
            <div className="text-[10px] uppercase tracking-wide text-text-tertiary font-bold mb-2">{fr ? 'Revenu / ville' : 'Revenue / city'}</div>
            <div className="flex flex-col gap-1.5">
              {legend.map(({ i, lo, hi }) => (
                <div key={i} className="flex items-center gap-2 text-[10.5px] text-text-secondary font-semibold">
                  <span className="w-3 h-3 rounded-sm border border-border" style={{ background: `rgba(${ink},${OPACITIES[i]})` }} />
                  <span className="tabular-nums">{kc(lo)} – {kc(hi)}</span>
                </div>
              ))}
            </div>
          </div>

          {empty && (
            <div className="absolute inset-0 z-[400] flex items-center justify-center bg-surface-card/70 backdrop-blur-sm">
              <div className="text-center px-6">
                <div className="text-[13px] font-semibold text-text-secondary">{fr ? 'Aucun job réalisé géocodé sur la période' : 'No geocoded completed jobs for this period'}</div>
                <div className="text-[11.5px] text-text-tertiary mt-1.5 max-w-[280px]">{fr ? 'Les villes où tu as des jobs terminés apparaîtront ici, colorées selon le revenu.' : 'Cities with completed jobs appear here, shaded by revenue.'}</div>
              </div>
            </div>
          )}
        </div>

        {/* top cities ranking */}
        <div className="flex flex-col">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-tertiary mb-1">{fr ? 'Villes les plus payantes' : 'Top paying cities'}</div>
          {empty ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-text-tertiary">{fr ? 'Aucune donnée' : 'No data'}</div>
          ) : (
            <div className="flex flex-col">
              {stats.top.map((z, i) => (
                <div key={z.name} className="py-2.5 border-b border-border-light last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold text-text-primary truncate">{i + 1}. {z.name}</span>
                    <span className="text-[13px] font-bold text-text-primary tabular-nums shrink-0">{kc(z.rev)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-tertiary overflow-hidden mt-2"><span className="block h-full rounded-full" style={{ width: `${Math.round((z.rev / maxRev) * 100)}%`, background: 'var(--color-text-primary)' }} /></div>
                  <div className="text-[11px] text-text-tertiary font-semibold mt-1.5">{z.jobs} jobs · {kc(z.jobs ? z.rev / z.jobs : 0)} {fr ? 'moy.' : 'avg'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
