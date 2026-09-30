/* ═══════════════════════════════════════════════════════════════
   Peut-on PUBLIER cette automatisation ? — le module partagé.

   Audit du 2026-09-28 (M8) : seul l'éditeur appelait
   `problemesAvantPublication`. La liste (interrupteur et lot), les pages
   Réglages et Lumi écrivaient `is_active` directement : on pouvait publier
   un parcours cassé d'un clic, sans un mot.

   Désormais la route serveur de publication (`server/routes/
   automation-publication.ts`) ET l'éditeur appellent cette fonction-ci :
   la même règle partout, sans copie qui puisse dériver.

   LE CAS DES MODÈLES AU FORMAT D'ORIGINE. 34 des 38 préréglages semés par
   la base contiennent `log_activity` (une écriture interne du moteur,
   volontairement absente du catalogue) ou une demande d'avis sans texte
   (le moteur prend le texte des réglages d'avis). Le catalogue les dirait
   « cassés » alors qu'ils tournent depuis des mois : on ne les bloque pas
   tant qu'ils restent au format d'origine. Vérifié en rejouant
   `problemesAvantPublication` sur `AUTOMATION_PRESETS` (tests/
   automatisations-publication-serveur.test.ts).
   ═══════════════════════════════════════════════════════════════ */

import { problemesAvantPublication, trouverAction, type ProblemePublication } from './automationCatalogue';
import { estFormatOrigine, TEXTES_ACTION_PROVISOIRE } from './sequenceTypes';

export interface RegleAPublier {
  trigger_event?: string | null;
  steps?: unknown;
  actions?: unknown;
  conditions?: Record<string, unknown> | null;
  is_preset?: boolean | null;
  fr?: boolean;
}

/** L'action « À compléter » posée à la création : ce n'est pas un vrai envoi. */
function estProvisoire(actions: unknown[]): boolean {
  if (actions.length !== 1) return false;
  const a = actions[0] as { type?: string; config?: { body?: unknown } } | null;
  return a?.type === 'send_sms' && TEXTES_ACTION_PROVISOIRE.includes(String(a.config?.body ?? ''));
}

/** Tous les problèmes (bloquants et avertissements) avant publication. */
export function problemesPublication(regle: RegleAPublier): ProblemePublication[] {
  const steps = Array.isArray(regle.steps) ? regle.steps : [];
  const actions = Array.isArray(regle.actions) ? regle.actions : [];

  if (estFormatOrigine({ steps, actions })) {
    // Un modèle fourni, jamais converti : il tourne tel que semé.
    if (regle.is_preset) return [];
    // Une ancienne règle simple : on vérifie ce que l'utilisateur a pu
    // écrire, pas les écritures internes du moteur (`log_activity`).
    return problemesAvantPublication({
      trigger_event: regle.trigger_event,
      steps: null,
      actions: actions.filter((a) => trouverAction(String((a as { type?: unknown })?.type ?? ''))),
      conditions: regle.conditions ?? null,
      fr: regle.fr,
    });
  }

  return problemesAvantPublication({
    trigger_event: regle.trigger_event,
    steps,
    // Une automatisation neuve porte l'action provisoire « À compléter » :
    // la publier enverrait ce texte à de vrais clients. Elle compte pour
    // un parcours vide.
    actions: estProvisoire(actions) ? [] : actions,
    conditions: regle.conditions ?? null,
    fr: regle.fr,
  });
}

/** Seulement ce qui EMPÊCHE de publier. */
export function bloquantsPublication(regle: RegleAPublier): ProblemePublication[] {
  return problemesPublication(regle).filter((p) => p.gravite === 'bloquant');
}
