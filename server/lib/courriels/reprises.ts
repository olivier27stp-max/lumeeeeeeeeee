/**
 * File de reprise des courriels de fond (2026-09-17).
 * ──────────────────────────────────────────────────
 * Un envoi raté (Resend ou SMTP en erreur) était journalisé puis perdu : un
 * rappel de paiement, un reçu d'abonnement ou un rapport planifié sautait
 * sans que personne ne le renvoie. Opt-in : `sendEmail({ …, reessayer: true })`
 * met l'envoi raté dans `email_retry_queue` ; ce cron le reprend.
 *
 * Réservé aux envois de FOND (cron, webhook, notification). Jamais sur un
 * envoi déclenché par un clic (facture, soumission, contrat) : là,
 * l'utilisateur voit l'erreur et réessaie lui-même — une file créerait des
 * doublons. Une garde statique le vérifie (tests/courriels/reprises.test.ts).
 *
 * Cadence : toutes les 5 min, sous verrou (une seule instance par tick).
 * Reprise : 5 min après l'échec initial, puis 30 min, puis 3 h ; au troisième
 * échec du cron la ligne passe `dead`, l'exploitant (SUPPORT_EMAIL) reçoit un
 * courriel et une erreur est journalisée.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { withAdvisoryLock } from '../advisory-lock';
import { withCronCheckIn, captureCronFailure } from '../sentry';
import { logger } from '../logger';
import { rendreCourrielLume } from './gabarit';
// `../config` et `../mailer` sont importés à l'exécution seulement : le mailer
// importe ce module pour ses règles pures, et config.ts entraîne le client
// Twilio — ni l'un ni l'autre n'a sa place dans le graphe d'import du mailer.

export const TABLE_REPRISES = 'email_retry_queue';
export const CADENCE_REPRISES_MS = 5 * 60_000;
/** Délais avant la tentative n° (index + 1) du cron : 5 min, 30 min, 3 h. */
export const DELAIS_REPRISE_MS = [5 * 60_000, 30 * 60_000, 3 * 3_600_000] as const;
export const MAX_TENTATIVES = 3;
const LOT = 50;

export type StatutReprise = 'pending' | 'sent' | 'dead';

export interface LigneReprise {
  id: string;
  org_id: string | null;
  from_addr: string | null;
  to_emails: string[];
  reply_to: string | null;
  subject: string;
  html: string;
  text: string | null;
  headers: Record<string, string> | null;
  suivi: { orgId: string | null; entityType: string; entityId?: string | null } | null;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  status: StatutReprise;
}

// ── Règles pures ──

/** Délai d'attente avant la prochaine tentative, selon le nombre de tentatives déjà faites par le cron. */
export function delaiAvantTentative(tentativesFaites: number): number {
  const i = Math.max(0, Math.min(tentativesFaites, DELAIS_REPRISE_MS.length - 1));
  return DELAIS_REPRISE_MS[i];
}

/** La ligne qu'insère le mailer au premier échec : attente initiale de 5 min. */
export function planifierPremiereReprise(maintenant: Date): { attempts: number; next_attempt_at: string; status: StatutReprise } {
  return { attempts: 0, next_attempt_at: new Date(maintenant.getTime() + delaiAvantTentative(0)).toISOString(), status: 'pending' };
}

/** Après un échec du cron : tentatives + 1, prochain créneau, ou `dead` au bout de MAX_TENTATIVES. */
export function apresEchec(tentativesFaites: number, maintenant: Date, erreur: string): { attempts: number; next_attempt_at: string | null; status: StatutReprise; last_error: string } {
  const attempts = tentativesFaites + 1;
  const last_error = erreur.slice(0, 1000);
  if (attempts >= MAX_TENTATIVES) return { attempts, next_attempt_at: null, status: 'dead', last_error };
  return { attempts, next_attempt_at: new Date(maintenant.getTime() + delaiAvantTentative(attempts)).toISOString(), status: 'pending', last_error };
}

/** Après un succès du cron. */
export function apresSucces(tentativesFaites: number): { attempts: number; status: StatutReprise; last_error: null } {
  return { attempts: tentativesFaites + 1, status: 'sent', last_error: null };
}

/** La ligne est-elle à reprendre maintenant ? */
export function estAReprendre(ligne: Pick<LigneReprise, 'status' | 'next_attempt_at'>, maintenant: Date): boolean {
  return ligne.status === 'pending' && new Date(ligne.next_attempt_at).getTime() <= maintenant.getTime();
}

