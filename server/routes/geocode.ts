import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { consumeGeocodeQuota, normalizeAddress, geocodeAddress } from '../lib/helpers';
import { validate, geocodeJobSchema } from '../lib/validation';

const router = Router();

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
