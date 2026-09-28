/* ═══════════════════════════════════════════════════════════════
   Vues d'une soumission par le CLIENT — la source de vérité du
   déclencheur « Soumission ouverte par le client ».

   On compte une vue quand la page publique est SERVIE (règle du projet :
   le suivi s'écrit quand la page est servie, jamais sur un appel annexe) —
   pas par un pixel dans le courriel, que les messageries chargent seules.

   Ne compte PAS :
     · un membre CONNECTÉ de l'entreprise (il vérifie ce qu'il a envoyé) ;
     · l'aperçu ouvert depuis l'app (en-tête `x-lume-apercu`) ;
     · les robots et scanners de liens (Outlook Safe Links, Mimecast,
       Slack, aperçus de messagerie…) — par leur navigateur déclaré, et par
       le délai : une « ouverture » moins de 2 s après l'envoi n'est pas
       humaine ;
     · la même session dans les 30 minutes (un rechargement n'est pas une
       vue) — dédoublonnage fait EN BASE, atomiquement.

   Loi 25 (minimisation) : ni IP ni navigateur en clair. Deux empreintes
   (session, navigateur) suffisent à dédoublonner ; aucune ne permet de
   retrouver une personne.
   ═══════════════════════════════════════════════════════════════ */
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventBus } from './eventBus';
import { recordClientActivity } from './clientActivity';
import { logger } from './logger';

/** Robots, scanners de liens et outils — jamais un client qui lit. */
const ROBOTS = /bot\b|bot\/|crawler|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skypeuripreview|linkedin|embedly|outlook|microsoft office|ms-office|bingpreview|safelinks|mimecast|proofpoint|barracuda|symantec|forcepoint|headless|phantom|puppeteer-scan|python-requests|python-urllib|curl\/|wget\/|go-http-client|okhttp|java\/|axios\/|node-fetch|httpclient|scanner|checker|monitor|uptime/i;

export function estRobot(userAgent: string | undefined | null): boolean {
  const ua = (userAgent ?? '').trim();
  // Aucun navigateur déclaré : un vrai navigateur en envoie toujours un.
  if (ua === '') return true;
  return ROBOTS.test(ua);
}

export function empreinte(valeur: string | undefined | null): string | null {
  const v = (valeur ?? '').trim();
  if (!v) return null;
  return createHash('sha256').update(v).digest('hex');
}

/** Ouverture trop proche de l'envoi pour être humaine (scanner de lien). */
export function tropTotApresEnvoi(
  envois: Array<string | null | undefined>,
  maintenant: number = Date.now(),
  seuilMs = 2000,
): boolean {
  const derniers = envois.map((e) => (e ? Date.parse(e) : NaN)).filter((t) => Number.isFinite(t));
  if (derniers.length === 0) return false;
  const dernier = Math.max(...derniers);
  const ecart = maintenant - dernier;
  return ecart >= 0 && ecart < seuilMs;
}

/** Le visiteur est-il un membre ACTIF de l'entreprise, connecté ? */
export async function visiteurInterne(admin: SupabaseClient, req: Request, orgId: string): Promise<boolean> {
  if (String(req.headers['x-lume-apercu'] ?? '') === '1') return true;
  const auth = String(req.headers.authorization ?? '');
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const jeton = auth.slice(7).trim();
  if (!jeton) return false;
  try {
    const { data } = await admin.auth.getUser(jeton);
    const uid = data?.user?.id;
    if (!uid) return false;
    const { data: m } = await admin
      .from('memberships')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('user_id', uid)
      .eq('status', 'active')
      .maybeSingle();
    return !!m;
  } catch {
    // Jeton illisible : on le traite comme un visiteur anonyme.
    return false;
  }
}

export interface SoumissionServie {
  id: string;
  org_id: string;
  quote_number: string | null;
  total_cents: number | null;
  client_id: string | null;
  lead_id: string | null;
  sent_via_email_at?: string | null;
  sent_via_sms_at?: string | null;
}

export type IssueVue = 'enregistree' | 'interne' | 'robot' | 'trop_tot' | 'doublon' | 'introuvable' | 'erreur';

