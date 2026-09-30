/**
 * Mots-clés texto STOP / START — version « désabonnement par canal ».
 *
 * Appelé par la route des textos entrants (`server/routes/messages.ts`)
 * SEULEMENT quand l'entreprise propriétaire du numéro qui a reçu le mot a le
 * drapeau `auto_desabonnement_canal`. Sans lui, l'ancien traitement reste.
 *
 * Trois différences avec l'ancien traitement, toutes voulues :
 *   1. Le retrait ne vaut que pour l'entreprise du NUMÉRO QUI A REÇU le mot.
 *      L'ancien STOP désabonnait le numéro chez toutes les entreprises ayant
 *      une conversation avec lui — une réponse à l'une coupait les autres.
 *   2. Chaque STOP / START est consigné dans `consents` (le journal probant),
 *      avec sa source : c'est l'historique affiché sur la fiche client.
 *   3. Une confirmation est envoyée. Si Twilio gère déjà le STOP lui-même
 *      (réglage par défaut des numéros nord-américains), il bloque notre
 *      message (erreur 21610) : le client ne reçoit jamais deux confirmations.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { clientParTelephone, journaliserChoix, messageConfirmation } from './index';

export type Envoyeur = (orgId: string, telephone: string, texte: string) => Promise<void>;

/** L'entreprise propriétaire du numéro Lume qui a reçu le texto. */
export async function orgDuNumeroSms(admin: SupabaseClient, numero: string | null | undefined): Promise<string | null> {
  if (!numero) return null;
  const { data, error } = await admin
    .from('communication_channels')
    .select('org_id')
    .eq('phone_number', numero)
    .eq('channel_type', 'sms')
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    logger.error('[desabonnement/sms] propriétaire du numéro illisible', { error: error.message });
    return null;
  }
  return (data as { org_id?: string } | null)?.org_id ?? null;
}

/**
 * Applique STOP ou START pour UNE entreprise, journalise, confirme.
 * Ne lève pas : un texto entrant ne doit jamais faire tomber la route.
 * Rend `true` si le retrait / réabonnement est enregistré.
 */
export async function appliquerMotCleSms(
  admin: SupabaseClient,
  p: { orgId: string; telephone: string; genre: 'stop' | 'start'; envoyer: Envoyeur },
): Promise<boolean> {
  try {
    if (p.genre === 'stop') {
      // LCAP : un retrait non enregistré = on continue de texter quelqu'un
      // qui a dit STOP. L'échec doit être bruyant.
      const { error } = await admin
        .from('sms_opt_outs')
        .upsert({ org_id: p.orgId, phone: p.telephone, reason: 'client_stop' }, { onConflict: 'org_id,phone' });
      if (error) {
        logger.error('[desabonnement/sms] STOP non enregistré', { orgId: p.orgId, error: error.message });
        return false;
      }
    } else {
      const { error } = await admin
        .from('sms_opt_outs')
        .delete()
        .eq('org_id', p.orgId)
        .eq('phone', p.telephone);
      if (error) {
        logger.error('[desabonnement/sms] START non appliqué', { orgId: p.orgId, error: error.message });
        return false;
      }
    }

    let clientId: string | null = null;
    try {
      clientId = (await clientParTelephone(admin, p.orgId, p.telephone))?.id ?? null;
    } catch (e: any) {
      logger.error('[desabonnement/sms] client introuvable pour le journal', { orgId: p.orgId, error: e?.message });
    }
    await journaliserChoix(admin, {
      orgId: p.orgId,
      clientId,
      canal: 'texto',
      accorde: p.genre === 'start',
      source: p.genre === 'stop' ? 'texto-stop' : 'texto-start',
    });

    const { data: reglages } = await admin
      .from('company_settings')
      .select('company_name, default_language')
      .eq('org_id', p.orgId)
      .maybeSingle();
    const langue = (reglages as { default_language?: string } | null)?.default_language === 'en' ? 'en' : 'fr';
    const nom = String((reglages as { company_name?: string } | null)?.company_name ?? '');
    try {
      await p.envoyer(p.orgId, p.telephone, messageConfirmation(p.genre, nom, langue));
    } catch (e: any) {
      // 21610 attendu quand Twilio a déjà pris le STOP en charge.
      logger.info('[desabonnement/sms] confirmation non envoyée', { orgId: p.orgId, code: e?.code, error: e?.message });
    }
    logger.info(`[desabonnement/sms] ${p.genre.toUpperCase()} appliqué`, { orgId: p.orgId });
    return true;
  } catch (e: any) {
    logger.error('[desabonnement/sms] mot-clé non traité', { orgId: p.orgId, genre: p.genre, error: e?.message || String(e) });
    return false;
  }
}

