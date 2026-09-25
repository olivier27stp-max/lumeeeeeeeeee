/**
 * feature-guard.ts — le gating de FORFAIT côté serveur.
 *
 * POURQUOI
 * `subscription-guard` répond à « cette entreprise paie-t-elle ? ». Il ne dit
 * rien de « son forfait inclut-il CETTE fonctionnalité ? ». Cette seconde
 * question ne vivait que dans React : `<PlanFeatureGate flag="…">` cache le
 * menu et la route. Constaté le 2026-09-25, aucune route d'automatisation ne
 * vérifiait le forfait :
 *
 *     automation-rules : 0 · automation-events : 0 · automation-test : 0
 *     reminders : 0 · reminders-cron : 0
 *
 * Un bouton caché n'est pas une porte fermée : un appel direct à l'API avec un
 * jeton valide obtient les automatisations, vendues dans Scale (347 $) et
 * Autopilot (495 $), depuis un forfait Starter (150 $).
 *
 * CE QU'IL FAIT
 * Pour les préfixes déclarés, il résout le forfait de l'entreprise (même
 * source que /billing/current : l'abonnement vit sur UN bureau du
 * company_group) et refuse en 403 si le drapeau est faux.
 *
 * CE QU'IL NE FAIT PAS
 * - Il ne remplace pas `subscription-guard` : celui-ci tourne avant et traite
 *   l'absence d'abonnement. Ici, on suppose l'abonnement valide.
 * - Il ne bloque jamais le cron ni les webhooks : ils n'ont pas d'utilisateur.
 *   La dépense côté cron est bornée par les réglages de l'entreprise, pas par
 *   une requête entrante.
 * - Il n'invente pas de droit : quand le forfait est illisible, il laisse
 *   passer et le journalise (fail-open), comme son grand frère. Couper un
 *   client payant parce qu'une table ne répond pas serait pire que le trou.
 *
 * MODES (env FEATURE_GUARD)
 *   log (défaut) — laisse passer, journalise ce qui AURAIT été bloqué
 *   enforce      — 403
 *   off          — désactivé
 *
 * Le défaut est `log`, à l'inverse de `subscription-guard`. Le gating n'a
 * jamais tourné : on veut VOIR qui serait coupé avant de couper. On ne passe
 * à `enforce` qu'après avoir lu ces journaux.
 */
import type express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { companyOrgIds, getServiceClient } from './supabase';
import { planGrants } from './platformFeatures';
import { estBypass } from './subscription-guard';

export type ModeGardeFonction = 'enforce' | 'log' | 'off';

export function modeGardeFonction(env: NodeJS.ProcessEnv = process.env): ModeGardeFonction {
  const v = (env.FEATURE_GUARD || 'log').trim().toLowerCase();
  return v === 'enforce' || v === 'off' ? v : 'log';
}

/**
 * Préfixes protégés → drapeau de forfait exigé.
 *
 * Volontairement restreint aux automatisations : c'est le trou constaté. Les
 * autres drapeaux (`includes_courses`, `includes_d2d`…) méritent le même
 * traitement, mais chacun demande de vérifier ce qu'il coupe — on n'élargit
 * pas à l'aveugle.
 */
export const PREFIXES_PROTEGES: ReadonlyArray<{ prefixe: string; drapeau: string }> = [
  // Couvre automation-rules.ts, automation-events.ts et automation-test.ts :
  // les trois déclarent leurs routes sous /automations/ (vérifié 2026-09-25).
  { prefixe: '/api/automations/', drapeau: 'includes_automations' },
  { prefixe: '/api/reminders/', drapeau: 'includes_automations' },
];

export function drapeauPourChemin(path: string): string | null {
  for (const { prefixe, drapeau } of PREFIXES_PROTEGES) {
    if (path.startsWith(prefixe)) return drapeau;
  }
  return null;
}

export type VerdictFonction = {
  autorise: boolean;
  raison: 'inclus' | 'hors_forfait' | 'forfait_inconnu';
  forfait?: string;
};

