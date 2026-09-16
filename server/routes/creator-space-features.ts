// Creator Space — fonctionnalités par workspace (activer / bloquer par-dessus
// le forfait).
//
// Volontairement HORS de creator-space.ts pour préserver son invariant
// « lecture seule » (verrouillé par tests/creator-space/route-guards.test.ts).
// Même discipline que creator-space-audit.ts :
//
//   - chaque handler se garde par requireCreatorSpace (platformAdminIds) ;
//   - toute modification est journalisée dans security_events AVANT l'écriture
//     (creator_space_feature_override, raison obligatoire) — si la
//     journalisation échoue, la modification est refusée ;
//   - tables écrites : org_features (upsert / delete) et security_events
//     (insert). Rien d'autre.
//
// Modèle : une ligne org_features { feature, enabled, metadata } par clé.
// metadata.platform_override = true marque une ligne posée ici ; le tenant ne
// peut plus la toucher via PUT /api/features/:feature. « Hériter » supprime
// cette ligne (le forfait ou le choix du tenant redevient la source).
// L'override s'applique à TOUS les bureaux de la compagnie (company_group),
// comme le forfait lui-même.

import { Router } from 'express';
import { requireCreatorSpace } from './creator-space';
import { getServiceClient, companyOrgIds } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { PLATFORM_FEATURES, isPlatformFeatureKey, isPlatformOverride, planGrants } from '../lib/platformFeatures';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OverrideState = 'inherit' | 'on' | 'off';

const router = Router();

async function loadCompanyPlan(admin: ReturnType<typeof getServiceClient>, orgIds: string[]) {
  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, plans:plan_id (name, name_fr, slug, includes_sms, includes_ai, includes_d2d, includes_courses, includes_api, includes_automations, includes_marketplace, includes_timesheets, includes_request_forms, includes_advanced_roles)')
    .in('org_id', orgIds)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (sub as any)?.plans ?? null;
}

// ── Lire l'état des fonctionnalités d'une compagnie ───────────────────────
router.get('/creator-space/companies/:orgId/features', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const admin = getServiceClient();

    const orgIds = await companyOrgIds(admin, orgId);
    if (!orgIds.includes(orgId)) orgIds.push(orgId);
    const [plan, { data: rows, error }] = await Promise.all([
      loadCompanyPlan(admin, orgIds),
      admin.from('org_features').select('feature, enabled, metadata, updated_at').eq('org_id', orgId),
    ]);
    if (error) throw error;
    const byKey = new Map<string, any>((rows ?? []).map((r: any) => [r.feature, r]));

    const features = PLATFORM_FEATURES.map((f) => {
      const row = byKey.get(f.key);
      const overridden = row ? isPlatformOverride(row.metadata) : false;
      const override: OverrideState = overridden ? (row.enabled ? 'on' : 'off') : 'inherit';
      // Défaut hors override : le forfait pour une clé « plan », le choix du
      // tenant (ligne sans marque plateforme) pour un module.
      const inherited: boolean | null = f.kind === 'plan'
        ? planGrants(plan, f.key)
        : (row && !overridden ? !!row.enabled : false);
      return {
        key: f.key,
        kind: f.kind,
        label: f.label,
        description: f.description,
        inherited,
        override,
        effective: override === 'inherit' ? inherited : override === 'on',
        updated_at: overridden ? row.updated_at ?? null : null,
      };
    });

    return res.json({
      plan: plan ? { name: plan.name, name_fr: plan.name_fr, slug: plan.slug } : null,
      office_count: orgIds.length,
      features,
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger les fonctionnalités.', '[creator-space/features]');
  }
});

// ── Forcer / bloquer / hériter une fonctionnalité (journalisé) ────────────
router.put('/creator-space/companies/:orgId/features/:key', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId, key } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    if (!isPlatformFeatureKey(key)) return res.status(400).json({ error: 'Fonctionnalité inconnue.' });
    const state = req.body?.state as OverrideState;
    if (state !== 'inherit' && state !== 'on' && state !== 'off') {
      return res.status(400).json({ error: 'state doit valoir inherit, on ou off.' });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (reason.length < 5) return res.status(400).json({ error: 'Une raison d’au moins 5 caractères est requise — elle est journalisée.' });

    const admin = getServiceClient();
    const orgIds = await companyOrgIds(admin, orgId);
    if (!orgIds.includes(orgId)) orgIds.push(orgId);

    // Journalisation AVANT l'écriture, en direct : pas de trace = pas de
    // modification. Le tenant visé est org_id ; les bureaux frères touchés
    // sont listés dans details.
    const { error: logErr } = await admin.from('security_events').insert({
      event_type: 'creator_space_feature_override',
      severity: 'medium',
      source: 'creator-space',
      user_id: auth.user.id,
      org_id: orgId,
      details: { feature: key, state, reason, org_ids: orgIds },
    });
    if (logErr) {
      console.error('[creator-space/features] journalisation refusée:', logErr.message);
      return res.status(500).json({ error: 'Journalisation impossible — modification refusée.' });
    }

    if (state === 'inherit') {
      // On ne retire que les lignes posées par la plateforme : une activation
      // faite par le tenant lui-même (module) reste intacte.
      const { error } = await admin
        .from('org_features')
        .delete()
        .in('org_id', orgIds)
        .eq('feature', key)
        .eq('metadata->>platform_override', 'true');
      if (error) throw error;
    } else {
      const setAt = new Date().toISOString();
      const { error } = await admin
        .from('org_features')
        .upsert(
          orgIds.map((id) => ({
            org_id: id,
            feature: key,
            enabled: state === 'on',
            metadata: { platform_override: true, set_at: setAt },
            updated_at: setAt,
          })),
          { onConflict: 'org_id,feature' },
        );
      if (error) throw error;
    }

    return res.json({ ok: true, key, state, org_ids: orgIds });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de modifier la fonctionnalité.', '[creator-space/features]');
  }
});

export default router;
