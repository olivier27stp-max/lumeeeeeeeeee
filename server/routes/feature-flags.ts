import { Router } from 'express';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner, companyOrgIds } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { validate, updateFeatureFlagSchema } from '../lib/validation';
import { isPlatformOverride } from '../lib/platformFeatures';

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
      return sendSafeError(res, error, 'Failed to fetch features.', '[features]');
    }

    // Return as a map for easy frontend consumption
    const flags: Record<string, { enabled: boolean; metadata: any }> = {};
    for (const row of data || []) {
      flags[row.feature] = { enabled: row.enabled, metadata: row.metadata };
    }

    return res.json({ flags });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch features.', '[features]');
  }
});

// PUT /api/features/:feature — toggle a feature flag (owner/admin only)
router.put('/features/:feature', validate(updateFeatureFlagSchema), async (req, res) => {
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

    // Un module est un réglage d'ENTREPRISE (plan multi-bureaux, niveau 1) :
    // il s'applique à tous les bureaux du groupe où l'appelant est propriétaire
    // ou admin actif — tous, pour un propriétaire. Avant, il ne touchait que le
    // bureau affiché, et le bureau frère n'avait pas le module.
    const groupe = await companyOrgIds(admin, auth.orgId);
    const { data: gerables } = await admin
      .from('memberships')
      .select('org_id')
      .eq('user_id', auth.user.id)
      .eq('status', 'active')
      .in('role', ['owner', 'admin'])
      .in('org_id', groupe);
    const bureaux = Array.from(new Set([auth.orgId, ...(gerables || []).map((m: any) => String(m.org_id))]));

    // Une ligne posée par la plateforme (Creator Space) est verrouillée pour
    // le tenant : bloquée ou imposée, elle ne se renverse pas depuis le CRM.
    const { data: existants } = await admin
      .from('org_features')
      .select('org_id, metadata')
      .in('org_id', bureaux)
      .eq('feature', feature);
    const verrouilles = new Set((existants || []).filter((r: any) => isPlatformOverride(r.metadata)).map((r: any) => String(r.org_id)));
    if (verrouilles.has(auth.orgId)) {
      return res.status(403).json({ error: 'Cette fonctionnalité est gérée par Lume pour votre espace de travail. Contactez le support.', platform_locked: true });
    }

    const lignes = bureaux
      .filter((org) => !verrouilles.has(org))
      .map((org) => ({ org_id: org, feature, enabled, ...(metadata !== undefined ? { metadata } : {}) }));
    const { data: ecrites, error } = await admin
      .from('org_features')
      .upsert(lignes, { onConflict: 'org_id,feature' })
      .select('org_id, feature, enabled, metadata');

    if (error) {
      return sendSafeError(res, error, 'Failed to update feature.', '[features]');
    }
    const data = (ecrites || []).find((r: any) => r.org_id === auth.orgId) ?? null;

    return res.json({ ok: true, flag: data, bureaux: lignes.length });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to update feature.', '[features]');
  }
});

export default router;