/**
 * Enregistre (ou écarte) l'ouverture d'une soumission, puis émet
 * `quote.viewed`. Ne lève JAMAIS : la page du client doit s'afficher même
 * si le suivi échoue.
 */
export async function enregistrerOuverture(
  admin: SupabaseClient,
  req: Request,
  quote: SoumissionServie,
): Promise<IssueVue> {
  try {
    const ua = String(req.headers['user-agent'] ?? '');
    if (await visiteurInterne(admin, req, quote.org_id)) return 'interne';
    if (estRobot(ua)) return 'robot';
    if (tropTotApresEnvoi([quote.sent_via_email_at, quote.sent_via_sms_at])) return 'trop_tot';

    const { data, error } = await admin.rpc('enregistrer_vue_soumission', {
      p_quote_id: quote.id,
      p_session_hash: empreinte(String(req.headers['x-lume-session'] ?? '')),
      p_user_agent_hash: empreinte(ua),
      p_compter: true,
    });
    if (error) {
      logger.error('[vues-soumission] enregistrement refusé', { quoteId: quote.id, message: error.message });
      return 'erreur';
    }
    const r = data as { enregistree: boolean; raison?: string; premiere?: boolean; nb_vues?: number; contact_id?: string | null };
    if (!r?.enregistree) return r?.raison === 'doublon' ? 'doublon' : 'introuvable';

    const contactId = r.contact_id ?? quote.client_id ?? quote.lead_id ?? null;
    if (contactId) void recordClientActivity(admin, contactId);

    // Ce que les filtres du déclencheur lisent : l'étape de l'opportunité
    // liée, les étiquettes du client, les services de la soumission.
    const [dealQ, clientQ, lignesQ] = await Promise.all([
      admin.from('deals').select('pipeline_id, stage_id').eq('org_id', quote.org_id)
        .eq('quote_id', quote.id).is('deleted_at', null).limit(1).maybeSingle(),
      contactId
        ? admin.from('clients').select('tags').eq('id', contactId).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('quote_line_items').select('source_service_id').eq('quote_id', quote.id),
    ]);
    let deal = dealQ.data as { pipeline_id: string; stage_id: string } | null;
    if (!deal && contactId) {
      const { data: ouvert } = await admin
        .from('deals').select('pipeline_id, stage_id, pipeline_stages!inner(kind)')
        .eq('org_id', quote.org_id).eq('client_id', contactId).is('deleted_at', null)
        .eq('pipeline_stages.kind', 'open').order('created_at', { ascending: false }).limit(1);
      deal = ((ouvert ?? [])[0] as { pipeline_id: string; stage_id: string } | undefined) ?? null;
    }
    const tags = ((clientQ.data as { tags?: string[] | null } | null)?.tags ?? []).filter(Boolean);
    const services = [...new Set(((lignesQ.data ?? []) as Array<{ source_service_id: string | null }>)
      .map((l) => l.source_service_id).filter((x): x is string => !!x))];

    await eventBus.emit('quote.viewed', {
      orgId: quote.org_id,
      entityType: 'quote',
      entityId: quote.id,
      relatedEntityType: contactId ? 'client' : undefined,
      relatedEntityId: contactId ?? undefined,
      metadata: {
        quote_id: quote.id,
        quote_number: quote.quote_number,
        client_id: contactId,
        is_first_view: !!r.premiere,
        view_count: r.nb_vues ?? null,
        // Une première ouverture répond à « première » ET à « chaque ».
        ouverture: r.premiere ? ['premiere', 'chaque'] : ['chaque'],
        total_cents: quote.total_cents ?? 0,
        montant: Math.round((quote.total_cents ?? 0)) / 100,
        pipeline_id: deal?.pipeline_id ?? null,
        stage_id: deal?.stage_id ?? null,
        etiquette: tags,
        service_id: services,
      },
    });
    return 'enregistree';
  } catch (e: unknown) {
    logger.error('[vues-soumission] exception', { quoteId: quote.id, message: e instanceof Error ? e.message : String(e) });
    return 'erreur';
  }
}
