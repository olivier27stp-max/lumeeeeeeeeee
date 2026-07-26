import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Route, Sparkles, MapPin, Car, Clock, Navigation } from 'lucide-react';
import { useTranslation } from '../../i18n';
import {
  getRoute, getOptimizedRoute, formatDistance, formatDuration,
  type RouteStop, type RouteResult,
} from '../../lib/routeApi';

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

  const [optimized, setOptimized] = useState(true); // optimized by default
  const [routes, setRoutes] = useState<TeamRoute[]>([]);
  const [loading, setLoading] = useState(false);

  // Stable key: recompute only when the actual jobs/teams or the mode change.
  const jobsKey = useMemo(
    () => teams.map((t) => `${t.key}:${t.jobs.map((j) => j.id).join('-')}`).join('|'),
    [teams],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const computed = await Promise.all(teams.map(async (t): Promise<TeamRoute> => {
        const geocoded = t.jobs.filter((j) => j.lat != null && j.lng != null);
        const ungeocoded = t.jobs.filter((j) => j.lat == null || j.lng == null);
        const stops: RouteStop[] = geocoded.map((j) => ({ id: j.id, lat: j.lat!, lng: j.lng! }));

        let route: RouteResult | null = null;
        if (stops.length >= 2) {
          route = optimized ? await getOptimizedRoute(stops) : await getRoute(stops);
        }

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

        return { teamId: t.key, teamName: t.name, color: t.color, jobs: orderedJobs, route, etas, ungeocoded };
      }));
      if (!cancelled) { setRoutes(computed); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [jobsKey, optimized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Day totals across all teams.
  const totals = useMemo(() => {
    let dist = 0, dur = 0, trips = 0;
    for (const r of routes) {
      if (r.route && r.jobs.length >= 2) { dist += r.route.totalDistanceM; dur += r.route.totalDurationS; trips++; }
    }
    return { dist, dur, trips };
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

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-3.5">
            <Totals value={String(totals.trips)} label={fr ? 'Tournées' : 'Trips'} />
            <Totals value={formatDistance(totals.dist, fr)} label={fr ? 'Distance' : 'Distance'} />
            <Totals value={formatDuration(totals.dur, fr)} label={fr ? 'Conduite' : 'Drive'} />
          </div>
          <button
            onClick={() => setOptimized((v) => !v)}
            disabled={loading}
            className={
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-all disabled:opacity-50 ' +
              (optimized
                ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
                : 'border border-border text-text-secondary hover:bg-surface-secondary')
            }
          >
            <Sparkles size={12} />
            {optimized ? (fr ? 'Optimisé' : 'Optimized') : (fr ? 'Optimiser' : 'Optimize')}
          </button>
        </div>
      </div>

      {/* Split: map + side list */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.85fr_1fr]">
        <div className="relative min-h-[300px] border-b border-border lg:min-h-[520px] lg:border-b-0 lg:border-r">
          <RouteMap routes={routes} />
        </div>

        <div className="max-h-[520px] overflow-y-auto">
          {routes.map((r, ti) => (
            <div key={r.teamId} className={ti > 0 ? 'border-t-[6px] border-surface-secondary' : ''}>
              {/* team header */}
              <div className="sticky top-0 z-[1] flex items-center gap-2 bg-surface-card px-4 pb-2 pt-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="text-[12.5px] font-bold text-text-primary">{r.teamName}</span>
                {r.route && r.jobs.length >= 2 && (
                  <span className="ml-auto flex items-center gap-2 text-[11px] text-text-tertiary tabular-nums">
                    <span>{r.jobs.length} {fr ? 'arrêts' : 'stops'}</span>
                    <span className="flex items-center gap-1"><Navigation size={10} />{formatDistance(r.route.totalDistanceM, fr)}</span>
                    <span className="flex items-center gap-1"><Clock size={10} />{formatDuration(r.route.totalDurationS, fr)}</span>
                  </span>
                )}
              </div>

              {optimized && r.jobs.length >= 3 && (
                <span
                  className="mx-4 mb-1 flex items-center gap-1 self-start rounded-pill px-2 py-0.5 text-[10px] font-bold"
                  style={{ color: r.color, backgroundColor: `${r.color}1a` }}
                >
                  <Sparkles size={10} />{fr ? 'Trajet optimisé' : 'Optimized route'}
                </span>
              )}

              {/* stops */}
              <ol className="px-1.5 pb-2">
                {r.jobs.map((j, i) => {
                  const leg = r.route?.legs[i];
                  const eta = r.etas[i];
                  const planned = new Date(j.startAt);
                  const moved = optimized && eta && Math.abs(eta.getTime() - planned.getTime()) > 5 * 60_000;
                  return (
                    <li key={j.id}>
                      {i > 0 && leg && (leg.distanceM > 0 || leg.durationS > 0) && (
                        <div className="ml-[30px] flex items-center gap-1.5 py-1 text-[10.5px] text-text-tertiary tabular-nums">
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
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface-secondary"
                      >
                        <span
                          className="flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                          style={{ backgroundColor: r.color }}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold text-text-primary">{j.title}</span>
                          {j.address && (
                            <span className="flex items-center gap-1 truncate text-[11px] text-text-tertiary">
                              <MapPin size={10} className="shrink-0" />{j.address}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[12px] font-bold text-text-primary tabular-nums">
                            {(eta ?? planned).toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' })}
                          </span>
                          {moved && (
                            <span className="block text-[9.5px] text-text-tertiary tabular-nums">
                              {fr ? 'prévu' : 'planned'} {planned.toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' })}
                            </span>
                          )}
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

function Totals({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-right leading-tight">
      <div className="text-[14px] font-extrabold tracking-tight text-text-primary tabular-nums">{value}</div>
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
    map.on('load', () => setReady(true));
    return () => { map.remove(); mapRef.current = null; setReady(false); };
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

      // Numbered pins
      pts.forEach((j, i) => {
        const el = document.createElement('div');
        el.style.cssText =
          `display:flex;align-items:center;justify-content:center;width:28px;height:28px;` +
          `border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${r.color};color:#fff;` +
          `font:700 12px Inter,system-ui,sans-serif;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);`;
        const inner = document.createElement('span');
        inner.style.transform = 'rotate(45deg)';
        inner.textContent = String(i + 1);
        el.appendChild(inner);
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
