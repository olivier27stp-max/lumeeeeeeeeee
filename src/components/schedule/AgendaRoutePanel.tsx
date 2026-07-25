import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Route, Sparkles, MapPin, Navigation, Clock } from 'lucide-react';
import { useTranslation } from '../../i18n';
import {
  getRoute, getOptimizedRoute, formatDistance, formatDuration,
  type RouteStop, type RouteResult,
} from '../../lib/routeApi';

// Minimal shape the panel needs — a subset of ScheduleEventRecord.
export interface RouteJob {
  id: string;          // event id
  jobId: string | null;
  title: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  startAt: string;     // ISO
  teamColor: string;
}

interface Props {
  jobs: RouteJob[];
  onJobClick?: (jobId: string) => void;
}

/**
 * Route panel for one day / one team in the Agenda view: an ordered stop list
 * with per-leg distance/time, a mini map of the drawn route, day totals, and a
 * one-click "optimize order" suggestion.
 */
export default function AgendaRoutePanel({ jobs, onJobClick }: Props) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  // Split geocoded (routable) vs not.
  const geocoded = useMemo(
    () => jobs.filter((j) => j.lat != null && j.lng != null),
    [jobs],
  );
  const ungeocoded = useMemo(
    () => jobs.filter((j) => j.lat == null || j.lng == null),
    [jobs],
  );

  // Chronological stops (the day's default order) as RouteStop[].
  const chronoStops: RouteStop[] = useMemo(
    () => geocoded.map((j) => ({ id: j.id, lat: j.lat!, lng: j.lng! })),
    [geocoded],
  );

  const [route, setRoute] = useState<RouteResult | null>(null);
  const [optimized, setOptimized] = useState(false);
  const [loading, setLoading] = useState(false);

  // A stable key so we only recompute when the actual stop set/order changes.
  const stopsKey = useMemo(() => chronoStops.map((s) => s.id).join(','), [chronoStops]);

  // Compute the chronological route whenever the day's stops change. Switching
  // back from an optimized view also lands here (optimized reset to false).
  useEffect(() => {
    let cancelled = false;
    if (chronoStops.length < 2) { setRoute(null); setOptimized(false); return; }
    if (optimized) return; // optimized route is computed by the button handler
    setLoading(true);
    getRoute(chronoStops)
      .then((r) => { if (!cancelled) setRoute(r); })
      .catch(() => { if (!cancelled) setRoute(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [stopsKey, optimized]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleOptimize() {
    if (chronoStops.length < 2) return;
    setLoading(true);
    try {
      const r = await getOptimizedRoute(chronoStops);
      setRoute(r);
      setOptimized(true);
    } catch {
      /* getOptimizedRoute never throws, but stay safe */
    } finally {
      setLoading(false);
    }
  }

  function resetToChrono() {
    setOptimized(false); // triggers the effect to recompute the chrono route
  }

  // Jobs in current route order, for the ordered list.
  const orderedJobs = useMemo(() => {
    if (!route) return geocoded;
    const byId = new Map(geocoded.map((j) => [j.id, j]));
    return route.order.map((id) => byId.get(id)).filter(Boolean) as RouteJob[];
  }, [route, geocoded]);

  if (geocoded.length < 2) {
    // Not enough routable stops to show a trip — show nothing (the agenda list
    // below already covers a single or zero-geocoded day).
    if (ungeocoded.length === 0) return null;
  }

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-border bg-surface-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Route size={15} className="text-text-secondary" />
          <span className="text-[12px] font-bold text-text-primary">
            {fr ? 'Trajet du jour' : "Day's route"}
          </span>
          {route && (
            <span className="flex items-center gap-2 text-[11px] text-text-tertiary">
              <span className="flex items-center gap-1"><Navigation size={11} />{formatDistance(route.totalDistanceM, fr)}</span>
              <span className="flex items-center gap-1"><Clock size={11} />{formatDuration(route.totalDurationS, fr)}</span>
            </span>
          )}
        </div>
        {geocoded.length >= 3 && (
          optimized ? (
            <button
              onClick={resetToChrono}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-surface-tertiary"
            >
              {fr ? 'Ordre par heure' : 'By time'}
            </button>
          ) : (
            <button
              onClick={handleOptimize}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
            >
              <Sparkles size={12} />
              {fr ? 'Optimiser le trajet' : 'Optimize route'}
            </button>
          )
        )}
      </div>

      <div className="flex flex-col lg:flex-row">
        {/* Ordered stop list */}
        <div className="min-w-0 flex-1 p-3">
          {optimized && (
            <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-medium text-emerald-600">
              <Sparkles size={11} />
              {fr ? 'Ordre optimisé pour le trajet le plus court' : 'Order optimized for the shortest drive'}
            </p>
          )}
          <ol className="space-y-0">
            {orderedJobs.map((j, i) => {
              const leg = route?.legs[i];
              return (
                <li key={j.id}>
                  {/* Leg connector (skip before the first stop) */}
                  {i > 0 && (
                    <div className="ml-[13px] flex items-center gap-2 py-1 text-[10.5px] text-text-tertiary">
                      <span className="h-4 w-px bg-border" />
                      {leg && (leg.distanceM > 0 || leg.durationS > 0) ? (
                        <span>
                          {formatDistance(leg.distanceM, fr)}
                          {leg.durationS > 0 && <> · {formatDuration(leg.durationS, fr)}</>}
                        </span>
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => j.jobId && onJobClick?.(j.jobId)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-surface-tertiary"
                  >
                    <span
                      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: j.teamColor }}
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
                    <span className="shrink-0 text-[11px] font-medium text-text-secondary tabular-nums">
                      {new Date(j.startAt).toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {ungeocoded.length > 0 && (
            <p className="mt-2 border-t border-border-light pt-2 text-[10.5px] text-text-tertiary">
              {fr
                ? `${ungeocoded.length} job(s) non géolocalisé(s) — exclus du trajet`
                : `${ungeocoded.length} job(s) not geolocated — excluded from the route`}
            </p>
          )}
        </div>

        {/* Mini map */}
        {geocoded.length >= 2 && (
          <div className="h-[220px] w-full shrink-0 border-t border-border-light lg:h-auto lg:w-[320px] lg:border-l lg:border-t-0">
            <RouteMiniMap jobs={orderedJobs} geometry={route?.geometry ?? []} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Mini map ──────────────────────────────────────────────────────────── */

function RouteMiniMap({ jobs, geometry }: { jobs: RouteJob[]; geometry: [number, number][] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [ready, setReady] = useState(false);

  // Init once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-72.5485, 46.343],
      zoom: 10,
      attributionControl: false,
      interactive: true,
    });
    mapRef.current = map;
    map.on('load', () => setReady(true));
    return () => { map.remove(); mapRef.current = null; setReady(false); };
  }, []);

  // Draw markers + route line + fit bounds whenever the ordered jobs change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    // Clear previous markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const pts = jobs.filter((j) => j.lat != null && j.lng != null);
    if (!pts.length) return;

    // Numbered markers
    pts.forEach((j, i) => {
      const el = document.createElement('div');
      el.style.cssText =
        `display:flex;align-items:center;justify-content:center;width:24px;height:24px;` +
        `border-radius:50%;background:${j.teamColor};color:#fff;font:700 11px Inter,system-ui,sans-serif;` +
        `border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);`;
      el.textContent = String(i + 1);
      const m = new mapboxgl.Marker({ element: el }).setLngLat([j.lng!, j.lat!]).addTo(map);
      markersRef.current.push(m);
    });

    // Route line — real geometry when available, else straight segments.
    const line: [number, number][] =
      geometry.length >= 2 ? geometry : pts.map((j) => [j.lng!, j.lat!] as [number, number]);
    const srcId = 'agenda-route';
    const data: GeoJSON.Feature = {
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: line },
    };
    const existing = map.getSource(srcId) as mapboxgl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
    } else {
      map.addSource(srcId, { type: 'geojson', data });
      map.addLayer({
        id: 'agenda-route-line', type: 'line', source: srcId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': pts[0].teamColor, 'line-width': 3, 'line-opacity': 0.7 },
      });
    }

    // Fit bounds to all points
    const bounds = new mapboxgl.LngLatBounds();
    pts.forEach((j) => bounds.extend([j.lng!, j.lat!]));
    map.fitBounds(bounds, { padding: 34, maxZoom: 15, duration: 300 });
  }, [jobs, geometry, ready]);

  return <div ref={containerRef} className="h-full w-full" />;
}
