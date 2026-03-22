import { Router } from 'express';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';

const router = Router();

// GET /api/features — list all feature flags for current org
router.get('/features', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { data, error } = await auth.client
      .from('org_features')
      .select('feature, enabled, metadata')
      .eq('org_id', auth.orgId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Return as a map for easy frontend consumption
    const flags: Record<string, { enabled: boolean; metadata: any }> = {};
    for (const row of data || []) {
      flags[row.feature] = { enabled: row.enabled, metadata: row.metadata };
    }

    return res.json({ flags });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to fetch features' });
  }
});

// PUT /api/features/:feature — toggle a feature flag (owner/admin only)
router.put('/features/:feature', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { feature } = req.params;
    const { enabled, metadata } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }

    // Check admin/owner
    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only org owners/admins can toggle features' });
    }

    // Upsert the feature flag
    const { data, error } = await admin
      .from('org_features')
      .upsert(
        {
          org_id: auth.orgId,
          feature,
          enabled,
          ...(metadata !== undefined ? { metadata } : {}),
        },
        { onConflict: 'org_id,feature' }
      )
      .select('feature, enabled, metadata')
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, flag: data });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to update feature' });
  }
});

export default router;
