import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { sendSafeError } from '../lib/error-handler';
import { cached, cacheDeletePrefix } from '../lib/cache';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

// GET /api/notifications — list unread + recent
router.get('/notifications', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    // Le service client ignore la RLS : on filtre explicitement la visibilité
    // par destinataire, sinon on renvoie les notifications ciblées sur des
    // collègues (user_id IS NULL = tout l'org ; sinon ce user seulement).
    const { data, error } = await admin.from('notifications')
      .select('*')
      .eq('org_id', auth.orgId)
      .or(`user_id.is.null,user_id.eq.${auth.user.id}`)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch notifications.', '[notifications]');
  }
});

// GET /api/notifications/unread-count — cached 10s (high-frequency poll)
router.get('/notifications/unread-count', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    // Cache PAR UTILISATEUR (pas par org) : sinon un utilisateur voyait le
    // compteur d'un collègue. Et filtre de visibilité comme ci-dessus.
    const count = await cached(`notifs:unread:${auth.orgId}:${auth.user.id}`, 10, async () => {
      const { count, error } = await admin.from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
        .or(`user_id.is.null,user_id.eq.${auth.user.id}`)
        .is('read_at', null)
        .is('dismissed_at', null);
      if (error) throw error;
      return count || 0;
    });

    return res.json({ count });
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

    // Filtre de visibilité : ne marquer lu QUE ses propres notifications (ou
    // org-wide). Sans ça, « tout marquer lu » effaçait le non-lu des collègues.
    const visibles = `user_id.is.null,user_id.eq.${auth.user.id}`;
    if (ids && Array.isArray(ids)) {
      await admin.from('notifications').update({ read_at: new Date().toISOString(), is_read: true }).eq('org_id', auth.orgId).or(visibles).in('id', ids);
    } else {
      await admin.from('notifications').update({ read_at: new Date().toISOString(), is_read: true }).eq('org_id', auth.orgId).or(visibles).is('read_at', null);
    }
    cacheDeletePrefix(`notifs:unread:${auth.orgId}:${auth.user.id}`);
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

    // On ne peut écarter QUE ses propres notifications (ou org-wide), pas celle
    // d'un collègue.
    await admin.from('notifications')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .or(`user_id.is.null,user_id.eq.${auth.user.id}`);

    cacheDeletePrefix(`notifs:unread:${auth.orgId}:${auth.user.id}`);
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to dismiss notification.', '[notifications/delete]');
  }
});

export default router;