/** Le courriel à l'exploitant quand une ligne meurt (voix Lume interne, sans signature). */
export function courrielAbandon(ligne: Pick<LigneReprise, 'to_emails' | 'subject' | 'last_error' | 'attempts' | 'org_id'>, supportEmail?: string | null): { sujet: string; html: string } {
  return {
    sujet: `Courriel abandonné après ${ligne.attempts} reprises — ${ligne.subject}`.slice(0, 200),
    html: rendreCourrielLume({
      langue: 'fr',
      titre: 'Courriel abandonné',
      intro: `Un courriel de fond n'a pas pu partir malgré ${ligne.attempts} reprises. Il ne sera plus tenté : à renvoyer à la main si nécessaire.`,
      lignes: [
        { libelle: 'Destinataire', valeur: ligne.to_emails.join(', ') },
        { libelle: 'Sujet', valeur: ligne.subject },
        { libelle: 'Erreur', valeur: ligne.last_error || 'inconnue' },
        ...(ligne.org_id ? [{ libelle: 'Org', valeur: ligne.org_id }] : []),
      ],
      signature: null,
      supportEmail,
    }),
  };
}

// ── Le cron ──

export interface BilanReprises { repris: number; envoyes: number; reportes: number; morts: number }

export async function reprendreCourriels(admin: SupabaseClient, maintenant = new Date()): Promise<BilanReprises> {
  const bilan: BilanReprises = { repris: 0, envoyes: 0, reportes: 0, morts: 0 };
  const { data, error } = await admin
    .from(TABLE_REPRISES)
    .select('id, org_id, from_addr, to_emails, reply_to, subject, html, text, headers, suivi, attempts, next_attempt_at, last_error, status')
    .eq('status', 'pending')
    .lte('next_attempt_at', maintenant.toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(LOT);
  if (error) throw new Error(`[courriels/reprises] lecture impossible : ${error.message}`);
  const lignes = (data ?? []) as LigneReprise[];
  if (!lignes.length) return bilan;

  const [{ sendEmail }, { emailFrom, supportEmail }] = await Promise.all([import('../mailer'), import('../config')]);

  for (const ligne of lignes) {
    bilan.repris++;
    const r = await sendEmail({
      from: ligne.from_addr || undefined,
      to: ligne.to_emails,
      replyTo: ligne.reply_to || undefined,
      subject: ligne.subject,
      html: ligne.html,
      text: ligne.text || undefined,
      headers: ligne.headers || undefined,
      suivi: ligne.suivi || undefined,
      reessayer: false,
    });
    const maj = r.sent ? apresSucces(ligne.attempts) : apresEchec(ligne.attempts, maintenant, r.error || 'send failed');
    const { error: majErr } = await admin.from(TABLE_REPRISES).update({ ...maj, updated_at: new Date().toISOString() }).eq('id', ligne.id);
    if (majErr) logger.error('[courriels/reprises] statut non mis à jour', { id: ligne.id, error: majErr.message });

    if (r.sent) { bilan.envoyes++; continue; }
    if (maj.status === 'dead') {
      bilan.morts++;
      logger.error('[courriels/reprises] courriel abandonné après le maximum de reprises', { id: ligne.id, orgId: ligne.org_id, subject: ligne.subject, attempts: maj.attempts, error: maj.last_error });
      const alerte = courrielAbandon({ ...ligne, attempts: maj.attempts, last_error: maj.last_error }, supportEmail);
      const n = await sendEmail({ from: emailFrom, to: supportEmail, subject: alerte.sujet, html: alerte.html });
      if (!n.sent) logger.error('[courriels/reprises] alerte à l’exploitant non envoyée', { id: ligne.id, error: n.error });
    } else {
      bilan.reportes++;
    }
  }
  if (bilan.repris) logger.info('[courriels/reprises] passage', bilan);
  return bilan;
}

/** Toutes les 5 min, sous verrou : reprend les envois ratés arrivés à échéance. */
export function demarrerReprisesCourriels(admin: () => SupabaseClient): void {
  const run = () =>
    withAdvisoryLock('email-retry', () => withCronCheckIn('email-retry', () => reprendreCourriels(admin())))
      .catch((e: unknown) => captureCronFailure('email-retry', e));
  const t = setInterval(run, CADENCE_REPRISES_MS);
  t.unref?.();
  setTimeout(run, 75_000).unref?.();
  logger.info('[courriels/reprises] Cron started (every 5min, lock-guarded)');
}