// ── Chemin SANS le drapeau par canal (traitement d'origine) ──

const STOP_HERITE = /^(stop|arret|arrêt|unsubscribe|cancel|end|quit|désabonner|desabonner)$/i;
const START_HERITE = /^(start|unstop|reprendre|resume)$/i;

/**
 * Le mot-clé du traitement d'origine (drapeau `auto_desabonnement_canal` OFF).
 *
 * « oui » / « yes » n'en sont PAS (audit V2, L3) : c'est une RÉPONSE — à
 * « Confirmez-vous jeudi ? » par exemple —, pas un ordre de réabonnement.
 * Le traiter comme un START levait les désabonnements du client chez toutes
 * les entreprises où il avait une conversation.
 */
export function motCleHerite(corps: string | null | undefined): 'stop' | 'start' | null {
  const t = String(corps ?? '').trim();
  if (STOP_HERITE.test(t)) return 'stop';
  if (START_HERITE.test(t)) return 'start';
  return null;
}

/**
 * STOP / START du traitement d'origine, sans journal ni confirmation (ceux-là
 * relèvent du drapeau par canal). Ne lève pas.
 *
 * Portée :
 *   - STOP : l'entreprise du numéro qui a REÇU le mot (`To`) quand on la
 *     connaît (audit V2, L2) : répondre STOP à une entreprise ne coupe plus
 *     les autres. Sinon — numéro inconnu, lecture ratée — toutes celles qui
 *     ont une conversation avec ce numéro : trop bloquer est un désagrément,
 *     pas assez est illégal.
 *   - START : SEULEMENT l'entreprise du numéro `To` (L3). Sans elle, rien
 *     n'est levé : réabonner des entreprises auxquelles la personne n'a
 *     jamais écrit START serait un consentement qu'elle n'a pas donné.
 */
export async function appliquerMotCleHerite(
  admin: SupabaseClient,
  p: { telephone: string; to: string | null | undefined; genre: 'stop' | 'start' },
): Promise<{ orgIds: string[]; appliques: number }> {
  try {
    const orgDuTo = await orgDuNumeroSms(admin, p.to);
    let orgIds: string[] = orgDuTo ? [orgDuTo] : [];
    if (!orgDuTo && p.genre === 'stop') {
      const { data: convos, error } = await admin
        .from('conversations')
        .select('org_id')
        .eq('phone_number', p.telephone);
      if (error) logger.error('[desabonnement/sms] conversations illisibles pour le STOP', { error: error.message });
      orgIds = Array.from(new Set(((convos || []) as Array<{ org_id?: string | null }>).map((c) => c.org_id).filter((o): o is string => !!o)));
    }
    if (orgIds.length === 0 && p.genre === 'start') {
      logger.info('[desabonnement/sms] START sans entreprise identifiable (numéro destinataire inconnu) — rien n\'est levé');
    }

    let appliques = 0;
    for (const oid of orgIds) {
      // LCAP : une opposition non enregistrée = on continue de texter
      // quelqu'un qui a répondu STOP. L'échec doit être bruyant.
      const { error } = p.genre === 'stop'
        ? await admin.from('sms_opt_outs').upsert({ org_id: oid, phone: p.telephone, reason: 'client_stop' }, { onConflict: 'org_id,phone' })
        : await admin.from('sms_opt_outs').delete().eq('org_id', oid).eq('phone', p.telephone);
      if (error) {
        logger.error(`[desabonnement/sms] ${p.genre.toUpperCase()} non appliqué`, { orgId: oid, error: error.message });
      } else {
        appliques++;
      }
    }
    logger.info(`[desabonnement/sms] ${p.genre.toUpperCase()} appliqué dans ${appliques}/${orgIds.length} entreprise(s)`);
    return { orgIds, appliques };
  } catch (e: any) {
    logger.error('[desabonnement/sms] mot-clé non traité', { genre: p.genre, error: e?.message || String(e) });
    return { orgIds: [], appliques: 0 };
  }
}
