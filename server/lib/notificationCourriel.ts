import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';
import { rendreCourrielLume, echapper } from './courriels/gabarit';
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
  /**
   * La version anglaise, quand la règle en a une. Sans elle, un membre
   * anglophone reçoit le courriel en français, cadre compris : un courriel
   * dans deux langues (contenu FR, bouton « Open in Lume ») est un défaut.
   */
  en?: { title: string; body: string } | null;
  /** « Bon moment pour appeler » : le numéro à composer, en lien cliquable. */
  appeler?: { nom: string; telephone: string } | null;
}

const EMOJI_EN_TETE = /^[\s\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/u;
const DIESE_NUMERO = /#(?=[\p{L}\p{N}])/gu;

/** Le titre affiché dans le courriel : le même, sans l'emoji ni le « # ». */
function titreNotification(titre: string): string {
  return titre.replace(EMOJI_EN_TETE, '').replace(DIESE_NUMERO, '').replace(/\s+/g, ' ').trim();
}

/**
 * L'objet tiré du titre de la notification (normes des courriels, 2026-09-29) :
 * pas d'emoji en tête, pas de « # » devant un numéro, la première phrase
 * seulement, 60 caractères au plus. « 👀 Marie vient d'ouvrir la soumission
 * #42 (1 250,00 $). Bon moment pour appeler. » faisait ~90 caractères.
 */
export function objetNotification(titre: string): string {
  let t = titreNotification(titre);
  const phrase = t.match(/^(.+?[.!?])(?:\s|$)/);
  if (phrase && phrase[1].length < t.length) t = phrase[1].replace(/\.$/, '');
  if (t.length <= 60) return t;
  const coupe = t.slice(0, 59);
  return `${coupe.slice(0, Math.max(coupe.lastIndexOf(' '), 40)).replace(/[\s,;:(—–-]+$/, '')}…`;
}

/** Lien absolu vers l'app : un courriel ne connaît pas l'origine. */
export function lienAbsolu(lien: string | null, base?: string): string | null {
  if (!lien) return null;
  if (/^https?:\/\//i.test(lien)) return lien;
  if (!lien.startsWith('/')) return null;
  let racine = base;
  if (!racine) {
    // Sans adresse publique configurée, le courriel part sans bouton plutôt que pas du tout.
    try { racine = resolvePublicBaseUrl(); } catch (err: any) {
      logger.warn('[notifications/courriel] adresse publique absente — courriel sans bouton', { error: err?.message });
      return null;
    }
  }
  return `${racine.replace(/\/+$/, '')}${lien}`;
}

export function courrielNotification(c: ContenuNotification, langueMembre: 'fr' | 'en', base?: string): { sujet: string; html: string } {
  const url = lienAbsolu(c.lien, base);
  // Une seule langue par courriel : l'anglais seulement si le contenu existe en anglais.
  const langue: 'fr' | 'en' = langueMembre === 'en' && c.en?.title ? 'en' : 'fr';
  const title = langue === 'en' && c.en ? c.en.title : c.title;
  const body = langue === 'en' && c.en ? c.en.body : c.body;
  const tel = (c.appeler?.telephone || '').replace(/[^\d+]/g, '');
  const ligneAppel = c.appeler && tel.replace(/\D/g, '').length >= 7
    ? `${langue === 'fr' ? 'Appeler' : 'Call'} ${echapper(c.appeler.nom)} : <a href="tel:${tel}" style="color:inherit;font-weight:600;">${echapper(c.appeler.telephone)}</a>`
    : null;
  return {
    sujet: objetNotification(title),
    html: rendreCourrielLume({
      langue,
      titre: titreNotification(title),
      preheader: body || null,
      intro: body || null,
      corpsHtml: ligneAppel ? `<p style="margin:0;">${ligneAppel}</p>` : null,
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
