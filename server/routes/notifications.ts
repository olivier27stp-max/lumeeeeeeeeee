import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { sendSafeError } from '../lib/error-handler';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

// GET /api/notifications — list unread + recent
router.get('/notifications', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { data, error } = await admin.from('notifications')
      .select('*')
      .eq('org_id', auth.orgId)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch notifications.', '[notifications]');
  }
});

// GET /api/notifications/unread-count
router.get('/notifications/unread-count', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { count, error } = await admin.from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', auth.orgId)
      .is('read_at', null)
      .is('dismissed_at', null);

    if (error) throw error;
    return res.json({ count: count || 0 });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to count notifications.', '[notifications/unread-count]');
  }
});

// POST /api/notifications/read — mark as read (single or all)
router.post('/notifications/read', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { ids } = req.body || {};

    if (ids && Array.isArray(ids)) {
      await admin.from('notifications').update({ read_at: new Date().toISOString(), is_read: true }).eq('org_id', auth.orgId).in('id', ids);
    } else {
      await admin.from('notifications').update({ read_at: new Date().toISOString(), is_read: true }).eq('org_id', auth.orgId).is('read_at', null);
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to mark as read.', '[notifications/read]');
  }
});

// DELETE /api/notifications/:id — dismiss
router.delete('/notifications/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    await admin.from('notifications')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId);

    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to dismiss notification.', '[notifications/delete]');
  }
});

export default router;
