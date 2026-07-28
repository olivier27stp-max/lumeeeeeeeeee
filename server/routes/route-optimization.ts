import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { geocodeAddress, normalizeAddress } from '../lib/helpers';
import { haversineKm, estimateDriveMinutes, type LatLng } from '../lib/geo';
import { osrmTable } from '../lib/osrm';

/**
 * Route optimization — V2.
 *
 * Algorithm: nearest-neighbor TSP heuristic sur une matrice de coûts.
 *   - Départ au `start_location` (si fourni), sinon au premier job.
 *   - À chaque étape, on choisit le job non visité le plus « proche » selon la
 *     matrice de coûts (durée de conduite).
 *   - On s'arrête quand tous les jobs sont visités.
 *
 * Source des distances/temps (par ordre de préférence) :
 *   1. OSRM (OpenStreetMap) — VRAIES routes et temps de conduite. Gratuit.
 *      provider = 'osrm'.
 *   2. Repli haversine — distance à vol d'oiseau + 50 km/h, si OSRM échoue.
 *      provider = 'haversine'.
 *
 * Limite honnête : nearest-neighbor n'est pas l'optimum absolu (TSP est
 * NP-difficile) mais reste ~à 25 % de l'optimal pour <20 arrêts, et sur de
 * VRAIS temps de route le résultat est nettement meilleur qu'à vol d'oiseau.
 * Pour l'optimum strict : Mapbox Optimization / Google Route Optimization /
 * OR-Tools.
 */

const router = Router();

const MAX_STOPS = 30;
const AVG_KMH = 50;

type JobStop = {
  job_id: string;
  title: string | null;
  address: string | null;
  lat: number;
  lng: number;
  duration_minutes: number;
};

type OrderedJob = {
  job_id: string;
  order: number;
  distance_km_from_prev: number;
  eta_minutes_from_prev: number;
  estimated_arrival_time: string;
};

