import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';

const router = Router();

// ── GET /quote-templates — list all templates for org ──────
router.get('/quote-templates', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    let query = auth.client
      .from('quote_templates')
      .select('*')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });

    const { data, error } = await query;
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

    const {
      name, description, services, images, notes, terms, custom_fields,
      is_default, is_active, sort_order, template_category,
      quote_title, intro_text, footer_notes,
      deposit_required, deposit_type, deposit_value,
      tax_enabled, tax_rate, tax_label,
      sections, layout_config, style_config,
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Template name is required.' });
    }

    const admin = getServiceClient();

    // If setting as default, clear existing default first
    if (is_default) {
      await admin
        .from('quote_templates')
        .update({ is_default: false })
        .eq('org_id', auth.orgId)
        .eq('is_default', true)
        .is('deleted_at', null)
        .then(() => {}); // ignore if column missing
    }

    // Base payload (original schema)
    const payload: Record<string, any> = {
      org_id: auth.orgId,
      created_by: auth.user.id,
      name: name.trim(),
      description: description || null,
      services: services || [],
      images: images || [],
      notes: notes || null,
      terms: terms || null,
      custom_fields: custom_fields || {},
    };
    // V2 fields — only include if provided (tolerant of old schema)
    if (is_default !== undefined) payload.is_default = is_default || false;
    if (is_active !== undefined) payload.is_active = is_active !== false;
    if (sort_order !== undefined) payload.sort_order = sort_order ?? 0;
    if (template_category !== undefined) payload.template_category = template_category || null;
    if (quote_title !== undefined) payload.quote_title = quote_title || null;
    if (intro_text !== undefined) payload.intro_text = intro_text || null;
    if (footer_notes !== undefined) payload.footer_notes = footer_notes || null;
    if (deposit_required !== undefined) payload.deposit_required = deposit_required || false;
    if (deposit_type !== undefined) payload.deposit_type = deposit_type || null;
    if (deposit_value !== undefined) payload.deposit_value = deposit_value ?? 0;
    if (tax_enabled !== undefined) payload.tax_enabled = tax_enabled !== false;
    if (tax_rate !== undefined) payload.tax_rate = tax_rate ?? 14.975;
    if (tax_label !== undefined) payload.tax_label = tax_label || 'TPS+TVQ (14.975%)';
    if (sections !== undefined) payload.sections = sections || [];
    if (layout_config !== undefined) payload.layout_config = layout_config || {};
    if (style_config !== undefined) payload.style_config = style_config || {};

    let { data, error } = await admin
      .from('quote_templates')
      .insert(payload)
      .select('*')
      .single();

    // If V2 columns don't exist yet, retry with base-only payload
    if (error && error.message?.includes('column')) {
      const base = {
        org_id: auth.orgId, created_by: auth.user.id,
        name: name.trim(), description: description || null,
        services: services || [], images: images || [],
        notes: notes || null, terms: terms || null,
        custom_fields: custom_fields || {},
      };
      const retry = await admin.from('quote_templates').insert(base).select('*').single();
      data = retry.data;
      error = retry.error;
    }

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

    const {
      name, description, services, images, notes, terms, custom_fields,
      is_default, is_active, sort_order, template_category,
      quote_title, intro_text, footer_notes,
      deposit_required, deposit_type, deposit_value,
      tax_enabled, tax_rate, tax_label,
      sections, layout_config, style_config,
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Template name is required.' });
    }

    const admin = getServiceClient();

    // If setting as default, clear existing default first
    if (is_default) {
      await admin
        .from('quote_templates')
        .update({ is_default: false })
        .eq('org_id', auth.orgId)
        .eq('is_default', true)
        .is('deleted_at', null)
        .neq('id', req.params.id)
        .then(() => {});
    }

    const payload: Record<string, any> = {
      name: name.trim(),
      description: description || null,
      services: services || [],
      images: images || [],
      notes: notes || null,
      terms: terms || null,
      custom_fields: custom_fields || {},
      updated_at: new Date().toISOString(),
    };
    if (is_default !== undefined) payload.is_default = is_default || false;
    if (is_active !== undefined) payload.is_active = is_active !== false;
    if (sort_order !== undefined) payload.sort_order = sort_order ?? 0;
    if (template_category !== undefined) payload.template_category = template_category || null;
    if (quote_title !== undefined) payload.quote_title = quote_title || null;
    if (intro_text !== undefined) payload.intro_text = intro_text || null;
    if (footer_notes !== undefined) payload.footer_notes = footer_notes || null;
    if (deposit_required !== undefined) payload.deposit_required = deposit_required || false;
    if (deposit_type !== undefined) payload.deposit_type = deposit_type || null;
    if (deposit_value !== undefined) payload.deposit_value = deposit_value ?? 0;
    if (tax_enabled !== undefined) payload.tax_enabled = tax_enabled !== false;
    if (tax_rate !== undefined) payload.tax_rate = tax_rate ?? 14.975;
    if (tax_label !== undefined) payload.tax_label = tax_label || 'TPS+TVQ (14.975%)';
    if (sections !== undefined) payload.sections = sections || [];
    if (layout_config !== undefined) payload.layout_config = layout_config || {};
    if (style_config !== undefined) payload.style_config = style_config || {};

    let { data, error } = await admin
      .from('quote_templates')
      .update(payload)
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .select('*')
      .single();

    // Retry with base-only if V2 columns missing
    if (error && error.message?.includes('column')) {
      const base = {
        name: name.trim(), description: description || null,
        services: services || [], images: images || [],
        notes: notes || null, terms: terms || null,
        custom_fields: custom_fields || {},
        updated_at: new Date().toISOString(),
      };
      const retry = await admin.from('quote_templates').update(base)
        .eq('id', req.params.id).eq('org_id', auth.orgId).is('deleted_at', null)
        .select('*').single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Template not found.' });
    return res.json({ template: data });
  } catch (err: any) {
    console.error('[quote-templates] update failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to update template.' });
  }
});

