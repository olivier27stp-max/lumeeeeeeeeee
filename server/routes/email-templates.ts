/* ═══════════════════════════════════════════════════════════════
   Routes — Email Templates
   CRUD for email_templates (org-scoped, auth required).
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { validate, emailTemplateSchema } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// GET /api/email-templates — list all for org, optional ?type= filter
router.get('/email-templates', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const serviceClient = getServiceClient();

    let query = serviceClient
      .from('email_templates')
      .select('*')
      .eq('org_id', orgId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    const typeFilter = req.query.type as string | undefined;
    if (typeFilter) {
      query = query.eq('type', typeFilter);
    }

    const { data, error } = await query;

    if (error) throw error;
    return res.json(data || []);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load email templates.', '[email-templates/list]');
  }
});

// GET /api/email-templates/:id — get single template
router.get('/email-templates/:id', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    const { data, error } = await serviceClient
      .from('email_templates')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Email template not found' });

    return res.json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load email template.', '[email-templates/get]');
  }
});

// POST /api/email-templates — create template
router.post('/email-templates', validate(emailTemplateSchema), async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId, user } = authed;
    const serviceClient = getServiceClient();

    const { name, type, subject, body, variables, is_active, is_default } = req.body;

    // If setting as default, unset other defaults of same type
    if (is_default) {
      await serviceClient
        .from('email_templates')
        .update({ is_default: false })
        .eq('org_id', orgId)
        .eq('type', type);
    }

    const { data, error } = await serviceClient
      .from('email_templates')
      .insert({
        org_id: orgId,
        created_by: user.id,
        name,
        type,
        subject,
        body,
        variables: variables || null,
        is_active: is_active ?? true,
        is_default: is_default || false,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to create email template.', '[email-templates/create]');
  }
});

// PUT /api/email-templates/:id — update template
router.put('/email-templates/:id', validate(emailTemplateSchema), async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    const { name, type, subject, body, variables, is_active, is_default } = req.body;

    // If setting as default, unset other defaults of same type
    if (is_default) {
      await serviceClient
        .from('email_templates')
        .update({ is_default: false })
        .eq('org_id', orgId)
        .eq('type', type);
    }

    const { data, error } = await serviceClient
      .from('email_templates')
      .update({
        name,
        type,
        subject,
        body,
        variables: variables || null,
        is_active: is_active ?? undefined,
        is_default: is_default ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Email template not found' });

    return res.json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to update email template.', '[email-templates/update]');
  }
});

// POST /api/email-templates/:id/duplicate — duplicate template
router.post('/email-templates/:id/duplicate', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId, user } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    // Fetch original
    const { data: original, error: fetchError } = await serviceClient
      .from('email_templates')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !original) {
      return res.status(404).json({ error: 'Email template not found' });
    }

    // Create duplicate
    const { data, error } = await serviceClient
      .from('email_templates')
      .insert({
        org_id: orgId,
        created_by: user.id,
        name: `${original.name} (Copy)`,
        type: original.type,
        subject: original.subject,
        body: original.body,
        variables: original.variables,
        is_active: original.is_active,
        is_default: false,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to duplicate email template.', '[email-templates/duplicate]');
  }
});

// POST /api/email-templates/:id/set-default — set as default for its type (unset others of same type)
router.post('/email-templates/:id/set-default', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    // Fetch template to get its type
    const { data: template, error: fetchError } = await serviceClient
      .from('email_templates')
      .select('id, type')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !template) {
      return res.status(404).json({ error: 'Email template not found' });
    }

    // Unset all defaults for this type in org
    await serviceClient
      .from('email_templates')
      .update({ is_default: false })
      .eq('org_id', orgId)
      .eq('type', template.type);

    // Set this template as default
    const { data, error } = await serviceClient
      .from('email_templates')
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single();

    if (error) throw error;

    return res.json(data);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to set default email template.', '[email-templates/set-default]');
  }
});

// DELETE /api/email-templates/:id — hard delete
router.delete('/email-templates/:id', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;
    const { id } = req.params;
    const serviceClient = getServiceClient();

    const { error } = await serviceClient
      .from('email_templates')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) throw error;

    return res.json({ ok: true });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to delete email template.', '[email-templates/delete]');
  }
});

export default router;
