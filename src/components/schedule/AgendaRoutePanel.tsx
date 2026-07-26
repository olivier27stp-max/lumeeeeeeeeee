import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Route, Sparkles, MapPin, Car, Clock, Navigation, ExternalLink, CheckCircle2, Play } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { formatCurrency } from '../../lib/utils';
import UnifiedAvatar from '../ui/UnifiedAvatar';
import {
  getRoute, getOptimizedRoute, formatDistance, formatDuration,
  type RouteStop, type RouteResult,
} from '../../lib/routeApi';

// Same DiceBear endpoint/style as <UnifiedAvatar> so map pins match the CRM.
function dicebearUrl(seed: string) {
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed || 'x')}&size=80&backgroundColor=f5f5f5&radius=50`;
}

// Google Maps directions URL with the whole trip (origin → waypoints → dest).
function googleMapsTripUrl(stops: { lat: number; lng: number }[], start?: { lat: number; lng: number } | null): string | null {
  const all = start ? [start, ...stops] : stops;
  if (all.length < 1) return null;
  const pt = (s: { lat: number; lng: number }) => `${s.lat},${s.lng}`;
  const origin = pt(all[0]);
  const destination = pt(all[all.length - 1]);
  const waypoints = all.slice(1, -1).map(pt).join('|');
  const base = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  return waypoints ? `${base}&waypoints=${encodeURIComponent(waypoints)}` : base;
}

const DONE_STATUSES = new Set(['completed', 'done', 'paid', 'closed', 'invoiced']);

// Where each team's trip starts from. 'first' = the earliest stop (default);
// 'me' = the dispatcher's current GPS position (asked once, shared by all teams).
type StartMode = 'first' | 'me';

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
  status: string;            // normalized job status (completed / in_progress / ...)
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
  done: number;            // completed stops
  savedSeconds: number;    // drive time saved vs the chronological order (≥0)
  savedMeters: number;     // distance saved vs the chronological order (≥0)
}

/**
 * Route view for the Agenda: a dominant map showing every selected team's trip
 * (one colour per team) beside a side list grouped by team. Trips are always
 * optimized; the user changes a route by choosing where it STARTS from (first
 * stop vs. their current location), which re-optimizes the order — no fiddly
 * drag & drop. Each stop shows driving time + a cascading ETA, clicking a stop
 * focuses its map pin, per-team progress + lateness is surfaced, and each trip
 * opens in Google Maps.
 */
export default function AgendaRoutePanel({ jobs, onJobClick }: Props) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [startMode, setStartMode] = useState<StartMode>('first');
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const flyToRef = useRef<((lng: number, lat: number) => void) | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Ask for the dispatcher's position once when they pick "my location".
  function chooseStart(mode: StartMode) {
    if (mode === 'me' && !myPos) {
      if (!navigator.geolocation) return;
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (p) => { if (!mountedRef.current) return; setMyPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setStartMode('me'); setLocating(false); },
        () => { if (mountedRef.current) setLocating(false); }, // permission denied → stay on 'first'
        { enableHighAccuracy: true, timeout: 10000 },
      );
      return;
    }
    setStartMode(mode);
  }

  const startPoint = startMode === 'me' ? myPos : null;

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
      list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      return { key, name: list[0].teamName, color: list[0].teamColor, jobs: list };
    });
  }, [jobs]);

  const [routes, setRoutes] = useState<TeamRoute[]>([]);
  const [loading, setLoading] = useState(true);

  const jobsKey = useMemo(
    () => teams.map((t) => `${t.key}:${t.jobs.map((j) => j.id).join('-')}`).join('|'),
    [teams],
  );
  const startKey = startPoint ? `${startPoint.lat},${startPoint.lng}` : 'first';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const computed = await Promise.all(teams.map(async (t): Promise<TeamRoute> => {
        const geocoded = t.jobs.filter((j) => j.lat != null && j.lng != null);
        const ungeocoded = t.jobs.filter((j) => j.lat == null || j.lng == null);
        const byId = new Map(geocoded.map((j) => [j.id, j]));

        let route: RouteResult | null = null;
        let orderedJobs: RouteJob[] = geocoded;
        let savedSeconds = 0, savedMeters = 0;

        if (geocoded.length >= 2) {
          const START = '__start__';
          const mk = (list: RouteJob[]): RouteStop[] => {
            const s: RouteStop[] = [];
            if (startPoint) s.push({ id: START, lat: startPoint.lat, lng: startPoint.lng });
            list.forEach((j) => s.push({ id: j.id, lat: j.lat!, lng: j.lng! }));
            return s;
          };
          // Optimized order (anchor only when there's a real origin).
          const [r, chrono] = await Promise.all([
            getOptimizedRoute(mk(geocoded), !!startPoint),
            // Chronological baseline = jobs in planned-time order (already sorted).
            geocoded.length >= 2 ? getRoute(mk(geocoded)).catch(() => null) : Promise.resolve(null),
          ]);
          const order = r.order.filter((id) => id !== START);
          orderedJobs = order.map((id) => byId.get(id)).filter(Boolean) as RouteJob[];
          route = r;
          if (chrono) {
            savedSeconds = Math.max(0, chrono.totalDurationS - r.totalDurationS);
            savedMeters = Math.max(0, chrono.totalDistanceM - r.totalDistanceM);
          }
        }

        // Geocoded jobs dropped by the optimizer's stop cap (Mapbox ≤ 12): they
        // must not vanish silently — surface them in the excluded note.
        const routedIds = new Set(orderedJobs.map((j) => j.id));
        const overCap = geocoded.filter((j) => !routedIds.has(j.id));

        // Cascading ETA from the first stop's planned time + drive + on-site time.
        const legOffset = startPoint ? 1 : 0; // legs[0] is start→stop1 when anchored
        const etas: (Date | null)[] = [];
        if (orderedJobs.length) {
          let cursor = new Date(orderedJobs[0].startAt);
          etas.push(cursor);
          for (let i = 1; i < orderedJobs.length; i++) {
            const driveS = route?.legs[i + legOffset]?.durationS ?? 0;
            cursor = new Date(cursor.getTime() + (driveS + 30 * 60) * 1000);
            etas.push(cursor);
          }
        }

        const revenueCents = t.jobs.reduce((sum, j) => sum + (j.revenueCents || 0), 0);
        const done = t.jobs.filter((j) => DONE_STATUSES.has(j.status)).length;
        return { teamId: t.key, teamName: t.name, color: t.color, jobs: orderedJobs, route, etas, ungeocoded: [...ungeocoded, ...overCap], revenueCents, done, savedSeconds, savedMeters };
      }));
      if (!cancelled) { setRoutes(computed); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [jobsKey, startKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    let dist = 0, dur = 0, trips = 0, revenueCents = 0;
    for (const r of routes) {
      if (r.route && r.jobs.length >= 2) { dist += r.route.totalDistanceM; dur += r.route.totalDurationS; trips++; }
      revenueCents += r.revenueCents;
    }
    return { dist, dur, trips, revenueCents };
  }, [routes]);

  function focusStop(j: RouteJob) {
    setSelectedId(j.id);
    if (j.lat != null && j.lng != null) flyToRef.current?.(j.lng, j.lat);
  }

  const anyRoutable = routes.some((r) => r.jobs.length >= 2);
  if (!loading && !anyRoutable && !routes.some((r) => r.ungeocoded.length)) return null;

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

        {/* Start-from selector — the real way to change a route */}
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 text-[11px] font-medium text-text-tertiary">
            <Play size={10} />{fr ? 'Départ' : 'Start'}
          </span>
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button
              onClick={() => chooseStart('first')}
              className={'px-2.5 py-1 text-[11px] font-semibold transition-colors ' + (startMode === 'first' ? 'bg-primary text-primary-foreground' : 'text-text-secondary hover:bg-surface-secondary')}
            >
              {fr ? '1er arrêt' : 'First stop'}
            </button>
            <button
              onClick={() => chooseStart('me')}
              disabled={locating}
              className={'px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ' + (startMode === 'me' ? 'bg-primary text-primary-foreground' : 'text-text-secondary hover:bg-surface-secondary')}
            >
              {locating ? (fr ? 'Localisation…' : 'Locating…') : (fr ? 'Ma position' : 'My location')}
            </button>
          </div>
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

      {/* Split: map + side list */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.85fr_1fr]">
        <div className="relative min-h-[320px] border-b border-border lg:min-h-[calc(100vh-16rem)] lg:border-b-0 lg:border-r">
          <RouteMap routes={routes} startPoint={startPoint} selectedId={selectedId} onSelect={setSelectedId} onJobClick={onJobClick} flyToRef={flyToRef} />
          {loading && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-border bg-surface-card/90 px-2.5 py-1 text-[11px] font-medium text-text-secondary shadow-sm backdrop-blur">
              {fr ? 'Calcul du trajet…' : 'Computing route…'}
            </div>
          )}
        </div>

        <div className="overflow-y-auto lg:max-h-[calc(100vh-16rem)]">
          {routes.map((r, ti) => {
            const late = r.jobs.reduce((n, j, i) => {
              const eta = r.etas[i];
              return n + (eta && eta.getTime() - new Date(j.startAt).getTime() > 5 * 60_000 ? 1 : 0);
            }, 0);
            const mapsUrl = googleMapsTripUrl(
              r.jobs.filter((j) => j.lat != null && j.lng != null).map((j) => ({ lat: j.lat!, lng: j.lng! })),
              startPoint,
            );
            return (
              <div key={r.teamId} className={ti > 0 ? 'border-t-[6px] border-surface-secondary' : ''}>
                {/* team header */}
                <div className="sticky top-0 z-[1] bg-surface-card px-4 pb-2.5 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="text-[12.5px] font-bold text-text-primary">{r.teamName}</span>
                    {r.revenueCents > 0 && (
                      <span className="ml-auto text-[12px] font-extrabold text-success tabular-nums">
                        {formatCurrency(r.revenueCents / 100)}
                      </span>
                    )}
                  </div>

                  {/* progress bar (done vs total) */}
                  {r.jobs.length > 0 && (
                    <div className="mt-2">
                      <div className="mb-1 flex items-center justify-between text-[10px] text-text-tertiary tabular-nums">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 size={10} className={r.done > 0 ? 'text-success' : 'opacity-50'} />
                          {r.done}/{r.jobs.length} {fr ? 'faits' : 'done'}
                        </span>
                        {late > 0 && (
                          <span className="font-semibold text-warning">
                            {late} {fr ? 'en retard' : 'late'}
                          </span>
                        )}
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-surface-tertiary">
                        <div className="h-full rounded-full transition-all" style={{ width: `${(r.done / r.jobs.length) * 100}%`, backgroundColor: r.color }} />
                      </div>
                    </div>
                  )}

                  {/* trip meta + open in maps */}
                  <div className="mt-2 flex items-center gap-2.5 text-[10.5px] text-text-tertiary tabular-nums">
                    {r.route && r.jobs.length >= 2 && (
                      <>
                        <span>{r.jobs.length} {fr ? 'arrêts' : 'stops'}</span>
                        <span className="flex items-center gap-1"><Navigation size={10} />{formatDistance(r.route.totalDistanceM, fr)}</span>
                        <span className="flex items-center gap-1"><Clock size={10} />{formatDuration(r.route.totalDurationS, fr)}</span>
                      </>
                    )}
                    {mapsUrl && (
                      <a
                        href={mapsUrl} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] font-semibold text-text-secondary transition-colors hover:bg-surface-secondary"
                      >
                        <ExternalLink size={11} />{fr ? 'Ouvrir dans Maps' : 'Open in Maps'}
                      </a>
                    )}
                  </div>

                  {/* Economy vs the chronological (by-time) order — proves the
                      optimization saves driving. Only shown when it actually does. */}
                  {r.savedSeconds >= 60 && (
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-success-light px-2 py-0.5 text-[10.5px] font-semibold text-success">
                      <Sparkles size={10} />
                      {fr
                        ? `Économie ${formatDuration(r.savedSeconds, fr)}${r.savedMeters >= 300 ? ` · ${formatDistance(r.savedMeters, fr)}` : ''} vs par heure`
                        : `Saves ${formatDuration(r.savedSeconds, fr)}${r.savedMeters >= 300 ? ` · ${formatDistance(r.savedMeters, fr)}` : ''} vs by-time`}
                    </div>
                  )}
                </div>

                {/* stops */}
                <ol className="px-1.5 pb-2">
                  {r.jobs.map((j, i) => (
                    <StopRow
                      key={j.id}
                      job={j}
                      index={i}
                      color={r.color}
                      leg={i > 0 ? r.route?.legs[i + (startPoint ? 1 : 0)] : undefined}
                      eta={r.etas[i]}
                      selected={selectedId === j.id}
                      done={DONE_STATUSES.has(j.status)}
                      fr={fr}
                      onFocus={() => focusStop(j)}
                      onOpen={() => j.jobId && onJobClick?.(j.jobId)}
                    />
                  ))}
                </ol>

                {r.ungeocoded.length > 0 && (
                  <p className="mx-4 mb-3 border-t border-border-light pt-2 text-[10.5px] text-text-tertiary">
                    {fr
                      ? `${r.ungeocoded.length} job(s) exclus du trajet (non géolocalisés ou au-delà de 12 arrêts)`
                      : `${r.ungeocoded.length} job(s) excluded from the route (not geolocated or beyond 12 stops)`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── One focusable stop row ────────────────────────────────────────────── */

function StopRow({
  job, index, color, leg, eta, selected, done, fr, onFocus, onOpen,
}: {
  job: RouteJob; index: number; color: string;
  leg: { distanceM: number; durationS: number } | undefined;
  eta: Date | null; selected: boolean; done: boolean; fr: boolean;
  onFocus: () => void; onOpen: () => void;
}) {
  const planned = new Date(job.startAt);
  const moved = eta && Math.abs(eta.getTime() - planned.getTime()) > 5 * 60_000;
  const isLate = eta && eta.getTime() - planned.getTime() > 5 * 60_000;

  return (
    <li>
      {leg && (leg.distanceM > 0 || leg.durationS > 0) && (
        <div className="ml-[30px] flex items-center gap-1.5 py-1 text-[10.5px] text-text-tertiary tabular-nums">
          <span className="h-4 w-px bg-border" />
          <Car size={11} className="opacity-60" />
          <span>
            {formatDistance(leg.distanceM, fr)}
            {leg.durationS > 0 && <> · {formatDuration(leg.durationS, fr)}</>}
          </span>
        </div>
      )}
      <div
        onClick={onFocus}
        className={
          'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-2 transition-colors ' +
          (selected ? 'bg-surface-secondary ring-1 ring-inset' : 'hover:bg-surface-secondary')
        }
        style={selected ? { ['--tw-ring-color' as any]: `${color}` } : undefined}
      >
        {/* step number — outside the bubble */}
        <span className="w-4 shrink-0 text-center text-[12px] font-bold text-text-secondary tabular-nums">{index + 1}</span>
        {/* client DiceBear */}
        <span className="relative shrink-0 rounded-full ring-2" style={{ ['--tw-ring-color' as any]: `${color}55` }}>
          <UnifiedAvatar id={job.clientId || job.id} name={job.clientName || job.title} size={32} />
          {done && (
            <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface-card">
              <CheckCircle2 size={13} className="text-success" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={'block truncate text-[12.5px] font-semibold ' + (done ? 'text-text-tertiary line-through' : 'text-text-primary')}>
            {job.clientName ? `${job.clientName} · ${job.title}` : job.title}
          </span>
          {job.address && (
            <span className="flex items-center gap-1 truncate text-[11px] text-text-tertiary">
              <MapPin size={10} className="shrink-0" />{job.address}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {job.revenueCents > 0 && (
            <span className="text-[11.5px] font-bold text-success tabular-nums">{formatCurrency(job.revenueCents / 100)}</span>
          )}
          <span className="text-right">
            <span className={'block text-[12px] font-bold tabular-nums ' + (isLate ? 'text-warning' : 'text-text-primary')}>
              {(eta ?? planned).toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
            {moved && (
              <span className="block text-[9.5px] text-text-tertiary tabular-nums">
                {fr ? 'prévu' : 'planned'} {planned.toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-secondary"
            title={fr ? 'Ouvrir la job' : 'Open job'}
          >
            <ExternalLink size={13} />
          </button>
        </span>
      </div>
    </li>
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

function RouteMap({
  routes, startPoint, selectedId, onSelect, onJobClick, flyToRef,
}: {
  routes: TeamRoute[];
  startPoint: { lat: number; lng: number } | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onJobClick?: (jobId: string) => void;
  flyToRef: React.MutableRefObject<((lng: number, lat: number) => void) | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, { marker: mapboxgl.Marker; el: HTMLDivElement }>>(new Map());
  const startMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [ready, setReady] = useState(false);

  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onJobClickRef = useRef(onJobClick); onJobClickRef.current = onJobClick;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const tk = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!tk) return;
    mapboxgl.accessToken = tk;
    const map = new mapboxgl.Map({
      container,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-72.5485, 46.343],
      zoom: 10,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on('load', () => { map.resize(); setReady(true); });
    flyToRef.current = (lng, lat) => map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), duration: 500 });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; flyToRef.current = null; setReady(false); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current = new Map();

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoint = false;

    // Start marker (dispatcher position)
    startMarkerRef.current?.remove();
    startMarkerRef.current = null;
    if (startPoint) {
      const el = document.createElement('div');
      el.style.cssText =
        'width:16px;height:16px;border-radius:50%;background:#171717;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);';
      startMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([startPoint.lng, startPoint.lat]).addTo(map);
      bounds.extend([startPoint.lng, startPoint.lat]);
      hasPoint = true;
    }

    routes.forEach((r, ri) => {
      const pts = r.jobs.filter((j) => j.lat != null && j.lng != null);
      const srcId = `route-src-${ri}`;
      const lineId = `route-line-${ri}`;

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

      pts.forEach((j, i) => {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';
        const idx = document.createElement('div');
        idx.textContent = String(i + 1);
        idx.style.cssText =
          `font:800 10px Inter,system-ui,sans-serif;color:#171717;background:#fff;border:1px solid #e5e5e5;` +
          `border-radius:999px;padding:0 5px;line-height:15px;margin-bottom:-4px;z-index:2;box-shadow:0 1px 3px rgba(0,0,0,.15);`;
        const drop = document.createElement('div');
        drop.style.cssText =
          `width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${r.color};` +
          `border:2.5px solid #fff;box-shadow:0 2px 7px rgba(0,0,0,.32);overflow:hidden;display:flex;align-items:center;justify-content:center;` +
          `transition:transform .15s;`;
        const img = document.createElement('img');
        img.src = dicebearUrl(j.clientId || j.id);
        img.alt = '';
        img.loading = 'lazy';
        img.style.cssText = 'width:100%;height:100%;transform:rotate(45deg) scale(1.42);';
        drop.appendChild(img);
        el.appendChild(idx);
        el.appendChild(drop);
        // Clic sur le pin → ouvre directement les infos de la job (+ highlight).
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectRef.current(j.id);
          if (j.jobId) onJobClickRef.current?.(j.jobId);
        });
        const m = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([j.lng!, j.lat!]).addTo(map);
        markersRef.current.set(j.id, { marker: m, el });
        bounds.extend([j.lng!, j.lat!]);
        hasPoint = true;
      });

      if (coords.length < 2) {
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getSource(srcId)) map.removeSource(srcId);
      }
    });

    for (let ri = routes.length; ri < routes.length + 8; ri++) {
      const lineId = `route-line-${ri}`, srcId = `route-src-${ri}`;
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(srcId)) map.removeSource(srcId);
    }

    if (hasPoint) map.fitBounds(bounds, { padding: 44, maxZoom: 15, duration: 350 });
  }, [routes, startPoint, ready]);

  // Highlight the selected pin.
  useEffect(() => {
    markersRef.current.forEach(({ el }, id) => {
      const drop = el.lastChild as HTMLElement | null;
      if (drop) drop.style.transform = id === selectedId ? 'rotate(-45deg) scale(1.28)' : 'rotate(-45deg)';
      el.style.zIndex = id === selectedId ? '5' : '';
    });
  }, [selectedId, routes]);

  return <div ref={containerRef} className="h-full w-full" />;
}
