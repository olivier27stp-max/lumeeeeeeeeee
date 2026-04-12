import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendScheduledReport } from '../lib/scheduled-reports';

const router = Router();

// GET /api/scheduled-reports — list reports for org
router.get('/scheduled-reports', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { data, error } = await admin.from('scheduled_reports')
      .select('*')
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to list reports' });
  }
});

// POST /api/scheduled-reports — create report
router.post('/scheduled-reports', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { recipient_email, frequency, day_of_week, day_of_month } = req.body;
    if (!recipient_email) return res.status(400).json({ error: 'recipient_email is required' });

    const { data, error } = await admin.from('scheduled_reports').insert({
      org_id: auth.orgId,
      created_by: auth.user.id,
      recipient_email,
      frequency: frequency || 'weekly',
      day_of_week: day_of_week ?? 1,
      day_of_month: day_of_month ?? 1,
      enabled: true,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to create report' });
  }
});

// PUT /api/scheduled-reports/:id — update report
router.put('/scheduled-reports/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { recipient_email, frequency, day_of_week, day_of_month, enabled } = req.body;

    const { data, error } = await admin.from('scheduled_reports')
      .update({
        ...(recipient_email !== undefined && { recipient_email }),
        ...(frequency !== undefined && { frequency }),
        ...(day_of_week !== undefined && { day_of_week }),
        ...(day_of_month !== undefined && { day_of_month }),
        ...(enabled !== undefined && { enabled }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .select().single();
    if (error) throw error;
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to update report' });
  }
});

// DELETE /api/scheduled-reports/:id
router.delete('/scheduled-reports/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { error } = await admin.from('scheduled_reports')
      .delete()
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to delete report' });
  }
});

// POST /api/scheduled-reports/:id/send-now — trigger immediate send
router.post('/scheduled-reports/:id/send-now', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    await sendScheduledReport(req.params.id);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to send report' });
  }
});

export default router;
