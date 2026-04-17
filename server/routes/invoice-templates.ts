/* ═══════════════════════════════════════════════════════════════
   Routes — Invoice Templates
   CRUD for invoice_templates (org-scoped, auth required).
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { validate, invoiceTemplateSchema } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// GET /api/invoice-templates — list all templates for org (exclude archived)
router.get('/invoice-templates', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const serviceClient = getServiceClient();

    const { data, error } = await serviceClient
      .from('invoice_templates')
      .select('*')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json(data || []);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load invoice templates.', '[invoice-templates/list]');
  }
});

// POST /api/invoice-templates — create template
router.post('/invoice-templates', validate(invoiceTemplateSchema), async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId, user } = authed;
    const serviceClient = getServiceClient();

    const {
      name, title, description, line_items, taxes, payment_terms,
      client_note, branding, payment_methods, email_subject, email_body, is_default,
    } = req.body;

    // If setting as default, unset other defaults first
    if (is_default) {
      await serviceClient
        .from('invoice_templates')
        .update({ is_default: false })
        .eq('org_id', orgId)
        .is('archived_at', null);
    }

    const { data, error } = await serviceClient
      .from('invoice_templates')
      .insert({
        org_id: orgId,
        created_by: user.id,
        name,
        title: title || null,
        description: description || null,
        line_items: line_items || null,
        taxes: taxes || null,
        payment_terms: payment_terms || null,
        client_note: client_note || null,
        branding: branding || null,
        payment_methods: payment_methods || null,
        email_subject: email_subject || null,
        email_body: email_body || null,
        is_default: is_default || false,
      })
      .select()
      .single();

    if (error) throw error;

    // Log activity
    await serviceClient.from('activity_log').insert({
      org_id: orgId,
      entity_type: 'invoice_template',
      entity_id: data.id,
      event_type: 'created',
      metadata: { name },
    });

    return res.status(201).json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to create invoice template.', '[invoice-templates/create]');
  }
});

// PUT /api/invoice-templates/:id — update template
router.put('/invoice-templates/:id', validate(invoiceTemplateSchema), async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    const {
      name, title, description, line_items, taxes, payment_terms,
      client_note, branding, payment_methods, email_subject, email_body, is_default,
    } = req.body;

    // If setting as default, unset other defaults first
    if (is_default) {
      await serviceClient
        .from('invoice_templates')
        .update({ is_default: false })
        .eq('org_id', orgId)
        .is('archived_at', null);
    }

    const { data, error } = await serviceClient
      .from('invoice_templates')
      .update({
        name,
        title: title || null,
        description: description || null,
        line_items: line_items || null,
        taxes: taxes || null,
        payment_terms: payment_terms || null,
        client_note: client_note || null,
        branding: branding || null,
        payment_methods: payment_methods || null,
        email_subject: email_subject || null,
        email_body: email_body || null,
        is_default: is_default ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('archived_at', null)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Template not found' });

    // Log activity
    await serviceClient.from('activity_log').insert({
      org_id: orgId,
      entity_type: 'invoice_template',
      entity_id: id,
      event_type: 'updated',
      metadata: { name: data.name },
    });

    return res.json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to update invoice template.', '[invoice-templates/update]');
  }
});

// POST /api/invoice-templates/:id/duplicate — duplicate template
router.post('/invoice-templates/:id/duplicate', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId, user } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    // Fetch original
    const { data: original, error: fetchError } = await serviceClient
      .from('invoice_templates')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('archived_at', null)
      .single();

    if (fetchError || !original) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Create duplicate
    const { data, error } = await serviceClient
      .from('invoice_templates')
      .insert({
        org_id: orgId,
        created_by: user.id,
        name: `${original.name} (Copy)`,
        title: original.title,
        description: original.description,
        line_items: original.line_items,
        taxes: original.taxes,
        payment_terms: original.payment_terms,
        client_note: original.client_note,
        branding: original.branding,
        payment_methods: original.payment_methods,
        email_subject: original.email_subject,
        email_body: original.email_body,
        is_default: false,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to duplicate invoice template.', '[invoice-templates/duplicate]');
  }
});

// POST /api/invoice-templates/:id/set-default — set as default (unset others)
router.post('/invoice-templates/:id/set-default', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    // Unset all defaults for this org
    await serviceClient
      .from('invoice_templates')
      .update({ is_default: false })
      .eq('org_id', orgId)
      .is('archived_at', null);

    // Set this template as default
    const { data, error } = await serviceClient
      .from('invoice_templates')
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('archived_at', null)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Template not found' });

    return res.json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to set default template.', '[invoice-templates/set-default]');
  }
});

// DELETE /api/invoice-templates/:id — soft delete (set archived_at)
router.delete('/invoice-templates/:id', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    const { data, error } = await serviceClient
      .from('invoice_templates')
      .update({ archived_at: new Date().toISOString(), is_default: false })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('archived_at', null)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Template not found' });

    // Log activity
    await serviceClient.from('activity_log').insert({
      org_id: orgId,
      entity_type: 'invoice_template',
      entity_id: id,
      event_type: 'deleted',
      metadata: { name: data.name },
    });

    return res.json({ ok: true });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to delete invoice template.', '[invoice-templates/delete]');
  }
});

export default router;
