/**
 * subscription-guard.ts — le paywall côté SERVEUR.
 *
 * POURQUOI
 * Jusqu'à l'audit du 2026-09-09 (C1), la vérification d'abonnement vivait
 * uniquement dans React (`App.tsx`) : un état `hasSubscription` sans aucune
 * autorité. N'importe qui créait un compte gratuit puis appelait /api/… avec
 * son token Supabase — ou modifiait l'état dans les devtools — et le produit
 * complet répondait. Aucun log ne le signalait.
 *
 * CE QUE FAIT CE MIDDLEWARE
 * Pour toute requête /api portée par un utilisateur Supabase, il résout l'org
 * active, cherche l'abonnement sur tout le company_group (l'abonnement vit sur
 * UN bureau) et refuse en 402 si aucun n'est `active` / `trialing`, ni
 * `past_due` dans la fenêtre de grâce. Même règle que /billing/current, même
 * source de vérité (service role) — le front ne fait plus que l'afficher.
 *
 * CE QU'IL NE FAIT PAS (par construction)
 * - Il ne bloque pas les routes publiques, ni celles de facturation, d'auth,
 *   d'onboarding, de profil : sans elles, un nouveau compte ne pourrait plus
 *   payer. La liste est explicite, en bas.
 * - Il ne se substitue pas à l'auth des routes : un token qui n'est pas un
 *   utilisateur Supabase (agent externe, MCP, cron, webhook) passe, et c'est
 *   la route qui tranche. Il ne renvoie jamais 401 lui-même.
 * - Un utilisateur sans membership (compte en cours d'onboarding) passe :
 *   il n'a pas encore d'org à protéger.
 * - Il ne couvre PAS les accès directs à Supabase via supabase-js (RLS) :
 *   ça, c'est le rôle des policies. Ici on ferme ce qui coûte de l'argent
 *   (SMS, courriels, paiements, IA) et tout ce qui passe par l'API.
 *
 * MODES (env SUBSCRIPTION_GUARD)
 *   enforce (défaut) — 402 quand l'abonnement manque
 *   log              — laisse passer mais journalise ce qui AURAIT été bloqué
 *   off              — désactivé (dépannage uniquement)
 *
 * BYPASS BÊTA
 * `BETA_BYPASS_EMAILS` (liste d'emails, virgule). On accepte aussi l'ancien
 * nom `VITE_BETA_BYPASS_EMAILS` — lu ici, côté serveur, il ne fuit plus dans
 * le bundle ; le garder évite de verrouiller les comptes propriétaires si la
 * variable n'a pas encore été renommée sur l'hébergeur.
 */
import type express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSupabaseWithAuth, companyOrgIds, getServiceClient, resolveOrgId } from './supabase';
import { PUBLIC_ROUTE_PREFIXES } from './route-permissions';
import { JOURS_DE_GRACE } from './subscription-email';

export type ModeGarde = 'enforce' | 'log' | 'off';

export function modeGarde(env: NodeJS.ProcessEnv = process.env): ModeGarde {
  const v = (env.SUBSCRIPTION_GUARD || 'enforce').trim().toLowerCase();
  return v === 'log' || v === 'off' ? v : 'enforce';
}

