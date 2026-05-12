import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { geocodeAddress, normalizeAddress } from '../lib/helpers';
import { haversineKm, estimateDriveMinutes, type LatLng } from '../lib/geo';

/**
 * Route optimization — V1.
 *
 * Algorithm: nearest-neighbor TSP heuristic.
 *   - Start at `start_location` (if provided), else at the first input job.
 *   - At each step, pick the unvisited job whose haversine distance to the
 *     current position is smallest.
 *   - Stop when all jobs are visited.
 *
 * Known limitations (be honest):
 *   - Nearest-neighbor is NOT optimal. True TSP is NP-hard; this is a greedy
 *     heuristic that typically lands within 25% of optimal for <20 stops.
 *   - We use straight-line (haversine) distance, not real drive distance.
 *     Two stops separated by a river will look closer than they drive.
 *   - Drive time uses a flat 50 km/h average — fine for cities, optimistic for
 *     rural sprawl, pessimistic for highways.
 *
 * Upgrade paths (for paying tiers):
 *   - Set GOOGLE_MAPS_API_KEY: route falls through to Distance Matrix API for
 *     real drive times (still nearest-neighbor on the matrix).
 *   - For true optimal, swap in Mapbox Optimization API or OR-Tools.
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
    let cursor: LatLng;
    if (startLocation && Number.isFinite(startLocation.lat) && Number.isFinite(startLocation.lng)) {
      cursor = { lat: Number(startLocation.lat), lng: Number(startLocation.lng) };
    } else if (startLocation?.address) {
      const geo = await geocodeAddress(normalizeAddress(startLocation.address));
      cursor = geo ? { lat: geo.latitude, lng: geo.longitude } : { lat: stops[0].lat, lng: stops[0].lng };
    } else {
      cursor = { lat: stops[0].lat, lng: stops[0].lng };
    }

    // Nearest-neighbor traversal.
    const remaining = [...stops];
    const ordered: OrderedJob[] = [];
    let totalKm = 0;
    let totalDriveMin = 0;
    const departureMs = departAt ? new Date(departAt).getTime() : Date.now();
    let clockMs = Number.isFinite(departureMs) ? departureMs : Date.now();

    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestKm = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = haversineKm(cursor, { lat: remaining[i].lat, lng: remaining[i].lng });
        if (d < bestKm) {
          bestKm = d;
          bestIdx = i;
        }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      const driveMin = estimateDriveMinutes(bestKm, AVG_KMH);
      clockMs += driveMin * 60 * 1000;

      ordered.push({
        job_id: next.job_id,
        order: ordered.length,
        distance_km_from_prev: Math.round(bestKm * 100) / 100,
        eta_minutes_from_prev: driveMin,
        estimated_arrival_time: new Date(clockMs).toISOString(),
      });

      totalKm += bestKm;
      totalDriveMin += driveMin;

      // Advance the in-day clock by the visit duration.
      clockMs += next.duration_minutes * 60 * 1000;
      cursor = { lat: next.lat, lng: next.lng };
    }

    // Optional return-to-end leg.
    let returnLeg: { distance_km: number; drive_minutes: number } | null = null;
    if (endLocation && Number.isFinite(endLocation.lat) && Number.isFinite(endLocation.lng)) {
      const d = haversineKm(cursor, { lat: Number(endLocation.lat), lng: Number(endLocation.lng) });
      const m = estimateDriveMinutes(d, AVG_KMH);
      returnLeg = { distance_km: Math.round(d * 100) / 100, drive_minutes: m };
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

    return res.status(200).json({
      ok: true,
      algorithm: 'nearest-neighbor',
      provider: 'haversine',
      ordered_jobs: orderedDetailed,
      total_distance_km: Math.round(totalKm * 100) / 100,
      total_drive_minutes: totalDriveMin,
      return_leg: returnLeg,
      skipped,
      notes: skipped.length
        ? 'Some jobs were skipped — see `skipped`. They are missing valid coordinates.'
        : undefined,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Route optimization failed.', '[route-optimization/optimize]');
  }
});

export default router;
