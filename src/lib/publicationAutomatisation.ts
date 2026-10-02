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
  /** L'entité que les réglages de la règle fixent — voir `champQuiFixeLEntite` (catalogue). */
  entite?: string | null;
}

/** L'action « À compléter » posée à la création : ce n'est pas un vrai envoi. */
function estProvisoire(actions: unknown[]): boolean {
  if (actions.length !== 1) return false;
  const a = actions[0] as { type?: string; config?: { body?: unknown } } | null;
  return a?.type === 'send_sms' && TEXTES_ACTION_PROVISOIRE.includes(String(a.config?.body ?? ''));
}

/** Plafond du champ `actions` côté serveur (`corpsAutomatisation`, server/lib/validation.ts). */
const ACTIONS_REFLET_MAX = 20;

/**
 * `actions`, REFLET du parcours (triage éditeur, 05b-canevas-outils-origine:303 ;
 * constat A-02).
 *
 * Une règle porte deux copies de ses messages : `steps` (le parcours, que le
 * moteur exécute dès qu'il y en a) et `actions` (le format d'origine). L'éditeur
 * n'écrivait que `steps` : « Convertir » laissait dans `actions` l'ancien
 * message, et dès que le parcours redevenait vide, l'éditeur ET le moteur
 * relisaient la règle comme « au format d'origine » — l'étape supprimée
 * revenait, en lecture seule, et continuait de partir.
 *
 * `actions` se DÉRIVE donc du parcours, à chaque enregistrement : ses actions,
 * dans l'ordre où le parcours les rencontre (le fil principal, puis la branche
 * « si non »), sans attente ni condition. Un parcours VIDE donne l'action
 * provisoire « À compléter » — celle d'une automatisation neuve, que l'éditeur
 * et la publication lisent comme « aucune étape » (le serveur exige une action).
 */
export function actionsDuParcours(steps: unknown, fr = true): Array<{ type: string; config: Record<string, unknown> }> {
  const etapes = (Array.isArray(steps) ? steps : []) as Array<Record<string, unknown> | null | undefined>;
  const parId = new Map<string, Record<string, unknown>>();
  for (const e of etapes) if (e && typeof e.id === 'string') parId.set(e.id, e);
  const ordre: Array<Record<string, unknown>> = [];
  const vues = new Set<string>();
  // Parcours en profondeur, sans récursion : la suite d'abord, les embranchements ensuite.
  const pile: string[] = typeof etapes[0]?.id === 'string' ? [etapes[0].id as string] : [];
  while (pile.length) {
    const id = pile.pop() as string;
    const etape = parId.get(id);
    if (!etape || vues.has(id)) continue;
    vues.add(id);
    ordre.push(etape);
    const suites = etape.type === 'si'
      ? [etape.alors, etape.sinon]
      : etape.type === 'arreter' ? [] : [etape.suivant, etape.si_reponse, etape.si_depasse];
    for (const s of [...suites].reverse()) if (typeof s === 'string' && !vues.has(s)) pile.push(s);
  }
  // Une étape que rien n'atteint (brouillon en cours de câblage) : gardée, à la fin.
  for (const e of etapes) if (e && typeof e.id === 'string' && !vues.has(e.id)) ordre.push(e);

  const actions = ordre.flatMap((e) => {
    const a = e.type === 'action' ? (e.action as { type?: unknown; config?: unknown } | null | undefined) : null;
    return a && typeof a.type === 'string' && a.type
      ? [{ type: a.type, config: { ...((a.config ?? {}) as Record<string, unknown>) } }]
      : [];
  });
  if (actions.length === 0) return [{ type: 'send_sms', config: { body: TEXTES_ACTION_PROVISOIRE[fr ? 0 : 1] } }];
  return actions.slice(0, ACTIONS_REFLET_MAX);
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
      entite: regle.entite,
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
    entite: regle.entite,
  });
}

/**
 * Les étapes qui portent encore le texte d'exemple de l'éditeur — à montrer
 * AVANT de publier, là où aucune confirmation ne s'affichait (interrupteur et
 * lot de la liste). L'éditeur, lui, les liste déjà dans sa confirmation.
 */
export function textesDExemple(regle: RegleAPublier): ProblemePublication[] {
  return problemesPublication(regle).filter((p) => p.code === 'texte_exemple');
}

/** Seulement ce qui EMPÊCHE de publier. */
export function bloquantsPublication(regle: RegleAPublier): ProblemePublication[] {
  return problemesPublication(regle).filter((p) => p.gravite === 'bloquant');
}
