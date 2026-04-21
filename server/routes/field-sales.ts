import { Router, Request, Response } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { scoreAllTerritories, scoreAllPins, getCompanyProfile } from '../lib/field-sales/scoring-engine';
import { getScheduleRecommendations } from '../lib/field-sales/scheduling-engine';
import { getFollowUpRecommendations } from '../lib/field-sales/followup-engine';
import { generateDailyPlan } from '../lib/field-sales/daily-plan-engine';
import { getAssignmentRecommendations } from '../lib/field-sales/territory-assignment-engine';
import { autoCreateOrMergePin } from '../lib/field-sales/auto-pin';

const router = Router();
// Global guards for this router — size cap + type-check of common fields
router.use(maxBodySize());
router.use(guardCommonShape);

const STATUS_COLORS: Record<string, string> = {
  unknown: '#6b7280', no_answer: '#9ca3af', not_interested: '#ef4444',
  lead: '#3b82f6', quote_sent: '#a855f7', sale: '#22c55e',
  callback: '#f59e0b', do_not_knock: '#dc2626', revisit: '#06b6d4',
};

// ---------------------------------------------------------------------------
// Helper: haversine distance in metres between two lat/lng points
// ---------------------------------------------------------------------------
function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Event-type → status mapping
// ---------------------------------------------------------------------------
const EVENT_STATUS_MAP: Record<string, string> = {
  knock: 'knocked',
  no_answer: 'no_answer',
  not_interested: 'not_interested',
  callback: 'callback',
  lead: 'lead',
  sale: 'sold',
  follow_up: 'follow_up',
  cancel: 'cancelled',
};

