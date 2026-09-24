/* ═══════════════════════════════════════════════════════════════
   Le moteur de séquences

   Une séquence, c'est un graphe d'étapes parcouru UNE À LA FOIS : chaque
   étape, une fois faite, planifie la suivante. Rien n'est planifié
   d'avance — c'est ce qui permet à une branche « si » d'être évaluée au
   moment où on y arrive, avec l'état du devis ou de la facture À CE
   MOMENT-LÀ, et non celui qu'il avait au déclenchement.

   ── Pourquoi pas tout planifier d'un coup ──────────────────────
   Le moteur simple (`scheduleDelayedActions`) planifie toutes les actions
   ensemble, avec la même date. C'est juste pour une règle plate. Pour une
   séquence ce serait faux : l'étape 3 dépend de ce qu'aura décidé l'étape 2,
   et une branche évaluée à l'avance déciderait sur un état périmé.

   ── L'anti-doublon ─────────────────────────────────────────────
   La clé d'unicité vaut `ruleId:entityId:step:<idÉtape>` et l'index
   `idx_scheduled_tasks_dedup` la couvre parmi les tâches pending/running.
   Deux étapes distinctes ne se bloquent donc pas, mais la même étape ne peut
   pas être planifiée deux fois pour la même entité — la protection qui a
   corrigé un vrai double envoi en prod reste entière.

   ── Les garde-fous ─────────────────────────────────────────────
   Un graphe accepte ce qu'un tableau interdit : une boucle. `e1 → e2 → e1`
   enverrait des messages jusqu'à la fin des temps. Trois protections, à trois
   moments différents :
     · à l'enregistrement, `validation.ts` refuse un cycle (détection statique) ;
     · au parcours, `ETAPES_MAX_PAR_PARCOURS` borne le nombre d'étapes
       franchies pour une entité ;
     · chaque étape franchie est comptée dans la tâche, donc la borne survit
       à un redémarrage du serveur.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

// ── Forme des étapes ────────────────────────────────────────

export type TypeEtape = 'action' | 'attendre' | 'si' | 'arreter';

export interface EtapeAction {
  id: string;
  type: 'action';
  action: { type: string; config: Record<string, unknown> };
  suivant?: string | null;
}

export interface EtapeAttendre {
  id: string;
  type: 'attendre';
  delai_secondes: number;
  suivant?: string | null;
}

export interface EtapeSi {
  id: string;
  type: 'si';
  conditions: Record<string, unknown>;
  alors?: string | null;
  sinon?: string | null;
}

export interface EtapeArreter {
  id: string;
  type: 'arreter';
}

export type Etape = EtapeAction | EtapeAttendre | EtapeSi | EtapeArreter;

/**
 * Nombre d'étapes qu'un parcours peut franchir pour une même entité.
 *
 * Généreux (une séquence réaliste en compte 5 à 10) mais fini : c'est le
 * filet qui empêche une boucle passée entre les mailles de la validation de
 * marteler un client indéfiniment.
 */
export const ETAPES_MAX_PAR_PARCOURS = 50;

/** L'étape par laquelle une séquence commence : la première du tableau. */
export function premiereEtape(steps: Etape[]): Etape | null {
  return steps[0] ?? null;
}

export function trouverEtape(steps: Etape[], id: string | null | undefined): Etape | null {
  if (!id) return null;
  return steps.find((e) => e.id === id) ?? null;
}

/**
 * La clé d'unicité d'une étape.
 *
 * Elle NE CONTIENT PAS de date — même raison que pour les règles simples :
 * avec la date du jour, renvoyer le même devis le lendemain produisait une
 * clé différente, les tâches déjà en attente restaient, et le client recevait
 * tout en double (constaté en prod, 10 tâches pour un seul devis).
 */
export function cleEtape(ruleId: string, entityId: string, stepId: string): string {
  return `${ruleId}:${entityId}:step:${stepId}`;
}

