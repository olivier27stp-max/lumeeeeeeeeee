import express, { Router } from 'express';
import { randomBytes } from 'crypto';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { validate, upsertRequestFormSchema, publicFormSubmissionSchema, updateFormSubmissionSchema } from '../lib/validation';
import { ensureClientForLead } from '../lib/leadClientSync';
import { upsertLeadPinForClient } from '../lib/fieldPinSync';
import { eventBus } from '../lib/eventBus';

const router = Router();

// ── GET /request-forms — fetch the org's form ─────────────────────
router.get('/request-forms', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { data, error } = await auth.client
      .from('request_forms')
      .select('*')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;
    return res.json({ form: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to fetch form.', '[request-forms]');
  }
});

// ── POST /request-forms — create or update the org's form ─────────
router.post('/request-forms', validate(upsertRequestFormSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const payload = {
      org_id: auth.orgId,
      created_by: auth.user.id,
      title: req.body.title,
      description: req.body.description || null,
      success_message: req.body.success_message,
      enabled: req.body.enabled ?? true,
      logo_url: req.body.logo_url || null,
      custom_fields: req.body.custom_fields || [],
      notify_email: req.body.notify_email ?? true,
      notify_in_app: req.body.notify_in_app ?? true,
      updated_at: new Date().toISOString(),
    };

    // Check if form already exists for this org
    const { data: existing } = await admin
      .from('request_forms')
      .select('id')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();

    const save = (p: Record<string, unknown>) =>
      existing?.id
        ? admin.from('request_forms').update(p).eq('id', existing.id).select('*').single()
        : admin.from('request_forms').insert(p).select('*').single();

    let { data: form, error: saveError } = await save(payload);
    // logo_url ships with migration 20260711000000_request_form_logo — keep
    // saving working on a DB that hasn't applied it yet.
    if (saveError && saveError.code === '42703' && `${saveError.message}`.includes('logo_url')) {
      const { logo_url: _omitted, ...rest } = payload;
      ({ data: form, error: saveError } = await save(rest));
    }
    if (saveError) throw saveError;

    return res.json({ form });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to save form.', '[request-forms]');
  }
});

// ── POST /request-forms/regenerate-key — generate new API key ─────
router.post('/request-forms/regenerate-key', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data: existing } = await admin
      .from('request_forms')
      .select('id')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!existing?.id) {
      return res.status(404).json({ error: 'No form found. Create one first.' });
    }

    // Generate new key using crypto
    const { randomBytes } = await import('crypto');
    const newKey = randomBytes(32).toString('hex');

    const { data, error } = await admin
      .from('request_forms')
      .update({ api_key: newKey, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('api_key')
      .single();

    if (error) throw error;
    return res.json({ api_key: data.api_key });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to regenerate key.', '[request-forms]');
  }
});

/** True when the error is "column does not exist" — migration
 *  20260718000000_request_assessment_archive not applied yet. */
const isMissingColumn = (err: any) => err?.code === '42703';

