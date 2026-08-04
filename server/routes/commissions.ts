import { Router } from 'express';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { sendSafeError } from '../lib/error-handler';
import {
  getCommissionEntries,
  approveCommission,
  reverseCommission,
  getCommissionRules,
  createCommissionRule,
  updateCommissionRule,
  getPayrollPreview,
  markCommissionPaid,
  generateCommissionsForInvoice,
  projectCommissionForJob,
  voidProjectedCommissionForJob,
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

// POST /api/commissions/project-for-job
// Creates a PENDING (estimated) commission for the job's rep when a job is
// created. Any org member may call it; the recipient is derived from the job
// (salesperson/creator), not the caller, so it can't be used to credit others.
router.post('/commissions/project-for-job', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const { jobId } = req.body || {};
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'jobId is required.' });
  }
  try {
    const sc = getServiceClient();
    const result = await projectCommissionForJob(sc, auth.orgId, jobId);
    res.json(result);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// POST /api/commissions/void-for-job
// Removes the UNCONFIRMED projected (pending, no-invoice) commission for a job
// when it is deleted/cancelled. Derived from the job + caller's org.
router.post('/commissions/void-for-job', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const { jobId } = req.body || {};
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'jobId is required.' });
  }
  try {
    const sc = getServiceClient();
    const result = await voidProjectedCommissionForJob(sc, auth.orgId, jobId);
    res.json(result);
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

// POST /api/commissions/generate-for-invoice (admin) — manual re-run for an invoice
router.post('/commissions/generate-for-invoice', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { invoiceId } = req.body;
  if (!invoiceId) return res.status(400).json({ error: 'invoiceId is required.' });
  try {
    const sc = getServiceClient();
    const result = await generateCommissionsForInvoice(sc, auth.orgId, invoiceId);
    res.json(result);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// POST /api/commissions/:id/mark-paid (admin)
router.post('/commissions/:id/mark-paid', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const entry = await markCommissionPaid(sc, auth.orgId, req.params.id);
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

  const {
    name, description, priority, is_active,
    base_kind, base_percent, base_value_cents,
    product_overrides, performance_tiers, bonuses,
    attribution, assigned_user_ids,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required.' });

  try {
    const sc = getServiceClient();
    const rule = await createCommissionRule(sc, auth.orgId, {
      name,
      description: description ?? null,
      // Legacy required columns — keep DB happy
      type: 'percentage',
      priority: priority ?? 0,
      is_active: is_active ?? true,
      // New engine columns
      base_kind: base_kind ?? 'percent',
      base_percent: base_percent ?? null,
      base_value_cents: base_value_cents ?? null,
      product_overrides: product_overrides ?? [],
      performance_tiers: performance_tiers ?? [],
      bonuses: bonuses ?? [],
      attribution: attribution ?? { mode: 'solo' },
      assigned_user_ids: assigned_user_ids ?? [],
    });
    res.json(rule);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// PUT /api/commissions/rules/:id (admin) — the client API called this route
// but it never existed server-side (silent 404 on every rule edit).
router.put('/commissions/rules/:id', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const ALLOWED = [
    'name', 'description', 'priority', 'is_active',
    'base_kind', 'base_percent', 'base_value_cents',
    'product_overrides', 'performance_tiers', 'bonuses',
    'attribution', 'assigned_user_ids',
  ];
  const payload: Record<string, any> = {};
  // `!= null` : un null explicite du client atteignait sinon des colonnes
  // NOT NULL (name, is_active, priority) → 23502.
  for (const key of ALLOWED) {
    if (req.body[key] != null) payload[key] = req.body[key];
  }
  if (Object.keys(payload).length === 0) return res.status(400).json({ error: 'No editable fields provided.' });

  try {
    const sc = getServiceClient();
    const { data, error } = await sc
      .from('fs_commission_rules')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// POST /api/commissions/rules/assign-member (admin) — atomically move a rep
// onto ONE plan: removed from every other active rule's assigned_user_ids,
// added to the target (rule_id null = default plan only).
router.post('/commissions/rules/assign-member', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const userId = String(req.body?.user_id || '').trim();
  const ruleId = req.body?.rule_id ? String(req.body.rule_id).trim() : null;
  if (!userId) return res.status(400).json({ error: 'user_id is required.' });

  try {
    const sc = getServiceClient();
    const { data: rules, error } = await sc
      .from('fs_commission_rules')
      .select('id, assigned_user_ids')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null);
    if (error) throw new Error(error.message);
    if (ruleId && !(rules || []).some((r: any) => r.id === ruleId)) {
      return res.status(404).json({ error: 'Commission rule not found.' });
    }

    for (const rule of rules || []) {
      const current: string[] = Array.isArray(rule.assigned_user_ids) ? rule.assigned_user_ids : [];
      const shouldContain = rule.id === ruleId;
      const contains = current.includes(userId);
      if (contains === shouldContain) continue;
      const next = shouldContain ? [...current, userId] : current.filter((u) => u !== userId);
      const { error: upErr } = await sc
        .from('fs_commission_rules')
        .update({ assigned_user_ids: next, updated_at: new Date().toISOString() })
        .eq('id', rule.id)
        .eq('org_id', auth.orgId);
      if (upErr) throw new Error(upErr.message);
    }

    res.json({ ok: true, rule_id: ruleId });
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// DELETE /api/commissions/rules/:id (admin) — soft delete
router.delete('/commissions/rules/:id', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    await sc.from('fs_commission_rules')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('org_id', auth.orgId);
    res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// GET /api/commissions/settings
router.get('/commissions/settings', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const { data } = await sc.from('commission_settings').select('*').eq('org_id', auth.orgId).maybeSingle();
    res.json(data || { org_id: auth.orgId, reversal_policy: 'alert', default_rule_id: null });
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// PUT /api/commissions/settings (admin)
router.put('/commissions/settings', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { reversal_policy, default_rule_id } = req.body;
  try {
    const sc = getServiceClient();
    const payload: Record<string, any> = { org_id: auth.orgId, updated_at: new Date().toISOString() };
    if (reversal_policy) {
      if (!['auto','keep','alert'].includes(reversal_policy)) return res.status(400).json({ error: 'Invalid reversal_policy.' });
      payload.reversal_policy = reversal_policy;
    }
    if (default_rule_id !== undefined) payload.default_rule_id = default_rule_id;
    const { data, error } = await sc.from('commission_settings').upsert(payload, { onConflict: 'org_id' }).select().single();
    if (error) throw error;
    res.json(data);
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