// ── Validation structurelle ─────────────────────────────────

/**
 * Le graphe se parcourt-il sans boucle et sans cul-de-sac ?
 *
 * Retourne la liste des problèmes en clair, vide si tout va bien. Utilisée à
 * l'enregistrement (refus) — jamais à l'exécution, où il est trop tard.
 */
export function problemesDuGraphe(steps: Etape[]): string[] {
  const out: string[] = [];
  if (!steps.length) return ['Une séquence a besoin d\'au moins une étape.'];

  const ids = steps.map((e) => e.id);
  const uniques = new Set(ids);
  if (uniques.size !== ids.length) out.push('Deux étapes portent le même identifiant.');

  // Chaque renvoi pointe-t-il vers une étape qui existe ?
  for (const etape of steps) {
    const cibles: Array<string | null | undefined> =
      etape.type === 'si' ? [etape.alors, etape.sinon]
      : etape.type === 'arreter' ? []
      : [(etape as EtapeAction | EtapeAttendre).suivant];
    for (const cible of cibles) {
      if (cible && !uniques.has(cible)) {
        out.push(`L'étape « ${etape.id} » renvoie vers « ${cible} », qui n'existe pas.`);
      }
    }
  }

  // Une boucle ? Parcours en profondeur, en marquant ce qui est dans la pile.
  const enCours = new Set<string>();
  const fini = new Set<string>();
  const parId = new Map(steps.map((e) => [e.id, e]));

  const descendre = (id: string): boolean => {
    if (enCours.has(id)) return true;        // on revient sur nos pas : boucle
    if (fini.has(id)) return false;
    const etape = parId.get(id);
    if (!etape) return false;
    enCours.add(id);
    const suites: Array<string | null | undefined> =
      etape.type === 'si' ? [etape.alors, etape.sinon]
      : etape.type === 'arreter' ? []
      : [(etape as EtapeAction | EtapeAttendre).suivant];
    for (const s of suites) {
      if (s && descendre(s)) return true;
    }
    enCours.delete(id);
    fini.add(id);
    return false;
  };

  if (steps.some((e) => descendre(e.id))) {
    out.push('Le parcours revient sur lui-même : les messages partiraient en boucle.');
  }

  // Une étape « attendre » en dernier ne fait rien : la séquence s'arrête là,
  // après avoir attendu pour rien. C'est presque toujours un oubli.
  const derniere = steps[steps.length - 1];
  if (derniere?.type === 'attendre' && !derniere.suivant) {
    out.push('La séquence se termine par une attente : rien ne se passera après.');
  }

  return out;
}

// ── Parcours ────────────────────────────────────────────────

export interface ContextePlanification {
  supabase: SupabaseClient;
  orgId: string;
  ruleId: string;
  entityType: string;
  entityId: string;
  /** Métadonnées de l'événement déclencheur, transportées d'étape en étape. */
  contexte: Record<string, unknown>;
  /** Étapes déjà franchies pour cette entité — borne anti-boucle. */
  franchies: number;
}

/**
 * Planifie l'étape donnée, en absorbant les attentes qui la précèdent.
 *
 * Une étape « attendre » n'est pas une tâche : c'est un DÉLAI appliqué à ce
 * qui suit. La planifier comme une tâche ferait un aller-retour inutile en
 * base — et surtout, la tâche « attendre » n'aurait rien à exécuter. On
 * additionne donc les attentes rencontrées, puis on planifie la première
 * étape qui fait vraiment quelque chose.
 *
 * Retourne l'identifiant planifié, ou null si la séquence se termine ici.
 */
