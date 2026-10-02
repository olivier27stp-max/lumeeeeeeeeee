/**
 * Veille de la base de données : quelqu'un est prévenu quand elle ne répond plus.
 * ─────────────────────────────────────────────────────────────────────────
 * 2026-09-28 puis 2026-10-01 : la base de production est restée injoignable
 * (65 minutes la seconde fois) et PERSONNE n'a été prévenu — l'app s'affiche,
 * plus rien ne charge, et on l'apprend quand un client écrit. Le serveur, lui,
 * tourne toujours pendant ces pannes, et Slack ne dépend pas de la base : c'est
 * donc lui qui sonne.
 *
 * Toutes les minutes, la même lecture minuscule que `/api/health` (une ligne,
 * une colonne), bornée à 8 secondes. Trois échecs de suite → UN message dans le
 * canal de l'équipe, avec l'heure du début et le remède connu. Au retour → un
 * second message, avec la durée de la coupure. Jamais plus d'un message par
 * panne : une alerte qui se répète est une alerte qu'on coupe.
 *
 * Sans Slack configuré, la panne est seulement journalisée (logger.error).
 * `VEILLE_BASE=off` désarme la veille.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';
import { isSlackConfigured, canalSupport, envoyerMessageSlack } from './slack';

export const CADENCE_VEILLE_MS = 60_000;
export const DELAI_SONDE_MS = 8_000;
export const ECHECS_AVANT_ALERTE = 3;

export interface EtatVeille {
  /** Échecs consécutifs. */
  echecs: number;
  enPanne: boolean;
  /** Heure du PREMIER échec de la série (ms). */
  debut: number | null;
}

export const ETAT_INITIAL: EtatVeille = { echecs: 0, enPanne: false, debut: null };

export type ActionVeille = { type: 'rien' } | { type: 'alerter'; debut: number } | { type: 'annoncer_retour'; debut: number; dureeMin: number };

/** Pure : un relevé de plus, l'état suivant et ce qu'il faut dire (au plus un message par panne, un par retour). */
export function etapeVeille(etat: EtatVeille, ok: boolean, maintenant: number): { etat: EtatVeille; action: ActionVeille } {
  if (ok) {
    if (etat.enPanne && etat.debut !== null) {
      return { etat: ETAT_INITIAL, action: { type: 'annoncer_retour', debut: etat.debut, dureeMin: Math.max(1, Math.round((maintenant - etat.debut) / 60_000)) } };
    }
    return { etat: ETAT_INITIAL, action: { type: 'rien' } };
  }
  const debut = etat.debut ?? maintenant;
  const echecs = etat.echecs + 1;
  if (!etat.enPanne && echecs >= ECHECS_AVANT_ALERTE) {
    return { etat: { echecs, enPanne: true, debut }, action: { type: 'alerter', debut } };
  }
  return { etat: { echecs, enPanne: etat.enPanne, debut }, action: { type: 'rien' } };
}

const heureMontreal = (ms: number): string => new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Montreal', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)).replace(':', ' h ');

/** Le projet Supabase visé par CETTE instance (« bbzcuz… ») : une instance de test ne doit pas faire croire à une panne de la prod. */
export function projetVise(url: string = process.env.VITE_SUPABASE_URL || ''): string {
  return /^https:[/][/]([a-z0-9]+)[.]/.exec(url)?.[1] ?? 'inconnu';
}

export function messagePanne(debut: number): string {
  return `:red_circle: *La base de données ne répond plus* (projet Supabase \`${projetVise()}\`) depuis ${heureMontreal(debut)} (heure de Montréal). L'app s'affiche, mais plus rien ne charge pour les clients.\nRemède connu : redémarrer le projet dans Supabase (Project Settings → General → Restart project), environ 4 minutes, sans perte de données. Je préviens ici quand elle revient.`;
}

export function messageRetour(debut: number, dureeMin: number): string {
  return `:large_green_circle: *La base de données répond de nouveau* (projet Supabase \`${projetVise()}\`). Coupure de ${dureeMin} minute${dureeMin > 1 ? 's' : ''}, commencée à ${heureMontreal(debut)} (heure de Montréal).`;
}

/** La lecture de `/api/health`, bornée dans le temps : une base qui ne répond pas ne rend jamais la main d'elle-même. */
export async function sonderBase(admin: SupabaseClient, delaiMs: number = DELAI_SONDE_MS): Promise<boolean> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<boolean>((resoudre) => { minuteur = setTimeout(() => resoudre(false), delaiMs); });
  const lecture = (async () => {
    try {
      const { error } = await admin.from('orgs').select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  try {
    return await Promise.race([lecture, limite]);
  } finally {
    if (minuteur) clearTimeout(minuteur);
  }
}

async function dire(texte: string): Promise<void> {
  if (!isSlackConfigured()) return;
  try {
    await envoyerMessageSlack({ channel: canalSupport(), text: texte });
  } catch (e) {
    logger.error('[veille-base] message Slack non parti', { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Un relevé : sonde, état suivant, message s'il y en a un. Exporté pour les tests. */
export async function releverBase(etat: EtatVeille, admin: SupabaseClient, maintenant: number = Date.now()): Promise<EtatVeille> {
  const ok = await sonderBase(admin);
  const suite = etapeVeille(etat, ok, maintenant);
  if (suite.action.type === 'alerter') {
    logger.error('[veille-base] la base ne répond plus', { depuis: new Date(suite.action.debut).toISOString(), echecs: suite.etat.echecs });
    await dire(messagePanne(suite.action.debut));
  } else if (suite.action.type === 'annoncer_retour') {
    logger.info('[veille-base] la base répond de nouveau', { coupure_min: suite.action.dureeMin });
    await dire(messageRetour(suite.action.debut, suite.action.dureeMin));
  }
  return suite.etat;
}

/** Arme la veille : un relevé par minute, jamais deux en même temps. */
export function demarrerVeilleBase(admin: () => SupabaseClient): void {
  if (process.env.VEILLE_BASE === 'off') return;
  let etat: EtatVeille = ETAT_INITIAL;
  let enCours = false;
  const t = setInterval(() => {
    if (enCours) return;
    enCours = true;
    void releverBase(etat, admin())
      .then((suivant) => { etat = suivant; })
      .catch((e: unknown) => logger.error('[veille-base] relevé en erreur', { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => { enCours = false; });
  }, CADENCE_VEILLE_MS);
  t.unref?.();
  logger.info('[veille-base] veille de la base armée', { slack: isSlackConfigured() });
}
