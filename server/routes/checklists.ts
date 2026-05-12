import { Router } from 'express';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

// ── Item schema (template items + instance items snapshot) ──
const itemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['checkbox', 'text', 'number', 'photo', 'signature']),
  label: z.string().min(1).max(500),
  required: z.boolean().optional().default(false),
});
const itemsSchema = z.array(itemSchema).max(200);

const templateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  job_type: z.string().max(100).nullable().optional(),
  items: itemsSchema.optional().default([]),
  is_active: z.boolean().optional(),
});

const templatePatchSchema = templateCreateSchema.partial();

const instanceCreateSchema = z.object({
  template_id: z.string().uuid().nullable().optional(),
  items: itemsSchema.optional(), // for blank checklists
});

const instancePatchSchema = z.object({
  responses: z.record(z.string(), z.any()).optional(),
  completed: z.boolean().optional(),
});

// ════════════════════════════════════════════════════════════════════
// CHECKLIST TEMPLATES
// ════════════════════════════════════════════════════════════════════

// GET /api/checklist-templates — list active templates for org
router.get('/checklist-templates', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const includeInactive = req.query.include_inactive === 'true';
    let query = auth.client
      .from('checklist_templates')
      .select('*')
      .eq('org_id', auth.orgId)
      .order('updated_at', { ascending: false });

    if (!includeInactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;
    return res.json({ templates: data || [] });
  } catch (err: any) {
    console.error('[checklists] list templates failed:', err.message);
    return res.status(500).json({ error: 'Unable to fetch templates.' });
  }
});

// POST /api/checklist-templates — admin only, create
router.post('/checklist-templates', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    if (!(await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId))) {
      return res.status(403).json({ error: 'Admin role required.' });
    }

    const parsed = templateCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid template payload.' });
    }
    const payload = parsed.data;

    const { data, error } = await admin
      .from('checklist_templates')
      .insert({
        org_id: auth.orgId,
        name: payload.name.trim(),
        description: payload.description ?? null,
        job_type: payload.job_type ?? null,
        items: payload.items ?? [],
        is_active: payload.is_active !== false,
      })
      .select('*')
      .single();

    if (error) throw error;
    return res.json({ template: data });
  } catch (err: any) {
    console.error('[checklists] create template failed:', err.message);
    return res.status(500).json({ error: 'Unable to create template.' });
  }
});

// PATCH /api/checklist-templates/:id — admin only, update
router.patch('/checklist-templates/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    if (!(await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId))) {
      return res.status(403).json({ error: 'Admin role required.' });
    }

    const parsed = templatePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid template payload.' });
    }
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    const p = parsed.data;
    if (p.name !== undefined) updates.name = p.name.trim();
    if (p.description !== undefined) updates.description = p.description;
    if (p.job_type !== undefined) updates.job_type = p.job_type;
    if (p.items !== undefined) updates.items = p.items;
    if (p.is_active !== undefined) updates.is_active = p.is_active;

    const { data, error } = await admin
      .from('checklist_templates')
      .update(updates)
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Template not found.' });
    return res.json({ template: data });
  } catch (err: any) {
    console.error('[checklists] patch template failed:', err.message);
    return res.status(500).json({ error: 'Unable to update template.' });
  }
});

// DELETE /api/checklist-templates/:id — admin only, soft-delete via is_active flag
router.delete('/checklist-templates/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    if (!(await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId))) {
      return res.status(403).json({ error: 'Admin role required.' });
    }

    const { error } = await admin
      .from('checklist_templates')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId);

    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[checklists] delete template failed:', err.message);
    return res.status(500).json({ error: 'Unable to delete template.' });
  }
});

// ════════════════════════════════════════════════════════════════════
// JOB CHECKLIST INSTANCES
// ════════════════════════════════════════════════════════════════════

// GET /api/jobs/:jobId/checklists — list instances for a job
router.get('/jobs/:jobId/checklists', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { data, error } = await auth.client
      .from('job_checklists')
      .select('*')
      .eq('org_id', auth.orgId)
      .eq('job_id', req.params.jobId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return res.json({ checklists: data || [] });
  } catch (err: any) {
    console.error('[checklists] list instances failed:', err.message);
    return res.status(500).json({ error: 'Unable to fetch checklists.' });
  }
});

// POST /api/jobs/:jobId/checklists — create instance from template (or blank)
router.post('/jobs/:jobId/checklists', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const parsed = instanceCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload.' });
    }

    const admin = getServiceClient();

    // Verify the job belongs to this org
    const { data: job, error: jobErr } = await admin
      .from('jobs')
      .select('id, org_id')
      .eq('id', req.params.jobId)
      .eq('org_id', auth.orgId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    // Snapshot items from template if provided
    let items: any[] = parsed.data.items ?? [];
    if (parsed.data.template_id) {
      const { data: tpl, error: tplErr } = await admin
        .from('checklist_templates')
        .select('items')
        .eq('id', parsed.data.template_id)
        .eq('org_id', auth.orgId)
        .maybeSingle();
      if (tplErr) throw tplErr;
      if (!tpl) return res.status(404).json({ error: 'Template not found.' });
      items = (tpl.items as any[]) || [];
    }

    const { data, error } = await admin
      .from('job_checklists')
      .insert({
        org_id: auth.orgId,
        job_id: req.params.jobId,
        template_id: parsed.data.template_id ?? null,
        items,
        responses: {},
      })
      .select('*')
      .single();

    if (error) throw error;
    return res.json({ checklist: data });
  } catch (err: any) {
    console.error('[checklists] create instance failed:', err.message);
    return res.status(500).json({ error: 'Unable to create checklist.' });
  }
});

// PATCH /api/jobs/:jobId/checklists/:id — update responses / mark complete
router.patch('/jobs/:jobId/checklists/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const parsed = instancePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload.' });
    }

    const admin = getServiceClient();

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (parsed.data.responses !== undefined) updates.responses = parsed.data.responses;
    if (parsed.data.completed !== undefined) {
      if (parsed.data.completed) {
        updates.completed_at = new Date().toISOString();
        updates.completed_by = auth.user.id;
      } else {
        updates.completed_at = null;
        updates.completed_by = null;
      }
    }

    const { data, error } = await admin
      .from('job_checklists')
      .update(updates)
      .eq('id', req.params.id)
      .eq('job_id', req.params.jobId)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Checklist not found.' });
    return res.json({ checklist: data });
  } catch (err: any) {
    console.error('[checklists] patch instance failed:', err.message);
    return res.status(500).json({ error: 'Unable to update checklist.' });
  }
});

// DELETE /api/jobs/:jobId/checklists/:id — remove instance
router.delete('/jobs/:jobId/checklists/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { error } = await admin
      .from('job_checklists')
      .delete()
      .eq('id', req.params.id)
      .eq('job_id', req.params.jobId)
      .eq('org_id', auth.orgId);

    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[checklists] delete instance failed:', err.message);
    return res.status(500).json({ error: 'Unable to delete checklist.' });
  }
});

export default router;