/**
 * Le forfait de l'entreprise accorde-t-il ce drapeau ?
 *
 * `planGrants` est la MÊME fonction que celle du Creator Space et du front :
 * quand la colonne n'existe pas encore, elle retombe sur la règle par slug.
 * La dupliquer ici ferait dériver les deux réponses.
 */
export async function verdictFonctionPourOrg(
  admin: SupabaseClient,
  orgId: string,
  drapeau: string,
): Promise<VerdictFonction> {
  const orgIds = await companyOrgIds(admin, orgId);
  const { data, error } = await admin
    .from('subscriptions')
    .select('plans:plan_id (*)')
    .in('org_id', orgIds)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`plan lookup failed: ${error.message}`);

  const plan = (data as any)?.plans ?? null;
  // Pas d'abonnement lisible : ce n'est PAS « hors forfait ». C'est le travail
  // de subscription-guard, et lui sait distinguer grâce, essai et absence.
  if (!plan) return { autorise: true, raison: 'forfait_inconnu' };

  const accorde = planGrants(plan, drapeau);
  if (accorde === null) return { autorise: true, raison: 'forfait_inconnu', forfait: plan.slug };
  return accorde
    ? { autorise: true, raison: 'inclus', forfait: plan.slug }
    : { autorise: false, raison: 'hors_forfait', forfait: plan.slug };
}

// ── Cache court ───────────────────────────────────────────────────────────
// Un forfait change quelques fois par an. 60 s par (org, drapeau) ; un refus
// n'est gardé que 10 s pour qu'une montée de forfait débloque tout de suite.
const TTL_MS = 60_000;
const cache = new Map<string, { verdict: VerdictFonction; expire: number }>();

export function viderCacheFonction(): void {
  cache.clear();
}

async function verdictEnCache(orgId: string, drapeau: string, maintenant: number): Promise<VerdictFonction> {
  const cle = `${orgId}:${drapeau}`;
  const hit = cache.get(cle);
  if (hit && hit.expire > maintenant) return hit.verdict;
  const verdict = await verdictFonctionPourOrg(getServiceClient(), orgId, drapeau);
  if (cache.size >= 5_000) for (const [k, v] of cache) if (v.expire <= maintenant) cache.delete(k);
  cache.set(cle, { verdict, expire: maintenant + (verdict.autorise ? TTL_MS : 10_000) });
  return verdict;
}

/**
 * `resoudreOrg` est injecté : la résolution d'utilisateur (jeton → org) vit
 * dans subscription-guard, qui tourne AVANT. On la lui passe plutôt que de
 * refaire un `auth.getUser()` par requête.
 */
export function featureGuard(options: {
  mode?: ModeGardeFonction;
  env?: NodeJS.ProcessEnv;
  resoudreOrg: (req: express.Request) => Promise<{ orgId: string | null; email: string | null } | null>;
}): express.RequestHandler {
  const env = options.env ?? process.env;
  const mode = options.mode ?? modeGardeFonction(env);

  return async (req, res, next) => {
    if (mode === 'off') return next();
    if (req.method === 'OPTIONS' || req.method === 'HEAD') return next();
    const drapeau = drapeauPourChemin(req.path);
    if (!drapeau) return next();

    try {
      const u = await options.resoudreOrg(req);
      if (!u || !u.orgId) return next();
      if (estBypass(u.email, env)) return next();

      const verdict = await verdictEnCache(u.orgId, drapeau, Date.now());
      if (verdict.autorise) return next();

      if (mode === 'log') {
        console.warn(
          `[feature-guard] AURAIT BLOQUÉ ${req.method} ${req.path} org=${u.orgId} forfait=${verdict.forfait} drapeau=${drapeau}`,
        );
        return next();
      }
      res.set('Cache-Control', 'no-store');
      return res.status(403).json({ error: 'feature_not_in_plan', feature: drapeau, plan: verdict.forfait });
    } catch (err: any) {
      console.error('[feature-guard] vérification impossible, fail-open:', err?.message || err);
      return next();
    }
  };
}