export function emailsBypass(env: NodeJS.ProcessEnv = process.env): string[] {
  return `${env.BETA_BYPASS_EMAILS || ''},${env.VITE_BETA_BYPASS_EMAILS || ''}`
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function estBypass(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const e = (email || '').trim().toLowerCase();
  return !!e && emailsBypass(env).includes(e);
}

/**
 * Routes qui doivent répondre SANS abonnement. Préfixes.
 * Tout ce qui permet de s'inscrire, payer, réparer un paiement, ou savoir
 * pourquoi on est bloqué. Les préfixes publics du RBAC sont repris tels quels.
 */
export const ROUTES_EXEMPTEES: readonly string[] = [
  ...PUBLIC_ROUTE_PREFIXES,
  '/api/billing/',        // plans, checkout, portail, current, annulation
  '/api/me/',             // is-beta-bypassed, profil
  '/api/auth/',           // register, verify, password
  '/api/webhooks/',       // Stripe / PayPal, signature vérifiée en aval
  '/api/cron/',           // secret de cron, pas d'utilisateur
  '/api/mcp',             // auth propre (OAuth)
  '/api/oauth',           // serveur à serveur
  '/api/agent/',          // agent externe, JWT propre
  '/api/security/',       // csp-report
  '/api/client-errors',   // un client bloqué doit pouvoir signaler une erreur
  '/api/invitations/',    // accepter une invitation précède l'abonnement
  '/api/unsubscribe/',    // désinscription courriel (lien dans le message)
  '/api/health',
];

export function estExemptee(path: string): boolean {
  return ROUTES_EXEMPTEES.some((p) => path.startsWith(p));
}

export type VerdictAbonnement = {
  autorise: boolean;
  raison: 'active' | 'trialing' | 'past_due_grace' | 'past_due_expire' | 'aucun' | 'bypass';
  expire_le?: string;
};

/** Même règle que /billing/current : active, trialing, ou past_due en grâce. */
export function verdictPourAbonnement(
  sub: { status: string; past_due_since?: string | null } | null,
  maintenant: number = Date.now(),
): VerdictAbonnement {
  if (!sub) return { autorise: false, raison: 'aucun' };
  if (sub.status === 'active' || sub.status === 'trialing') return { autorise: true, raison: sub.status };
  if (sub.status === 'past_due') {
    // Sans date de départ (ligne antérieure à la colonne), grâce complète :
    // mieux vaut ouvrir à tort que fermer sans préavis.
    const depuis = sub.past_due_since ? new Date(sub.past_due_since).getTime() : maintenant;
    const fin = depuis + JOURS_DE_GRACE * 86400_000;
    return fin > maintenant
      ? { autorise: true, raison: 'past_due_grace', expire_le: new Date(fin).toISOString() }
      : { autorise: false, raison: 'past_due_expire', expire_le: new Date(fin).toISOString() };
  }
  return { autorise: false, raison: 'aucun' };
}

export async function verdictPourOrg(admin: SupabaseClient, orgId: string): Promise<VerdictAbonnement> {
  const orgIds = await companyOrgIds(admin, orgId);
  const { data, error } = await admin
    .from('subscriptions')
    .select('status, past_due_since')
    .in('org_id', orgIds)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // Lecture ratée = on ne sait pas. On lève : l'appelant décide (fail-open
  // journalisé), on ne fabrique pas un « aucun abonnement » à partir d'une panne.
  if (error) throw new Error(`subscriptions lookup failed: ${error.message}`);
  return verdictPourAbonnement((data as any) ?? null);
}

// ── Cache court ───────────────────────────────────────────────────────────
// Un abonnement change quelques fois par an ; le vérifier à chaque requête
// coûterait 2-3 allers-retours DB de plus par appel API. 60 s de cache par
// org : un checkout réussi débloque en moins d'une minute (et /billing/current,
// qui ne passe pas par ici, reste instantané).
const TTL_MS = 60_000;
const cacheOrg = new Map<string, { verdict: VerdictAbonnement; expire: number }>();
const cacheToken = new Map<string, { userId: string; email: string | null; orgId: string | null; expire: number }>();

export function viderCacheGarde(): void {
  cacheOrg.clear();
  cacheToken.clear();
}

function purger<T extends { expire: number }>(m: Map<string, T>, maintenant: number) {
  if (m.size < 5_000) return;
  for (const [k, v] of m) if (v.expire <= maintenant) m.delete(k);
}

async function resoudreUtilisateur(req: express.Request, maintenant: number) {
  const header = req.header('authorization');
  if (!header || !/^Bearer\s+\S+/i.test(header)) return null;
  const cle = header.slice(-64); // fin du JWT (signature) : unique par token
  const enCache = cacheToken.get(cle);
  if (enCache && enCache.expire > maintenant) return enCache;

  const client = buildSupabaseWithAuth(header);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null; // pas un utilisateur Supabase → la route tranche

  // Bureau actif : même règle anti-IDOR que requireAuthedClient — on honore
  // x-org-id seulement si l'utilisateur en est membre.
  let orgId: string | null = null;
  const headerOrg = req.header('x-org-id');
  if (headerOrg && /^[0-9a-f-]{36}$/i.test(headerOrg)) {
    const { data: isMember } = await client.rpc('has_org_membership', { p_user: user.id, p_org: headerOrg });
    if (isMember === true) orgId = headerOrg;
  }
  if (!orgId) orgId = await resolveOrgId(client);

  const entree = { userId: user.id, email: user.email ?? null, orgId, expire: maintenant + TTL_MS };
  purger(cacheToken, maintenant);
  cacheToken.set(cle, entree);
  return entree;
}

async function verdictOrgEnCache(orgId: string, maintenant: number): Promise<VerdictAbonnement> {
  const enCache = cacheOrg.get(orgId);
  if (enCache && enCache.expire > maintenant) return enCache.verdict;
  const verdict = await verdictPourOrg(getServiceClient(), orgId);
  purger(cacheOrg, maintenant);
  // Un refus n'est gardé que 10 s : le client qui vient de payer ne doit pas
  // rester bloqué une minute devant un écran qui lui dit de payer.
  cacheOrg.set(orgId, { verdict, expire: maintenant + (verdict.autorise ? TTL_MS : 10_000) });
  return verdict;
}

export function subscriptionGuard(options: { mode?: ModeGarde; env?: NodeJS.ProcessEnv } = {}): express.RequestHandler {
  const env = options.env ?? process.env;
  const mode = options.mode ?? modeGarde(env);

  return async (req, res, next) => {
    if (mode === 'off') return next();
    if (!req.path.startsWith('/api')) return next();
    if (req.method === 'OPTIONS' || req.method === 'HEAD') return next();
    if (estExemptee(req.path)) return next();

    const maintenant = Date.now();
    try {
      const u = await resoudreUtilisateur(req, maintenant);
      if (!u || !u.orgId) return next();
      if (estBypass(u.email, env)) return next();

      const verdict = await verdictOrgEnCache(u.orgId, maintenant);
      if (verdict.autorise) return next();

      if (mode === 'log') {
        console.warn(`[subscription-guard] AURAIT BLOQUÉ ${req.method} ${req.path} org=${u.orgId} raison=${verdict.raison}`);
        return next();
      }
      res.set('Cache-Control', 'no-store');
      return res.status(402).json({
        error: 'subscription_required',
        reason: verdict.raison,
        ...(verdict.expire_le ? { expired_at: verdict.expire_le } : {}),
      });
    } catch (err: any) {
      // Panne de la vérification (DB, réseau) : on laisse passer ET on le dit.
      // Fermer le CRM entier parce que la table subscriptions ne répond pas
      // punirait les clients payants — la route, elle, échouera ou non selon
      // sa propre lecture.
      console.error('[subscription-guard] vérification impossible, fail-open:', err?.message || err);
      return next();
    }
  };
}
