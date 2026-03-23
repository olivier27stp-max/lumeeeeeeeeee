import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';

const router = Router();

// ── GET /quote-templates — list all templates for org ──────
router.get('/quote-templates', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { data, error } = await auth.client
      .from('quote_templates')
      .select('*')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return res.json({ templates: data || [] });
  } catch (err: any) {
    console.error('[quote-templates] list failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to fetch templates.' });
  }
});

// ── GET /quote-templates/:id — get single template ─────────
router.get('/quote-templates/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { data, error } = await auth.client
      .from('quote_templates')
      .select('*')
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Template not found.' });
    return res.json({ template: data });
  } catch (err: any) {
    console.error('[quote-templates] get failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to fetch template.' });
  }
});

// ── POST /quote-templates — create template ────────────────
router.post('/quote-templates', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { name, description, services, images, notes, terms, custom_fields } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Template name is required.' });
    }

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('quote_templates')
      .insert({
        org_id: auth.orgId,
        created_by: auth.user.id,
        name: name.trim(),
        description: description || null,
        services: services || [],
        images: images || [],
        notes: notes || null,
        terms: terms || null,
        custom_fields: custom_fields || {},
      })
      .select('*')
      .single();

    if (error) throw error;
    return res.json({ template: data });
  } catch (err: any) {
    console.error('[quote-templates] create failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to create template.' });
  }
});

// ── PUT /quote-templates/:id — update template ─────────────
router.put('/quote-templates/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { name, description, services, images, notes, terms, custom_fields } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Template name is required.' });
    }

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('quote_templates')
      .update({
        name: name.trim(),
        description: description || null,
        services: services || [],
        images: images || [],
        notes: notes || null,
        terms: terms || null,
        custom_fields: custom_fields || {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Template not found.' });
    return res.json({ template: data });
  } catch (err: any) {
    console.error('[quote-templates] update failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to update template.' });
  }
});

// ── DELETE /quote-templates/:id — soft delete ──────────────
router.delete('/quote-templates/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { error } = await admin
      .from('quote_templates')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null);

    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[quote-templates] delete failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to delete template.' });
  }
});

// ── POST /quote-templates/:id/duplicate — duplicate ────────
router.post('/quote-templates/:id/duplicate', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data: source, error: fetchErr } = await admin
      .from('quote_templates')
      .select('*')
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!source) return res.status(404).json({ error: 'Template not found.' });

    const { data, error } = await admin
      .from('quote_templates')
      .insert({
        org_id: auth.orgId,
        created_by: auth.user.id,
        name: `${source.name} (Copy)`,
        description: source.description,
        services: source.services,
        images: source.images,
        notes: source.notes,
        terms: source.terms,
        custom_fields: source.custom_fields,
      })
      .select('*')
      .single();

    if (error) throw error;
    return res.json({ template: data });
  } catch (err: any) {
    console.error('[quote-templates] duplicate failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to duplicate template.' });
  }
});

export default router;
