// Route computation for the schedule Trajet view — 1:1 port of the web
// src/lib/routeApi.ts (Mapbox Directions + Optimization APIs, local
// nearest-neighbour fallback). Only the token source differs (Expo env).

export interface RouteStop {
  /** Stable id (job id) — used to map results back to the source jobs */
  id: string;
  lat: number;
  lng: number;
}

export interface RouteLeg {
  /** Metres for the leg leading INTO this stop (0 for the first stop) */
  distanceM: number;
  /** Seconds of driving for the leg leading INTO this stop (0 for the first) */
  durationS: number;
}

export interface RouteResult {
  /** Stop ids in travel order (same order the caller passed, for getRoute) */
  order: string[];
  /** Per-stop legs, aligned with `order` (legs[0] is always 0/0) */
  legs: RouteLeg[];
  /** Total driving distance in metres */
  totalDistanceM: number;
  /** Total driving time in seconds */
  totalDurationS: number;
  /** GeoJSON LineString coordinates [lng,lat][] for the drawn route (route geometry) */
  geometry: [number, number][];
  /** True when the order was produced by the optimizer (vs the input order) */
  optimized: boolean;
}

// Mapbox caps coordinates per request. Directions allows more, but Optimization
// (the trip solver) is limited to 12 including source/destination — we cap both
// paths at 12 so behaviour is predictable.
const MAX_STOPS = 12;

function token(): string {
  return process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
}

