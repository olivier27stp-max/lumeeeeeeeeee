import { Router, Request, Response } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// GET /api/org-knowledge — list all active entries for the org, optionally filtered by category
router.get('/', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { category } = req.query;

  let query = admin
    .from('org_knowledge')
    .select('*')
    .eq('org_id', auth.orgId)
    .eq('is_active', true)
    .order('importance', { ascending: false });

  if (category && typeof category === 'string') {
    query = query.eq('category', category);
  }

  const { data, error } = await query;

  if (error) {
    return sendSafeError(res, error, 'Failed to fetch knowledge entries.', '[org-knowledge]');
  }

  return res.json({ data });
});

// POST /api/org-knowledge — upsert a single entry
router.post('/', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { category, key, value, importance } = req.body as {
    category: string;
    key: string;
    value: string;
    importance?: number;
  };

  if (!category || !key || value === undefined) {
    return res.status(400).json({ error: 'category, key, and value are required' });
  }

  const { data, error } = await admin
    .from('org_knowledge')
    .upsert(
      {
        org_id: auth.orgId,
        category,
        key,
        value,
        importance: importance ?? 5,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,category,key' }
    )
    .select()
    .single();

  if (error) {
    return sendSafeError(res, error, 'Failed to save knowledge entry.', '[org-knowledge]');
  }

  return res.json({ data });
});

// DELETE /api/org-knowledge/:id — soft-delete by setting is_active = false
router.delete('/:id', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const { id } = req.params;

  const { error } = await admin
    .from('org_knowledge')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', auth.orgId);

  if (error) {
    return sendSafeError(res, error, 'Failed to delete knowledge entry.', '[org-knowledge]');
  }

  return res.json({ success: true });
});

// POST /api/org-knowledge/bulk — bulk upsert array of entries
router.post('/bulk', async (req: Request, res: Response) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const admin = getServiceClient();

  const entries = req.body as Array<{
    category: string;
    key: string;
    value: string;
    importance?: number;
  }>;

  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'Body must be a non-empty array of entries' });
  }

  const rows = entries.map((e) => ({
    org_id: auth.orgId,
    category: e.category,
    key: e.key,
    value: e.value,
    importance: e.importance ?? 5,
    is_active: true,
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await admin
    .from('org_knowledge')
    .upsert(rows, { onConflict: 'org_id,category,key' })
    .select();

  if (error) {
    return sendSafeError(res, error, 'Failed to bulk save knowledge entries.', '[org-knowledge/bulk]');
  }

  return res.json({ data });
});

export default router;