// ---------------------------------------------------------------------------
// 1. GET /field-sales/houses
// ---------------------------------------------------------------------------
router.get('/houses', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const {
    status,
    territory_id,
    search,
    lat,
    lng,
    radius,
    page = '1',
    limit = '50',
    north,
    south,
    east,
    west,
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  try {
    
    

    let query = admin
      .from('field_house_profiles')
      .select(
        `*, field_pins!field_pins_house_id_fkey(
          id, status, pin_color, has_note, lat, lng, updated_at
        )`,
        { count: 'exact' }
      )
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .order('last_activity_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (status) query = query.eq('current_status', status);
    if (territory_id) query = query.eq('territory_id', territory_id);
    if (search) {
      query = query.ilike('address_normalized', `%${search.toLowerCase().trim()}%`);
    }

    const { data: houses, error, count } = await query;
    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');

    // Geo-radius filter (post-query, Supabase free tier has no PostGIS)
    let result = houses ?? [];
    if (lat && lng && radius) {
      const latN = parseFloat(lat);
      const lngN = parseFloat(lng);
      const radN = parseFloat(radius);
      if (!isNaN(latN) && !isNaN(lngN) && !isNaN(radN) && radN > 0) {
        result = result.filter(
          (h: any) => h.lat != null && h.lng != null && haversineMetres(latN, lngN, h.lat, h.lng) <= radN
        );
      }
    }

    return res.json({ data: result, total: count, page: pageNum, limit: limitNum });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 2. GET /field-sales/houses/:id
// ---------------------------------------------------------------------------
router.get('/houses/:id', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    
    

    const { data: house, error: hErr } = await admin
      .from('field_house_profiles')
      .select('*')
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .single();

    if (hErr || !house) return res.status(404).json({ error: 'House not found' });

    const { data: events } = await admin
      .from('field_house_events')
      .select('*')
      .eq('house_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(50);

    const { data: pin } = await admin
      .from('field_pins')
      .select('*')
      .eq('house_id', req.params.id)
      .maybeSingle();

    // Compute simple score (0-100) based on status and visit count
    const STATUS_SCORE: Record<string, number> = {
      sold: 100,
      lead: 80,
      callback: 60,
      follow_up: 50,
      knocked: 30,
      no_answer: 20,
      not_interested: 5,
      cancelled: 0,
      new: 10,
    };
    const score = STATUS_SCORE[house.current_status] ?? 10;

    // Derive next action
    const NEXT_ACTION: Record<string, string> = {
      sold: 'Schedule installation',
      lead: 'Send proposal',
      callback: 'Call back as agreed',
      follow_up: 'Follow up visit',
      knocked: 'Revisit',
      no_answer: 'Try again later',
      not_interested: 'No action needed',
      cancelled: 'No action needed',
      new: 'First visit',
    };
    const next_action = NEXT_ACTION[house.current_status] ?? 'Visit house';

    // Get closer's name if closed
    let closed_by_name: string | null = null;
    if (house.closed_by_user_id) {
      const { data: profile } = await admin.from('profiles')
        .select('full_name').eq('id', house.closed_by_user_id).maybeSingle();
      closed_by_name = profile?.full_name ?? null;
    }

    return res.json({ ...house, events: events ?? [], pin, score, next_action, closed_by_name });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 3. POST /field-sales/houses
// ---------------------------------------------------------------------------
router.post('/houses', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const {
    address, lat, lng, status, note_text, territory_id, assigned_user_id, metadata,
    // Customer fields
    customer_name, customer_phone, customer_email,
  } = req.body;
  if (!address || lat == null || lng == null) {
    return res.status(400).json({ error: 'address, lat and lng are required' });
  }

  // CRM-linked statuses: customer info is optional for quick pin drops on the map.
  // A client will only be auto-created if customer_name AND (phone or email) are provided.
  // Otherwise the pin is created without a client link — rep can fill in details later via edit.
  const hasCustomerInfo = customer_name?.trim() && (customer_phone?.trim() || customer_email?.trim());

  try {
    const addressNorm = String(address).toLowerCase().trim();

    // Duplicate check: any house within 50 m — merge instead of reject
    const { data: nearby } = await admin
      .from('field_house_profiles')
      .select('id, address, lat, lng, client_id')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null);

    const duplicate = (nearby ?? []).find(
      (h: any) => haversineMetres(lat, lng, h.lat, h.lng) <= 50
    );

    // Auto-create client only when full customer info is provided AND status is CRM-linked
    const clientCreationStatuses = ['lead', 'sale', 'quote_sent'];
    let clientId: string | null = null;
    if (hasCustomerInfo && clientCreationStatuses.includes(status || '')) {
      const nameParts = String(customer_name).trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      // Check for existing client by email or phone
      let existingClient = null;
      if (customer_email) {
        const { data: byEmail } = await admin.from('clients')
          .select('id').eq('org_id', auth.orgId).eq('email', customer_email).is('deleted_at', null).maybeSingle();
        existingClient = byEmail;
      }
      if (!existingClient && customer_phone) {
        const { data: byPhone } = await admin.from('clients')
          .select('id').eq('org_id', auth.orgId).eq('phone', customer_phone).is('deleted_at', null).maybeSingle();
        existingClient = byPhone;
      }

      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const { data: newClient } = await admin.from('clients').insert({
          org_id: auth.orgId,
          created_by: auth.user.id,
          first_name: firstName,
          last_name: lastName,
          email: customer_email || null,
          phone: customer_phone || null,
          address,
          status: 'lead',
        }).select('id').single();
        clientId = newClient?.id ?? null;
      }
    }

    if (duplicate) {
      // Merge into existing pin instead of rejecting
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (status) updates.current_status = status;
      if (clientId && !duplicate.client_id) updates.client_id = clientId;
      if (assigned_user_id) updates.assigned_user_id = assigned_user_id;
      updates.last_activity_at = new Date().toISOString();

      await admin.from('field_house_profiles').update(updates).eq('id', duplicate.id);

      // Update pin visual
      const pinStatus = status || 'unknown';
      await admin.from('field_pins')
        .update({ status: pinStatus, pin_color: STATUS_COLORS[pinStatus] || '#9CA3AF', has_note: !!note_text, updated_at: new Date().toISOString() })
        .eq('house_id', duplicate.id);

      // Add merge event
      await admin.from('field_house_events').insert({
        org_id: auth.orgId, house_id: duplicate.id, user_id: auth.user.id,
        event_type: status || 'note',
        note_text: note_text || `Pin updated${customer_name ? ` — ${customer_name}` : ''}`,
        metadata: { merged: true, customer_name, customer_phone, customer_email },
      });

      const { data: merged } = await admin.from('field_house_profiles').select('*').eq('id', duplicate.id).single();
      return res.status(200).json({ ...merged, merged: true, client_id: clientId });
    }

    const { data: house, error: hErr } = await admin
      .from('field_house_profiles')
      .insert({
        org_id: auth.orgId,
        address,
        address_normalized: addressNorm,
        lat,
        lng,
        territory_id: territory_id ?? null,
        assigned_user_id: assigned_user_id ?? auth.user.id,
        current_status: status || 'unknown',
        client_id: clientId,
        visit_count: 0,
        last_activity_at: new Date().toISOString(),
        metadata: { ...(metadata ?? {}), customer_name, customer_phone, customer_email },
      })
      .select()
      .single();

    if (hErr) return sendSafeError(res, hErr, 'Field sales operation failed.', '[field-sales]');

    // Create initial pin
    const pinStatus = status || 'unknown';
    const pinColor = STATUS_COLORS[pinStatus] || '#9CA3AF';
    const { data: pin } = await admin
      .from('field_pins')
      .insert({
        org_id: auth.orgId,
        house_id: house.id,
        user_id: auth.user.id,
        status: pinStatus,
        pin_color: pinColor,
        has_note: !!note_text,
      })
      .select()
      .single();

    // Create events for creation + note
    const events: any[] = [{
      org_id: auth.orgId, house_id: house.id, user_id: auth.user.id,
      event_type: 'pin_created',
      note_text: `Pin created${customer_name ? ` — ${customer_name}` : ''}`,
      metadata: { status: pinStatus, customer_name, customer_phone, customer_email, client_id: clientId },
    }];
    if (note_text) {
      events.push({
        org_id: auth.orgId, house_id: house.id, user_id: auth.user.id,
        event_type: 'note', note_text,
      });
    }
    if (clientId) {
      events.push({
        org_id: auth.orgId, house_id: house.id, user_id: auth.user.id,
        event_type: 'note', note_text: `Client linked: ${customer_name}`,
        metadata: { auto_linked: true, entity_type: 'client', entity_id: clientId },
      });
    }
    await admin.from('field_house_events').insert(events);

    // Link client to pin entity links
    if (clientId) {
      await admin.from('field_pin_entity_links').upsert({
        org_id: auth.orgId, house_id: house.id,
        entity_type: 'client', entity_id: clientId, linked_at: new Date().toISOString(),
      }, { onConflict: 'org_id,house_id,entity_type,entity_id' });
    }

    // Async: trigger AI recalculation (non-blocking)
    (async () => {
      try {
        const profile = await getCompanyProfile(admin, auth.orgId);
        await scoreAllPins(admin, auth.orgId, profile);
        await scoreAllTerritories(admin, auth.orgId, profile);
      } catch { /* silent background task */ }
    })();

    return res.status(201).json({ ...house, pin, client_id: clientId });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 4. PUT /field-sales/houses/:id
// ---------------------------------------------------------------------------
router.put('/houses/:id', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    
    

    const allowed = [
      'address',
      'address_normalized',
      'lat',
      'lng',
      'current_status',
      'territory_id',
      'assigned_user_id',
      'metadata',
    ];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.address) {
      updates.address_normalized = String(updates.address).toLowerCase().trim();
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await admin
      .from('field_house_profiles')
      .update(updates)
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .select()
      .single();

    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 4b. DELETE /field-sales/houses/:id (soft delete house + pin)
// ---------------------------------------------------------------------------
router.delete('/houses/:id', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    const now = new Date().toISOString();

    // Soft-delete house
    const { error: hErr } = await admin
      .from('field_house_profiles')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId);

    if (hErr) return sendSafeError(res, hErr, 'Field sales operation failed.', '[field-sales]');

    // Delete associated pin (scoped to org for safety)
    const { error: pinErr, count: pinCount } = await admin
      .from('field_pins')
      .delete()
      .eq('house_id', req.params.id)
      .eq('org_id', auth.orgId);

    if (pinErr) {
      console.error('[field-sales] Pin delete failed:', pinErr.message);
    }

    // Also try without org_id filter as fallback (in case pin has different org_id)
    if (!pinCount || pinCount === 0) {
      await admin
        .from('field_pins')
        .delete()
        .eq('house_id', req.params.id);
    }

    return res.json({ success: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 4c. POST /field-sales/houses/:id/link — link house to client/lead/quote/job
// ---------------------------------------------------------------------------
router.post('/houses/:id/link', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { entity_type, entity_id } = req.body;
  if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' });

  const validTypes = ['client', 'lead', 'quote', 'job', 'invoice'];
  if (!validTypes.includes(entity_type)) return res.status(400).json({ error: `entity_type must be one of: ${validTypes.join(', ')}` });

  try {
    // Verify house
    const { data: house, error: hErr } = await admin
      .from('field_house_profiles')
      .select('id')
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .single();

    if (hErr || !house) return res.status(404).json({ error: 'House not found' });

    // Update house with entity link
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (entity_type === 'client') updates.client_id = entity_id;
    if (entity_type === 'lead') updates.lead_id = entity_id;
    if (entity_type === 'quote') updates.quote_id = entity_id;
    if (entity_type === 'job') updates.job_id = entity_id;

    await admin.from('field_house_profiles').update(updates).eq('id', req.params.id).eq('org_id', auth.orgId);

    // Also create link record
    await admin.from('field_pin_entity_links').upsert({
      org_id: auth.orgId,
      house_id: req.params.id,
      entity_type,
      entity_id,
      linked_at: new Date().toISOString(),
    }, { onConflict: 'org_id,house_id,entity_type,entity_id' });

    // Create event
    await admin.from('field_house_events').insert({
      org_id: auth.orgId,
      house_id: req.params.id,
      user_id: auth.user.id,
      event_type: 'note',
      note_text: `Linked to ${entity_type} ${entity_id}`,
      metadata: { auto_linked: true, entity_type, entity_id },
    });

    return res.json({ success: true, entity_type, entity_id });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 5. POST /field-sales/houses/:id/events
// ---------------------------------------------------------------------------
router.post('/houses/:id/events', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { event_type, note_text, note_voice_url, metadata } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type is required' });

  try {
    
    

    // Verify house belongs to org
    const { data: house, error: hErr } = await admin
      .from('field_house_profiles')
      .select('id, visit_count, current_status, lat, lng')
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .single();

    if (hErr || !house) return res.status(404).json({ error: 'House not found' });

    const now = new Date().toISOString();

    // Insert event
    const { data: event, error: eErr } = await admin
      .from('field_house_events')
      .insert({
        org_id: auth.orgId,
        house_id: req.params.id,
        user_id: auth.user.id,
        event_type,
        note_text: note_text ?? null,
        note_voice_url: note_voice_url ?? null,
        metadata: metadata ?? {},
        created_at: now,
      })
      .select()
      .single();

    if (eErr) return sendSafeError(res, eErr, 'Failed to create event.', '[field-sales/events]');

    // Derive new status
    const newStatus = EVENT_STATUS_MAP[event_type] ?? house.current_status;

    // Pin colour mapping
    const PIN_COLOURS: Record<string, string> = {
      sold: '#10B981',
      lead: '#3B82F6',
      callback: '#F59E0B',
      follow_up: '#8B5CF6',
      knocked: '#6B7280',
      no_answer: '#D1D5DB',
      not_interested: '#EF4444',
      cancelled: '#1F2937',
      new: '#9CA3AF',
    };
    const pinColor = PIN_COLOURS[newStatus] ?? '#9CA3AF';

    // Update house
    const newVisitCount =
      ['knock', 'no_answer', 'not_interested', 'callback', 'lead', 'sale', 'follow_up'].includes(
        event_type
      )
        ? (house.visit_count ?? 0) + 1
        : house.visit_count ?? 0;

    const houseUpdate: Record<string, any> = {
      current_status: newStatus,
      visit_count: newVisitCount,
      last_activity_at: now,
      updated_at: now,
    };

    // Closing attribution — track who closed the deal
    if (event_type === 'sale') {
      houseUpdate.closed_by_user_id = auth.user.id;
      houseUpdate.closed_at = now;
      // Determine role
      const { data: membership } = await admin.from('memberships')
        .select('role').eq('user_id', auth.user.id).eq('org_id', auth.orgId).maybeSingle();
      houseUpdate.closed_by_role = (membership?.role === 'owner' || membership?.role === 'admin') ? 'admin' : 'rep';
    }

    await admin
      .from('field_house_profiles')
      .update(houseUpdate)
      .eq('id', req.params.id);

    // Upsert pin
    const { data: existingPin } = await admin
      .from('field_pins')
      .select('id')
      .eq('house_id', req.params.id)
      .maybeSingle();

    if (existingPin) {
      await admin
        .from('field_pins')
        .update({
          status: newStatus,
          pin_color: pinColor,
          has_note: !!(note_text || note_voice_url),
          updated_at: now,
        })
        .eq('id', existingPin.id);
    } else {
      await admin.from('field_pins').insert({
        org_id: auth.orgId,
        house_id: req.params.id,
        lat: house.lat,
        lng: house.lng,
        status: newStatus,
        pin_color: pinColor,
        has_note: !!(note_text || note_voice_url),
      });
    }

    // Upsert daily_stats
    const today = now.slice(0, 10); // YYYY-MM-DD
    const { data: existingStats } = await admin
      .from('field_daily_stats')
      .select('id, knocks, leads, sales, callbacks, no_answers, not_interested, notes')
      .eq('org_id', auth.orgId)
      .eq('user_id', auth.user.id)
      .eq('date', today)
      .maybeSingle();

    const statsIncrement: Record<string, number> = {
      knocks: event_type === 'knock' ? 1 : 0,
      leads: event_type === 'lead' ? 1 : 0,
      sales: event_type === 'sale' ? 1 : 0,
      callbacks: event_type === 'callback' ? 1 : 0,
      no_answers: event_type === 'no_answer' ? 1 : 0,
      not_interested: event_type === 'not_interested' ? 1 : 0,
      notes: note_text || note_voice_url ? 1 : 0,
    };

    if (existingStats) {
      await admin
        .from('field_daily_stats')
        .update({
          knocks: (existingStats.knocks ?? 0) + statsIncrement.knocks,
          leads: (existingStats.leads ?? 0) + statsIncrement.leads,
          sales: (existingStats.sales ?? 0) + statsIncrement.sales,
          callbacks: (existingStats.callbacks ?? 0) + statsIncrement.callbacks,
          no_answers: (existingStats.no_answers ?? 0) + statsIncrement.no_answers,
          not_interested: (existingStats.not_interested ?? 0) + statsIncrement.not_interested,
          notes: (existingStats.notes ?? 0) + statsIncrement.notes,
          updated_at: now,
        })
        .eq('id', existingStats.id);
    } else {
      await admin.from('field_daily_stats').insert({
        org_id: auth.orgId,
        user_id: auth.user.id,
        date: today,
        ...statsIncrement,
      });
    }

    // Async: trigger AI recalculation (non-blocking)
    (async () => {
      try {
        const profile = await getCompanyProfile(admin, auth.orgId);
        await scoreAllPins(admin, auth.orgId, profile);
        await scoreAllTerritories(admin, auth.orgId, profile);
      } catch { /* silent background task */ }
    })();

    return res.status(201).json(event);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 5b. DELETE /field-sales/events/:eventId — delete a house event (note)
// ---------------------------------------------------------------------------
router.delete('/events/:eventId', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    // Verify event belongs to org
    const { data: event, error: eErr } = await admin
      .from('field_house_events')
      .select('id, org_id, house_id')
      .eq('id', req.params.eventId)
      .eq('org_id', auth.orgId)
      .single();

    if (eErr || !event) return res.status(404).json({ error: 'Event not found' });

    await admin.from('field_house_events').delete().eq('id', event.id).eq('org_id', auth.orgId);

    return res.status(200).json({ success: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 6. GET /field-sales/territories
// ---------------------------------------------------------------------------
router.get('/territories', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    
    

    const { data, error } = await admin
      .from('field_territories')
      .select('*')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .order('name');

    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.json(data ?? []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 7. POST /field-sales/territories
// ---------------------------------------------------------------------------
router.post('/territories', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { name, geojson, color, assigned_user_id, assigned_team_id } = req.body;
  if (!name || !geojson) return res.status(400).json({ error: 'name and geojson are required' });

  try {
    const { data, error } = await admin
      .from('field_territories')
      .insert({
        org_id: auth.orgId,
        name,
        polygon_geojson: geojson,
        color: color ?? '#3B82F6',
        assigned_user_id: assigned_user_id || null,
        assigned_team_id: assigned_team_id || null,
      })
      .select()
      .single();

    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.status(201).json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 8. PUT /field-sales/territories/:id
// ---------------------------------------------------------------------------
router.put('/territories/:id', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    
    

    const allowed = ['name', 'polygon_geojson', 'color', 'assigned_user_id', 'assigned_team_id', 'is_exclusive'];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await admin
      .from('field_territories')
      .update(updates)
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .select()
      .single();

    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 9. DELETE /field-sales/territories/:id (soft delete)
// ---------------------------------------------------------------------------
router.delete('/territories/:id', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    
    

    const { error } = await admin
      .from('field_territories')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId);

    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.json({ success: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 10. GET /field-sales/stats
// ---------------------------------------------------------------------------
router.get('/stats', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { user_id, territory_id, from, to } = req.query as Record<string, string>;

  try {
    
    

    let statsQuery = admin
      .from('field_daily_stats')
      .select('*')
      .eq('org_id', auth.orgId);

    if (user_id) statsQuery = statsQuery.eq('user_id', user_id);
    if (from) statsQuery = statsQuery.gte('date', from);
    if (to) statsQuery = statsQuery.lte('date', to);

    const { data: statsRows, error: sErr } = await statsQuery;
    if (sErr) return sendSafeError(res, sErr, 'Failed to fetch stats.', '[field-sales/stats]');

    // Aggregate
    const totals = (statsRows ?? []).reduce(
      (acc: any, row: any) => {
        acc.knocks += row.knocks ?? 0;
        acc.leads += row.leads ?? 0;
        acc.sales += row.sales ?? 0;
        acc.callbacks += row.callbacks ?? 0;
        acc.no_answers += row.no_answers ?? 0;
        acc.not_interested += row.not_interested ?? 0;
        acc.notes += row.notes ?? 0;
        return acc;
      },
      { knocks: 0, leads: 0, sales: 0, callbacks: 0, no_answers: 0, not_interested: 0, notes: 0 }
    );

    // House counts
    let housesQuery = admin
      .from('field_house_profiles')
      .select('current_status', { count: 'exact', head: false })
      .eq('org_id', auth.orgId)
      .is('deleted_at', null);

    if (territory_id) housesQuery = housesQuery.eq('territory_id', territory_id);
    if (user_id) housesQuery = housesQuery.eq('assigned_user_id', user_id);

    const { data: houses } = await housesQuery;
    const statusCounts: Record<string, number> = {};
    for (const h of houses ?? []) {
      statusCounts[h.current_status] = (statusCounts[h.current_status] ?? 0) + 1;
    }

    const conversion_rate =
      totals.knocks > 0 ? ((totals.leads / totals.knocks) * 100).toFixed(1) : '0.0';

    return res.json({ totals, conversion_rate: parseFloat(conversion_rate), status_counts: statusCounts });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 11. GET /field-sales/stats/daily
// ---------------------------------------------------------------------------
router.get('/stats/daily', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { user_id, from, to } = req.query as Record<string, string>;

  try {
    
    

    let query = admin
      .from('field_daily_stats')
      .select('*')
      .eq('org_id', auth.orgId)
      .eq('user_id', user_id ?? auth.user.id)
      .order('date', { ascending: true });

    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);

    const { data, error } = await query;
    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.json(data ?? []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 12. GET /field-sales/stats/leaderboard
// ---------------------------------------------------------------------------
router.get('/stats/leaderboard', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { metric = 'knocks', from, to, limit = '10' } = req.query as Record<string, string>;
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
  const validMetrics = ['knocks', 'leads', 'sales', 'callbacks'];
  const col = validMetrics.includes(metric) ? metric : 'knocks';

  try {
    
    

    let query = admin
      .from('field_daily_stats')
      .select('user_id, knocks, leads, sales, callbacks')
      .eq('org_id', auth.orgId);

    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);

    const { data: rows, error } = await query;
    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');

    // Aggregate by user
    const byUser: Record<string, number> = {};
    for (const row of rows ?? []) {
      byUser[row.user_id] = (byUser[row.user_id] ?? 0) + ((row as any)[col] ?? 0);
    }

    const sorted = Object.entries(byUser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limitNum);

    // Fetch display names
    const userIds = sorted.map(([uid]) => uid);
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', userIds);

    const profileMap: Record<string, any> = {};
    for (const p of profiles ?? []) profileMap[p.id] = p;

    const leaderboard = sorted.map(([user_id, value], index) => ({
      rank: index + 1,
      user_id,
      value,
      metric: col,
      full_name: profileMap[user_id]?.full_name ?? 'Unknown',
      avatar_url: profileMap[user_id]?.avatar_url ?? null,
    }));

    return res.json(leaderboard);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 13. GET /field-sales/settings
// ---------------------------------------------------------------------------
router.get('/settings', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    
    

    const { data, error } = await admin
      .from('field_settings')
      .select('*')
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');

    // Return defaults if no record exists yet
    if (!data) {
      return res.json({
        org_id: auth.orgId,
        allow_voice_notes: true,
        default_pin_radius: 50,
        require_gps_on_knock: false,
        daily_goal_knocks: 50,
        daily_goal_leads: 5,
        custom_statuses: [],
        pin_colors: {},
        working_hours_start: '08:00',
        working_hours_end: '20:00',
        timezone: 'UTC',
      });
    }

    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 14. PUT /field-sales/settings
// ---------------------------------------------------------------------------
router.put('/settings', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    
    

    const allowed = [
      'allow_voice_notes',
      'default_pin_radius',
      'require_gps_on_knock',
      'daily_goal_knocks',
      'daily_goal_leads',
      'custom_statuses',
      'pin_colors',
      'working_hours_start',
      'working_hours_end',
      'timezone',
    ];
    const updates: Record<string, any> = { org_id: auth.orgId };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await admin
      .from('field_settings')
      .upsert(updates, { onConflict: 'org_id' })
      .select()
      .single();

    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// 15. GET /field-sales/pins (lightweight map view)
// ---------------------------------------------------------------------------
router.get('/pins', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { north, south, east, west } = req.query as Record<string, string>;

  try {
    
    

    // Pins — join with house_profiles for coords + metadata + rep for filtering
    // Filter out soft-deleted houses to prevent ghost pins from appearing
    const { data: pins, error } = await admin
      .from('field_pins')
      .select('id, house_id, status, has_note, pin_color, field_house_profiles!inner(lat, lng, address, metadata, current_status, client_id, assigned_user_id, territory_id, deleted_at)')
      .eq('org_id', auth.orgId)
      .is('field_house_profiles.deleted_at', null);

    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');

    // Get latest note for each house that has_note
    const houseIdsWithNotes = (pins ?? []).filter((p: any) => p.has_note).map((p: any) => p.house_id);
    let noteMap: Record<string, string> = {};
    if (houseIdsWithNotes.length > 0) {
      const { data: notes } = await admin
        .from('field_house_events')
        .select('house_id, note_text')
        .in('house_id', houseIdsWithNotes)
        .not('note_text', 'is', null)
        .order('created_at', { ascending: false });
      // Keep first (latest) note per house
      for (const n of notes ?? []) {
        if (!noteMap[n.house_id] && n.note_text && !n.note_text.startsWith('Pin ') && !n.note_text.startsWith('Client linked')) {
          noteMap[n.house_id] = n.note_text;
        }
      }
    }

    // Flatten and apply bounding box filter
    let result = (pins ?? []).map((p: any) => ({
      id: p.id,
      house_id: p.house_id,
      lat: p.field_house_profiles?.lat,
      lng: p.field_house_profiles?.lng,
      status: p.status,
      has_note: p.has_note,
      pin_color: p.pin_color,
      note_preview: noteMap[p.house_id] ?? null,
      customer_name: p.field_house_profiles?.metadata?.customer_name ?? null,
      address: p.field_house_profiles?.address ?? null,
      assigned_user_id: p.field_house_profiles?.assigned_user_id ?? null,
      territory_id: p.field_house_profiles?.territory_id ?? null,
    })).filter((p: any) => p.lat != null && p.lng != null);

    if (north) result = result.filter((p: any) => p.lat <= parseFloat(north));
    if (south) result = result.filter((p: any) => p.lat >= parseFloat(south));
    if (east) result = result.filter((p: any) => p.lng <= parseFloat(east));
    if (west) result = result.filter((p: any) => p.lng >= parseFloat(west));

    return res.json(result);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// FIELD SALES REPS
// ---------------------------------------------------------------------------

// GET /reps — list reps for org
router.get('/reps', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();
  try {
    const { data, error } = await admin.from('field_sales_reps')
      .select('*').eq('org_id', auth.orgId).eq('is_active', true).order('display_name');
    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.json(data ?? []);
  } catch (err: any) { return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]'); }
});

// POST /reps — create rep
router.post('/reps', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();
  const { user_id, display_name, role, avatar_url } = req.body;
  if (!user_id || !display_name) return res.status(400).json({ error: 'user_id and display_name required' });
  try {
    const { data, error } = await admin.from('field_sales_reps')
      .insert({ org_id: auth.orgId, user_id, display_name, role: role || 'sales_rep', avatar_url: avatar_url || null })
      .select().single();
    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.status(201).json(data);
  } catch (err: any) { return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]'); }
});

// PUT /reps/:id — update rep
router.put('/reps/:id', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();
  const allowed = ['display_name', 'role', 'avatar_url', 'is_active'];
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
  try {
    const { data, error } = await admin.from('field_sales_reps')
      .update(updates).eq('id', req.params.id).eq('org_id', auth.orgId).select().single();
    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.json(data);
  } catch (err: any) { return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]'); }
});

// DELETE /reps/:id — deactivate rep
router.delete('/reps/:id', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();
  try {
    await admin.from('field_sales_reps')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('org_id', auth.orgId);
    return res.json({ ok: true });
  } catch (err: any) { return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]'); }
});

// GET /teams — list teams
router.get('/teams', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();
  try {
    const { data, error } = await admin.from('field_sales_teams')
      .select('*, field_sales_team_members(rep_id, field_sales_reps(id, display_name))')
      .eq('org_id', auth.orgId).eq('is_active', true).order('name');
    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.json(data ?? []);
  } catch (err: any) { return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]'); }
});

// POST /teams — create team
router.post('/teams', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();
  const { name, leader_id, color, member_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const { data: team, error } = await admin.from('field_sales_teams')
      .insert({ org_id: auth.orgId, name, leader_id: leader_id || null, color: color || '#6366f1' })
      .select().single();
    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    // Add members
    if (member_ids?.length) {
      await admin.from('field_sales_team_members')
        .insert(member_ids.map((rid: string) => ({ team_id: team.id, rep_id: rid })));
    }
    return res.status(201).json(team);
  } catch (err: any) { return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]'); }
});

// ===========================================================================
// AI INTELLIGENCE ENDPOINTS
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /field-sales/ai/territory/recommendations
// ---------------------------------------------------------------------------
router.get('/ai/territory/recommendations', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    // Re-score territories (async-safe)
    const profile = await getCompanyProfile(admin, auth.orgId);
    await scoreAllTerritories(admin, auth.orgId, profile);

    // Get top territories
    const { data: territories } = await admin
      .from('field_territories')
      .select('id, name, territory_score, fatigue_score, coverage_percent, total_pins, active_leads, close_rate, assigned_user_id')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .order('territory_score', { ascending: false })
      .limit(10);

    // Get top pins
    const { data: pins } = await admin
      .from('field_house_profiles')
      .select('id, address, current_status, reknock_priority_score, ai_next_action, territory_id, lat, lng')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .not('current_status', 'in', '("sold","cancelled","do_not_knock","not_interested")')
      .order('reknock_priority_score', { ascending: false })
      .limit(10);

    const topTerritories = (territories ?? []).slice(0, 3).map((t: any) => ({
      id: t.id,
      name: t.name,
      score: t.territory_score,
      fatigue_score: t.fatigue_score,
      coverage: t.coverage_percent,
      total_pins: t.total_pins,
      active_leads: t.active_leads,
      close_rate: t.close_rate,
      explanation: t.territory_score > 70
        ? `High-opportunity zone: ${t.active_leads} active leads, ${t.close_rate}% close rate`
        : t.territory_score > 40
          ? `Moderate potential: ${t.total_pins} total addresses, reknock opportunities available`
          : `Lower activity zone: consider increasing coverage (${t.coverage_percent}%)`,
    }));

    const topPins = (pins ?? []).slice(0, 3).map((p: any) => ({
      id: p.id,
      address: p.address,
      score: p.reknock_priority_score,
      status: p.current_status,
      next_action: p.ai_next_action,
      territory_id: p.territory_id,
      lat: p.lat,
      lng: p.lng,
    }));

    return res.json({
      territories: topTerritories,
      pins: topPins,
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// POST /field-sales/ai/schedule/recommendations
// ---------------------------------------------------------------------------
router.post('/ai/schedule/recommendations', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { target_date, user_id, job_duration_minutes } = req.body;
  if (!target_date) return res.status(400).json({ error: 'target_date required (YYYY-MM-DD)' });

  try {
    const slots = await getScheduleRecommendations(admin, {
      org_id: auth.orgId,
      user_id: user_id ?? auth.user.id,
      target_date,
      job_duration_minutes,
    });

    return res.json({
      slots: slots.slice(0, 3),
      target_date,
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// GET /field-sales/ai/follow-ups
// ---------------------------------------------------------------------------
router.get('/ai/follow-ups', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { user_id, limit = '15' } = req.query as Record<string, string>;

  try {
    const actions = await getFollowUpRecommendations(
      admin,
      auth.orgId,
      user_id ?? auth.user.id,
      Math.min(50, parseInt(limit, 10) || 15)
    );

    return res.json({
      actions,
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// GET /field-sales/ai/daily-plan
// ---------------------------------------------------------------------------
router.get('/ai/daily-plan', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { user_id, date } = req.query as Record<string, string>;

  try {
    // Score everything first
    const profile = await getCompanyProfile(admin, auth.orgId);
    await scoreAllTerritories(admin, auth.orgId, profile);
    await scoreAllPins(admin, auth.orgId, profile);

    const plan = await generateDailyPlan(
      admin,
      auth.orgId,
      user_id ?? auth.user.id,
      date
    );

    return res.json(plan);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// GET /field-sales/ai/territory-assignments
// ---------------------------------------------------------------------------
router.get('/ai/territory-assignments', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    const recommendations = await getAssignmentRecommendations(admin, auth.orgId);
    return res.json({
      recommendations,
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// POST /field-sales/ai/recalculate — trigger full AI recalculation
// ---------------------------------------------------------------------------
router.post('/ai/recalculate', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    const profile = await getCompanyProfile(admin, auth.orgId);
    await scoreAllTerritories(admin, auth.orgId, profile);
    await scoreAllPins(admin, auth.orgId, profile);
    return res.json({ success: true, recalculated_at: new Date().toISOString() });
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// POST /field-sales/auto-pin — auto-create/merge pin from entity creation
// ---------------------------------------------------------------------------
router.post('/auto-pin', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { address, lat, lng, entity_type, entity_id, client_id, lead_id, quote_id, job_id } = req.body;
  if (!address || lat == null || lng == null || !entity_type || !entity_id) {
    return res.status(400).json({ error: 'address, lat, lng, entity_type, entity_id required' });
  }

  try {
    const result = await autoCreateOrMergePin(admin, {
      org_id: auth.orgId,
      user_id: auth.user.id,
      address,
      lat,
      lng,
      entity_type,
      entity_id,
      client_id,
      lead_id,
      quote_id,
      job_id,
    });

    return res.status(201).json(result);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ===========================================================================
// COMPANY OPERATING PROFILE
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /field-sales/operating-profile
// ---------------------------------------------------------------------------
router.get('/operating-profile', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    const { data } = await admin
      .from('company_operating_profile')
      .select('*')
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (!data) {
      return res.json({
        org_id: auth.orgId,
        industry_type: 'general',
        avg_job_duration_minutes: 120,
        avg_jobs_per_day: 4,
        max_travel_radius_km: 50,
        weight_proximity: 0.3,
        weight_team_availability: 0.25,
        weight_value: 0.25,
        weight_recency: 0.2,
        preferred_reknock_delay_days: 7,
        scheduling_pattern_type: 'clustered',
        peak_hours_start: '09:00',
        peak_hours_end: '17:00',
        operating_days: [1, 2, 3, 4, 5],
      });
    }
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// PUT /field-sales/operating-profile
// ---------------------------------------------------------------------------
router.put('/operating-profile', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const allowed = [
    'industry_type', 'avg_job_duration_minutes', 'avg_jobs_per_day', 'max_travel_radius_km',
    'weight_proximity', 'weight_team_availability', 'weight_value', 'weight_recency',
    'preferred_reknock_delay_days', 'scheduling_pattern_type', 'peak_hours_start',
    'peak_hours_end', 'operating_days',
  ];

  const updates: Record<string, any> = { org_id: auth.orgId };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  updates.updated_at = new Date().toISOString();

  try {
    const { data, error } = await admin
      .from('company_operating_profile')
      .upsert(updates, { onConflict: 'org_id' })
      .select()
      .single();

    if (error) return sendSafeError(res, error, 'Field sales operation failed.', '[field-sales]');
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Field sales operation failed.', '[field-sales]');
  }
});

// ---------------------------------------------------------------------------
// D2D PIPELINE ENDPOINTS
// ---------------------------------------------------------------------------

// GET /field-sales/pipeline — fetch all pipeline deals for D2D Kanban
router.get('/pipeline', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    const repFilter = req.query.rep_id as string | undefined;

    let query = admin
      .from('pipeline_deals')
      .select(`
        id, org_id, stage, title, value, notes, created_at, updated_at,
        lead_id, client_id, job_id, quote_id, pin_id, rep_id, source,
        d2d_status, lost_reason, lost_at,
        leads(id, first_name, last_name, email, phone, status, created_by),
        clients(id, first_name, last_name, company, email, phone)
      `)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });

    if (repFilter && repFilter !== 'all') {
      query = query.eq('rep_id', repFilter);
    }

    const { data, error } = await query;
    if (error) return sendSafeError(res, error, 'Failed to load pipeline.', '[field-sales/pipeline]');

    // Fetch rep names + creator names for display
    const allUserIds = [...new Set([
      ...(data || []).map((d: any) => d.rep_id).filter(Boolean),
      ...(data || []).map((d: any) => d.leads?.created_by).filter(Boolean),
    ])];
    let userNameMap: Record<string, string> = {};
    if (allUserIds.length > 0) {
      const { data: members } = await admin
        .from('memberships')
        .select('user_id, full_name')
        .eq('org_id', auth.orgId)
        .in('user_id', allUserIds);
      for (const m of members || []) {
        if (m.user_id && m.full_name) userNameMap[m.user_id] = m.full_name;
      }
    }

    // Enrich deals with rep name + creator name
    const enriched = (data || []).map((deal: any) => ({
      ...deal,
      rep_name: deal.rep_id ? (userNameMap[deal.rep_id] || null) : null,
      created_by_id: deal.leads?.created_by || null,
      created_by_name: deal.leads?.created_by ? (userNameMap[deal.leads.created_by] || null) : null,
      lead_name: deal.leads
        ? `${deal.leads.first_name || ''} ${deal.leads.last_name || ''}`.trim()
        : deal.clients
          ? `${deal.clients.first_name || ''} ${deal.clients.last_name || ''}`.trim()
          : deal.title || 'Unnamed',
      lead_email: deal.leads?.email || deal.clients?.email || null,
      lead_phone: deal.leads?.phone || deal.clients?.phone || null,
    }));

    return res.json(enriched);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load pipeline.', '[field-sales/pipeline]');
  }
});

// PUT /field-sales/pipeline/:id — update a deal (stage, status, lost_reason)
router.put('/pipeline/:id', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    const { stage, d2d_status, lost_reason, rep_id } = req.body;
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    if (stage) updates.stage = stage;
    if (d2d_status !== undefined) updates.d2d_status = d2d_status;
    if (lost_reason !== undefined) updates.lost_reason = lost_reason;
    if (rep_id !== undefined) updates.rep_id = rep_id;

    if (stage === 'Lost') {
      updates.lost_at = new Date().toISOString();
    }

    const { data, error } = await admin
      .from('pipeline_deals')
      .update(updates)
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .select()
      .maybeSingle();

    if (error) return sendSafeError(res, error, 'Failed to update deal.', '[field-sales/pipeline]');
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to update deal.', '[field-sales/pipeline]');
  }
});

// GET /field-sales/pipeline/reps — list all reps for filter dropdown
router.get('/pipeline/reps', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  try {
    const { data, error } = await admin
      .from('memberships')
      .select('user_id, full_name, role, avatar_url')
      .eq('org_id', auth.orgId)
      .eq('status', 'active')
      .in('role', ['owner', 'admin', 'sales_rep', 'technician', 'team_lead']);

    if (error) return sendSafeError(res, error, 'Failed to load reps.', '[field-sales/pipeline]');
    return res.json(data || []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load reps.', '[field-sales/pipeline]');
  }
});

export default router;
