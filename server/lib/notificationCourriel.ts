import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';
import { rendreCourrielLume } from './courriels/gabarit';
import { resolvePublicBaseUrl } from './helpers';

/*
 * « Aussi par courriel » d'une notification interne (Notifier l'équipe).
 *
 * Le même message que la cloche, envoyé à l'adresse de connexion de chaque
 * destinataire — les mêmes personnes, jamais une adresse libre. Interne : pas
 * de client en copie, pas de lien de désabonnement commercial (l'interrupteur
 * est sur l'automatisation). Ne lance jamais : un courriel raté ne doit pas
 * faire échouer la notification, déjà écrite.
 */

export interface ContenuNotification {
  title: string;
  body: string;
  /** Lien interne (`/quotes/…`) ou absolu. */
  lien: string | null;
}

/** Lien absolu vers l'app : un courriel ne connaît pas l'origine. */
export function lienAbsolu(lien: string | null, base = resolvePublicBaseUrl()): string | null {
  if (!lien) return null;
  if (/^https?:\/\//i.test(lien)) return lien;
  if (!lien.startsWith('/')) return null;
  return `${base.replace(/\/+$/, '')}${lien}`;
}

export function courrielNotification(c: ContenuNotification, langue: 'fr' | 'en', base?: string): { sujet: string; html: string } {
  const url = lienAbsolu(c.lien, base);
  return {
    sujet: c.title.slice(0, 200),
    html: rendreCourrielLume({
      langue,
      titre: c.title,
      preheader: c.body || null,
      intro: c.body || null,
      bouton: url ? { texte: langue === 'fr' ? 'Ouvrir dans Lume' : 'Open in Lume', url } : null,
      note: langue === 'fr'
        ? 'Tu reçois ce courriel parce qu’une automatisation de ton entreprise te prévient aussi par courriel.'
        : 'You get this email because one of your company’s automations also notifies you by email.',
      signature: null,
    }),
  };
}

export async function envoyerNotificationParCourriel(
  admin: SupabaseClient,
  orgId: string,
  destinataires: Map<string, 'fr' | 'en'>,
  contenu: ContenuNotification,
  suivi: { entityType: string; entityId: string | null },
): Promise<number> {
  if (destinataires.size === 0) return 0;
  const { sendEmail } = await import('./mailer');
  let envoyes = 0;
  for (const [userId, langue] of destinataires) {
    try {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      const email = data?.user?.email;
      if (error || !email) {
        logger.warn('[notifications/courriel] adresse introuvable', { userId, error: error?.message });
        continue;
      }
      const { sujet, html } = courrielNotification(contenu, langue);
      const r = await sendEmail({
        to: email,
        subject: sujet,
        html,
        suivi: { orgId, entityType: suivi.entityType, entityId: suivi.entityId },
        reessayer: true,
      });
      if (r.sent || r.enFile) envoyes += 1;
      else logger.error('[notifications/courriel] envoi échoué', { userId, error: r.error });
    } catch (err: any) {
      logger.error('[notifications/courriel] envoi échoué', { userId, error: err?.message || String(err) });
    }
  }
  return envoyes;
}
