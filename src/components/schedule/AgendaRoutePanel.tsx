import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Route, Sparkles, MapPin, Car, Clock, Navigation } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { formatCurrency } from '../../lib/utils';
import UnifiedAvatar from '../ui/UnifiedAvatar';
import {
  getOptimizedRoute, formatDistance, formatDuration,
  type RouteStop, type RouteResult,
} from '../../lib/routeApi';

// Same DiceBear endpoint/style as <UnifiedAvatar> so map pins match the CRM.
function dicebearUrl(seed: string) {
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed || 'x')}&size=80&backgroundColor=f5f5f5&radius=50`;
}

// One job the route panel can plot.
export interface RouteJob {
  id: string;          // event id
  jobId: string | null;
  title: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  startAt: string;     // ISO — the planned time
  teamId: string;      // '' when unassigned
  teamName: string;
  teamColor: string;
  clientId: string | null;   // avatar seed (same DiceBear as the rest of the CRM)
  clientName: string;
  revenueCents: number;      // job total, for "who made cash"
}

interface Props {
  /** All of a day's jobs, across the selected teams. */
  jobs: RouteJob[];
  onJobClick?: (jobId: string) => void;
}

// A single team's computed trip.
interface TeamRoute {
  teamId: string;
  teamName: string;
  color: string;
  jobs: RouteJob[];        // in travel order
  route: RouteResult | null;
  etas: (Date | null)[];   // arrival estimate per stop, aligned with jobs
  ungeocoded: RouteJob[];
  revenueCents: number;    // sum of the trip's job totals
}

/**
 * Route view for the Agenda: a dominant map showing every selected team's trip
 * (one colour per team) beside a side list grouped by team. Trips open already
 * optimized, with driving time between stops and a cascading arrival estimate.
 */
export default function AgendaRoutePanel({ jobs, onJobClick }: Props) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  // Group jobs by team (stable order: first appearance).
  const teams = useMemo(() => {
    const order: string[] = [];
    const byTeam = new Map<string, RouteJob[]>();
    for (const j of jobs) {
      const key = j.teamId || '__none__';
      if (!byTeam.has(key)) { byTeam.set(key, []); order.push(key); }
      byTeam.get(key)!.push(j);
    }
    return order.map((key) => {
      const list = byTeam.get(key)!;
      // chronological within a team, so the "by time" baseline is meaningful
      list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      return { key, name: list[0].teamName, color: list[0].teamColor, jobs: list };
    });
  }, [jobs]);

  const [routes, setRoutes] = useState<TeamRoute[]>([]);

  // Stable key: recompute only when the actual jobs/teams change.
  const jobsKey = useMemo(
    () => teams.map((t) => `${t.key}:${t.jobs.map((j) => j.id).join('-')}`).join('|'),
    [teams],
  );

  // Trips are ALWAYS optimized — the shortest order is computed automatically,
  // no toggle. (Display only: the calendar's scheduled times aren't rewritten.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const computed = await Promise.all(teams.map(async (t): Promise<TeamRoute> => {
        const geocoded = t.jobs.filter((j) => j.lat != null && j.lng != null);
        const ungeocoded = t.jobs.filter((j) => j.lat == null || j.lng == null);
        const stops: RouteStop[] = geocoded.map((j) => ({ id: j.id, lat: j.lat!, lng: j.lng! }));

        let route: RouteResult | null = null;
        if (stops.length >= 2) route = await getOptimizedRoute(stops);

        // Order jobs to match the route.
        const byId = new Map(geocoded.map((j) => [j.id, j]));
        const orderedJobs = route
          ? route.order.map((id) => byId.get(id)).filter(Boolean) as RouteJob[]
          : geocoded;

        // Cascading ETA: start from the first stop's planned time, then add each
        // leg's driving duration + a fixed on-site allowance.
        const etas: (Date | null)[] = [];
        if (orderedJobs.length) {
          let cursor = new Date(orderedJobs[0].startAt);
          etas.push(cursor);
          for (let i = 1; i < orderedJobs.length; i++) {
            const driveS = route?.legs[i]?.durationS ?? 0;
            cursor = new Date(cursor.getTime() + (driveS + 30 * 60) * 1000); // +30 min on site
            etas.push(cursor);
          }
        }

        const revenueCents = t.jobs.reduce((sum, j) => sum + (j.revenueCents || 0), 0);
        return { teamId: t.key, teamName: t.name, color: t.color, jobs: orderedJobs, route, etas, ungeocoded, revenueCents };
      }));
      if (!cancelled) setRoutes(computed);
    })();
    return () => { cancelled = true; };
  }, [jobsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Day totals across all teams.
  const totals = useMemo(() => {
    let dist = 0, dur = 0, trips = 0, revenueCents = 0;
    for (const r of routes) {
      if (r.route && r.jobs.length >= 2) { dist += r.route.totalDistanceM; dur += r.route.totalDurationS; trips++; }
      revenueCents += r.revenueCents;
    }
    return { dist, dur, trips, revenueCents };
  }, [routes]);

  const anyRoutable = routes.some((r) => r.jobs.length >= 2);
  if (!anyRoutable && !routes.some((r) => r.ungeocoded.length)) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface-card shadow-card">
      {/* Bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Route size={16} className="text-text-secondary" />
          <span className="text-[13.5px] font-bold tracking-tight text-text-primary">
            {fr ? 'Trajet du jour' : "Day's route"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-pill bg-success-light px-2 py-0.5 text-[10px] font-bold text-success">
            <Sparkles size={10} />{fr ? 'Optimisé' : 'Optimized'}
          </span>
        </div>

        {/* team legend */}
        <div className="flex flex-wrap items-center gap-1.5">
          {routes.filter((r) => r.jobs.length).map((r) => (
            <span key={r.teamId} className="inline-flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 text-[11px] font-semibold text-text-secondary">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
              {r.teamName}
            </span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3.5">
          <Totals value={String(totals.trips)} label={fr ? 'Tournées' : 'Trips'} />
          <Totals value={formatDistance(totals.dist, fr)} label={fr ? 'Distance' : 'Distance'} />
          <Totals value={formatDuration(totals.dur, fr)} label={fr ? 'Conduite' : 'Drive'} />
          {totals.revenueCents > 0 && (
            <Totals value={formatCurrency(totals.revenueCents / 100)} label={fr ? 'Revenu' : 'Revenue'} accent />
          )}
        </div>
      </div>

      {/* Split: map + side list — takes most of the viewport height so the map
          dominates instead of sitting in an empty page. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.85fr_1fr]">
        <div className="relative min-h-[320px] border-b border-border lg:min-h-[calc(100vh-16rem)] lg:border-b-0 lg:border-r">
          <RouteMap routes={routes} />
        </div>

        <div className="overflow-y-auto lg:max-h-[calc(100vh-16rem)]">
          {routes.map((r, ti) => (
            <div key={r.teamId} className={ti > 0 ? 'border-t-[6px] border-surface-secondary' : ''}>
              {/* team header — name + revenue (who made cash) */}
              <div className="sticky top-0 z-[1] bg-surface-card px-4 pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                  <span className="text-[12.5px] font-bold text-text-primary">{r.teamName}</span>
                  {r.revenueCents > 0 && (
                    <span className="ml-auto text-[12px] font-extrabold text-success tabular-nums">
                      {formatCurrency(r.revenueCents / 100)}
                    </span>
                  )}
                </div>
                {r.route && r.jobs.length >= 2 && (
                  <div className="mt-1 flex items-center gap-2.5 text-[10.5px] text-text-tertiary tabular-nums">
                    <span>{r.jobs.length} {fr ? 'arrêts' : 'stops'}</span>
                    <span className="flex items-center gap-1"><Navigation size={10} />{formatDistance(r.route.totalDistanceM, fr)}</span>
                    <span className="flex items-center gap-1"><Clock size={10} />{formatDuration(r.route.totalDurationS, fr)}</span>
                  </div>
                )}
              </div>

              {/* stops */}
              <ol className="px-1.5 pb-2">
                {r.jobs.map((j, i) => {
                  const leg = r.route?.legs[i];
                  const eta = r.etas[i];
                  const planned = new Date(j.startAt);
                  const moved = eta && Math.abs(eta.getTime() - planned.getTime()) > 5 * 60_000;
                  return (
                    <li key={j.id}>
                      {i > 0 && leg && (leg.distanceM > 0 || leg.durationS > 0) && (
                        <div className="ml-[38px] flex items-center gap-1.5 py-1 text-[10.5px] text-text-tertiary tabular-nums">
                          <span className="h-4 w-px bg-border" />
                          <Car size={11} className="opacity-60" />
                          <span>
                            {formatDistance(leg.distanceM, fr)}
                            {leg.durationS > 0 && <> · {formatDuration(leg.durationS, fr)}</>}
                          </span>
                        </div>
                      )}
                      <button
                        onClick={() => j.jobId && onJobClick?.(j.jobId)}
                        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-secondary"
                      >
                        {/* step number — OUTSIDE the avatar bubble */}
                        <span className="w-4 shrink-0 text-center text-[12px] font-bold text-text-secondary tabular-nums">{i + 1}</span>
                        {/* client DiceBear — same avatar system as the rest of the CRM */}
                        <span className="shrink-0 rounded-full ring-2" style={{ ['--tw-ring-color' as any]: `${r.color}55` }}>
                          <UnifiedAvatar id={j.clientId || j.id} name={j.clientName || j.title} size={32} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold text-text-primary">
                            {j.clientName ? `${j.clientName} · ${j.title}` : j.title}
                          </span>
                          {j.address && (
                            <span className="flex items-center gap-1 truncate text-[11px] text-text-tertiary">
                              <MapPin size={10} className="shrink-0" />{j.address}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-2.5">
                          {j.revenueCents > 0 && (
                            <span className="text-[11.5px] font-bold text-success tabular-nums">{formatCurrency(j.revenueCents / 100)}</span>
                          )}
                          <span className="text-right">
                            <span className="block text-[12px] font-bold text-text-primary tabular-nums">
                              {(eta ?? planned).toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' })}
                            </span>
                            {moved && (
                              <span className="block text-[9.5px] text-text-tertiary tabular-nums">
                                {fr ? 'prévu' : 'planned'} {planned.toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' })}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {r.ungeocoded.length > 0 && (
                <p className="mx-4 mb-3 border-t border-border-light pt-2 text-[10.5px] text-text-tertiary">
                  {fr
                    ? `${r.ungeocoded.length} job(s) non géolocalisé(s) — exclus du trajet`
                    : `${r.ungeocoded.length} job(s) not geolocated — excluded from the route`}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Totals({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="text-right leading-tight">
      <div className={'text-[14px] font-extrabold tracking-tight tabular-nums ' + (accent ? 'text-success' : 'text-text-primary')}>{value}</div>
      <div className="text-[8.5px] font-semibold uppercase tracking-[0.07em] text-text-tertiary">{label}</div>
    </div>
  );
}

/* ── Map: one colored trip per team ────────────────────────────────────── */

function RouteMap({ routes }: { routes: TeamRoute[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const tk = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!tk) return;
    mapboxgl.accessToken = tk;
    const map = new mapboxgl.Map({
      container,
      style: 'mapbox://styles/mapbox/light-v11', // neutral, matches Lume's greys
      center: [-72.5485, 46.343],
      zoom: 10,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on('load', () => { map.resize(); setReady(true); });
    // Keep the canvas in sync when the container grows (viewport-height layout).
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; setReady(false); };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoint = false;

    routes.forEach((r, ri) => {
      const pts = r.jobs.filter((j) => j.lat != null && j.lng != null);
      const srcId = `route-src-${ri}`;
      const lineId = `route-line-${ri}`;

      // Route line (real geometry or straight fallback)
      const coords: [number, number][] =
        r.route && r.route.geometry.length >= 2
          ? r.route.geometry
          : pts.map((j) => [j.lng!, j.lat!] as [number, number]);

      const data: GeoJSON.Feature = {
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      };
      const existing = map.getSource(srcId) as mapboxgl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
        if (map.getLayer(lineId)) map.setPaintProperty(lineId, 'line-color', r.color);
      } else if (coords.length >= 2) {
        map.addSource(srcId, { type: 'geojson', data });
        map.addLayer({
          id: lineId, type: 'line', source: srcId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': r.color, 'line-width': 4, 'line-opacity': 0.9 },
        });
      }

      // Pins: step number OUTSIDE the bubble, client DiceBear INSIDE the drop.
      pts.forEach((j, i) => {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
        // step number chip (above)
        const idx = document.createElement('div');
        idx.textContent = String(i + 1);
        idx.style.cssText =
          `font:800 10px Inter,system-ui,sans-serif;color:#171717;background:#fff;border:1px solid #e5e5e5;` +
          `border-radius:999px;padding:0 5px;line-height:15px;margin-bottom:-4px;z-index:2;box-shadow:0 1px 3px rgba(0,0,0,.15);`;
        // teardrop with the client's DiceBear avatar
        const drop = document.createElement('div');
        drop.style.cssText =
          `width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${r.color};` +
          `border:2.5px solid #fff;box-shadow:0 2px 7px rgba(0,0,0,.32);overflow:hidden;display:flex;align-items:center;justify-content:center;`;
        const img = document.createElement('img');
        img.src = dicebearUrl(j.clientId || j.id);
        img.alt = '';
        img.loading = 'lazy';
        img.style.cssText = 'width:100%;height:100%;transform:rotate(45deg) scale(1.42);';
        drop.appendChild(img);
        el.appendChild(idx);
        el.appendChild(drop);
        const m = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([j.lng!, j.lat!]).addTo(map);
        markersRef.current.push(m);
        bounds.extend([j.lng!, j.lat!]);
        hasPoint = true;
      });

      // Remove stale sources/layers for teams that no longer have a line
      if (coords.length < 2) {
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getSource(srcId)) map.removeSource(srcId);
      }
    });

    // Clean up orphaned team layers beyond current count
    for (let ri = routes.length; ri < routes.length + 8; ri++) {
      const lineId = `route-line-${ri}`, srcId = `route-src-${ri}`;
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(srcId)) map.removeSource(srcId);
    }

    if (hasPoint) map.fitBounds(bounds, { padding: 44, maxZoom: 15, duration: 350 });
  }, [routes, ready]);

  return <div ref={containerRef} className="h-full w-full" />;
}
