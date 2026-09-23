/**
 * Interrupteur d'arrêt des automatisations — F6 (2026-09-23).
 * ───────────────────────────────────────────────────────────
 * Quand une automatisation part de travers chez un vrai client — une relance
 * qui boucle, un gabarit cassé, un import qui déclenche 200 envois — il faut
 * pouvoir tout arrêter MAINTENANT. Sans cet interrupteur, le seul recours
 * était de désactiver les règles une par une dans chaque organisation, ou de
 * déployer. Les deux prennent des minutes ; un envoi en rafale en prend
 * quelques-unes aussi.
 *
 * `AUTOMATIONS_ENABLED=false` → le moteur ne traite plus rien.
 *
 * ── Ce que l'arrêt garantit ──
 * La file reste INTACTE. Les tâches déjà planifiées ne sont ni réclamées, ni
 * marquées en échec, ni supprimées : elles attendent. Remettre la variable à
 * `true` et redémarrer reprend le travail là où il s'était arrêté. Un
 * interrupteur qui ferait perdre la file serait un interrupteur qu'on n'ose
 * pas utiliser — donc inutile le jour où il faut s'en servir.
 *
 * ── Pourquoi la valeur par défaut est « allumé » ──
 * Une variable absente doit laisser le produit fonctionner. Si l'absence
 * coupait les automatisations, un oubli de configuration sur un nouvel
 * environnement les désactiverait en silence — exactement le genre de panne
 * muette que ce dépôt a déjà payée.
 *
 * ── Pourquoi lire l'environnement à chaque appel ──
 * Pas de constante au chargement du module : sur Railway, changer la
 * variable redémarre le service, mais en test (et si un jour on recharge la
 * configuration à chaud) une valeur figée à l'import rendrait l'interrupteur
 * intestable et mensonger.
 *
 * Tests : tests/automations-interrupteur.test.ts
 */
import { logger } from './logger';

/**
 * `false` uniquement sur une valeur explicitement négative. Tout le reste —
 * variable absente, vide, « true », ou une faute de frappe — laisse les
 * automatisations actives : on ne coupe pas la production sur une coquille.
 */
export function automatisationsActives(env: NodeJS.ProcessEnv = process.env): boolean {
  const brut = (env.AUTOMATIONS_ENABLED ?? '').trim().toLowerCase();
  return !(brut === 'false' || brut === '0' || brut === 'off' || brut === 'no');
}

let dejaSignale = false;

/**
 * Comme `automatisationsActives`, mais journalise UNE fois que le moteur est
 * à l'arrêt. Sans cette trace, un interrupteur oublié en position « arrêt »
 * ressemblerait à un moteur en panne, et on chercherait le bug ailleurs.
 */
export function automatisationsActivesAvecTrace(env: NodeJS.ProcessEnv = process.env): boolean {
  const actives = automatisationsActives(env);
  if (!actives && !dejaSignale) {
    dejaSignale = true;
    logger.warn('[automationEngine] ARRÊT GLOBAL — AUTOMATIONS_ENABLED=false : aucun événement traité, aucune tâche réclamée. La file est conservée.');
  }
  if (actives) dejaSignale = false;
  return actives;
}

/** Remet le témoin à zéro — pour les tests seulement. */
export function reinitialiserTraceInterrupteur(): void {
  dejaSignale = false;
}
