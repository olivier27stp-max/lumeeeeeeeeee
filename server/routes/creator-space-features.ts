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
// Quota de bureaux : même mécanique, clé 'office_quota' (metadata.quota),
// 1 par défaut — les bureaux ne sont plus vendus par forfait.
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
import {
  DEFAULT_OFFICE_QUOTA,
  MAX_OFFICE_QUOTA,
  OFFICE_QUOTA_KEY,
  PLATFORM_FEATURES,
  isPlatformFeatureKey,
  isPlatformOverride,
  planGrants,
  resolveOfficeQuota,
} from '../lib/platformFeatures';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OverrideState = 'inherit' | 'on' | 'off';

const router = Router();

async function loadCompanyPlan(admin: ReturnType<typeof getServiceClient>, orgIds: string[]) {
  // `plans:plan_id (*)` et jamais une liste de colonnes : includes_advanced_roles
  // n'existe pas en base (flag dérivé côté front). PostgREST rejette la requête
  // ENTIÈRE pour une seule colonne inconnue et supabase-js ne lève pas — le
  // panneau affichait « Forfait actuel : aucun » pour toutes les compagnies.
  const { data: sub, error } = await admin
    .from('subscriptions')
    .select('status, plans:plan_id (*)')
    .in('org_id', orgIds)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
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
    const [plan, { data: rows, error }, { data: quotaRows }, { data: officeOrgs }, { data: officeSettings }] = await Promise.all([
      loadCompanyPlan(admin, orgIds),
      admin.from('org_features').select('feature, enabled, metadata, updated_at').eq('org_id', orgId),
      admin.from('org_features').select('feature, enabled, metadata, updated_at').in('org_id', orgIds).eq('feature', OFFICE_QUOTA_KEY),
      admin.from('orgs').select('id, name, created_at').in('id', orgIds),
      admin.from('company_settings').select('org_id, company_name').in('org_id', orgIds),
    ]);
    if (error) throw error;
    const byKey = new Map<string, any>((rows ?? []).map((r: any) => [r.feature, r]));
    const nameByOrg = new Map<string, string>((officeSettings ?? []).map((s: any) => [s.org_id, (s.company_name || '').trim()]));
    const quotaRow = (quotaRows ?? []).find((r: any) => isPlatformOverride(r.metadata)) ?? null;
    const offices = {
      quota: resolveOfficeQuota(quotaRows),
      default_quota: DEFAULT_OFFICE_QUOTA,
      max_quota: MAX_OFFICE_QUOTA,
      used: orgIds.length,
      updated_at: quotaRow?.updated_at ?? null,
      list: (officeOrgs ?? [])
        .map((o: any) => ({ id: o.id, name: nameByOrg.get(o.id) || o.name, created_at: o.created_at, is_current: o.id === orgId }))
        .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at))),
    };

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
      offices,
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

// ── Quota de bureaux (journalisé) ─────────────────────────────────────────
// Ajouter / enlever des bureaux = relever ou abaisser le quota du workspace.
// Abaisser sous le nombre de bureaux existants n'en supprime aucun : le
// workspace ne peut simplement plus en créer. Un quota égal au défaut retire
// la ligne plateforme.
router.put('/creator-space/companies/:orgId/office-quota', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const quota = Number(req.body?.quota);
    if (!Number.isInteger(quota) || quota < 1 || quota > MAX_OFFICE_QUOTA) {
      return res.status(400).json({ error: `quota doit être un entier entre 1 et ${MAX_OFFICE_QUOTA}.` });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (reason.length < 5) return res.status(400).json({ error: 'Une raison d’au moins 5 caractères est requise — elle est journalisée.' });

    const admin = getServiceClient();
    const orgIds = await companyOrgIds(admin, orgId);
    if (!orgIds.includes(orgId)) orgIds.push(orgId);

    const { error: logErr } = await admin.from('security_events').insert({
      event_type: 'creator_space_office_quota',
      severity: 'medium',
      source: 'creator-space',
      user_id: auth.user.id,
      org_id: orgId,
      details: { quota, reason, org_ids: orgIds, used: orgIds.length },
    });
    if (logErr) {
      console.error('[creator-space/office-quota] journalisation refusée:', logErr.message);
      return res.status(500).json({ error: 'Journalisation impossible — modification refusée.' });
    }

    if (quota === DEFAULT_OFFICE_QUOTA) {
      const { error } = await admin
        .from('org_features')
        .delete()
        .in('org_id', orgIds)
        .eq('feature', OFFICE_QUOTA_KEY)
        .eq('metadata->>platform_override', 'true');
      if (error) throw error;
    } else {
      const setAt = new Date().toISOString();
      const { error } = await admin
        .from('org_features')
        .upsert(
          orgIds.map((id) => ({
            org_id: id,
            feature: OFFICE_QUOTA_KEY,
            enabled: true,
            metadata: { platform_override: true, quota, set_at: setAt },
            updated_at: setAt,
          })),
          { onConflict: 'org_id,feature' },
        );
      if (error) throw error;
    }

    return res.json({ ok: true, quota, used: orgIds.length, org_ids: orgIds });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de modifier le quota de bureaux.', '[creator-space/office-quota]');
  }
});

export default router;
