/**
 * Plafond journalier DUR en dollars, par source d'appel (incident 2026-09-18).
 * ─────────────────────────────────────────────────────────────────────────
 * Ce que les garde-fous existants ne couvraient pas — et ce qui a coûté 39 $
 * en sept jours sur STAGING pendant que la prod en coûtait 2 :
 *
 *  - `budget.ts` plafonne le mois PAR ORG, à partir du plan de l'abonnement.
 *    Une org de test portant le plan Autopilot (`ai_monthly_budget_cents`
 *    = 4500) est donc autorisée à brûler 45 $ avant le moindre refus : sur un
 *    environnement de test, ce plafond n'est pas une protection, c'est un
 *    droit de dépense. Mesuré le 2026-09-16 : 4 111 appels, 18,05 $ en une
 *    journée, org « Vision Lavage ».
 *  - Le garde-fou journalier de `budget.ts` (`part_budget_par_jour`) ne
 *    BLOQUE pas : il fait passer en palier restreint (Haiku). La dépense
 *    continue, moins vite.
 *  - Une org SANS abonnement (`includes_ai` faux) n'a aucun plafond du tout.
 *
 * Ce module ajoute la borne qui manquait, volontairement indépendante de
 * l'org et du plan : une somme en dollars, par jour, par source, comptée sur
 * TOUTE la dépense de l'instance. Au-delà, l'appel est refusé — pas dégradé.
 *
 * Deux principes :
 *  - Hors production, le plafond est serré par défaut (LUMI_PLAFOND_JOUR_USD,
 *    défaut 5 $) : une batterie d'évaluation qui part en boucle s'arrête au
 *    bout de 5 $, pas de 45 $. En production, aucun plafond global par défaut
 *    (0 = illimité) : ce sont les budgets par org qui gouvernent, et on ne
 *    veut jamais qu'un abonné soit coupé par une borne d'exploitation.
 *  - Le compteur est en mémoire, par processus. C'est un cran d'arrêt, pas de
 *    la comptabilité : la comptabilité reste `ai_usage`. Un redémarrage remet
 *    le compteur à zéro, ce qui est acceptable pour un garde-fou (et évite de
 *    dépendre de la base sur le chemin chaud).
 *
 * Tests : tests/lumi-plafond-journalier.test.ts
 */
import { logger } from '../logger';

/** Sources d'appel distinctes : chacune a son plafond et son compteur. */
export type SourceLLM = 'lumi' | 'support' | 'migration' | 'public' | 'cache-chaud' | 'eval';

export const SOURCES: readonly SourceLLM[] = ['lumi', 'support', 'migration', 'public', 'cache-chaud', 'eval'];

/** `production` = l'app qui sert les abonnés. Tout le reste est un environnement de travail. */
export function estProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV || '').toLowerCase() === 'production' && (env.LUMI_ENV || '').toLowerCase() !== 'staging';
}

/**
 * Plafond du jour en CENTS pour une source. 0 = illimité.
 * `LUMI_PLAFOND_JOUR_USD` fixe le plafond global ; `LUMI_PLAFOND_JOUR_<SOURCE>_USD`
 * l'affine par source (ex. LUMI_PLAFOND_JOUR_EVAL_USD=2).
 */
export function plafondJourCents(source: SourceLLM, env: NodeJS.ProcessEnv = process.env): number {
  const parSource = env[`LUMI_PLAFOND_JOUR_${source.toUpperCase().replace(/-/g, '_')}_USD`];
  const global = env.LUMI_PLAFOND_JOUR_USD;
  const brut = parSource ?? global;
  if (brut !== undefined && brut !== '') {
    const v = Number(brut);
    // Une valeur illisible ne doit jamais valoir « illimité » : on retombe sur le défaut.
    if (Number.isFinite(v) && v >= 0) return Math.round(v * 100);
  }
  // Défaut : serré hors prod, illimité en prod (les budgets par org gouvernent).
  return estProduction(env) ? 0 : 500;
}

interface Compteur { jour: string; cents: number; refus: number; alerte: boolean }
const compteurs = new Map<SourceLLM, Compteur>();

/** Jour civil de Montréal : la même frontière que le reste du budget. */
export function jourMontreal(maintenant = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montreal', year: 'numeric', month: '2-digit', day: '2-digit' }).format(maintenant);
}

function compteur(source: SourceLLM, maintenant: Date): Compteur {
  const jour = jourMontreal(maintenant);
  const c = compteurs.get(source);
  if (c && c.jour === jour) return c;
  const neuf: Compteur = { jour, cents: 0, refus: 0, alerte: false };
  compteurs.set(source, neuf);
  return neuf;
}

export interface Verdict {
  autorise: boolean;
  /** Dépense déjà comptée aujourd'hui pour cette source, en cents. */
  depense_cents: number;
  plafond_cents: number;
}

/**
 * À appeler AVANT chaque appel au modèle. Refuse dès que la dépense du jour
 * atteint le plafond de la source. Ne consomme rien : c'est `ajouterDepense`
 * qui compte, une fois le coût réel connu.
 */
export function verifierPlafond(source: SourceLLM, env: NodeJS.ProcessEnv = process.env, maintenant = new Date()): Verdict {
  const plafond = plafondJourCents(source, env);
  const c = compteur(source, maintenant);
  if (plafond <= 0) return { autorise: true, depense_cents: c.cents, plafond_cents: 0 };
  return { autorise: c.cents < plafond, depense_cents: c.cents, plafond_cents: plafond };
}

/**
 * Ajoute le coût réel d'un appel au compteur du jour. Journalise une fois le
 * franchissement — un plafond qui coupe en silence est un bug qu'on cherche
 * pendant des heures.
 */
export function ajouterDepense(source: SourceLLM, coutCents: number, env: NodeJS.ProcessEnv = process.env, maintenant = new Date()): void {
  if (!Number.isFinite(coutCents) || coutCents <= 0) return;
  const c = compteur(source, maintenant);
  c.cents = Math.round((c.cents + coutCents) * 10_000) / 10_000;
  const plafond = plafondJourCents(source, env);
  if (plafond > 0 && c.cents >= plafond && !c.alerte) {
    c.alerte = true;
    logger.warn('[lumi] plafond journalier atteint — les appels de cette source sont refusés jusqu\'à minuit', {
      source, depense_usd: (c.cents / 100).toFixed(2), plafond_usd: (plafond / 100).toFixed(2), jour: c.jour,
    });
  }
}

/** Compte un refus (pour l'état et l'alerte). */
export function compterRefus(source: SourceLLM, maintenant = new Date()): void {
  compteur(source, maintenant).refus += 1;
}

/** État courant, pour /api/lumi/budget et les tests. */
export function etatPlafonds(env: NodeJS.ProcessEnv = process.env, maintenant = new Date()): Array<{ source: SourceLLM; depense_cents: number; plafond_cents: number; refus: number }> {
  return SOURCES.map((s) => {
    const c = compteur(s, maintenant);
    return { source: s, depense_cents: c.cents, plafond_cents: plafondJourCents(s, env), refus: c.refus };
  });
}

/** Tests seulement : remet les compteurs à zéro. */
export function reinitialiserPlafonds(): void { compteurs.clear(); }
