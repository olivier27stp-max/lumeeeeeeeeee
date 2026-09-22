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
 *  - UN SEUL comportement, partout. Le code ne regarde JAMAIS NODE_ENV : il
 *    lit une valeur, un point. Staging et production exécutent exactement le
 *    même chemin, et c'est la valeur de LUMI_PLAFOND_JOUR_USD qui diffère,
 *    comme n'importe quel autre réglage d'environnement. Un garde-fou qui se
 *    comporte autrement selon l'environnement n'est pas testé là où il compte,
 *    et la règle du projet est « zéro delta » entre les deux.
 *    Le défaut est 5 $ par source : la valeur qui aurait arrêté l'incident,
 *    appliquée des deux côtés. À monter par variable d'env si un abonné réel
 *    a besoin de plus.
 *  - Le compteur est en mémoire, par processus. C'est un cran d'arrêt, pas de
 *    la comptabilité : la comptabilité reste `ai_usage`. Un redémarrage remet
 *    le compteur à zéro, ce qui est acceptable pour un garde-fou (et évite de
 *    dépendre de la base sur le chemin chaud).
 *
 * Tests : tests/lumi-plafond-journalier.test.ts
 */
import { logger } from '../logger';

/** Sources d'appel distinctes : chacune a son plafond et son compteur. */
export type SourceLLM = 'lumi' | 'support' | 'migration' | 'public' | 'cache-chaud' | 'eval' | 'voix';

export const SOURCES: readonly SourceLLM[] = ['lumi', 'support', 'migration', 'public', 'cache-chaud', 'eval', 'voix'];

/**
 * Sources dont le tarif n'est pas connu du code (Gemini) : leur dépense en
 * DOLLARS ne peut pas être comptée, seulement leur nombre d'appels. Le
 * plafond s'applique alors au VOLUME, pas au montant — c'est moins précis,
 * mais un poste non chiffré sans aucune borne est pire (2026-09-22 : la
 * dictée ne figurait dans aucun total en dollars).
 */
export const SOURCES_SANS_TARIF: readonly SourceLLM[] = ['voix'];

/** Appels/jour tolérés pour une source non chiffrée. `LUMI_PLAFOND_JOUR_VOIX_APPELS`. */
export function plafondAppelsJour(source: SourceLLM, env: NodeJS.ProcessEnv = process.env): number {
  const brut = env[`LUMI_PLAFOND_JOUR_${source.toUpperCase()}_APPELS`];
  if (brut !== undefined && brut !== '') {
    const v = Number(brut);
    if (Number.isFinite(v) && v >= 0) return Math.round(v);
  }
  // 60 s par dictée : 300 appels = 5 h d'audio en une journée pour une org.
  // Large pour un usage normal, net contre une boucle.
  return 300;
}

/** Plafond par défaut, le MÊME partout : la valeur qui aurait arrêté l'incident du 2026-09-18. */
export const PLAFOND_DEFAUT_CENTS = 500;

/**
 * Plafond du jour en CENTS pour une source. 0 = illimité (échappatoire
 * explicite). `LUMI_PLAFOND_JOUR_USD` fixe le plafond global ;
 * `LUMI_PLAFOND_JOUR_<SOURCE>_USD` l'affine par source
 * (ex. LUMI_PLAFOND_JOUR_EVAL_USD=2).
 *
 * Aucune lecture de NODE_ENV ici, volontairement : le comportement est
 * identique en staging et en production, seule la valeur peut différer.
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
  return PLAFOND_DEFAUT_CENTS;
}

interface Compteur { jour: string; cents: number; appels: number; refus: number; alerte: boolean }
const compteurs = new Map<SourceLLM, Compteur>();

/** Jour civil de Montréal : la même frontière que le reste du budget. */
export function jourMontreal(maintenant = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montreal', year: 'numeric', month: '2-digit', day: '2-digit' }).format(maintenant);
}

function compteur(source: SourceLLM, maintenant: Date): Compteur {
  const jour = jourMontreal(maintenant);
  const c = compteurs.get(source);
  if (c && c.jour === jour) return c;
  const neuf: Compteur = { jour, cents: 0, appels: 0, refus: 0, alerte: false };
  compteurs.set(source, neuf);
  return neuf;
}

export interface Verdict {
  autorise: boolean;
  /** Appels du jour pour cette source (seul compteur disponible sans tarif). */
  appels?: number;
  /** Plafond en nombre d'appels, pour une source non chiffrée. */
  plafond_appels?: number;
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
  const c = compteur(source, maintenant);
  // Source non chiffrée (Gemini) : on borne le VOLUME, faute de connaître le prix.
  if (SOURCES_SANS_TARIF.includes(source)) {
    const max = plafondAppelsJour(source, env);
    return { autorise: max <= 0 || c.appels < max, depense_cents: c.cents, plafond_cents: 0, appels: c.appels, plafond_appels: max };
  }
  const plafond = plafondJourCents(source, env);
  if (plafond <= 0) return { autorise: true, depense_cents: c.cents, plafond_cents: 0, appels: c.appels };
  return { autorise: c.cents < plafond, depense_cents: c.cents, plafond_cents: plafond, appels: c.appels };
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

/**
 * Compte UN APPEL, pour les sources dont on ne connaît pas le tarif. Le prix
 * reste inconnu, mais le volume, lui, est mesurable — et c'est ce volume qui
 * arme le plafond de ces sources.
 */
export function ajouterAppel(source: SourceLLM, env: NodeJS.ProcessEnv = process.env, maintenant = new Date()): void {
  const c = compteur(source, maintenant);
  c.appels += 1;
  const max = plafondAppelsJour(source, env);
  if (max > 0 && c.appels >= max && !c.alerte) {
    c.alerte = true;
    logger.warn('[lumi] plafond journalier d’appels atteint (source sans tarif connu)', { source, appels: c.appels, plafond: max, jour: c.jour });
  }
}

/** Compte un refus (pour l'état et l'alerte). */
export function compterRefus(source: SourceLLM, maintenant = new Date()): void {
  compteur(source, maintenant).refus += 1;
}

/** État courant, pour /api/lumi/budget et les tests. */
export function etatPlafonds(env: NodeJS.ProcessEnv = process.env, maintenant = new Date()): Array<{ source: SourceLLM; depense_cents: number; plafond_cents: number; appels: number; plafond_appels: number | null; refus: number }> {
  return SOURCES.map((s) => {
    const c = compteur(s, maintenant);
    const sansTarif = SOURCES_SANS_TARIF.includes(s);
    return {
      source: s,
      depense_cents: c.cents,
      // Une source sans tarif n'a pas de plafond en dollars : le dire (0)
      // plutôt que d'afficher une borne qui ne s'applique pas.
      plafond_cents: sansTarif ? 0 : plafondJourCents(s, env),
      appels: c.appels,
      plafond_appels: sansTarif ? plafondAppelsJour(s, env) : null,
      refus: c.refus,
    };
  });
}

/** Tests seulement : remet les compteurs à zéro. */
export function reinitialiserPlafonds(): void { compteurs.clear(); }
