import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { consumeGeocodeQuota, normalizeAddress, geocodeAddress } from '../lib/helpers';
import {
  validate,
  geocodeJobSchema,
  placesAutocompleteSchema,
  placesDetailsSchema,
} from '../lib/validation';

const router = Router();

// ── Places autocomplete proxy ──
// The browser Google Maps key is referer-restricted and its allowlist doesn't
// include every domain the app runs on, which silently killed the address
// autocomplete client-side. The server calls Places API (New) directly and
// sends an allowlisted referer, so the frontend works from any domain.
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
const PLACES_REFERER = process.env.GOOGLE_PLACES_REFERER || 'https://lumeeeeeeeeee-production.up.railway.app/';

// Per-user rate limits (autocomplete fires on every debounced keystroke)
const placesLimiter = new Map<string, { count: number; windowStart: number }>();
function consumePlacesQuota(key: string, max: number) {
  const now = Date.now();
  const windowMs = 60_000;
  const current = placesLimiter.get(key);
  if (!current || now - current.windowStart >= windowMs) {
    placesLimiter.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (current.count >= max) return false;
  current.count += 1;
  return true;
}

// Org address geocoded once and cached — used to rank nearby suggestions first.
const orgGeoCache = new Map<string, { point: { lat: number; lng: number } | null; at: number }>();
const ORG_GEO_TTL_MS = 24 * 60 * 60 * 1000;
async function getOrgBias(client: any, orgId: string): Promise<{ lat: number; lng: number } | null> {
  const hit = orgGeoCache.get(orgId);
  if (hit && Date.now() - hit.at < ORG_GEO_TTL_MS) return hit.point;
  let point: { lat: number; lng: number } | null = null;
  try {
    const { data } = await client
      .from('company_settings')
      .select('street1, city, province, postal_code')
      .eq('org_id', orgId)
      .limit(1)
      .maybeSingle();
    const query = [data?.street1, data?.city, data?.province, data?.postal_code]
      .filter(Boolean).join(', ').trim();
    if (query) {
      const geo = await geocodeAddress(query);
      if (geo) point = { lat: geo.latitude, lng: geo.longitude };
    }
  } catch { /* bias is a nice-to-have */ }
  orgGeoCache.set(orgId, { point, at: Date.now() });
  return point;
}

router.post('/places/autocomplete', validate(placesAutocompleteSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    if (!PLACES_KEY) return res.status(503).json({ error: 'Places API not configured.' });
    if (!consumePlacesQuota(`ac:${auth.user.id}`, 120)) {
      return res.status(429).json({ error: 'Too many requests.' });
    }

    const { input, countries, language, sessionToken } = req.body as {
      input: string; countries?: string[]; language?: string; sessionToken?: string;
    };
    const bias = await getOrgBias(auth.client, auth.orgId);

    const body: Record<string, unknown> = {
      input,
      includedRegionCodes: countries?.length ? countries : ['ca'],
      languageCode: language || 'fr',
    };
    if (sessionToken) body.sessionToken = sessionToken;
    if (bias) {
      body.locationBias = {
        circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 },
      };
    }

    const googleRes = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': PLACES_KEY,
        Referer: PLACES_REFERER,
      },
      body: JSON.stringify(body),
    });
    const data: any = await googleRes.json().catch(() => ({}));
    if (!googleRes.ok) {
      console.error('[places/autocomplete] google error:', googleRes.status, data?.error?.message);
      return res.status(502).json({ error: 'Address suggestions unavailable.' });
    }

    const suggestions = (data.suggestions || [])
      .map((s: any) => {
        const p = s.placePrediction;
        if (!p) return null;
        return {
          placeId: p.placeId,
          main: p.structuredFormat?.mainText?.text || p.text?.text || '',
          secondary: p.structuredFormat?.secondaryText?.text || '',
        };
      })
      .filter(Boolean);
    return res.status(200).json({ suggestions });
  } catch (error: any) {
    return sendSafeError(res, error, 'Address suggestions failed.', '[places/autocomplete]');
  }
});