// ── GET /request-forms/submissions — list submissions ─────────────
router.get('/request-forms/submissions', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const list = (withDeletedFilter: boolean) => {
      let q = admin
        .from('form_submissions')
        .select('*')
        .eq('org_id', auth.orgId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (withDeletedFilter) q = q.is('deleted_at', null);
      return q;
    };

    // deleted_at ships with migration 20260718000000 — keep listing working
    // on a DB that hasn't applied it yet.
    let { data, error } = await list(true);
    if (error && isMissingColumn(error)) ({ data, error } = await list(false));
    if (error) throw error;
    return res.json({ submissions: data || [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to fetch submissions.', '[request-forms]');
  }
});

// ── GET /request-forms/submissions/:id — single submission ────────
router.get('/request-forms/submissions/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('form_submissions')
      .select('*')
      .eq('org_id', auth.orgId)
      .eq('id', String(req.params.id))
      .maybeSingle();

    if (error) throw error;
    if (!data || data.deleted_at) return res.status(404).json({ error: 'Submission not found.' });
    return res.json({ submission: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to fetch submission.', '[request-forms]');
  }
});

// ── PATCH /request-forms/submissions/:id — assessment + archive ───
router.patch('/request-forms/submissions/:id', validate(updateFormSubmissionSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const patch: Record<string, unknown> = {};
    for (const key of [
      'assessment_start_at',
      'assessment_end_at',
      'assessment_team_id',
      'assessment_user_id',
      'assessment_instructions',
    ] as const) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (req.body.archived !== undefined) {
      patch.archived_at = req.body.archived ? new Date().toISOString() : null;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('form_submissions')
      .update(patch)
      .eq('org_id', auth.orgId)
      .eq('id', String(req.params.id))
      .select('*')
      .maybeSingle();

    if (error && isMissingColumn(error)) {
      return res.status(409).json({
        error: 'Database migration pending: apply 20260718000000_request_assessment_archive.sql first.',
      });
    }
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Submission not found.' });
    return res.json({ submission: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to update submission.', '[request-forms]');
  }
});

// ── DELETE /request-forms/submissions/:id — soft delete ───────────
router.delete('/request-forms/submissions/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('form_submissions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('org_id', auth.orgId)
      .eq('id', String(req.params.id))
      .select('id')
      .maybeSingle();

    if (error && isMissingColumn(error)) {
      return res.status(409).json({
        error: 'Database migration pending: apply 20260718000000_request_assessment_archive.sql first.',
      });
    }
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Submission not found.' });
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to delete submission.', '[request-forms]');
  }
});

// ════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINT — no auth, uses API key
// ════════════════════════════════════════════════════════════════════

// ── GET /public/form/:apiKey — fetch form config for embedding ────
router.get('/public/form/:apiKey', async (req, res) => {
  try {
    const apiKey = String(req.params.apiKey || '').trim();
    if (!apiKey || apiKey.length < 32) {
      return res.status(400).json({ error: 'Invalid API key.' });
    }

    const admin = getServiceClient();
    // select('*') (not an explicit column list) so this keeps working on a DB
    // where migration 20260711000000_request_form_logo isn't applied yet; the
    // public payload is rebuilt field-by-field below, so nothing extra leaks.
    const { data: form, error } = await admin
      .from('request_forms')
      .select('*')
      .eq('api_key', apiKey)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;
    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (!form.enabled) return res.status(403).json({ error: 'Form is currently disabled.' });

    // No custom form logo → default to the company logo from company settings.
    let logoUrl: string | null = form.logo_url || null;
    if (!logoUrl) {
      const { data: company } = await admin
        .from('company_settings')
        .select('logo_url')
        .eq('org_id', form.org_id)
        .maybeSingle();
      logoUrl = company?.logo_url || null;
    }

    return res.json({
      form: {
        id: form.id,
        title: form.title,
        description: form.description,
        success_message: form.success_message,
        enabled: form.enabled,
        custom_fields: form.custom_fields,
        logo_url: logoUrl,
      },
    });
  } catch (err: any) {
    console.error('[public/form] get failed:', err.message);
    return res.status(500).json({ error: 'Unable to load form.' });
  }
});

// ── POST /public/form/:apiKey/upload — public photo upload ────────
// Accepts a single raw image body (Content-Type: image/*). The visitor is
// unauthenticated, so the upload runs through the service client (bypasses
// RLS). Returns the public URL, which the client then includes in the
// submission payload under `photos[]`.
const PHOTO_BUCKET = 'attachments';
router.post(
  '/public/form/:apiKey/upload',
  express.raw({ type: 'image/*', limit: '15mb' }),
  async (req, res) => {
    try {
      const apiKey = String(req.params.apiKey || '').trim();
      if (!apiKey || apiKey.length < 32) {
        return res.status(400).json({ error: 'Invalid API key.' });
      }

      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return res.status(400).json({ error: 'No image data received.' });
      }

      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
      if (!contentType.startsWith('image/')) {
        return res.status(400).json({ error: 'Only image uploads are allowed.' });
      }

      const admin = getServiceClient();

      // Resolve the org from the form so files are namespaced per-tenant.
      const { data: form, error: formError } = await admin
        .from('request_forms')
        .select('org_id, enabled')
        .eq('api_key', apiKey)
        .is('deleted_at', null)
        .maybeSingle();
      if (formError) throw formError;
      if (!form) return res.status(404).json({ error: 'Form not found.' });
      if (!form.enabled) return res.status(403).json({ error: 'Form is currently disabled.' });

      // Build a safe, unique object path.
      const ext = contentType.split('/')[1]?.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'jpg';
      const rawName = String(req.query.filename || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
      const baseName = rawName || `photo.${ext}`;
      const path = `request-forms/${form.org_id}/${Date.now()}-${randomBytes(6).toString('hex')}-${baseName}`;

      const { error: upErr } = await admin.storage
        .from(PHOTO_BUCKET)
        .upload(path, buffer, { contentType, upsert: true, cacheControl: '3600' });
      if (upErr) throw upErr;

      const { data: pub } = admin.storage.from(PHOTO_BUCKET).getPublicUrl(path);
      return res.json({ url: pub.publicUrl, path });
    } catch (err: any) {
      console.error('[public/form] upload failed:', err.message);
      return res.status(500).json({ error: 'Unable to upload image.' });
    }
  },
);

// ── POST /public/form/:apiKey/submit — public submission ──────────
router.post('/public/form/:apiKey/submit', validate(publicFormSubmissionSchema), async (req, res) => {
  // Step tracker — surfaced in the error log (and temporarily in the 500
  // response) so a failing submission tells us exactly where it broke.
  let step = 'start';
  try {
    const apiKey = String(req.params.apiKey || '').trim();
    if (!apiKey || apiKey.length < 32) {
      return res.status(400).json({ error: 'Invalid API key.' });
    }

    step = 'service-client';
    const admin = getServiceClient();

    // Look up form
    step = 'form-lookup';
    const { data: form, error: formError } = await admin
      .from('request_forms')
      .select('id, org_id, enabled, created_by, custom_fields')
      .eq('api_key', apiKey)
      .is('deleted_at', null)
      .maybeSingle();

    if (formError) throw formError;
    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (!form.enabled) return res.status(403).json({ error: 'Form is currently disabled.' });

    const body = req.body;
    const orgId = form.org_id;

    // ── Resolve a VALID actor (auth.users id) for created_by ──
    // clients/leads/pipeline_deals.created_by is NOT NULL with an FK to
    // auth.users(id). A public form submission has no authenticated user,
    // so the work must be attributed to a real member of the org — NOT the
    // org id. Passing org_id here triggered a 23503 FK violation → 500.
    // Prefer the form's creator if they are still a member, else the org owner.
    step = 'actor-resolution';
    const { data: members } = await admin
      .from('memberships')
      .select('user_id, role, language')
      .eq('org_id', orgId);
    const memberIds = new Set((members || []).map((m: any) => String(m.user_id)));
    let actorId: string | null = null;
    if (form.created_by && memberIds.has(String(form.created_by))) {
      actorId = String(form.created_by);
    } else {
      const owner = (members || []).find((m: any) => m.role === 'owner');
      actorId = owner?.user_id
        ? String(owner.user_id)
        : (members?.[0]?.user_id ? String(members[0].user_id) : null);
    }
    if (!actorId) {
      console.error('[public/form] no valid org member to attribute submission', { orgId, formId: form.id });
      return res.status(500).json({ error: 'Form is misconfigured (no org owner).' });
    }

    // ── Build address string for lead ──
    const addressParts = [body.street_address, body.unit, body.city, body.region, body.postal_code, body.country].filter(Boolean);
    const address = addressParts.length > 0 ? addressParts.join(', ') : null;

    // ── Build notes from custom responses + notes ──
    const noteLines: string[] = [];
    if (body.notes) noteLines.push(`Notes: ${body.notes}`);

    // Map custom field responses to readable notes
    const customFields = (form.custom_fields || []) as Array<{ id: string; label: string }>;
    const responses = body.custom_responses || {};
    for (const field of customFields) {
      const value = responses[field.id];
      if (value !== undefined && value !== null && value !== '') {
        const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
        noteLines.push(`${field.label}: ${displayValue}`);
      }
    }

    if (address) noteLines.push(`Address: ${address}`);
    if (body.company) noteLines.push(`Company: ${body.company}`);

    // Photo URLs uploaded via /upload — surface them on the lead notes.
    const photoUrls: string[] = Array.isArray(body.photos) ? body.photos.filter(Boolean) : [];
    if (photoUrls.length) noteLines.push(`Photos:\n${photoUrls.join('\n')}`);

    // Persist photos on the submission itself (under a reserved key in the
    // custom_responses jsonb — form_submissions has no dedicated column) so the
    // Requests detail view can render them as a gallery.
    const submissionResponses: Record<string, unknown> = { ...(body.custom_responses || {}) };
    if (photoUrls.length) submissionResponses.__photos = photoUrls;

    const fullNotes = noteLines.length > 0 ? noteLines.join('\n') : null;
    const fullName = `${body.first_name} ${body.last_name}`.trim();

    // ── REUSE existing lead creation logic ──
    // 1. Ensure linked client
    step = 'ensure-client';
    const clientId = await ensureClientForLead(admin, {
      orgId,
      createdBy: actorId,
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email || null,
      phone: body.phone || null,
      address: address || null,
      company: body.company || null,
    });

    // 2. A lead IS a client with status='lead' — stamp lead fields onto the client.
    step = 'lead-stamp';
    const { error: leadErr } = await admin
      .from('clients')
      .update({
        status: 'lead',
        lead_status: 'new_prospect',
        title: body.company || null,
        company: body.company || null,
        notes: fullNotes,
        value: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clientId);
    if (leadErr) throw leadErr;
    const leadIdStr = String(clientId);

    // 3. Create pipeline deal (new_prospect stage)
    step = 'pipeline-deal';
    const { data: existingDeal } = await admin
      .from('pipeline_deals')
      .select('id')
      .eq('org_id', orgId)
      .eq('lead_id', leadIdStr)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    let dealId: string | null = existingDeal?.id ? String(existingDeal.id) : null;

    if (!dealId) {
      const dealRow = {
        org_id: orgId,
        created_by: actorId,
        lead_id: leadIdStr,
        stage: 'new_prospect',
        title: body.company || fullName,
        value: 0,
        notes: fullNotes,
      };
      let { data: dealInsert, error: dealError } = await admin
        .from('pipeline_deals')
        .insert(dealRow)
        .select('id')
        .single();

      // 23514 = CHECK violation: DB still on legacy stage slugs (migration
      // 20260703200000 not applied yet) — retry with the legacy value.
      if (dealError?.code === '23514') {
        ({ data: dealInsert, error: dealError } = await admin
          .from('pipeline_deals')
          .insert({ ...dealRow, stage: 'new' })
          .select('id')
          .single());
      }

      if (dealError) {
        // Roll back lead-client on deal failure
        await admin.from('clients').update({ deleted_at: new Date().toISOString() }).eq('id', leadIdStr);
        throw dealError;
      }
      dealId = dealInsert?.id ? String(dealInsert.id) : null;
    }

    // 3b. Drop a 'lead' pin on the field-sales map (geocoded from the form
    // address). Non-fatal — the helper never throws. The pin then follows the
    // client status via the trg_clients_sync_field_pin DB trigger.
    // The pin is mandatory: when the form has no address, fall back to the
    // address already on file for the matched client.
    step = 'map-pin';
    let pinAddress = address;
    if (!pinAddress) {
      const { data: clientRow } = await admin
        .from('clients')
        .select('address')
        .eq('id', leadIdStr)
        .maybeSingle();
      pinAddress = clientRow?.address?.trim() || null;
    }
    const pinResult = pinAddress
      ? await upsertLeadPinForClient(admin, {
          orgId,
          actorId,
          clientId: leadIdStr,
          address: pinAddress,
          customerName: fullName,
          customerPhone: body.phone || null,
          customerEmail: body.email || null,
        })
      : null;
    if (!pinResult) {
      console.error('[public/form] no map pin created for request', {
        orgId,
        clientId: leadIdStr,
        hasAddress: !!pinAddress,
      });
    }

    // 4. Save submission record
    step = 'submission-record';
    const { data: submission, error: subError } = await admin
      .from('form_submissions')
      .insert({
        org_id: orgId,
        form_id: form.id,
        first_name: body.first_name,
        last_name: body.last_name,
        company: body.company || null,
        email: body.email,
        phone: body.phone,
        street_address: body.street_address || null,
        unit: body.unit || null,
        city: body.city || null,
        country: body.country || null,
        region: body.region || null,
        postal_code: body.postal_code || null,
        custom_responses: submissionResponses,
        notes: body.notes || null,
        lead_id: leadIdStr,
        deal_id: dealId,
        client_id: clientId,
        ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null,
        user_agent: req.headers['user-agent'] || null,
      })
      .select('id')
      .single();

    if (subError) {
      console.error('[public/form] submission record failed:', subError.message);
      // Non-fatal — lead/deal are already created
    }

    // 4b. In-app notification — drives the sidebar badges (Requests +
    // Pipeline) and the realtime toast via useRealtimeNotifications.
    // Localized with the actor's membership language (org default: fr).
    step = 'notification';
    const actorLang = (members || []).find((m: any) => String(m.user_id) === actorId)?.language === 'en' ? 'en' : 'fr';
    const contactLine = [body.email, body.phone, address].filter(Boolean).join(' · ');
    const notifRow = {
      org_id: orgId,
      type: 'request_created',
      title: actorLang === 'fr' ? `Nouvelle demande de ${fullName}` : `New request from ${fullName}`,
      body: contactLine || null,
      entity_type: 'request',
      entity_id: submission?.id || null,
    };
    let { error: notifError } = await admin.from('notifications').insert(notifRow);
    // Unknown column = migration 20260706100000 not applied yet. PostgREST
    // reports it as PGRST204 (schema cache) or 42703 (raw Postgres) — retry
    // with the legacy minimal shape so the toast/bell still fire.
    if (notifError && (notifError.code === 'PGRST204' || notifError.code === '42703')) {
      const { entity_type: _et, entity_id: _ei, ...legacyRow } = notifRow;
      ({ error: notifError } = await admin.from('notifications').insert(legacyRow));
    }
    if (notifError) {
      console.error('[public/form] notification insert failed:', { code: notifError.code, message: notifError.message });
      // Non-fatal — the submission itself succeeded
    }

    // 5. Emit event for automations
    step = 'event-emit';
    eventBus.emit('lead.created', {
      orgId,
      entityType: 'lead',
      entityId: leadIdStr,
      actorId: actorId,
      metadata: { name: fullName, email: body.email, phone: body.phone, source: 'request_form' },
    });

    console.info('[public/form] submission processed', { orgId, leadId: leadIdStr, dealId, houseId: pinResult?.houseId || null, formId: form.id });

    return res.json({ ok: true, submission_id: submission?.id || null });
  } catch (err: any) {
    console.error('[public/form] submit failed:', { step, code: err?.code, message: err?.message, details: err?.details, hint: err?.hint });
    // TEMP DIAGNOSTIC — expose the failing step + db error code (no raw SQL /
    // stack) so live failures can be identified without server logs. Remove
    // once the submission bug is resolved.
    return res.status(500).json({ error: `Unable to process submission. [${step}${err?.code ? ` ${err.code}` : ''}]` });
  }
});

export default router;
