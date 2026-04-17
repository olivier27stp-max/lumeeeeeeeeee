import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { validate, createGoalSchema } from '../lib/validation';

const router = Router();

// GET /api/goals — list goals for org
router.get('/goals', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { data, error } = await admin.from('goals')
      .select('*').eq('org_id', auth.orgId)
      .order('start_date', { ascending: false }).limit(20);
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Goals operation failed.', '[goals]');
  }
});

// POST /api/goals — create
router.post('/goals', validate(createGoalSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { metric, target_value, period, start_date, end_date } = req.body;
    if (!metric || !target_value || !start_date || !end_date) return res.status(400).json({ error: 'Missing required fields' });

    const { data, error } = await admin.from('goals').insert({
      org_id: auth.orgId, created_by: auth.user.id,
      metric, target_value, period: period || 'monthly', start_date, end_date,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Goals operation failed.', '[goals]');
  }
});

// DELETE /api/goals/:id
router.delete('/goals/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    await admin.from('goals').delete().eq('id', req.params.id).eq('org_id', auth.orgId);
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Goals operation failed.', '[goals]');
  }
});

// GET /api/goals/progress — get actual values for active goals
router.get('/goals/progress', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const now = new Date().toISOString().slice(0, 10);
    const { data: goals } = await admin.from('goals')
      .select('*').eq('org_id', auth.orgId)
      .lte('start_date', now).gte('end_date', now);

    if (!goals?.length) return res.json([]);

    const results = [];
    for (const goal of goals) {
      let actual = 0;
      const from = goal.start_date + 'T00:00:00Z';
      const to = goal.end_date + 'T23:59:59Z';

      if (goal.metric === 'revenue') {
        const { data } = await admin.from('invoices')
          .select('total_cents').eq('org_id', auth.orgId).is('deleted_at', null)
          .eq('status', 'paid').gte('paid_at', from).lte('paid_at', to);
        actual = (data || []).reduce((s: number, r: any) => s + Number(r.total_cents || 0), 0);
      } else if (goal.metric === 'jobs') {
        const { count } = await admin.from('jobs')
          .select('*', { count: 'exact', head: true }).eq('org_id', auth.orgId).is('deleted_at', null)
          .gte('created_at', from).lte('created_at', to);
        actual = count || 0;
      } else if (goal.metric === 'leads') {
        const { count } = await admin.from('leads')
          .select('*', { count: 'exact', head: true }).eq('org_id', auth.orgId).is('deleted_at', null)
          .gte('created_at', from).lte('created_at', to);
        actual = count || 0;
      }

      results.push({
        ...goal,
        actual_value: actual,
        progress_pct: goal.target_value > 0 ? Math.min(100, Math.round((actual / goal.target_value) * 100)) : 0,
      });
    }

    return res.json(results);
  } catch (err: any) {
    return sendSafeError(res, err, 'Goals operation failed.', '[goals]');
  }
});

export default router;
