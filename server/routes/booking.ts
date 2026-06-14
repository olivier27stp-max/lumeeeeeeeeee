import { Router } from 'express';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { ensureClientForLead } from '../lib/leadClientSync';
import { dispatchWebhook } from '../lib/webhookDispatcher';

const router = Router();

// ── Helpers ──────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

type DayKey = typeof DAY_KEYS[number];
type Window = { start: string; end: string };
type Availability = Partial<Record<DayKey, Window[]>>;

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 24 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Compute available start times for a given calendar date (YYYY-MM-DD), in UTC ISO timestamps. */
function computeSlots(opts: {
  date: string;
  availability: Availability;
  durationMinutes: number;
  bufferMinutes: number;
  advanceNoticeHours: number;
  maxDaysAhead: number;
  existing: { scheduled_at: string; duration_minutes: number }[];
}): { start: string; end: string }[] {
  const { date, availability, durationMinutes, bufferMinutes, advanceNoticeHours, maxDaysAhead, existing } = opts;

  // Determine weekday in UTC for consistency.
  const dayDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dayDate.getTime())) return [];

  // Reject dates outside allowed window.
  const now = Date.now();
  const minTs = now + advanceNoticeHours * 3600_000;
  const maxTs = now + maxDaysAhead * 86_400_000;
  if (dayDate.getTime() + 86_400_000 < minTs) return []; // entire day already past notice window
  if (dayDate.getTime() > maxTs) return [];

  const weekdayIdx = dayDate.getUTCDay();
  const key = DAY_KEYS[weekdayIdx];
  const windows = availability[key] || [];
  if (!Array.isArray(windows) || windows.length === 0) return [];

  // Build busy intervals in minutes-since-midnight UTC.
  const dayStartMs = dayDate.getTime();
  const dayEndMs = dayStartMs + 86_400_000;
  const busy: { start: number; end: number }[] = [];
  for (const b of existing) {
    const sMs = Date.parse(b.scheduled_at);
    if (!Number.isFinite(sMs)) continue;
    const eMs = sMs + b.duration_minutes * 60_000;
    if (eMs <= dayStartMs || sMs >= dayEndMs) continue;
    busy.push({
      start: Math.max(0, (sMs - dayStartMs) / 60_000) - bufferMinutes,
      end: Math.min(1440, (eMs - dayStartMs) / 60_000) + bufferMinutes,
    });
  }

  const slots: { start: string; end: string }[] = [];
  const step = durationMinutes; // simple non-overlapping packing
  for (const w of windows) {
    const wStart = parseHHMM(w.start);
    const wEnd = parseHHMM(w.end);
    if (wStart == null || wEnd == null || wEnd <= wStart) continue;
    for (let t = wStart; t + durationMinutes <= wEnd; t += step) {
      const slotStartMs = dayStartMs + t * 60_000;
      const slotEndMs = slotStartMs + durationMinutes * 60_000;
      if (slotStartMs < minTs) continue;
      if (slotStartMs > maxTs) continue;
      const conflict = busy.some((b) => !(t + durationMinutes <= b.start || t >= b.end));
      if (conflict) continue;
      slots.push({ start: new Date(slotStartMs).toISOString(), end: new Date(slotEndMs).toISOString() });
    }
  }
  return slots;
}

// ── Zod schemas ──────────────────────────────────────────────

const windowSchema = z.object({
  start: z.string().regex(/^\d{1,2}:\d{2}$/),
  end: z.string().regex(/^\d{1,2}:\d{2}$/),
});

const availabilitySchema = z.object({
  sunday: z.array(windowSchema).optional(),
  monday: z.array(windowSchema).optional(),
  tuesday: z.array(windowSchema).optional(),
  wednesday: z.array(windowSchema).optional(),
  thursday: z.array(windowSchema).optional(),
  friday: z.array(windowSchema).optional(),
  saturday: z.array(windowSchema).optional(),
}).strict();

const upsertBookingPageSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().min(2).max(64).regex(SLUG_RE, 'Invalid slug'),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  service_type: z.string().max(80).nullable().optional(),
  duration_minutes: z.number().int().min(15).max(480),
  buffer_minutes: z.number().int().min(0).max(240),
  availability: availabilitySchema,
  advance_notice_hours: z.number().int().min(0).max(720),
  max_days_ahead: z.number().int().min(1).max(365),
  is_active: z.boolean().optional(),
});

const submitBookingSchema = z.object({
  customer_first_name: z.string().min(1).max(80),
  customer_last_name: z.string().min(1).max(80),
  customer_email: z.string().email().max(254),
  customer_phone: z.string().max(40).nullable().optional(),
  service_address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  scheduled_at: z.string().datetime(),
});

// ── PUBLIC ROUTES (no auth) ─────────────────────────────────