router.post('/places/details', validate(placesDetailsSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    if (!PLACES_KEY) return res.status(503).json({ error: 'Places API not configured.' });
    if (!consumePlacesQuota(`det:${auth.user.id}`, 30)) {
      return res.status(429).json({ error: 'Too many requests.' });
    }

    const { placeId, language, sessionToken } = req.body as {
      placeId: string; language?: string; sessionToken?: string;
    };
    const params = new URLSearchParams({ languageCode: language || 'fr' });
    if (sessionToken) params.set('sessionToken', sessionToken);

    const googleRes = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${params}`,
      {
        headers: {
          'X-Goog-Api-Key': PLACES_KEY,
          'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents',
          Referer: PLACES_REFERER,
        },
      },
    );
    const data: any = await googleRes.json().catch(() => ({}));
    if (!googleRes.ok) {
      console.error('[places/details] google error:', googleRes.status, data?.error?.message);
      return res.status(502).json({ error: 'Address details unavailable.' });
    }

    const comps: any[] = data.addressComponents || [];
    const get = (type: string) => comps.find((c) => (c.types || []).includes(type))?.longText || '';
    return res.status(200).json({
      address: {
        formatted_address: data.formattedAddress || '',
        street_number: get('street_number'),
        street_name: get('route'),
        city: get('locality') || get('sublocality') || get('postal_town'),
        province: get('administrative_area_level_1'),
        postal_code: get('postal_code'),
        country: get('country'),
        latitude: data.location?.latitude ?? null,
        longitude: data.location?.longitude ?? null,
        place_id: data.id || placeId,
      },
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Address details failed.', '[places/details]');
  }
});

router.post('/geocode-job', validate(geocodeJobSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId, user } = auth;
    const jobId = String(req.body?.jobId || '').trim();
    if (!jobId) {
      return res.status(400).json({ error: 'Missing jobId' });
    }

    const limiterKey = `${orgId}:${user.id}`;
    if (!consumeGeocodeQuota(limiterKey)) {
      return res.status(429).json({ error: 'Too many geocode requests, please retry later.' });
    }

    const { data: jobRow, error: jobError } = await client
      .from('jobs')
      .select('id,org_id,property_address,address')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!jobRow) return res.status(404).json({ error: 'Job not found' });

    const address = normalizeAddress((jobRow as any).property_address || (jobRow as any).address || '');
    if (!address) {
      const { error: updateError } = await client
        .from('jobs')
        .update({ geocode_status: 'failed', geocoded_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('org_id', orgId);
      if (updateError) throw updateError;
      return res.status(422).json({ ok: false, reason: 'missing_address' });
    }

    const geocoded = await geocodeAddress(address);
    if (!geocoded) {
      const { error: updateError } = await client
        .from('jobs')
        .update({ geocode_status: 'failed', geocoded_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('org_id', orgId);
      if (updateError) throw updateError;
      return res.status(422).json({ ok: false, reason: 'geocode_not_found' });
    }

    const { error: updateError } = await client
      .from('jobs')
      .update({
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
        geocode_status: 'ok',
        geocoded_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('org_id', orgId);

    if (updateError) throw updateError;

    return res.status(200).json({
      ok: true,
      provider: geocoded.provider,
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Geocoding failed.', '[geocode-job]');
  }
});

router.post('/geocode-batch', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;

    // Fetch all jobs with an address but no valid coordinates
    const { data: jobs, error: fetchError } = await client
      .from('jobs')
      .select('id, property_address, address')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .is('latitude', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (fetchError) throw fetchError;

    const pending = (jobs || []).filter((j: any) => {
      const addr = normalizeAddress((j as any).property_address || (j as any).address || '');
      return addr.length > 0;
    });

    if (pending.length === 0) {
      return res.status(200).json({ ok: true, processed: 0, succeeded: 0, failed: 0 });
    }

    let succeeded = 0;
    let failed = 0;

    for (const job of pending) {
      const addr = normalizeAddress((job as any).property_address || (job as any).address || '');
      const geocoded = await geocodeAddress(addr);

      if (geocoded) {
        await client.from('jobs').update({
          latitude: geocoded.latitude,
          longitude: geocoded.longitude,
          geocode_status: 'ok',
          geocoded_at: new Date().toISOString(),
        }).eq('id', job.id).eq('org_id', orgId);
        succeeded++;
      } else {
        await client.from('jobs').update({
          geocode_status: 'failed',
          geocoded_at: new Date().toISOString(),
        }).eq('id', job.id).eq('org_id', orgId);
        failed++;
      }

      // Respect Nominatim rate limit (1 req/sec)
      if (pending.indexOf(job) < pending.length - 1) {
        await new Promise((r) => setTimeout(r, 1100));
      }
    }

    return res.status(200).json({ ok: true, processed: pending.length, succeeded, failed });
  } catch (error: any) {
    return sendSafeError(res, error, 'Batch geocoding failed.', '[geocode-batch]');
  }
});

export default router;