router.post('/route-optimization/optimize', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { client, orgId } = auth;

    const body = req.body || {};
    const jobIds: string[] = Array.isArray(body.job_ids) ? body.job_ids.filter((x: any) => typeof x === 'string') : [];
    const startLocation: { lat?: number; lng?: number; address?: string } | undefined = body.start_location;
    const endLocation: { lat?: number; lng?: number; address?: string } | undefined = body.end_location;
    const departAt: string | undefined = body.depart_at; // ISO string, optional

    if (jobIds.length === 0) {
      return res.status(400).json({ error: 'job_ids is required (non-empty array)' });
    }
    if (jobIds.length > MAX_STOPS) {
      return res.status(400).json({ error: `Too many stops. Maximum is ${MAX_STOPS}.` });
    }

    // Fetch jobs scoped to org. Pull both lat/lng and address so we can geocode
    // missing coords on the fly.
    const { data: rawJobs, error: jobsErr } = await client
      .from('jobs')
      .select('id, org_id, title, property_address, address, latitude, longitude, scheduled_at, end_at')
      .in('id', jobIds)
      .eq('org_id', orgId)
      .is('deleted_at', null);

    if (jobsErr) throw jobsErr;
    if (!rawJobs || rawJobs.length === 0) {
      return res.status(404).json({ error: 'No matching jobs found for this organization.' });
    }

    // Geocode any jobs missing coordinates.
    const stops: JobStop[] = [];
    const skipped: { job_id: string; reason: string }[] = [];

    for (const j of rawJobs) {
      const id = String((j as any).id);
      let lat = (j as any).latitude;
      let lng = (j as any).longitude;
      const rawAddr = (j as any).property_address || (j as any).address || '';
      const addr = normalizeAddress(rawAddr);

      if ((lat == null || lng == null) && addr) {
        const geo = await geocodeAddress(addr);
        if (geo) {
          lat = geo.latitude;
          lng = geo.longitude;
          // Persist for next time (best-effort, ignore errors).
          try {
            await client
              .from('jobs')
              .update({
                latitude: geo.latitude,
                longitude: geo.longitude,
                geocode_status: 'ok',
                geocoded_at: new Date().toISOString(),
              })
              .eq('id', id)
              .eq('org_id', orgId);
          } catch {
            /* non-fatal */
          }
        }
      }

      if (lat == null || lng == null) {
        skipped.push({ job_id: id, reason: addr ? 'geocode_failed' : 'missing_address' });
        continue;
      }

      // Compute duration from scheduled_at/end_at if present, else default 60 min.
      let duration = 60;
      const sa = (j as any).scheduled_at;
      const ea = (j as any).end_at;
      if (sa && ea) {
        const diff = (new Date(ea).getTime() - new Date(sa).getTime()) / 60000;
        if (Number.isFinite(diff) && diff > 0) duration = Math.round(diff);
      }

      stops.push({
        job_id: id,
        title: (j as any).title || null,
        address: rawAddr || null,
        lat: Number(lat),
        lng: Number(lng),
        duration_minutes: duration,
      });
    }

    if (stops.length === 0) {
      return res.status(422).json({
        error: 'No jobs have usable coordinates after geocoding.',
        skipped,
      });
    }

    // Determine starting point.
    let startPoint: LatLng;
    if (startLocation && Number.isFinite(startLocation.lat) && Number.isFinite(startLocation.lng)) {
      startPoint = { lat: Number(startLocation.lat), lng: Number(startLocation.lng) };
    } else if (startLocation?.address) {
      const geo = await geocodeAddress(normalizeAddress(startLocation.address));
      startPoint = geo ? { lat: geo.latitude, lng: geo.longitude } : { lat: stops[0].lat, lng: stops[0].lng };
    } else {
      startPoint = { lat: stops[0].lat, lng: stops[0].lng };
    }

    const endPoint: LatLng | null =
      endLocation && Number.isFinite(endLocation.lat) && Number.isFinite(endLocation.lng)
        ? { lat: Number(endLocation.lat), lng: Number(endLocation.lng) }
        : null;

    /* ── Matrice de coûts ──
       On assemble tous les points [départ, ...arrêts, (fin?)] et on demande à
       OSRM la matrice des vraies durées/distances de conduite. Si OSRM répond,
       provider='osrm' (routes réelles). Sinon on retombe sur haversine à vol
       d'oiseau, sans jamais planter. Index 0 = départ, 1..N = arrêts. */
    const matrixPoints: LatLng[] = [startPoint, ...stops.map((s) => ({ lat: s.lat, lng: s.lng }))];
    if (endPoint) matrixPoints.push(endPoint);
    const endIdx = endPoint ? matrixPoints.length - 1 : -1;

    const matrix = await osrmTable(matrixPoints);
    const provider: 'osrm' | 'haversine' = matrix ? 'osrm' : 'haversine';

    // Coût (minutes) et distance (km) entre deux index de matrixPoints.
    const legMinutes = (from: number, to: number): number => {
      if (matrix && matrix.durations[from]?.[to] != null) {
        return Math.round(matrix.durations[from][to] / 60);
      }
      return estimateDriveMinutes(haversineKm(matrixPoints[from], matrixPoints[to]), AVG_KMH);
    };
    const legKm = (from: number, to: number): number => {
      if (matrix && matrix.distances[from]?.[to] != null) {
        return Math.round((matrix.distances[from][to] / 1000) * 100) / 100;
      }
      return Math.round(haversineKm(matrixPoints[from], matrixPoints[to]) * 100) / 100;
    };

    // Nearest-neighbor sur la matrice (coût = temps de conduite).
    // On travaille avec les index de matrixPoints : les arrêts sont 1..stops.length.
    const remainingIdx = stops.map((_, i) => i + 1);
    const ordered: OrderedJob[] = [];
    let totalKm = 0;
    let totalDriveMin = 0;
    const departureMs = departAt ? new Date(departAt).getTime() : Date.now();
    let clockMs = Number.isFinite(departureMs) ? departureMs : Date.now();
    let cursorIdx = 0; // départ

    while (remainingIdx.length > 0) {
      let bestPos = 0;
      let bestMin = Infinity;
      for (let i = 0; i < remainingIdx.length; i++) {
        const m = legMinutes(cursorIdx, remainingIdx[i]);
        if (m < bestMin) {
          bestMin = m;
          bestPos = i;
        }
      }
      const nextIdx = remainingIdx.splice(bestPos, 1)[0];
      const driveMin = legMinutes(cursorIdx, nextIdx);
      const km = legKm(cursorIdx, nextIdx);
      clockMs += driveMin * 60 * 1000;

      const stop = stops[nextIdx - 1];
      ordered.push({
        job_id: stop.job_id,
        order: ordered.length,
        distance_km_from_prev: km,
        eta_minutes_from_prev: driveMin,
        estimated_arrival_time: new Date(clockMs).toISOString(),
      });

      totalKm += km;
      totalDriveMin += driveMin;

      // Avance l'horloge de la durée de la visite.
      clockMs += stop.duration_minutes * 60 * 1000;
      cursorIdx = nextIdx;
    }

    // Trajet de retour optionnel vers end_location.
    let returnLeg: { distance_km: number; drive_minutes: number } | null = null;
    if (endIdx >= 0) {
      const m = legMinutes(cursorIdx, endIdx);
      const d = legKm(cursorIdx, endIdx);
      returnLeg = { distance_km: d, drive_minutes: m };
      totalKm += d;
      totalDriveMin += m;
    }

    // Build a stops array with full info (for the map view / table).
    const orderedDetailed = ordered.map((o) => {
      const meta = stops.find((s) => s.job_id === o.job_id)!;
      return {
        ...o,
        title: meta.title,
        address: meta.address,
        lat: meta.lat,
        lng: meta.lng,
        duration_minutes: meta.duration_minutes,
      };
    });

    const providerNote =
      provider === 'haversine'
        ? 'Itinéraire estimé à vol d’oiseau (OSRM indisponible).'
        : undefined;
    const skipNote = skipped.length
      ? 'Certains jobs ont été ignorés (voir `skipped`) : coordonnées manquantes.'
      : undefined;

    return res.status(200).json({
      ok: true,
      algorithm: 'nearest-neighbor',
      provider,
      ordered_jobs: orderedDetailed,
      total_distance_km: Math.round(totalKm * 100) / 100,
      total_drive_minutes: totalDriveMin,
      return_leg: returnLeg,
      skipped,
      notes: [skipNote, providerNote].filter(Boolean).join(' ') || undefined,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Route optimization failed.', '[route-optimization/optimize]');
  }
});

export default router;