export async function planifierEtape(
  ctx: ContextePlanification,
  steps: Etape[],
  depart: string | null | undefined,
): Promise<string | null> {
  let courante = trouverEtape(steps, depart);
  let delaiCumule = 0;
  let sauts = 0;

  // Traverser les attentes jusqu'à une étape exécutable.
  while (courante && courante.type === 'attendre') {
    delaiCumule += Math.max(0, courante.delai_secondes || 0);
    courante = trouverEtape(steps, courante.suivant);
    if (++sauts > ETAPES_MAX_PAR_PARCOURS) {
      logger.error('[sequences] chaîne d\'attentes anormalement longue — parcours abandonné', {
        rule_id: ctx.ruleId, entity_id: ctx.entityId,
      });
      return null;
    }
  }

  if (!courante || courante.type === 'arreter') return null;

  if (ctx.franchies >= ETAPES_MAX_PAR_PARCOURS) {
    logger.error('[sequences] parcours abandonné — trop d\'étapes franchies', {
      rule_id: ctx.ruleId, entity_id: ctx.entityId, franchies: ctx.franchies,
    });
    return null;
  }

  const executeAt = new Date(Date.now() + delaiCumule * 1000).toISOString();

  const { error } = await ctx.supabase.from('automation_scheduled_tasks').insert({
    org_id: ctx.orgId,
    automation_rule_id: ctx.ruleId,
    entity_type: ctx.entityType,
    entity_id: ctx.entityId,
    step_id: courante.id,
    // Une étape « si » n'a pas d'action : le worker la reconnaît à son type et
    // l'évalue au lieu d'exécuter quoi que ce soit.
    action_config: courante.type === 'action'
      ? { ...courante.action, event_metadata: ctx.contexte }
      : { type: '__sequence__', etape: courante.type, event_metadata: ctx.contexte },
    sequence_context: { ...ctx.contexte, franchies: ctx.franchies + 1 },
    execute_at: executeAt,
    status: 'pending',
    execution_key: cleEtape(ctx.ruleId, ctx.entityId, courante.id),
  });

  if (error) {
    // 23505 = cette étape est DÉJÀ en file pour cette entité. Ce n'est pas une
    // panne : c'est l'anti-doublon qui fait son travail (même événement rejoué,
    // deux ticks concurrents). supabase-js ne lève jamais — l'erreur se lit
    // dans la réponse, un catch ici n'attraperait rien.
    if (error.code === '23505') {
      logger.info(`[sequences] étape déjà planifiée, ignorée : ${cleEtape(ctx.ruleId, ctx.entityId, courante.id)}`);
      return null;
    }
    logger.error('[sequences] planification échouée', {
      rule_id: ctx.ruleId, step_id: courante.id, message: error.message,
    });
    return null;
  }

  return courante.id;
}

/**
 * L'étape qui suit celle-ci, une fois qu'elle est faite.
 *
 * Pour une étape « si », `resultat` dit quelle branche prendre. Pour les
 * autres, il est ignoré.
 */
export function etapeSuivante(etape: Etape, resultat?: boolean): string | null {
  if (etape.type === 'si') return (resultat ? etape.alors : etape.sinon) ?? null;
  if (etape.type === 'arreter') return null;
  return (etape as EtapeAction | EtapeAttendre).suivant ?? null;
}

/**
 * Annule tout ce qui reste en file pour cette entité et cette règle.
 *
 * Appelée quand la séquence n'a plus lieu d'être : le client a répondu, le
 * devis est accepté, la facture est payée. `cancelled` plutôt qu'une
 * suppression — le journal doit garder la trace de ce qui était prévu et de
 * pourquoi ça ne partira pas.
 */
export async function annulerSequence(
  supabase: SupabaseClient,
  orgId: string,
  ruleId: string,
  entityId: string,
  motif: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('automation_scheduled_tasks')
    .update({ status: 'cancelled', last_error: motif })
    .eq('org_id', orgId)
    .eq('automation_rule_id', ruleId)
    .eq('entity_id', entityId)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    logger.error('[sequences] annulation échouée', { rule_id: ruleId, entity_id: entityId, message: error.message });
    return 0;
  }
  return data?.length ?? 0;
}
