import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { sendSafeError } from '../lib/error-handler';
import {
  getCommissionEntries,
  calculateCommission,
  approveCommission,
  reverseCommission,
  getCommissionRules,
  createCommissionRule,
  updateCommissionRule,
  getPayrollPreview,
} from '../lib/field-sales/commission-engine';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

// GET /api/commissions?userId=...&status=...&from=...&to=...
router.get('/commissions', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const userId = req.query.userId as string | undefined;
  const status = req.query.status as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  try {
    const sc = getServiceClient();
    const entries = await getCommissionEntries(sc, auth.orgId, {
      userId,
      status,
      dateRange: from && to ? { from, to } : undefined,
    });
    res.json(entries);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// POST /api/commissions/calculate
router.post('/commissions/calculate', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { leadId, repUserId } = req.body;
  if (!leadId || !repUserId) {
    return res.status(400).json({ error: 'leadId and repUserId are required.' });
  }

  try {
    const sc = getServiceClient();
    const entry = await calculateCommission(sc, auth.orgId, leadId, repUserId);
    res.json(entry);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// POST /api/commissions/:id/approve
router.post('/commissions/:id/approve', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const entry = await approveCommission(sc, auth.orgId, req.params.id, auth.user.id);
    res.json(entry);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// POST /api/commissions/:id/reverse
router.post('/commissions/:id/reverse', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const reason = req.body.reason || '';

  try {
    const sc = getServiceClient();
    const entry = await reverseCommission(sc, auth.orgId, req.params.id, reason);
    res.json(entry);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// GET /api/commissions/rules
router.get('/commissions/rules', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const rules = await getCommissionRules(sc, auth.orgId);
    res.json(rules);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// POST /api/commissions/rules
router.post('/commissions/rules', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { name, type, flat_amount, percentage, tiers, applies_to_role, applies_to_user_id, priority } = req.body;
  if (!name || !type) {
    return res.status(400).json({ error: 'name and type are required.' });
  }

  try {
    const sc = getServiceClient();
    const rule = await createCommissionRule(sc, auth.orgId, {
      name, type, flat_amount, percentage, tiers, applies_to_role, applies_to_user_id, priority,
    });
    res.json(rule);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// PUT /api/commissions/rules/:id
router.put('/commissions/rules/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const rule = await updateCommissionRule(sc, auth.orgId, req.params.id, req.body);
    res.json(rule);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// GET /api/commissions/payroll-preview?userId=...&from=...&to=...
router.get('/commissions/payroll-preview', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const userId = (req.query.userId as string) || null;
  const from = req.query.from as string;
  const to = req.query.to as string;

  if (!from || !to) {
    return res.status(400).json({ error: 'from and to query parameters are required.' });
  }

  try {
    const sc = getServiceClient();
    const preview = await getPayrollPreview(sc, auth.orgId, userId, from, to);
    res.json(preview);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

export default router;