// GET /api/booking/:slug — public booking page config
router.get('/booking/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid slug.' });

    const admin = getServiceClient();
    const { data: page } = await admin
      .from('booking_pages')
      .select('id, org_id, slug, title, description, service_type, duration_minutes, buffer_minutes, availability, advance_notice_hours, max_days_ahead, is_active')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (!page) return res.status(404).json({ error: 'Booking page not found.' });

    // Public org branding
    const { data: orgSettings } = await admin
      .from('company_settings')
      .select('company_name, logo_url')
      .eq('org_id', page.org_id)
      .maybeSingle();

    return res.json({
      page: {
        slug: page.slug,
        title: page.title,
        description: page.description,
        service_type: page.service_type,
        duration_minutes: page.duration_minutes,
        availability: page.availability,
        advance_notice_hours: page.advance_notice_hours,
        max_days_ahead: page.max_days_ahead,
      },
      business: {
        name: orgSettings?.company_name || null,
        logo_url: orgSettings?.logo_url || null,
      },
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to load booking page.', '[booking/get]');
  }
});

// GET /api/booking/:slug/slots?date=YYYY-MM-DD
router.get('/booking/:slug/slots', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    const date = String(req.query.date || '').trim();
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid slug.' });
    if (!isValidDateString(date)) return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });

    const admin = getServiceClient();
    const { data: page } = await admin
      .from('booking_pages')
      .select('id, duration_minutes, buffer_minutes, availability, advance_notice_hours, max_days_ahead')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();
    if (!page) return res.status(404).json({ error: 'Booking page not found.' });

    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;
    const { data: existing } = await admin
      .from('bookings')
      .select('scheduled_at, duration_minutes')
      .eq('booking_page_id', page.id)
      .in('status', ['pending', 'confirmed'])
      .gte('scheduled_at', dayStart)
      .lte('scheduled_at', dayEnd);

    const slots = computeSlots({
      date,
      availability: (page.availability || {}) as Availability,
      durationMinutes: page.duration_minutes,
      bufferMinutes: page.buffer_minutes,
      advanceNoticeHours: page.advance_notice_hours,
      maxDaysAhead: page.max_days_ahead,
      existing: existing || [],
    });

    return res.json({ slots });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to load slots.', '[booking/slots]');
  }
});

// POST /api/booking/:slug — public submission
router.post('/booking/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid slug.' });

    const parsed = submitBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid booking data.', details: parsed.error.flatten() });
    }
    const body = parsed.data;

    const admin = getServiceClient();
    const { data: page } = await admin
      .from('booking_pages')
      .select('id, org_id, duration_minutes, buffer_minutes, availability, advance_notice_hours, max_days_ahead, title')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();
    if (!page) return res.status(404).json({ error: 'Booking page not found.' });

    // Validate the chosen slot is actually available right now (server is source of truth).
    const scheduledMs = Date.parse(body.scheduled_at);
    if (!Number.isFinite(scheduledMs)) return res.status(400).json({ error: 'Invalid scheduled_at.' });
    const dateStr = new Date(scheduledMs).toISOString().slice(0, 10);

    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;
    const { data: existing } = await admin
      .from('bookings')
      .select('scheduled_at, duration_minutes')
      .eq('booking_page_id', page.id)
      .in('status', ['pending', 'confirmed'])
      .gte('scheduled_at', dayStart)
      .lte('scheduled_at', dayEnd);

    const slots = computeSlots({
      date: dateStr,
      availability: (page.availability || {}) as Availability,
      durationMinutes: page.duration_minutes,
      bufferMinutes: page.buffer_minutes,
      advanceNoticeHours: page.advance_notice_hours,
      maxDaysAhead: page.max_days_ahead,
      existing: existing || [],
    });
    const slotStartIso = new Date(scheduledMs).toISOString();
    const ok = slots.some((s) => s.start === slotStartIso);
    if (!ok) return res.status(409).json({ error: 'This slot is no longer available. Please pick another time.' });

    // System "creator" — pick the org owner as created_by for downstream records.
    const { data: ownerMembership } = await admin
      .from('memberships')
      .select('user_id')
      .eq('org_id', page.org_id)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle();
    const createdBy = ownerMembership?.user_id || null;

    // Create the booking row first.
    const { data: bookingRow, error: bookingErr } = await admin
      .from('bookings')
      .insert({
        org_id: page.org_id,
        booking_page_id: page.id,
        customer_first_name: body.customer_first_name,
        customer_last_name: body.customer_last_name,
        customer_email: body.customer_email,
        customer_phone: body.customer_phone || null,
        service_address: body.service_address || null,
        notes: body.notes || null,
        scheduled_at: slotStartIso,
        duration_minutes: page.duration_minutes,
        status: 'pending',
      })
      .select('id')
      .single();
    if (bookingErr) throw bookingErr;
    const bookingId = bookingRow.id as string;

    // Best-effort: create Lead + Client. Failures here should not break the booking confirmation.
    let leadId: string | null = null;
    try {
      if (createdBy) {
        const clientId = await ensureClientForLead(admin, {
          orgId: page.org_id,
          createdBy,
          firstName: body.customer_first_name,
          lastName: body.customer_last_name,
          email: body.customer_email,
          phone: body.customer_phone || null,
          address: body.service_address || null,
          company: null,
        });

        // A lead IS a client with status='lead' — stamp lead fields onto the client.
        const { error: leadErr } = await admin
          .from('clients')
          .update({
            status: 'lead',
            lead_status: 'new_prospect',
            title: page.title,
            notes: `Online booking — ${page.title} — ${slotStartIso}\n${body.notes || ''}`.trim(),
            value: 0,
            updated_at: new Date().toISOString(),
          })
          .eq('id', clientId);
        if (!leadErr) {
          leadId = String(clientId);
          await admin.from('bookings').update({ lead_id: leadId }).eq('id', bookingId);
        }
      }
    } catch (err: any) {
      console.error('[booking/post] lead-create best-effort failed:', err?.message);
    }

    // Fire outbound webhook (best-effort, non-blocking).
    dispatchWebhook(page.org_id, 'booking.received', {
      booking_id: bookingId,
      lead_id: leadId,
      scheduled_at: slotStartIso,
      duration_minutes: page.duration_minutes,
      customer: {
        first_name: body.customer_first_name,
        last_name: body.customer_last_name,
        email: body.customer_email,
        phone: body.customer_phone || null,
      },
      service_address: body.service_address || null,
      notes: body.notes || null,
      booking_page: { id: page.id, title: page.title },
    }).catch((err) => console.error('[webhooks] booking.received dispatch failed:', err?.message));

    return res.json({
      ok: true,
      booking: {
        id: bookingId,
        scheduled_at: slotStartIso,
        duration_minutes: page.duration_minutes,
      },
      lead_id: leadId,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to submit booking.', '[booking/post]');
  }
});

