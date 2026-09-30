/**
 * Accusés de réception Twilio (`POST /api/messages/status`) — audit V2, C13.
 *
 * Trois défauts corrigés :
 *   1. Le statut RECULAIT : Twilio ne garantit pas l'ordre de ses rappels, et
 *      un `sent` arrivé après `delivered` repassait le message à « envoyé ».
 *      Ordre imposé : queued < sent < delivered / failed (finaux). La mise à
 *      jour est conditionnelle, faite en UNE requête : deux rappels
 *      simultanés ne peuvent pas se doubler.
 *   2. Le code d'erreur (`ErrorCode`, ex. 30007 « filtré par l'opérateur »)
 *      était jeté : il est gardé dans `messages.error_message`.
 *   3. Un échec de livraison n'informait personne : les propriétaires et
 *      administrateurs sont prévenus (FR/EN), une fois par heure au plus
 *      par entreprise — 200 textos vers des lignes fixes ne font pas 200
 *      notifications.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { insertTargetedNotifications, resolveQuoteRecipients } from '../notificationHelpers';

export type StatutMessage = 'queued' | 'sent' | 'delivered' | 'failed';

/** Statut Twilio → statut de `messages` (contrainte CHECK : queued, sent, delivered, failed, received). */
export function statutInterne(statutTwilio: string | null | undefined): StatutMessage | null {
  switch (String(statutTwilio ?? '').toLowerCase()) {
    case 'accepted': case 'scheduled': case 'queued': case 'sending': return 'queued';
    case 'sent': return 'sent';
    case 'delivered': case 'read': return 'delivered';
    case 'undelivered': case 'failed': case 'canceled': return 'failed';
    default: return null;
  }
}

const RANG: Record<StatutMessage, number> = { queued: 0, sent: 1, delivered: 2, failed: 2 };

/** Les statuts qu'un nouveau statut a le droit de remplacer : ceux d'avant lui. */
export function statutsRemplacables(nouveau: StatutMessage): StatutMessage[] {
  return (Object.keys(RANG) as StatutMessage[]).filter((s) => RANG[s] < RANG[nouveau]);
}

/** Le texte gardé pour un échec : le code Twilio, et son sens quand on le connaît. */
export function texteErreur(code: string | null | undefined, message?: string | null): string {
  const c = String(code ?? '').trim();
  const connus: Record<string, string> = {
    '21610': 'destinataire désabonné (STOP) / recipient unsubscribed',
    '30003': 'numéro injoignable / unreachable handset',
    '30004': 'message bloqué / message blocked',
    '30005': 'numéro inconnu / unknown destination',
    '30006': 'ligne fixe ou opérateur injoignable / landline or unreachable carrier',
    '30007': 'filtré par l’opérateur / carrier violation (filtered)',
    '30008': 'erreur inconnue / unknown error',
  };
  const sens = connus[c] || String(message ?? '').trim();
  return (c ? `Twilio ${c}${sens ? ` — ${sens}` : ''}` : (sens || 'Twilio — échec de livraison / delivery failed')).slice(0, 500);
}

interface LigneMessage { id: string; org_id: string | null; phone_number: string | null; direction: string | null }

/**
 * Applique un accusé de réception. `ok: false` = l'écriture a échoué (la
 * route répond 500 pour que Twilio rejoue). `ignore` = rien à faire (statut
 * inconnu, ou plus ancien que celui déjà enregistré).
 */
export async function appliquerStatutTwilio(
  admin: SupabaseClient,
  p: { sid: string; statutTwilio: string; codeErreur?: string | null; messageErreur?: string | null },
): Promise<{ ok: boolean; maj: number; statut: StatutMessage | null; ignore?: 'statut_inconnu' | 'deja_plus_avance' }> {
  const statut = statutInterne(p.statutTwilio);
  if (!statut) return { ok: true, maj: 0, statut: null, ignore: 'statut_inconnu' };
  const remplacables = statutsRemplacables(statut);
  if (remplacables.length === 0) return { ok: true, maj: 0, statut, ignore: 'deja_plus_avance' };

  const { data, error } = await admin
    .from('messages')
    .update({ status: statut, ...(statut === 'failed' ? { error_message: texteErreur(p.codeErreur, p.messageErreur) } : {}) })
    .eq('provider_message_id', p.sid)
    // Jamais en arrière : seul un statut PRÉCÉDENT est remplacé.
    .or(`status.is.null,status.in.(${remplacables.join(',')})`)
    .select('id, org_id, phone_number, direction');
  if (error) {
    logger.error('[sms/statut] accusé de réception non enregistré', { sid: p.sid, statut, error: error.message });
    return { ok: false, maj: 0, statut };
  }
  const lignes = (data ?? []) as LigneMessage[];
  if (lignes.length === 0) return { ok: true, maj: 0, statut, ignore: 'deja_plus_avance' };

  if (statut === 'failed') {
    for (const l of lignes) {
      if (l.direction && l.direction !== 'outbound') continue;
      logger.warn('[sms/statut] texto non livré', { orgId: l.org_id, code: p.codeErreur ?? null });
      await signalerEchec(admin, l, texteErreur(p.codeErreur, p.messageErreur));
    }
  }
  return { ok: true, maj: lignes.length, statut };
}

/** Une notification par heure et par entreprise au plus. Ne lève jamais. */
async function signalerEchec(admin: SupabaseClient, l: LigneMessage, erreur: string): Promise<void> {
  if (!l.org_id) return;
  try {
    const depuis = new Date(Date.now() - 3600_000).toISOString();
    const { data: recentes, error } = await admin
      .from('notifications')
      .select('id')
      .eq('org_id', l.org_id)
      .eq('type', 'sms_failed')
      .gte('created_at', depuis)
      .limit(1);
    if (error) logger.error('[sms/statut] lecture des notifications récentes échouée', { error: error.message });
    else if ((recentes ?? []).length > 0) return;

    const numero = String(l.phone_number ?? '');
    await insertTargetedNotifications(
      admin,
      l.org_id,
      await resolveQuoteRecipients(admin, l.org_id, {}),
      (langue) => langue === 'en'
        ? { title: `Text not delivered to ${numero}`, body: `${erreur}. Check the number, or reach the client another way.` }
        : { title: `Texto non livré au ${numero}`, body: `${erreur}. Vérifiez le numéro, ou joignez le client autrement.` },
      { type: 'sms_failed', link: numero ? `/messages?phone=${encodeURIComponent(numero)}` : '/messages', icon: 'alert-triangle' },
    );
  } catch (e: any) {
    logger.error('[sms/statut] notification d’échec non créée', { orgId: l.org_id, error: e?.message || String(e) });
  }
}