// ── PATCH /quote-templates/:id/default — toggle default ────
router.patch('/quote-templates/:id/default', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { is_default } = req.body;

    if (is_default) {
      await admin.from('quote_templates').update({ is_default: false })
        .eq('org_id', auth.orgId).eq('is_default', true).is('deleted_at', null).then(() => {});
    }

    const { data, error } = await admin.from('quote_templates')
      .update({ is_default: !!is_default, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('org_id', auth.orgId).is('deleted_at', null)
      .select('*').single();

    if (error) {
      if (error.message?.includes('column')) {
        return res.status(400).json({ error: 'Migration required: run the quote_templates_v2 migration first.' });
      }
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Template not found.' });
    return res.json({ template: data });
  } catch (err: any) {
    console.error('[quote-templates] set-default failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to update default.' });
  }
});

// ── PATCH /quote-templates/:id/active — toggle active ──────
router.patch('/quote-templates/:id/active', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { is_active } = req.body;

    const { data, error } = await admin.from('quote_templates')
      .update({ is_active: !!is_active, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('org_id', auth.orgId).is('deleted_at', null)
      .select('*').single();

    if (error) {
      if (error.message?.includes('column')) {
        return res.status(400).json({ error: 'Migration required: run the quote_templates_v2 migration first.' });
      }
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Template not found.' });
    return res.json({ template: data });
  } catch (err: any) {
    console.error('[quote-templates] toggle-active failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to toggle active.' });
  }
});

// ── DELETE /quote-templates/:id — soft delete ──────────────
router.delete('/quote-templates/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();

    // Check if it's the default — if so, remove default status
    const { data: existing } = await admin
      .from('quote_templates')
      .select('is_default')
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();

    const { error } = await admin
      .from('quote_templates')
      .update({ deleted_at: new Date().toISOString(), is_default: false })
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

    // Copy only base columns (safe for both old and new schema)
    const copyPayload: Record<string, any> = {
      org_id: auth.orgId,
      created_by: auth.user.id,
      name: `${source.name} (Copy)`,
      description: source.description,
      services: source.services,
      images: source.images,
      notes: source.notes,
      terms: source.terms,
      custom_fields: source.custom_fields,
    };
    // V2 fields — only copy if present on source
    for (const key of ['is_active','sort_order','template_category','quote_title','intro_text','footer_notes','deposit_required','deposit_type','deposit_value','tax_enabled','tax_rate','tax_label','sections','layout_config','style_config']) {
      if (source[key] !== undefined) copyPayload[key] = source[key];
    }
    copyPayload.is_default = false; // never copy default status

    let { data, error } = await admin.from('quote_templates').insert(copyPayload).select('*').single();

    if (error && error.message?.includes('column')) {
      const base = { org_id: auth.orgId, created_by: auth.user.id, name: `${source.name} (Copy)`, description: source.description, services: source.services, images: source.images, notes: source.notes, terms: source.terms, custom_fields: source.custom_fields };
      const retry = await admin.from('quote_templates').insert(base).select('*').single();
      data = retry.data; error = retry.error;
    }

    if (error) throw error;
    return res.json({ template: data });
  } catch (err: any) {
    console.error('[quote-templates] duplicate failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to duplicate template.' });
  }
});

