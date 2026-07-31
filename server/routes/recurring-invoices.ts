/**
 * Recurring Invoice Schedules — CRUD + manual run-now.
 * Auto-generation runs via POST /api/cron/recurring-invoices (see cron.ts).
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
import { validate } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';
import { runOneSchedule } from '../lib/recurringInvoicesEngine';

const router = Router();

const itemSchema = z.object({
  description: z.string().trim().min(1),
  qty: z.number().nonnegative(),
  unit_price_cents: z.number().int().nonnegative(),
});

const createSchema = z.object({
  client_id: z.string().uuid(),
  subject: z.string().trim().min(1).max(200),
  items: z.array(itemSchema).min(1),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  due_days_offset: z.number().int().min(0).max(365).default(30),
  auto_send: z.boolean().default(false),
});

const patchSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  items: z.array(itemSchema).min(1).optional(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_days_offset: z.number().int().min(0).max(365).optional(),
  auto_send: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

async function requireAdmin(req: any, res: any) {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  const admin = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
  if (!admin) {
    res.status(403).json({ error: 'Admin role required.' });
    return null;
  }
  return auth;
}

// GET /api/recurring-invoices — list for org (optional ?client_id=...)
router.get('/recurring-invoices', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const svc = getServiceClient();
    let query = svc
      .from('recurring_invoice_schedules')
      .select('*, clients!recurring_invoice_schedules_client_id_fkey(id, first_name, last_name, company, email)')
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false });
    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : null;
    if (clientId) query = query.eq('client_id', clientId);
    const { data, error } = await query;
    if (error) throw error;
    return res.json({ schedules: data || [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to list schedules.', '[recurring-invoices/list]');
  }
});

// POST /api/recurring-invoices — admin only
router.post('/recurring-invoices', validate(createSchema), async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const body = req.body as z.infer<typeof createSchema>;
    const svc = getServiceClient();

    // Verify client belongs to this org
    const { data: client, error: clientErr } = await svc
      .from('clients')
      .select('id')
      .eq('id', body.client_id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (clientErr) throw clientErr;
    if (!client) return res.status(404).json({ error: 'Client not found.' });

    const { data, error } = await svc
      .from('recurring_invoice_schedules')
      .insert({
        org_id: auth.orgId,
        client_id: body.client_id,
        subject: body.subject,
        items: body.items,
        frequency: body.frequency,
        start_date: body.start_date,
        end_date: body.end_date || null,
        next_run_date: body.start_date,
        due_days_offset: body.due_days_offset,
        auto_send: body.auto_send,
        is_active: true,
      })
      .select('*')
      .single();
    if (error) throw error;
    return res.status(201).json({ schedule: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to create schedule.', '[recurring-invoices/create]');
  }
});

// PATCH /api/recurring-invoices/:id — admin only
router.patch('/recurring-invoices/:id', validate(patchSchema), async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const svc = getServiceClient();
    const update: Record<string, any> = { ...req.body, updated_at: new Date().toISOString() };
    const { data, error } = await svc
      .from('recurring_invoice_schedules')
      .update(update)
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ schedule: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to update schedule.', '[recurring-invoices/update]');
  }
});

// DELETE /api/recurring-invoices/:id — admin only, sets is_active=false (soft)
router.delete('/recurring-invoices/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const svc = getServiceClient();
    const { error } = await svc
      .from('recurring_invoice_schedules')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to delete schedule.', '[recurring-invoices/delete]');
  }
});

// POST /api/recurring-invoices/:id/run-now — manually trigger one schedule
router.post('/recurring-invoices/:id/run-now', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const svc = getServiceClient();
    const { data: schedule, error } = await svc
      .from('recurring_invoice_schedules')
      .select('*')
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .maybeSingle();
    if (error) throw error;
    if (!schedule) return res.status(404).json({ error: 'Schedule not found.' });

    const result = await runOneSchedule(svc, schedule, { advance: false });
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to run schedule.', '[recurring-invoices/run-now]');
  }
});

export default router;
