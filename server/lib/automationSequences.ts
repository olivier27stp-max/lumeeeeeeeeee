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
  /**
   * Le nom que l'utilisateur donne a cette etape.
   *
   * Sans lui, un parcours qui envoie trois courriels affiche trois cartes
   * « Envoyer un courriel » impossibles a distinguer. C'est le champ
   * « Action Name » de GoHighLevel, et il ne sert qu'a l'affichage : le
   * moteur ne le lit jamais.
   */
  nom?: string | null;
}

export interface EtapeAttendre {
  id: string;
  type: 'attendre';
  delai_secondes: number;
  suivant?: string | null;
  /**
   * Ce qu'on attend.
   *
   * `duree` (défaut, et le seul comportement d'avant) : un délai fixe.
   *
   * `reponse` : on attend la réponse du client, au plus `delai_secondes`.
   * C'est le « Wait for Contact Reply » de GoHighLevel, et le plus utile
   * pour une relance : il rend inutile la moitié des conditions. Le moteur
   * regarde s'il y a un message ENTRANT ; si oui, il saute directement à
   * `si_reponse` (ou arrête le parcours), sinon il continue vers `suivant`
   * une fois le délai écoulé.
   *
   * Absent = `duree` : les parcours déjà enregistrés ne changent pas.
   *
   * `avant_date` : on attend jusqu'à `secondes_avant` AVANT la date du
   * rendez-vous (« 7 jours avant », « la veille », « 2 h avant »). Un délai
   * fixe depuis la réservation ne peut pas le faire : un rendez-vous pris
   * trois semaines d'avance recevrait son « rappel de la veille » le
   * lendemain de la réservation. La date est RELUE à l'échéance : un
   * rendez-vous déplacé replanifie l'attente, un rendez-vous annulé arrête
   * le parcours, et un moment déjà passé (réservé 3 jours avant) mène à
   * `si_depasse` au lieu d'envoyer « dans une semaine » deux jours avant.
   */
  mode?: 'duree' | 'reponse' | 'avant_date';
  /**
   * Où aller si le client a répondu. Absent = le parcours s'arrête —
   * c'est le cas le plus fréquent : il a répondu, on ne relance plus.
   */
  si_reponse?: string | null;
  /** Mode `avant_date` : combien de secondes AVANT le début du rendez-vous. */
  secondes_avant?: number;
  /**
   * Mode `avant_date` : où aller si ce moment est déjà passé. Absent = le
   * parcours s'arrête. Typiquement l'attente du rappel suivant.
   */
  si_depasse?: string | null;
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
 * Les suites possibles d'une étape — TOUTES.
 *
 * Écrit une seule fois parce que deux listes divergentes seraient pires que
 * pas de vérification : une attente « jusqu'à réponse » porte DEUX suites
 * (`suivant` et `si_reponse`), et oublier la seconde laisserait passer un
 * renvoi cassé ou une boucle infinie — exactement ce que ces gardes
 * existent pour empêcher.
 */
function suitesDe(etape: Etape): Array<string | null | undefined> {
  if (etape.type === 'si') return [etape.alors, etape.sinon];
  if (etape.type === 'arreter') return [];
  if (etape.type === 'attendre') return [etape.suivant, etape.si_reponse, etape.si_depasse];
  return [(etape as EtapeAction).suivant];
}

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
    const cibles = suitesDe(etape);
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
    const suites = suitesDe(etape);
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

/**
 * Un rappel « avant la date » en retard de moins de 30 min part encore : le
 * décalage vient alors du tick de 5 min, pas d'une date dépassée. Même
 * tolérance que les rappels des règles simples (RETARD_TOLERE_MS du moteur).
 */
export const RETARD_TOLERE_AVANT_DATE_MS = 30 * 60 * 1000;

/**
 * Le début du rendez-vous visé par le parcours, relu en base.
 *
 * `annule` : le rendez-vous n'existe plus, est supprimé ou annulé — le
 * parcours n'a plus rien à rappeler. `debut` null sans annulation : pas de
 * date connue (entité qui n'est pas un rendez-vous) — le rappel est sauté.
 */
export async function debutRendezVous(
  supabase: SupabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<{ debut: number | null; annule: boolean }> {
  if (entityType !== 'schedule_event' && entityType !== 'appointment') return { debut: null, annule: false };
  const { data, error } = await supabase
    .from('schedule_events')
    .select('start_at, start_time, status, deleted_at')
    .eq('id', entityId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new Error(`lecture du rendez-vous : ${error.message}`);
  const r = data as { start_at?: string | null; start_time?: string | null; status?: string | null; deleted_at?: string | null } | null;
  if (!r || r.deleted_at || /cancel|annul/i.test(String(r.status ?? ''))) return { debut: null, annule: true };
  const d = r.start_at || r.start_time;
  return { debut: d ? Date.parse(d) : null, annule: false };
}

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

  /*
   * Traverser les attentes jusqu'à une étape exécutable.
   *
   * Une attente « jusqu'à réponse » ne se traverse PAS : elle doit devenir
   * une tâche à elle seule, pour que le worker vérifie à son échéance si le
   * client a répondu. La cumuler comme un simple délai ferait sauter la
   * vérification — l'attente se comporterait comme une attente ordinaire, et
   * le réglage ne servirait à rien.
   */
  while (courante && courante.type === 'attendre' && courante.mode !== 'reponse' && courante.mode !== 'avant_date') {
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

  let executeAtMs = Date.now() + delaiCumule * 1000;

  /*
   * Attente « avant la date » : la tâche est datée à partir du rendez-vous.
   * Moment déjà passé (ou pas de date) : on ne rappelle pas « dans une
   * semaine » deux jours avant — on suit `si_depasse`.
   */
  if (courante.type === 'attendre' && courante.mode === 'avant_date') {
    let rdv: { debut: number | null; annule: boolean };
    try {
      rdv = await debutRendezVous(ctx.supabase, ctx.orgId, ctx.entityType, ctx.entityId);
    } catch (e) {
      logger.error('[sequences] date du rendez-vous illisible — rappel sauté', {
        rule_id: ctx.ruleId, step_id: courante.id, message: e instanceof Error ? e.message : String(e),
      });
      rdv = { debut: null, annule: false };
    }
    if (rdv.annule) return null;
    const cible = rdv.debut === null ? null : rdv.debut - Math.max(0, courante.secondes_avant ?? 0) * 1000;
    if (cible === null || cible < Math.max(executeAtMs, Date.now()) - RETARD_TOLERE_AVANT_DATE_MS) {
      return planifierEtape(ctx, steps, courante.si_depasse ?? null);
    }
    executeAtMs = Math.max(executeAtMs, cible);
  }

  const executeAt = new Date(executeAtMs).toISOString();

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
      : {
        type: '__sequence__',
        etape: courante.type,
        // Le mode de l'attente voyage avec la tâche : sans lui, le worker ne
        // saurait pas qu'il doit vérifier la réponse du client à l'échéance.
        ...(courante.type === 'attendre' && courante.mode === 'reponse'
          ? { mode: 'reponse', si_reponse: courante.si_reponse ?? null, suivant: courante.suivant ?? null }
          : {}),
        ...(courante.type === 'attendre' && courante.mode === 'avant_date'
          ? { mode: 'avant_date', secondes_avant: courante.secondes_avant ?? 0, si_depasse: courante.si_depasse ?? null, suivant: courante.suivant ?? null }
          : {}),
        event_metadata: ctx.contexte,
      },
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
 * Une ATTENTE « X avant le rendez-vous », arrivée à échéance.
 *
 * La date est RELUE : entre la réservation et maintenant, le rendez-vous a pu
 * bouger ou être annulé.
 *   · annulé / supprimé → le parcours s'arrête ;
 *   · déplacé plus tard → l'attente est replanifiée à la bonne heure ;
 *   · moment dépassé (déplacé plus tôt) → `si_depasse` (on ne dit pas « dans
 *     une semaine » à quelqu'un qu'on voit demain) ;
 *   · sinon → le rappel qui suit.
 * Une lecture ratée LÈVE, pour que la tâche passe par la reprise normale.
 */
export async function echeanceAvantDate(
  supabase: SupabaseClient,
  task: {
    id: string; org_id: string; automation_rule_id: string; entity_type: string; entity_id: string;
    sequence_context?: Record<string, unknown> | null;
  },
  etape: EtapeAttendre,
  etapes: Etape[],
  maintenant: number = Date.now(),
): Promise<'annule' | 'replanifie' | 'depasse' | 'suite'> {
  const contexte = (task.sequence_context ?? {}) as Record<string, unknown>;
  const suite = (id: string | null | undefined) => planifierEtape(
    {
      supabase,
      orgId: task.org_id,
      ruleId: task.automation_rule_id,
      entityType: task.entity_type,
      entityId: task.entity_id,
      contexte,
      franchies: Number(contexte.franchies ?? 0),
    },
    etapes,
    id ?? null,
  );
  const terminer = async (note: string) => {
    const { error } = await supabase
      .from('automation_scheduled_tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString(), last_error: note })
      .eq('id', task.id);
    if (error) logger.error('[sequences] attente « avant la date » non close', { task_id: task.id, message: error.message });
  };

  const rdv = await debutRendezVous(supabase, task.org_id, task.entity_type, task.entity_id);
  const cible = rdv.debut === null ? null : rdv.debut - Math.max(0, etape.secondes_avant ?? 0) * 1000;

  if (rdv.annule) {
    await terminer('Rendez-vous annulé ou supprimé : le parcours s’arrête.');
    return 'annule';
  }
  if (cible !== null && cible > maintenant + 2 * 60_000) {
    const { error } = await supabase
      .from('automation_scheduled_tasks')
      .update({ status: 'pending', execute_at: new Date(cible).toISOString(), last_error: 'Rendez-vous déplacé : rappel replanifié.' })
      .eq('id', task.id);
    if (error) throw new Error(`replanification impossible : ${error.message}`);
    return 'replanifie';
  }
  if (cible === null || maintenant > cible + RETARD_TOLERE_AVANT_DATE_MS) {
    await suite(etape.si_depasse);
    await terminer('Moment du rappel dépassé : rappel sauté.');
    return 'depasse';
  }
  await suite(etape.suivant);
  await terminer('Moment atteint : le rappel a été planifié.');
  return 'suite';
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