// ── POST /quote-templates/seed — create 3 prefab templates ──
router.post('/quote-templates/seed', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();

    const { count } = await admin
      .from('quote_templates')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', auth.orgId)
      .is('deleted_at', null);

    if (count && count > 0) {
      return res.json({ seeded: false, message: 'Templates already exist.' });
    }

    // 3 templates using only base schema columns (no V2 fields)
    const prefabs = [
      {
        org_id: auth.orgId,
        created_by: auth.user.id,
        name: 'Classic Blue',
        description: 'Professional navy blue layout with clean corporate styling.',
        services: [
          { id: crypto.randomUUID(), name: 'Service Visit', description: 'On-site service call including assessment and standard work', unit_price_cents: 15000, quantity: 1, is_optional: false },
          { id: crypto.randomUUID(), name: 'Materials', description: 'Required materials and supplies', unit_price_cents: 5000, quantity: 1, is_optional: false },
        ],
        images: [],
        notes: 'Work will be scheduled within 5 business days of approval. All materials included in quoted price.',
        terms: 'This quote is valid for 30 days from the date of issue. Payment is due upon completion unless otherwise agreed.',
        custom_fields: {},
      },
      {
        org_id: auth.orgId,
        created_by: auth.user.id,
        name: 'Detailed Red',
        description: 'Detailed estimate with full cost breakdown, signature line, and service information.',
        services: [
          { id: crypto.randomUUID(), name: 'Site Assessment', description: 'On-site evaluation and project scoping', unit_price_cents: 10000, quantity: 1, is_optional: false },
          { id: crypto.randomUUID(), name: 'Primary Service', description: 'Complete execution of project scope', unit_price_cents: 45000, quantity: 1, is_optional: false },
          { id: crypto.randomUUID(), name: 'Materials & Supplies', description: 'All required materials', unit_price_cents: 20000, quantity: 1, is_optional: false },
          { id: crypto.randomUUID(), name: 'Cleanup & Disposal', description: 'Site cleanup and waste disposal', unit_price_cents: 5000, quantity: 1, is_optional: false },
        ],
        images: [],
        notes: 'All work performed by licensed and insured professionals.',
        terms: 'Quote valid for 30 days. A 25% deposit is required prior to commencement. Balance due upon completion.',
        custom_fields: {},
      },
      {
        org_id: auth.orgId,
        created_by: auth.user.id,
        name: 'Modern Bold',
        description: 'Vibrant contemporary design with bold orange accents and modern styling.',
        services: [
          { id: crypto.randomUUID(), name: 'Consultation', description: 'Initial assessment and project planning', unit_price_cents: 15000, quantity: 1, is_optional: false },
          { id: crypto.randomUUID(), name: 'Service Delivery', description: 'Full project execution as outlined', unit_price_cents: 60000, quantity: 1, is_optional: false },
          { id: crypto.randomUUID(), name: 'Materials', description: 'Quality materials sourced from trusted suppliers', unit_price_cents: 25000, quantity: 1, is_optional: false },
        ],
        images: [],
        notes: 'Project timeline will be confirmed upon approval. Progress updates provided regularly.',
        terms: 'This quote is valid for 30 days. Payment due upon completion unless otherwise agreed.',
        custom_fields: {},
      },
    ];

    const { data, error } = await admin.from('quote_templates').insert(prefabs).select('*');
    if (error) throw error;
    return res.json({ seeded: true, templates: data });
  } catch (err: any) {
    console.error('[quote-templates] seed failed:', err.message);
    return res.status(500).json({ error: err.message || 'Unable to seed templates.' });
  }
});

export default router;
