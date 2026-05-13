import { Router } from 'express';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
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
// Reps see only their own commissions; owners/admins see all (and can filter by userId).
router.get('/commissions', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const requestedUserId = req.query.userId as string | undefined;
  const status = req.query.status as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    const effectiveUserId = isAdmin ? requestedUserId : auth.user.id;

    const entries = await getCommissionEntries(sc, auth.orgId, {
      userId: effectiveUserId,
      status,
      dateRange: from && to ? { from, to } : undefined,
    });
    res.json(entries);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// All write/admin endpoints below this point require owner/admin role.
async function requireAdmin(req: any, res: any) {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  const sc = getServiceClient();
  const ok = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
  if (!ok) {
    res.status(403).json({ error: 'Only owners and admins can manage commission rules.' });
    return null;
  }
  return auth;
}

// POST /api/commissions/calculate (admin)
router.post('/commissions/calculate', async (req, res) => {
  const auth = await requireAdmin(req, res);
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

// POST /api/commissions/:id/approve (admin)
router.post('/commissions/:id/approve', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const entry = await approveCommission(sc, auth.orgId, req.params.id, auth.user.id);
    res.json(entry);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// POST /api/commissions/:id/reverse (admin)
router.post('/commissions/:id/reverse', async (req, res) => {
  const auth = await requireAdmin(req, res);
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

// GET /api/commissions/rules — anyone can read (rep needs to see their own rate),
// but only admin can write.
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

// POST /api/commissions/rules (admin)
router.post('/commissions/rules', async (req, res) => {
  const auth = await requireAdmin(req, res);
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

// PUT /api/commissions/rules/:id (admin)
router.put('/commissions/rules/:id', async (req, res) => {
  const auth = await requireAdmin(req, res);
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
// Reps can only preview their own; admins can preview anyone or all.
router.get('/commissions/payroll-preview', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const requestedUserId = (req.query.userId as string) || null;
  const from = req.query.from as string;
  const to = req.query.to as string;

  if (!from || !to) {
    return res.status(400).json({ error: 'from and to query parameters are required.' });
  }

  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    const effectiveUserId = isAdmin ? requestedUserId : auth.user.id;
    const preview = await getPayrollPreview(sc, auth.orgId, effectiveUserId, from, to);
    res.json(preview);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// GET /api/commissions/me — current user's role flag (used by UI to hide admin controls)
router.get('/commissions/me', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    res.json({ user_id: auth.user.id, is_admin: isAdmin });
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

export default router;
