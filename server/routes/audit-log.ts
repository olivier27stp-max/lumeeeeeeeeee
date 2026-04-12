import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';

const router = Router();

router.get('/audit-log', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const page = Number(req.query.page) || 1;
    const limit = 30;
    const offset = (page - 1) * limit;

    let query = admin.from('audit_events')
      .select('*', { count: 'exact' })
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.entity_type && req.query.entity_type !== 'all') query = query.eq('entity_type', req.query.entity_type);
    if (req.query.action && req.query.action !== 'all') query = query.eq('action', req.query.action);

    const { data, error, count } = await query;
    if (error) throw error;
    return res.json({ data: data || [], total: count || 0, page, limit });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

export default router;