/** Haversine distance in metres between two lng/lat points. */
export function haversineM(a: RouteStop, b: RouteStop): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Local nearest-neighbour ordering starting from the first stop. */
function nearestNeighbourOrder(stops: RouteStop[]): RouteStop[] {
  if (stops.length <= 2) return [...stops];
  const remaining = [...stops];
  const ordered: RouteStop[] = [remaining.shift()!];
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((s, i) => {
      const d = haversineM(last, s);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  return ordered;
}

/** Total straight-line length of an ordered chain (metres). */
function chainLength(order: RouteStop[]): number {
  let sum = 0;
  for (let i = 1; i < order.length; i++) sum += haversineM(order[i - 1], order[i]);
  return sum;
}

/** Nearest-neighbour started from a specific index. */
function nnFrom(stops: RouteStop[], startIdx: number): RouteStop[] {
  const remaining = stops.slice();
  const ordered: RouteStop[] = [remaining.splice(startIdx, 1)[0]];
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0, bestDist = Infinity;
    remaining.forEach((s, i) => { const d = haversineM(last, s); if (d < bestDist) { bestDist = d; bestIdx = i; } });
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  return ordered;
}

/** Try nearest-neighbour from every start; keep the shortest chain. */
function bestNearestNeighbour(stops: RouteStop[]): RouteStop[] {
  if (stops.length <= 2) return [...stops];
  let best: RouteStop[] | null = null;
  let bestLen = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const chain = nnFrom(stops, i);
    const len = chainLength(chain);
    if (len < bestLen) { bestLen = len; best = chain; }
  }
  return best!;
}

function coordString(stops: RouteStop[]): string {
  return stops.map((s) => `${s.lng},${s.lat}`).join(';');
}

/** Build legs + totals from a Mapbox route (legs are between consecutive stops). */
function legsFromMapbox(route: any): { legs: RouteLeg[]; totalDistanceM: number; totalDurationS: number } {
  const mbLegs: any[] = route?.legs ?? [];
  // legs[i] is the leg BETWEEN stop i and stop i+1. We store the leg leading
  // INTO each stop, so stop 0 gets 0/0 and stop i+1 gets mbLegs[i].
  const legs: RouteLeg[] = [{ distanceM: 0, durationS: 0 }];
  for (const leg of mbLegs) {
    legs.push({ distanceM: leg.distance ?? 0, durationS: leg.duration ?? 0 });
  }
  return {
    legs,
    totalDistanceM: route?.distance ?? 0,
    totalDurationS: route?.duration ?? 0,
  };
}

/**
 * Driving route through the stops IN THE GIVEN ORDER. Returns real street
 * geometry + per-leg distance/time. Throws on network/API error.
 */
export async function getRoute(stops: RouteStop[]): Promise<RouteResult> {
  const capped = stops.slice(0, MAX_STOPS);
  if (capped.length < 2) {
    return {
      order: capped.map((s) => s.id),
      legs: capped.map(() => ({ distanceM: 0, durationS: 0 })),
      totalDistanceM: 0, totalDurationS: 0, geometry: [], optimized: false,
    };
  }
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coordString(capped)}` +
    `?geometries=geojson&overview=full&access_token=${token()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions API ${res.status}`);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route) throw new Error('No route returned');
  const { legs, totalDistanceM, totalDurationS } = legsFromMapbox(route);
  return {
    order: capped.map((s) => s.id),
    legs,
    totalDistanceM,
    totalDurationS,
    geometry: (route.geometry?.coordinates ?? []) as [number, number][],
    optimized: false,
  };
}

/**
 * Shortest-order trip through the stops. Uses the Mapbox Optimization API
 * (a real TSP solver over the road network) to minimise total driving time —
 * i.e. the least back-tracking. Falls back to a local nearest-neighbour order +
 * Directions geometry when the optimizer is unavailable. Never throws.
 *
 * `anchorFirst`: keep stops[0] as the fixed start (use when it's a real origin,
 * e.g. the dispatcher's current position). When false, Mapbox is free to pick
 * the best starting stop — which removes back-tracking that a forced start
 * would otherwise cause.
 */
export async function getOptimizedRoute(stops: RouteStop[], anchorFirst = false): Promise<RouteResult> {
  const capped = stops.slice(0, MAX_STOPS);
  if (capped.length < 3) {
    // Nothing to optimize — the visiting order is forced.
    try { return { ...(await getRoute(capped)), optimized: false }; }
    catch { return fallbackLocal(capped, anchorFirst); }
  }

  try {
    const source = anchorFirst ? 'first' : 'any';
    const url =
      `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordString(capped)}` +
      `?source=${source}&roundtrip=false&geometries=geojson&overview=full&access_token=${token()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Optimization API ${res.status}`);
    const data = await res.json();
    const trip = data?.trips?.[0];
    const waypoints: any[] = data?.waypoints ?? [];
    if (!trip || !waypoints.length) throw new Error('No trip returned');

    // waypoint.waypoint_index gives the visiting order for each INPUT stop.
    const orderedStops = capped
      .map((s, i) => ({ s, pos: waypoints[i]?.waypoint_index ?? i }))
      .sort((a, b) => a.pos - b.pos)
      .map((x) => x.s);

    const { legs, totalDistanceM, totalDurationS } = legsFromMapbox(trip);
    return {
      order: orderedStops.map((s) => s.id),
      legs,
      totalDistanceM,
      totalDurationS,
      geometry: (trip.geometry?.coordinates ?? []) as [number, number][],
      optimized: true,
    };
  } catch {
    return fallbackLocal(capped, anchorFirst);
  }
}

/**
 * Local fallback: nearest-neighbour order, then real geometry via Directions.
 * When not anchored, try starting the greedy chain from EACH stop and keep the
 * shortest total — a cheap way to avoid the classic nearest-neighbour trap of a
 * bad first pick sending the route back and forth.
 */
async function fallbackLocal(stops: RouteStop[], anchorFirst = false): Promise<RouteResult> {
  const candidate = anchorFirst ? nearestNeighbourOrder(stops) : bestNearestNeighbour(stops);
  // Never return an order WORSE than the input: if the greedy chain isn't
  // shorter (straight-line) than the given order, keep the input order so the
  // "optimized" result is at worst equal — never a regression.
  const ordered = chainLength(candidate) < chainLength(stops) ? candidate : stops;
  const improved = ordered !== stops;
  try {
    const r = await getRoute(ordered);
    return { ...r, optimized: improved };
  } catch {
    // Even Directions failed — return straight-line legs so the list still works.
    const legs: RouteLeg[] = ordered.map((s, i) =>
      i === 0 ? { distanceM: 0, durationS: 0 }
              : { distanceM: haversineM(ordered[i - 1], s), durationS: 0 });
    const totalDistanceM = legs.reduce((sum, l) => sum + l.distanceM, 0);
    return {
      order: ordered.map((s) => s.id),
      legs,
      totalDistanceM,
      totalDurationS: 0,
      geometry: ordered.map((s) => [s.lng, s.lat] as [number, number]),
      optimized: improved,
    };
  }
}

/** Human-friendly "12.4 km" / "840 m". */
export function formatDistance(metres: number, fr: boolean): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

/** Human-friendly "1 h 05" / "23 min". */
export function formatDuration(seconds: number, fr: boolean): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return fr ? `${h} h ${String(m).padStart(2, '0')}` : `${h}h ${String(m).padStart(2, '0')}`;
}