// ── ADMIN ROUTES (authenticated) ────────────────────────────

// GET /api/booking-pages — list pages for current org
router.get('/booking-pages', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { data, error } = await auth.client
      .from('booking_pages')
      .select('*')
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ pages: data || [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to fetch booking pages.', '[booking-pages/list]');
  }
});

// POST /api/booking-pages — create or update
router.post('/booking-pages', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const parsed = upsertBookingPageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload.', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const slug = body.slug.toLowerCase();

    // Validate availability windows numerically (start < end).
    for (const k of DAY_KEYS) {
      const windows = body.availability[k];
      if (!windows) continue;
      for (const w of windows) {
        const s = parseHHMM(w.start);
        const e = parseHHMM(w.end);
        if (s == null || e == null || e <= s) {
          return res.status(400).json({ error: `Invalid availability window for ${k}.` });
        }
      }
    }

    const admin = getServiceClient();

    // Slug uniqueness (excluding self if updating)
    const { data: slugClash } = await admin
      .from('booking_pages')
      .select('id, org_id')
      .eq('slug', slug)
      .maybeSingle();
    if (slugClash && slugClash.id !== body.id) {
      return res.status(409).json({ error: 'Slug is already taken.' });
    }
    if (slugClash && slugClash.org_id !== auth.orgId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const payload = {
      org_id: auth.orgId,
      slug,
      title: body.title,
      description: body.description ?? null,
      service_type: body.service_type ?? null,
      duration_minutes: body.duration_minutes,
      buffer_minutes: body.buffer_minutes,
      availability: body.availability,
      advance_notice_hours: body.advance_notice_hours,
      max_days_ahead: body.max_days_ahead,
      is_active: body.is_active ?? true,
      updated_at: new Date().toISOString(),
    };

    let row;
    if (body.id) {
      const { data, error } = await admin
        .from('booking_pages')
        .update(payload)
        .eq('id', body.id)
        .eq('org_id', auth.orgId)
        .select('*')
        .single();
      if (error) throw error;
      row = data;
    } else {
      const { data, error } = await admin
        .from('booking_pages')
        .insert(payload)
        .select('*')
        .single();
      if (error) throw error;
      row = data;
    }
    return res.json({ page: row });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to save booking page.', '[booking-pages/upsert]');
  }
});

// DELETE /api/booking-pages/:id — soft via is_active=false
router.delete('/booking-pages/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const id = String(req.params.id || '');
    const admin = getServiceClient();
    const { error } = await admin
      .from('booking_pages')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', auth.orgId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to delete booking page.', '[booking-pages/delete]');
  }
});

// GET /api/bookings — list incoming bookings for the org
router.get('/bookings', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const status = String(req.query.status || '').trim();
    let q = auth.client
      .from('bookings')
      .select('*')
      .eq('org_id', auth.orgId)
      .order('scheduled_at', { ascending: false })
      .limit(200);
    if (['pending', 'confirmed', 'cancelled', 'completed'].includes(status)) {
      q = q.eq('status', status);
    }
    const { data, error } = await q;
    if (error) throw error;
    return res.json({ bookings: data || [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to fetch bookings.', '[bookings/list]');
  }
});

// PATCH /api/bookings/:id — admin action (confirm/cancel/complete)
const patchBookingSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'cancelled', 'completed']).optional(),
});
router.patch('/bookings/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const id = String(req.params.id || '');
    const parsed = patchBookingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload.' });

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('bookings')
      .update({ ...parsed.data })
      .eq('id', id)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ booking: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to update booking.', '[bookings/update]');
  }
});

export default router;
