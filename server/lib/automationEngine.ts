/* ═══════════════════════════════════════════════════════════════
   Automation Engine — Event-driven rule executor.
   Listens to CRM events via the event bus, matches automation
   rules, schedules or executes actions.
   ═══════════════════════════════════════════════════════════════ */

import { SupabaseClient } from '@supabase/supabase-js';
import { eventBus, CRMEvent, CRMEventType } from './eventBus';
import {
  ActionContext,
  ActionType,
  executeAction,
  resolveEntityVariables,
} from './actions';
import { logger } from './logger';
import { conditionsChampsOk, CLE_CONDITIONS_CHAMPS } from './champs/automatisations';
import {
  type Etape,
  planifierEtape,
  trouverEtape,
  etapeSuivante,
  premiereEtape,
} from './automationSequences';
import { automatisationsActivesAvecTrace } from './automations-interrupteur';

interface AutomationRule {
  id: string;
  org_id: string;
  name: string;
  trigger_event: string;
  conditions: Record<string, any>;
  delay_seconds: number;
  actions: Array<{ type: ActionType; config: Record<string, any> }>;
  /**
   * Graphe d'étapes d'une SÉQUENCE. `null` sur une règle simple, qui continue
   * d'être pilotée par `delay_seconds` + `actions` exactement comme avant.
   */
  steps?: Etape[] | null;
  /**
   * Réglages propres à cette règle. `null` = les défauts du moteur, qui sont
   * bons : fenêtre 8h-20h, arrêt sur changement d'état. Personne n'a besoin
   * d'y toucher pour que ça marche.
   */
  settings?: ReglagesRegle | null;
  is_active: boolean;
  /** Portée pipeline (déclencheurs `deal.*`). `null` = toutes les étapes. */
  pipeline_id?: string | null;
  stage_id?: string | null;
}

/**
 * Une règle du pipeline s'applique-t-elle à CET événement ?
 *
 * `automation_rules` porte `pipeline_id` et `stage_id` depuis la migration
 * 20260923100100, mais le moteur ne les regardait pas : il ne filtrait que
 * sur l'organisation et le type d'événement. Une règle attachée à l'étape
 * « Contacté » se déclenchait donc à l'entrée dans N'IMPORTE quelle étape —
 * le choix d'étape dans l'interface n'aurait servi à rien.
 *
 * Une règle sans étape reste volontairement large : c'est la façon d'écrire
 * « à chaque changement d'étape, quelle qu'elle soit ». Et un événement qui
 * ne porte pas l'étape dans ses métadonnées passe : mieux vaut exécuter la
 * règle que de perdre l'action sans trace.
 */
export function regleViseCetEvenement(rule: AutomationRule, event: CRMEvent): boolean {
  if (!event.type.startsWith('deal.')) return true;
  const m = event.metadata ?? {};
  if (rule.pipeline_id && m.pipeline_id && rule.pipeline_id !== m.pipeline_id) return false;
  if (rule.stage_id && m.stage_id && rule.stage_id !== m.stage_id) return false;
  return true;
}

interface EngineConfig {
  supabase: SupabaseClient;
  twilio: { client: any; phoneNumber: string } | null;
  baseUrl: string;
}

let engineConfig: EngineConfig | null = null;

// ── Condition evaluator ─────────────────────────────────────

/**
 * Compare deux valeurs sans se laisser piéger par leur type.
 *
 * Les conditions sont stockées en jsonb et proviennent souvent d'un champ de
 * saisie : elles arrivent donc en CHAÎNE. Les métadonnées d'événement, elles,
 * portent le type réel — `days_overdue` et `amount_cents` sont des NOMBRES.
 * Avec une égalité stricte, `3 !== "3"` : la règle ne se déclenchait jamais,
 * et l'utilisateur n'avait aucun moyen de comprendre pourquoi (le moteur
 * passait au suivant en silence).
 *
 * On normalise donc en chaîne pour comparer, après avoir écarté `null` et
 * `undefined` — sinon `null` et la chaîne « null » deviendraient égaux.
 */
function memeValeur(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'object' || typeof b === 'object') return false;
  return String(a) === String(b);
}

/** Opérateurs que `evaluateConditions` sait évaluer. */
const OPERATEURS_CONNUS = ['eq', 'neq', 'in', 'not_in'];

function evaluateConditions(
  conditions: Record<string, any>,
  event: CRMEvent,
): boolean {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  // Simple condition matching against event metadata
  for (const [key, expected] of Object.entries(conditions)) {
    // Champs personnalisés : jugés à part, sur les valeurs actuelles
    // (conditionsChampsOk, asynchrone) — pas contre les métadonnées.
    if (key === CLE_CONDITIONS_CHAMPS) continue;
    const actual = event.metadata[key];

    // Support operators
    if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
      // Un opérateur inconnu était purement IGNORÉ : la condition passait pour
      // vraie et la règle s'exécutait sur tout. Une règle « si montant > 5000 »
      // partait donc pour n'importe quel montant — un faux positif, bien plus
      // dangereux qu'un blocage. On refuse désormais d'évaluer ce qu'on ne
      // comprend pas.
      const inconnus = Object.keys(expected).filter((op) => !OPERATEURS_CONNUS.includes(op));
      if (inconnus.length > 0) {
        console.warn(
          `[automationEngine] condition ignorée — opérateur(s) non supporté(s) sur « ${key} » : ${inconnus.join(', ')}`,
        );
        return false;
      }

      if ('eq' in expected && !memeValeur(actual, expected.eq)) return false;
      if ('neq' in expected && memeValeur(actual, expected.neq)) return false;
      if ('in' in expected && Array.isArray(expected.in)
        && !expected.in.some((v: unknown) => memeValeur(actual, v))) return false;
      if ('not_in' in expected && Array.isArray(expected.not_in)
        && expected.not_in.some((v: unknown) => memeValeur(actual, v))) return false;
    } else {
      // Direct equality
      if (!memeValeur(actual, expected)) return false;
    }
  }
  return true;
}

// ── Deduplication key builder ───────────────────────────────

// La clé NE DOIT PAS contenir la date : `idx_scheduled_tasks_dedup` est unique
// sur (org_id, execution_key) parmi les tâches pending/running, et c'est ce qui
// empêche de planifier deux fois la même action. Avec la date du jour, renvoyer
// le même devis le lendemain produisait une clé différente : les 5 relances
// déjà en attente restaient, 5 nouvelles s'ajoutaient, et le client recevait
// tout en double (constaté en prod : 10 tâches pending pour un seul devis).
function buildExecutionKey(ruleId: string, entityId: string, actionIndex: number): string {
  return `${ruleId}:${entityId}:${actionIndex}`;
}

// ── Quiet hours (SMS only) ──────────────────────────────────
// No automated text lands on a client's phone outside 08:00–19:59 local
// (Québec). Emails/notifications are unaffected — only SMS wakes people up.

const QUIET_TZ = 'America/Toronto';
const SEND_START_HOUR = 8;
const SEND_END_HOUR = 20; // exclusive — last send at 19:59

function localHour(d: Date): number {
  return parseInt(
    new Intl.DateTimeFormat('en-CA', { timeZone: QUIET_TZ, hour: '2-digit', hour12: false }).format(d),
    10,
  );
}

export interface ReglagesRegle {
  reentree?: boolean;
  arret_sur_reponse?: boolean;
  fenetre?: { debut: number; fin: number };
  jours_ouvrables?: boolean;
  marquer_lu?: boolean;
}

export function isQuietHours(d: Date = new Date()): boolean {
  const h = localHour(d);
  return h < SEND_START_HOUR || h >= SEND_END_HOUR;
}

/**
 * Hors de la fenêtre d'envoi de CETTE règle.
 *
 * Sans réglage, c'est la fenêtre commune (8 h-20 h) : le comportement d'une
 * automatisation qui n'a jamais été touchée ne change pas d'un iota.
 *
 * `jours_ouvrables` s'ajoute à l'heure : un message prêt le samedi attend
 * lundi matin. Utile pour les relances commerciales, pas pour un rappel de
 * rendez-vous — d'où le réglage par automatisation plutôt que global.
 */
export function horsFenetre(reglages: ReglagesRegle | null | undefined, d: Date = new Date()): boolean {
  const debut = reglages?.fenetre?.debut ?? SEND_START_HOUR;
  const fin = reglages?.fenetre?.fin ?? SEND_END_HOUR;
  const h = localHour(d);
  if (h < debut || h >= fin) return true;

  if (reglages?.jours_ouvrables) {
    // `getDay()` lit le fuseau du SERVEUR ; on passe par Intl pour rester
    // sur l'heure du Québec, comme le reste de la fenêtre.
    const jour = new Intl.DateTimeFormat('en-CA', { timeZone: QUIET_TZ, weekday: 'short' }).format(d);
    if (jour === 'Sat' || jour === 'Sun') return true;
  }
  return false;
}

/** Décalage UTC (en minutes) du fuseau local à cet instant — +/- selon l'heure avancée. */
function decalageLocalMin(t: number): number {
  const d = new Date(t);
  // Une date formatée dans le fuseau cible, relue comme si elle était UTC :
  // l'écart avec l'instant d'origine EST le décalage.
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: QUIET_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => (a[x.type] = x.value, a), {});
  const commeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((commeUtc - d.getTime()) / 60000);
}

/**
 * Cale un rappel sur l'HEURE LOCALE voulue, même à cheval sur un changement
 * d'heure.
 *
 * Un « rappel 7 jours avant » se calcule en 604 800 secondes absolues. Si le
 * retour à l'heure normale tombe entre les deux, l'heure locale glisse d'une
 * heure : un rendez-vous à 10 h donnait un rappel à 11 h. Mesuré sur le cas
 * réel du 1er novembre 2026.
 *
 * On compare le décalage UTC aux deux instants et on rattrape la différence.
 * Rien à faire le reste de l'année : les deux décalages sont égaux, la
 * correction vaut zéro.
 */
function corrigerChangementDHeure(reference: number, cible: number): number {
  const ecart = decalageLocalMin(reference) - decalageLocalMin(cible);
  return ecart === 0 ? cible : cible + ecart * 60000;
}

/**
 * Cette action doit-elle respecter la fenêtre 8h–20h ?
 *
 * Les SMS, toujours. Les courriels, seulement quand ils sont COMMERCIAUX.
 *
 * Le critère est le délai de la règle, et non une liste de déclencheurs à
 * maintenir : un message immédiat est une confirmation que le destinataire
 * attend (« rendez-vous confirmé », « dépôt reçu ») — le retarder jusqu'à 8h
 * lui ferait croire que sa demande n'est pas passée. Un message différé est
 * une relance ou un suivi : rien ne justifie qu'il parte à 3h du matin.
 *
 * Corrige aussi une incohérence visible : une règle envoyant SMS + courriel
 * voyait ses deux moitiés partir à des heures différentes, le SMS étant seul
 * reporté.
 */
function shouldRespectQuietHours(actionType: string, delaySeconds: number): boolean {
  if (actionType === 'send_sms') return true;
  if (actionType !== 'send_email') return false;
  // Délai non nul (positif OU négatif, comme les rappels « X h avant ») =
  // message programmé, donc pas une confirmation attendue dans l'instant.
  return delaySeconds !== 0;
}

/** Next moment inside the send window, stepping 30 min (DST-safe, no tz lib). */
export function nextSendTime(from: Date = new Date(), reglages?: ReglagesRegle | null): Date {
  const next = new Date(from);
  // 48 pas de 30 min = 24 h. Avec `jours_ouvrables`, un message prêt le
  // samedi doit pouvoir attendre jusqu'à lundi : on va jusqu'à 3 jours.
  const pasMax = reglages?.jours_ouvrables ? 144 : 48;
  for (let i = 0; i < pasMax; i++) {
    next.setTime(next.getTime() + 30 * 60 * 1000);
    if (!horsFenetre(reglages, next)) return next;
  }
  return from;
}

// ── Execute actions for a rule ──────────────────────────────

/**
 * Langue des communications automatiques de l'org (company_settings.
 * default_language). Défaut 'fr' si absent/erreur — jamais bloquant.
 */
async function langueOrg(supabase: SupabaseClient, orgId: string): Promise<'fr' | 'en'> {
  try {
    const { data } = await supabase
      .from('company_settings')
      .select('default_language')
      .eq('org_id', orgId)
      .maybeSingle();
    return data?.default_language === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
}

async function executeRuleActions(
  rule: AutomationRule,
  event: CRMEvent,
  config: EngineConfig,
) {
  const vars = await resolveEntityVariables(
    config.supabase,
    event.orgId,
    event.entityType,
    event.entityId,
  );

  const ctx: ActionContext = {
    supabase: config.supabase,
    orgId: event.orgId,
    entityType: event.entityType,
    entityId: event.entityId,
    twilio: config.twilio,
    baseUrl: config.baseUrl,
    langue: await langueOrg(config.supabase, event.orgId),
    ruleId: rule.id,
  };

  for (let i = 0; i < rule.actions.length; i++) {
    const action = rule.actions[i];
    const executionKey = buildExecutionKey(rule.id, event.entityId, i);

    // Reporte à la prochaine fenêtre d'envoi les actions déclenchées en heures
    // calmes. Une règle immédiate (délai 0) porte une confirmation attendue :
    // seuls ses SMS sont reportés, jamais ses courriels.
    if (shouldRespectQuietHours(action.type, rule.delay_seconds) && horsFenetre(rule.settings)) {
      // supabase-js ne lève jamais : l'erreur (dont le doublon 23505) arrive
      // dans la réponse, pas dans un catch.
      const { error: deferError } = await config.supabase.from('automation_scheduled_tasks').insert({
        org_id: event.orgId,
        automation_rule_id: rule.id,
        entity_type: event.entityType,
        entity_id: event.entityId,
        action_config: { ...action, trigger_event: event.type, event_metadata: event.metadata },
        execute_at: nextSendTime(new Date(), rule.settings).toISOString(),
        status: 'pending',
        execution_key: executionKey,
      });
      if (deferError) {
        if (deferError.code !== '23505') {
          console.error(`[automationEngine] failed to defer quiet-hours SMS (rule ${rule.id}, org ${event.orgId}):`, deferError.message);
        }
      } else {
        logger.info(`[automationEngine] ${action.type} deferred to send window (quiet hours) for rule "${rule.name}"`);
      }
      continue;
    }

    const startTime = Date.now();

    try {
      const result = await executeAction(action.type, action.config, vars, ctx);
      const durationMs = Date.now() - startTime;

      // Log execution
      const { error: logError } = await config.supabase.from('automation_execution_logs').insert({
        org_id: event.orgId,
        automation_rule_id: rule.id,
        trigger_event: event.type,
        entity_type: event.entityType,
        entity_id: event.entityId,
        action_type: action.type,
        action_config: action.config,
        result_success: result.success,
        result_data: result.data || null,
        result_error: result.error || null,
        duration_ms: durationMs,
      });
      if (logError) {
        console.error(`[automationEngine] failed to write execution log (rule ${rule.id}, org ${event.orgId}):`, logError.message);
      }

      if (!result.success) {
        console.error(`[automationEngine] action ${action.type} failed for rule "${rule.name}":`, result.error);
      }
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      console.error(`[automationEngine] action ${action.type} threw for rule "${rule.name}":`, err.message);

      const { error: logError } = await config.supabase.from('automation_execution_logs').insert({
        org_id: event.orgId,
        automation_rule_id: rule.id,
        trigger_event: event.type,
        entity_type: event.entityType,
        entity_id: event.entityId,
        action_type: action.type,
        action_config: action.config,
        result_success: false,
        result_error: err.message,
        duration_ms: durationMs,
      });
      if (logError) {
        console.error(`[automationEngine] failed to write failure log (rule ${rule.id}, org ${event.orgId}):`, logError.message);
      }
    }
  }
}

// ── Resolve execution time ──────────────────────────────────

/**
 * Tolérance avant d'abandonner un rappel dont l'heure est déjà passée.
 *
 * Un rappel « la veille » calculé avec 20 minutes de retard reste pertinent ;
 * le même rappel calculé 3 jours trop tard ne l'est plus.
 */
const RETARD_TOLERE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Calcule le moment d'exécution d'une action différée.
 *
 * Retourne `null` quand la tâche doit être ABANDONNÉE plutôt que planifiée.
 *
 * Auparavant, un rappel dont l'heure était déjà passée était exécuté « dans
 * 5 secondes ». Concrètement : créer aujourd'hui un rendez-vous pour DEMAIN
 * déclenchait immédiatement le rappel « J-7 », et le client recevait dans la
 * seconde « votre rendez-vous est dans une semaine » — alors qu'il est demain.
 * Un message factuellement faux, sur le cas le plus courant qui soit (la prise
 * de rendez-vous à court terme).
 *
 * On garde une tolérance : un rappel légèrement en retard part quand même,
 * parce que le décalage vient alors du tick de 5 minutes, pas d'une erreur de
 * cadence.
 */
async function resolveExecuteAt(
  rule: AutomationRule,
  event: CRMEvent,
  config: EngineConfig,
): Promise<Date | null> {
  // Negative delay = "X seconds before the event's reference time"
  // Used for appointment reminders (e.g., -86400 = 1 day before start_time)
  if (rule.delay_seconds < 0 && (event.entityType === 'schedule_event' || event.entityType === 'appointment')) {
    const { data: evt, error } = await config.supabase
      .from('schedule_events')
      .select('start_at, start_time')
      .eq('id', event.entityId)
      .eq('org_id', event.orgId)
      .maybeSingle();

    // Une erreur de lecture ne doit pas être confondue avec « pas de date » :
    // sans ce garde, on retombait sur le délai positif ci-dessous et le rappel
    // « 1 semaine avant » partait 1 semaine APRÈS la création du rendez-vous.
    if (error) {
      console.error(`[automationEngine] lecture de schedule_events échouée (rule ${rule.id}):`, error.message);
      return null;
    }

    const startField = evt?.start_at || evt?.start_time;
    if (startField) {
      const eventTime = new Date(startField).getTime();
      const executeAt = new Date(
        corrigerChangementDHeure(eventTime, eventTime + rule.delay_seconds * 1000),
      );
      const retard = Date.now() - executeAt.getTime();

      if (retard > RETARD_TOLERE_MS) {
        // Le créneau du rappel est franchement dépassé : l'envoyer dirait au
        // client quelque chose de faux.
        logger.info(
          `[automationEngine] rappel abandonné (créneau dépassé de ${Math.round(retard / 60000)} min) — règle "${rule.name}"`,
        );
        return null;
      }
      if (retard > 0) {
        // Léger retard (tick de 5 min) : on part tout de suite, le message
        // reste juste.
        return new Date(Date.now() + 5000);
      }
      return executeAt;
    }
  }

  // Normal positive delay from now
  return new Date(Date.now() + Math.abs(rule.delay_seconds) * 1000);
}

// ── Schedule delayed actions ────────────────────────────────

async function scheduleDelayedActions(
  rule: AutomationRule,
  event: CRMEvent,
  config: EngineConfig,
) {
  const executeAt = await resolveExecuteAt(rule, event, config);

  // `null` = créneau dépassé ou date de référence illisible : on ne planifie
  // rien plutôt que d'envoyer un rappel devenu faux.
  if (!executeAt) return;

  for (let i = 0; i < rule.actions.length; i++) {
    const action = rule.actions[i];
    const executionKey = buildExecutionKey(rule.id, event.entityId, i);

    // supabase-js ne lève jamais : le doublon (23505) comme toute autre erreur
    // se lit dans la réponse — un catch ici n'aurait jamais rien attrapé.
    const { error: insertError } = await config.supabase.from('automation_scheduled_tasks').insert({
      org_id: event.orgId,
      automation_rule_id: rule.id,
      entity_type: event.entityType,
      entity_id: event.entityId,
      action_config: { ...action, trigger_event: event.type, event_metadata: event.metadata },
      execute_at: executeAt.toISOString(),
      status: 'pending',
      execution_key: executionKey,
    });
    if (insertError) {
      // Unique constraint violation = duplicate, skip
      if (insertError.code === '23505') {
        logger.info(`[automationEngine] skipped duplicate scheduled task: ${executionKey}`);
      } else {
        console.error(`[automationEngine] failed to schedule task (rule ${rule.id}, org ${event.orgId}):`, insertError.message);
      }
    }
  }
}

// ── Event handler ───────────────────────────────────────────


// ── Convert delay_value + delay_unit to seconds ───────────
function delayToSeconds(value: number, unit: string): number {
  if (unit === 'immediate' || value <= 0) return 0;
  if (unit === 'minutes') return value * 60;
  if (unit === 'hours') return value * 3600;
  if (unit === 'days') return value * 86400;
  return 0;
}

async function handleEvent(event: CRMEvent) {
  if (!engineConfig) return;
  // Interrupteur d'arrêt (F6) : avant TOUTE lecture. L'événement est
  // simplement ignoré — rien n'est planifié, rien n'est journalisé comme
  // échec. Ce qui était déjà en file y reste.
  if (!automatisationsActivesAvecTrace()) return;

  try {
    // ── 1. Match automation_rules (legacy system) ──
    // L'ordre est EXPLICITE : sans `order by`, PostgreSQL n'en garantit aucun.
    // Deux règles sur le même événement — « confirmer » puis « prévenir
    // l'équipe » — pouvaient s'exécuter dans un ordre différent d'un appel à
    // l'autre, et un bug qui n'apparaît qu'une fois sur deux est le plus long
    // à diagnostiquer. `created_at` d'abord (la plus ancienne règle en
    // premier), `id` pour départager deux règles créées dans la même
    // milliseconde — un seeder en insère plusieurs d'un coup.
    const { data: rules, error } = await engineConfig.supabase
      .from('automation_rules')
      .select('*')
      .eq('org_id', event.orgId)
      .eq('trigger_event', event.type)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      console.error('[automationEngine] failed to fetch rules:', error.message);
    }

    if (rules && rules.length > 0) {
      for (const rule of rules as AutomationRule[]) {
        /**
         * Chaque règle est isolée. Sans ce try, une seule règle qui lève —
         * une lecture qui explose, un gabarit malformé — sortait de la boucle
         * par le catch global et TOUTES les règles suivantes du même
         * événement étaient sautées, sans trace individuelle. Une règle
         * cassée dans une org pouvait ainsi faire taire ses confirmations de
         * rendez-vous, et rien ne disait laquelle.
         */
        try {
        if (!regleViseCetEvenement(rule, event)) continue;
        if (!evaluateConditions(rule.conditions, event)) continue;
        if (!(await conditionsChampsOk(engineConfig.supabase, event.orgId, event.entityType, event.entityId,
          rule.conditions?.[CLE_CONDITIONS_CHAMPS]))) continue;
        // Une SÉQUENCE se parcourt étape par étape : on ne planifie que la
        // première, chacune ouvrant la suivante une fois faite. Rien n'est
        // planifié d'avance, pour qu'une branche « si » soit évaluée sur
        // l'état du devis AU MOMENT où on y arrive, pas sur celui d'il y a
        // trois jours.
        if (Array.isArray(rule.steps) && rule.steps.length > 0) {
          const debut = premiereEtape(rule.steps);
          if (debut) {
            await planifierEtape(
              {
                supabase: engineConfig.supabase,
                orgId: event.orgId,
                ruleId: rule.id,
                entityType: event.entityType,
                entityId: event.entityId,
                contexte: event.metadata ?? {},
                franchies: 0,
              },
              rule.steps,
              debut.id,
            );
          }
          continue;
        }
        if (rule.delay_seconds !== 0) {
          await scheduleDelayedActions(rule, event, engineConfig);
        } else if (event.metadata?.suppress_immediate) {
          // Visite créée en lot (plan de service, job multi-visites) : seule la
          // PREMIÈRE visite déclenche la confirmation immédiate — sans ce
          // garde, un plan de 10 visites envoyait 10 confirmations d'un coup
          // au client. Les rappels datés (délai négatif) ne sont pas touchés :
          // ils passent par scheduleDelayedActions ci-dessus et restent calés
          // sur la date de CHAQUE visite.
          logger.info(`[automationEngine] confirmation immédiate supprimée (visite en lot) — règle "${rule.name}"`);
        } else {
          await executeRuleActions(rule, event, engineConfig);
        }
        } catch (err: any) {
          // On nomme la règle fautive : « une automatisation a planté » sans
          // dire laquelle n'aide personne à la réparer.
          console.error(
            `[automationEngine] règle "${rule.name}" (${rule.id}) a échoué sur ${event.type} — les autres règles continuent :`,
            err?.message || err,
          );
        }
      }
    }

    // Le second système d'automatisations (table `workflows`, constructeur
    // visuel) a été retiré : aucune interface ne permettait d'en créer, les
    // 31 lignes existantes vivaient dans une seule org et n'ont jamais été
    // exécutées (`workflow_runs` vide). Leur planification différée violait de
    // surcroît une clé étrangère — `automation_scheduled_tasks.automation_rule_id`
    // pointe vers `automation_rules`, pas vers `workflows`.
    //
    // Les automatisations du produit vivent dans `automation_rules`, traitées
    // juste au-dessus.

  } catch (err: any) {
    console.error('[automationEngine] error handling event:', err.message);
  }
}

// ── Scheduled task processor (called by scheduler) ──────────

/** Nombre maximal de tentatives pour une tâche planifiée (1 initiale + 3 reprises). */
const MAX_TASK_ATTEMPTS = 4;

/**
 * Délai maximal accordé à UNE action avant de la considérer perdue.
 *
 * Le tick traite les tâches en série : sans limite, un fournisseur qui ne
 * répond pas (Twilio ou SMTP muet, connexion à moitié ouverte) suspend la
 * boucle entière — aucune autre tâche de la file n'est traitée, pour
 * personne, tant qu'il n'a pas rendu la main. Une seule org en panne gelait
 * ainsi les automatisations de toutes les autres.
 *
 * 5 s : un envoi normal prend moins d'une seconde ; au-delà de cinq, il
 * n'est plus « lent », il est perdu. L'échec est transitoire au sens de
 * `isTransientFailure`, donc la tâche repart en reprise (5 min, 30 min, 2 h)
 * plutôt que d'être abandonnée — rien n'est jeté.
 */
const DELAI_MAX_ACTION_MS = 5_000;

/**
 * La promesse, ou un échec au bout de `delaiMs`.
 *
 * Le travail sous-jacent n'est PAS annulé — on ne peut pas rappeler un appel
 * HTTP déjà parti. On cesse seulement de l'attendre : c'est exactement ce
 * qu'il faut, puisque le but est de libérer le tick, pas de garantir que
 * rien n'est parti (la reprise et l'idempotence s'en chargent).
 */
async function avecDelaiMax<T>(promesse: Promise<T>, delaiMs: number, message: string): Promise<T> {
  let minuterie: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promesse,
      new Promise<never>((_, rejeter) => {
        minuterie = setTimeout(() => rejeter(new Error(message)), delaiMs);
      }),
    ]);
  } finally {
    // Sans ce nettoyage, la minuterie garde le processus éveillé jusqu'à son
    // terme — 20 s de retard à chaque arrêt du serveur.
    if (minuterie) clearTimeout(minuterie);
  }
}

/**
 * Un échec est-il réessayable ?
 *
 * Distinction volontaire : une panne SMTP passagère mérite une reprise, un
 * client sans adresse courriel n'en méritera jamais — le réessayer trois fois
 * ne ferait que retarder l'inévitable et polluer les journaux.
 */
function isTransientFailure(error?: string | null): boolean {
  if (!error) return true; // cause inconnue → on laisse sa chance à la reprise
  const definitifs = [
    'no recipient',           // pas d'adresse / pas de téléphone
    'not configured',         // SMTP ou Twilio absent (config, pas incident)
    'opted out',              // désabonnement : ne jamais réessayer
    'plan does not include',  // forfait insuffisant
    'are disabled',           // fonctionnalité désactivée dans les réglages
    'frequency cap',          // plafond atteint : le retenter donnerait le même refus
    // Consentement manquant (LCAP) : rien ne changera dans les 2 h qui
    // suivent — la base légale se saisit à la main sur la fiche du client.
    // Réessayer quatre fois ne fait que retarder la notification qui
    // apprendra à l'entrepreneur qu'il doit agir.
    'consentement',
    'consent',
  ];
  const lower = error.toLowerCase();
  return !definitifs.some((d) => lower.includes(d));
}

/**
 * Détermine l'état suivant d'une tâche qui vient d'échouer.
 *
 * Sans cette logique, une tâche échouée passait en `failed` définitif : le
 * fetch ne sélectionne que les `pending`, donc elle n'était PLUS JAMAIS
 * reprise. Le compteur `attempts` était bien incrémenté, mais jamais relu.
 * Résultat mesuré en prod : 8 tâches perdues, dont 6 relances par courriel
 * tombées sur un « SMTP not configured » passager.
 *
 * Reprise à délai croissant (5 min, 30 min, 2 h) pour laisser le temps à un
 * service externe de se rétablir sans marteler la file.
 */
/**
 * Prévient l'entreprise qu'un message automatique n'est JAMAIS parti.
 *
 * Sans ça, un échec définitif ne laissait qu'une ligne dans les journaux du
 * serveur : le client ne recevait pas sa confirmation, et l'entrepreneur ne
 * l'apprenait jamais — ni le jour même, ni plus tard. C'est le pire des
 * silences, parce qu'il donne l'illusion que tout fonctionne.
 *
 * Ne lève jamais : une notification perdue ne doit pas empêcher de marquer la
 * tâche comme terminée, sinon elle resterait `running` pour toujours.
 */
async function prevenirEchecDefinitif(
  supabase: SupabaseClient,
  task: { id: string; org_id: string; action_config?: { type?: string } | null; automation_rules?: { name?: string } | null },
  motif: string | null | undefined,
): Promise<void> {
  try {
    const nom = task.automation_rules?.name || 'Automatisation';
    const canal = task.action_config?.type === 'send_sms' ? 'texto'
      : task.action_config?.type === 'send_email' ? 'courriel'
      : 'message';
    /**
     * Le motif est TRADUIT, jamais l'erreur brute : « No recipient phone » ne
     * dit rien à un entrepreneur, « ce client n'a pas de numéro » lui dit quoi
     * faire. Une cause inconnue reste affichée telle quelle plutôt que
     * masquée — mieux vaut un message technique qu'un silence.
     */
    const brut = (motif || '').toLowerCase();
    const cause = brut.includes('no recipient phone') ? 'ce client n\'a pas de numéro de téléphone'
      : brut.includes('no recipient email') ? 'ce client n\'a pas d\'adresse courriel'
      : brut.includes('opted out') ? 'ce client s\'est désabonné'
      : brut.includes('not configured') ? 'l\'envoi n\'est pas configuré dans les réglages'
      : brut.includes('frequency cap') ? 'la limite de messages pour ce client est atteinte'
      : brut.includes('consentement') ? 'le consentement de ce client n\'est pas enregistré'
      : (motif || 'cause inconnue');

    const { error } = await supabase.from('notifications').insert({
      org_id: task.org_id,
      type: 'automation_failed',
      title: `Échec d'envoi — ${nom}`,
      body: `Le ${canal} n'est pas parti et ne partira pas : ${cause}.`,
      reference_id: task.id,
    });
    if (error) throw new Error(error.message);
  } catch (e: any) {
    console.error(`[automationEngine] notification d'échec non créée (tâche ${task.id}) :`, e?.message || e);
  }
}

function nextStateAfterFailure(
  attempts: number,
  error?: string | null,
): Record<string, unknown> {
  const dejaTentees = Number(attempts || 0) + 1; // `attempts` a été incrémenté à la prise
  const peutReessayer = dejaTentees < MAX_TASK_ATTEMPTS && isTransientFailure(error);

  if (!peutReessayer) {
    return {
      status: 'failed',
      completed_at: new Date().toISOString(),
      last_error: error || null,
    };
  }

  const delaisMinutes = [5, 30, 120];
  const attente = delaisMinutes[Math.min(dejaTentees - 1, delaisMinutes.length - 1)];
  return {
    status: 'pending',
    execute_at: new Date(Date.now() + attente * 60_000).toISOString(),
    last_error: `${error || 'échec'} — reprise ${dejaTentees}/${MAX_TASK_ATTEMPTS} dans ${attente} min`,
  };
}

/**
 * Délai au-delà duquel une tâche « en cours » est considérée comme abandonnée.
 *
 * Large volontairement : une action lente (SMTP poussif, Twilio qui traîne)
 * doit pouvoir finir sans être reprise en parallèle.
 */
const TACHE_FIGEE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Remet en file les tâches restées « en cours » après un arrêt brutal.
 *
 * Une tâche passe en `running` avant son exécution. Si le processus meurt
 * entre les deux — déploiement, plantage, mémoire épuisée — la ligne reste
 * `running` pour toujours :
 *   · le fetch ne sélectionne que les `pending`, donc elle n'est jamais
 *     reprise ;
 *   · l'index d'unicité couvre `running`, donc sa clé reste occupée et cette
 *     action ne peut PLUS JAMAIS être replanifiée pour cette entité.
 *
 * Chaque déploiement pendant un tick perdait ainsi quelques relances et
 * rendait l'entité concernée sourde pour cette règle.
 */
async function recupererTachesFigees(supabase: SupabaseClient): Promise<void> {
  const limite = new Date(Date.now() - TACHE_FIGEE_MS).toISOString();
  const { data, error } = await supabase
    .from('automation_scheduled_tasks')
    .update({ status: 'pending', execute_at: new Date().toISOString() })
    .eq('status', 'running')
    // `updated_at` N'EXISTE PAS sur cette table (colonnes vérifiées en base).
    // Avec PostgREST, une seule colonne inconnue fait échouer TOUTE la requête
    // — et supabase-js ne lève pas : la récupération des tâches figées ne
    // faisait donc jamais rien, en silence. `execute_at` est réécrit au moment
    // où la tâche est réclamée, il date bien le début du blocage.
    .lt('execute_at', limite)
    .select('id');

  if (error) {
    console.error('[automationEngine] récupération des tâches figées échouée:', error.message);
    return;
  }
  if (data && data.length > 0) {
    console.warn(`[automationEngine] ${data.length} tâche(s) figée(s) remise(s) en file (arrêt brutal détecté)`);
  }
}

export async function processScheduledTasks(supabase: SupabaseClient) {
  if (!engineConfig) return;
  // Interrupteur d'arrêt (F6) : AVANT la récupération des tâches figées.
  // Remettre des tâches en file serait déjà y toucher, et l'arrêt doit
  // laisser la file exactement dans l'état où il l'a trouvée.
  if (!automatisationsActivesAvecTrace()) return;

  // Avant tout : libérer ce qu'un arrêt brutal aurait laissé coincé.
  await recupererTachesFigees(supabase);

  const now = new Date().toISOString();

  // Fetch pending tasks that are ready
  const { data: tasks, error } = await supabase
    .from('automation_scheduled_tasks')
    // Clé étrangère nommée explicitement — même cause que dans
    // recurringJobScheduler : depuis 20260751100200, automation_scheduled_tasks
    // a deux clés vers automation_rules (l'originale, et la composite
    // (org_id, automation_rule_id) qui porte l'isolation multi-tenant).
    // PostgREST répondait PGRST201 et AUCUNE tâche d'automatisation planifiée
    // n'était plus exécutée.
    .select('*, automation_rules!automation_scheduled_tasks_automation_rule_id_fkey(name, actions, conditions, steps, settings)')
    .eq('status', 'pending')
    .lte('execute_at', now)
    .order('execute_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[automationEngine] failed to fetch scheduled tasks:', error.message);
    return;
  }
  if (!tasks || tasks.length === 0) return;

  for (const task of tasks as any[]) {
    // Heures calmes : on repousse à la prochaine fenêtre sans consommer de
    // tentative. Toute tâche présente ici est par construction DIFFÉRÉE (une
    // action immédiate s'exécute en direct, sans passer par cette file) : elle
    // porte donc une relance ou un suivi, jamais une confirmation attendue.
    // Les deux canaux sont concernés — auparavant seuls les SMS l'étaient, et
    // un courriel de relance pouvait partir à 3h du matin.
    const taskType = task.action_config?.type;
    const reglagesRegle = (task.automation_rules?.settings ?? null) as ReglagesRegle | null;
    if ((taskType === 'send_sms' || taskType === 'send_email') && horsFenetre(reglagesRegle)) {
      const prochaine = nextSendTime(new Date(), reglagesRegle);

      /**
       * Un rappel « X h avant » que le report ferait tomber APRÈS son objet
       * n'a plus rien à rappeler : on l'annule au lieu de l'envoyer en retard.
       *
       * Le cas : rendez-vous à 7 h, rappel « 2 h avant » donc à 5 h — en
       * pleine plage calme. Repoussé à 8 h, il arrivait UNE HEURE APRÈS le
       * rendez-vous, avec un texte du genre « votre rendez-vous est dans
       * 2 heures » alors que le technicien était déjà passé. Pire qu'un
       * silence : le client doute de ce qu'il a lu.
       */
      const reference = task.action_config?.event_metadata?.start_time
        ?? task.action_config?.event_metadata?.start_at;
      const momentPrevu = reference ? new Date(String(reference)).getTime() : NaN;
      if (Number.isFinite(momentPrevu) && prochaine.getTime() > momentPrevu) {
        const { error: cancelError } = await supabase
          .from('automation_scheduled_tasks')
          // `execute_at` est conservé tel quel : il dit QUAND le rappel aurait
          // dû partir, ce qu'on veut encore savoir en relisant une tâche
          // annulée. L'écraser avec la fenêtre reportée raconterait l'inverse.
          .update({ status: 'cancelled', completed_at: new Date().toISOString(), execute_at: task.execute_at, last_error: 'rappel périmé : la fenêtre d\'envoi tombe après le rendez-vous' })
          .eq('id', task.id);
        if (cancelError) {
          console.error(`[automationEngine] failed to cancel stale reminder ${task.id}:`, cancelError.message);
        } else {
          logger.info(`[automationEngine] rappel annulé — la prochaine fenêtre d'envoi (${prochaine.toISOString()}) tombe après le rendez-vous`);
        }
        continue;
      }

      const { error: pushError } = await supabase
        .from('automation_scheduled_tasks')
        .update({ execute_at: prochaine.toISOString() })
        .eq('id', task.id);
      if (pushError) {
        console.error(`[automationEngine] failed to push task ${task.id} out of quiet hours:`, pushError.message);
      }
      continue;
    }

    // Mark as running. Si la prise n'est pas persistée, la tâche reste
    // 'pending' et serait ré-exécutée au tour suivant — on la saute plutôt
    // que d'envoyer deux fois la même action.
    const { data: claimed, error: claimError } = await supabase
      .from('automation_scheduled_tasks')
      // `execute_at` est réécrit à l'instant de la prise : la table n'a pas de
      // colonne `updated_at`, et c'est cet horodatage qui permet de repérer
      // une tâche restée `running` après un arrêt brutal (cf.
      // `recupererTachesFigees`). Sans lui, la détection n'aurait aucun repère
      // temporel.
      //
      // Le filtre `.eq('status','pending')` rend la prise atomique : avec deux
      // instances du serveur, une seule voit sa mise à jour aboutir, l'autre
      // touche 0 ligne et passe son tour. Sans lui, les deux réussissaient et
      // exécutaient l'action — le client recevait le message en double.
      .update({ status: 'running', attempts: task.attempts + 1, execute_at: new Date().toISOString() })
      .eq('id', task.id)
      .eq('status', 'pending')
      .select('id');
    if (claimError) {
      console.error(`[automationEngine] failed to claim scheduled task ${task.id}:`, claimError.message);
      continue;
    }
    // Zéro ligne touchée = une autre instance (ou un tick qui se chevauche) a
    // pris la tâche entre le fetch et l'update. On la lui laisse.
    if (!claimed || claimed.length === 0) continue;

    try {
      const actionConfig = task.action_config;
      const actionType = actionConfig.type as ActionType;
      const config = actionConfig.config || {};

      // Check stop conditions before executing
      const shouldStop = await checkStopConditions(
        supabase,
        task.entity_type,
        task.entity_id,
        // L'org de la TÂCHE, jamais celle de l'entité lue : c'est ce qui
        // empêche une tâche d'une org de conclure sur les données d'une autre.
        task.org_id,
        actionConfig.trigger_event,
        actionConfig.event_metadata,
      );

      /*
       * « Arrêter quand le client répond » — le réglage `arret_sur_reponse`.
       *
       * Vérifié APRÈS les conditions d'arrêt métier et seulement pour les
       * actions qui PARLENT au client : annuler une tâche interne (note,
       * étiquette) parce que le client a écrit n'aurait aucun sens.
       *
       * On remonte au client par les variables déjà résolues plus bas —
       * mais elles ne le sont qu'après ce point, donc on relit l'entité ici,
       * par le même chemin que les actions (`clientDeLEntite` vit côté
       * actions ; on refait la résolution minimale nécessaire).
       */
      let stopReponse = false;
      if (!shouldStop && reglagesRegle?.arret_sur_reponse
          && (taskType === 'send_sms' || taskType === 'send_email' || taskType === 'request_review')) {
        const clientId = await clientDeLaTache(supabase, task.org_id, task.entity_type, task.entity_id);
        stopReponse = await clientARepondu(supabase, task.org_id, clientId, task.created_at);
      }

      if (shouldStop || stopReponse) {
        const { error: cancelError } = await supabase
          .from('automation_scheduled_tasks')
          .update({
            status: 'cancelled',
            completed_at: now,
            // La RAISON, lisible dans l'onglet Journaux : « annulée » sans
            // explication est la plainte n°1 sur ce genre d'écran.
            last_error: stopReponse
              ? 'Annulée : le client a répondu.'
              : 'Annulée : la condition d’arrêt de la règle est remplie.',
          })
          .eq('id', task.id);
        if (cancelError) {
          console.error(`[automationEngine] failed to cancel scheduled task ${task.id}:`, cancelError.message);
        }
        continue;
      }

      // ── Séquence : une étape « si » ne s'exécute pas, elle décide ──
      //
      // Elle est traitée AVANT toute exécution : il n'y a rien à envoyer, il
      // y a une branche à choisir. Et elle est évaluée MAINTENANT, contre
      // l'état actuel de l'entité — c'est tout l'intérêt de ne rien planifier
      // d'avance : « si le devis est toujours sans réponse » se juge au
      // moment où on y arrive, pas trois jours plus tôt.
      const etapesRegle = (task.automation_rules?.steps ?? null) as Etape[] | null;
      if (task.step_id && Array.isArray(etapesRegle)) {
        const etape = trouverEtape(etapesRegle, task.step_id);
        if (etape && etape.type === 'si') {
          const contexte = (task.sequence_context ?? {}) as Record<string, unknown>;
          // On réutilise l'évaluateur des règles simples : mêmes opérateurs,
          // même sémantique. Deux moteurs de conditions divergeraient.
          const verdict = evaluateConditions(etape.conditions as Record<string, any>, {
            type: actionConfig.trigger_event,
            orgId: task.org_id,
            entityType: task.entity_type,
            entityId: task.entity_id,
            metadata: await metadonneesFraiches(supabase, task, contexte),
          } as CRMEvent)
            && await conditionsChampsOk(supabase, task.org_id, task.entity_type, task.entity_id,
              (etape.conditions as Record<string, unknown> | undefined)?.[CLE_CONDITIONS_CHAMPS]);

          await planifierEtape(
            {
              supabase,
              orgId: task.org_id,
              ruleId: task.automation_rule_id,
              entityType: task.entity_type,
              entityId: task.entity_id,
              contexte,
              franchies: Number(contexte.franchies ?? 0),
            },
            etapesRegle,
            etapeSuivante(etape, verdict),
          );

          await supabase
            .from('automation_scheduled_tasks')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', task.id);
          logger.info(`[sequences] branche « ${verdict ? 'alors' : 'sinon' } » suivie`, {
            rule_id: task.automation_rule_id, step_id: task.step_id,
          });
          continue;
        }

        /*
         * Une ATTENTE « jusqu'à réponse du client », arrivée à échéance.
         *
         * Le délai est le PLAFOND : « attends sa réponse, au plus 3 jours ».
         * À l'échéance, deux cas :
         *   · il a répondu → on suit `si_reponse` (souvent rien : il a
         *     répondu, on ne relance plus) ;
         *   · il n'a pas répondu → on continue vers `suivant`, la relance.
         *
         * C'est le « Wait for Contact Reply » de GoHighLevel, et le plus
         * utile pour une relance : il rend inutile la moitié des conditions.
         */
        if (etape && etape.type === 'attendre' && etape.mode === 'reponse') {
          const contexte = (task.sequence_context ?? {}) as Record<string, unknown>;
          const clientId = await clientDeLaTache(supabase, task.org_id, task.entity_type, task.entity_id);
          // `task.created_at` : la réponse doit être POSTÉRIEURE à la mise en
          // attente. Une conversation d'avant ne compte pas.
          const aRepondu = await clientARepondu(supabase, task.org_id, clientId, task.created_at);

          await planifierEtape(
            {
              supabase,
              orgId: task.org_id,
              ruleId: task.automation_rule_id,
              entityType: task.entity_type,
              entityId: task.entity_id,
              contexte,
              franchies: Number(contexte.franchies ?? 0),
            },
            etapesRegle,
            aRepondu ? (etape.si_reponse ?? null) : (etape.suivant ?? null),
          );

          await supabase
            .from('automation_scheduled_tasks')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              // Lisible dans l'onglet Journaux : sans ça, une attente qui se
              // termine sans rien envoyer ressemble à une panne.
              last_error: aRepondu
                ? 'Le client a répondu : la suite « réponse » a été suivie.'
                : 'Pas de réponse dans le délai : la relance a été planifiée.',
            })
            .eq('id', task.id);
          logger.info(`[sequences] attente « réponse » — ${aRepondu ? 'répondu' : 'sans réponse'}`, {
            rule_id: task.automation_rule_id, step_id: task.step_id,
          });
          continue;
        }
      }

      const vars = await resolveEntityVariables(
        supabase,
        task.org_id,
        task.entity_type,
        task.entity_id,
      );

      const ctx: ActionContext = {
        supabase,
        orgId: task.org_id,
        entityType: task.entity_type,
        entityId: task.entity_id,
        twilio: engineConfig.twilio,
        baseUrl: engineConfig.baseUrl,
        // Toute tâche de cette file est DIFFÉRÉE, donc commerciale : soumise au
        // plafond de fréquence. Les actions immédiates (confirmations) ne
        // passent pas ici et restent exemptes.
        commercial: true,
        langue: await langueOrg(supabase, task.org_id),
        ruleId: task.automation_rule_id,
      };

      const startTime = Date.now();
      const result = await avecDelaiMax(
        executeAction(actionType, config, vars, ctx),
        DELAI_MAX_ACTION_MS,
        `${actionType} n'a pas répondu en ${Math.round(DELAI_MAX_ACTION_MS / 1000)} s`,
      );
      const durationMs = Date.now() - startTime;

      // Log execution
      const { error: logError } = await supabase.from('automation_execution_logs').insert({
        org_id: task.org_id,
        automation_rule_id: task.automation_rule_id,
        scheduled_task_id: task.id,
        trigger_event: actionConfig.trigger_event || 'scheduled',
        entity_type: task.entity_type,
        entity_id: task.entity_id,
        action_type: actionType,
        action_config: config,
        result_success: result.success,
        result_data: result.data || null,
        result_error: result.error || null,
        duration_ms: durationMs,
      });
      if (logError) {
        console.error(`[automationEngine] failed to write execution log for task ${task.id} (org ${task.org_id}):`, logError.message);
      }

      // Update task status — avec reprise sur échec transitoire.
      const { error: statusError } = await supabase
        .from('automation_scheduled_tasks')
        .update(
          result.success
            ? {
                status: 'completed',
                completed_at: new Date().toISOString(),
                last_error: null,
              }
            : nextStateAfterFailure(task.attempts, result.error),
        )
        .eq('id', task.id);
      // ── Séquence : l'étape est faite, on ouvre la suivante ──
      //
      // Seulement sur SUCCÈS : une étape échouée sera reprise (backoff), et
      // enchaîner tout de suite ferait partir la suite alors que le message
      // précédent n'est jamais parti. Après épuisement des reprises, la
      // séquence s'arrête là — c'est voulu : mieux vaut une séquence
      // interrompue qu'une séquence qui saute une étape en silence.
      if (result.success && task.step_id && Array.isArray(etapesRegle)) {
        const etape = trouverEtape(etapesRegle, task.step_id);
        if (etape) {
          const contexte = (task.sequence_context ?? {}) as Record<string, unknown>;
          await planifierEtape(
            {
              supabase,
              orgId: task.org_id,
              ruleId: task.automation_rule_id,
              entityType: task.entity_type,
              entityId: task.entity_id,
              contexte,
              franchies: Number(contexte.franchies ?? 0),
            },
            etapesRegle,
            etapeSuivante(etape),
          );
        }
      }

      // Abandon définitif : l'entreprise doit l'apprendre.
      if (!result.success && nextStateAfterFailure(task.attempts, result.error).status === 'failed') {
        await prevenirEchecDefinitif(supabase, task, result.error);
      }
      if (statusError) {
        // La tâche resterait 'running' pour toujours : personne ne la reprend.
        console.error(`[automationEngine] failed to close scheduled task ${task.id}:`, statusError.message);
      }
    } catch (err: any) {
      console.error(`[automationEngine] scheduled task ${task.id} failed:`, err.message);
      const { error: statusError } = await supabase
        .from('automation_scheduled_tasks')
        .update(nextStateAfterFailure(task.attempts, err.message))
        .eq('id', task.id);
      if (nextStateAfterFailure(task.attempts, err.message).status === 'failed') {
        await prevenirEchecDefinitif(supabase, task, err?.message);
      }
      if (statusError) {
        console.error(`[automationEngine] failed to mark task ${task.id} as failed:`, statusError.message);
      }
    }
  }
}

// ── Stop condition checker ──────────────────────────────────

/**
 * Faut-il abandonner cette tâche planifiée ?
 *
 * `true` = la relance n'a plus lieu d'être (facture payée, devis accepté,
 * rendez-vous annulé…). La tâche est alors annulée DÉFINITIVEMENT.
 *
 * D'où la précaution centrale de cette fonction : `supabase-js` ne lève jamais
 * d'exception, il retourne `{ data, error }`. Les six lectures ci-dessous ne
 * lisaient que `data` — sur erreur (délai dépassé, incident réseau, RLS),
 * `data` vaut `null`, que le code interprétait comme « entité supprimée » et
 * traduisait par une annulation irrémédiable. Un hoquet de deux secondes
 * suffisait à supprimer des relances en attente, sans log ni reprise.
 *
 * Règle appliquée partout maintenant : une erreur de LECTURE ne conclut rien.
 * On laisse la tâche en place ; le tick suivant réessaiera.
 */
/**
 * Les métadonnées à jour de l'entité, pour évaluer une branche « si ».
 *
 * C'EST LE CŒUR DE L'INTÉRÊT D'UNE SÉQUENCE. Les métadonnées de l'événement
 * déclencheur décrivent le devis tel qu'il était le jour de l'envoi. Trois
 * jours plus tard, « si le devis est toujours sans réponse » doit se juger
 * sur son état ACTUEL — sinon la branche répondrait toujours la même chose
 * et ne servirait à rien.
 *
 * On part du contexte d'origine et on écrase ce qui a pu changer. Une lecture
 * qui échoue n'est pas silencieuse : on garde l'ancien contexte et on le dit,
 * plutôt que de décider sur du vide.
 */
async function metadonneesFraiches(
  supabase: SupabaseClient,
  task: { entity_type: string; entity_id: string; org_id: string },
  contexte: Record<string, unknown>,
): Promise<Record<string, any>> {
  const base: Record<string, any> = { ...contexte };

  /** Table et colonnes à relire selon le type d'entité. */
  const source: Record<string, { table: string; colonnes: string }> = {
    quote: { table: 'quotes', colonnes: 'status, total_cents' },
    invoice: { table: 'invoices', colonnes: 'status, total_cents, balance_cents' },
    job: { table: 'jobs', colonnes: 'status' },
    lead: { table: 'leads_active', colonnes: 'status, lead_status' },
    appointment: { table: 'schedule_events', colonnes: 'status' },
  };

  const cible = source[task.entity_type];
  if (!cible) return base;

  const { data, error } = await supabase
    .from(cible.table)
    .select(cible.colonnes)
    .eq('id', task.entity_id)
    .eq('org_id', task.org_id)
    .maybeSingle();

  if (error) {
    // Ne pas confondre « je ne sais pas » et « rien n'a changé » : on décide
    // sur le contexte d'origine, mais la trace dit pourquoi.
    logger.error('[sequences] état actuel illisible — branche évaluée sur le contexte d’origine', {
      entity_type: task.entity_type, entity_id: task.entity_id, message: error.message,
    });
    return base;
  }
  if (!data) return base;

  // `data` est typé `unknown` par PostgREST quand les colonnes sont choisies
  // dynamiquement : la forme est garantie par `source` juste au-dessus.
  return { ...base, ...(data as unknown as Record<string, unknown>) };
}

/**
 * Remonte de l'entité d'une tâche jusqu'à la fiche client.
 *
 * Même carte des liens que `clientDeLEntite` (actions/index.ts), vérifiée
 * dans le schéma de production : un `lead` EST une fiche `clients`, une
 * visite n'a pas de `client_id` et passe par son job, un devis porte DEUX
 * liens (`client_id` et `lead_id`).
 *
 * Volontairement dupliquée ici plutôt qu'importée : le moteur ne doit pas
 * dépendre du module d'actions pour décider d'ANNULER un envoi — c'est une
 * garde, elle reste lisible d'un seul tenant.
 */
async function clientDeLaTache(
  supabase: SupabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  if (entityType === 'client' || entityType === 'lead') return entityId;

  const lire = async (table: string, colonnes: string) => {
    const { data } = await supabase
      .from(table).select(colonnes).eq('id', entityId).eq('org_id', orgId).maybeSingle();
    return data as Record<string, string | null> | null;
  };

  switch (entityType) {
    case 'job': return (await lire('jobs', 'client_id'))?.client_id ?? null;
    case 'invoice': return (await lire('invoices', 'client_id'))?.client_id ?? null;
    case 'quote': {
      const q = await lire('quotes', 'client_id, lead_id');
      return q?.client_id ?? q?.lead_id ?? null;
    }
    case 'deal': return (await lire('deals', 'client_id'))?.client_id ?? null;
    case 'schedule_event':
    case 'appointment': {
      const e = await lire('schedule_events', 'job_id');
      if (!e?.job_id) return null;
      const { data: job } = await supabase
        .from('jobs').select('client_id').eq('id', e.job_id).eq('org_id', orgId).maybeSingle();
      return (job as { client_id?: string | null } | null)?.client_id ?? null;
    }
    default: return null;
  }
}

/**
 * Le client a-t-il répondu depuis que cette tâche a été planifiée ?
 *
 * C'est le réglage « Arrêter quand le client répond » (`arret_sur_reponse`).
 * Il était OFFERT dans l'interface, ENREGISTRÉ en base… et JAMAIS LU par le
 * moteur : le client répondait, et les relances continuaient. Un client qui
 * a répondu et reçoit quand même trois rappels, c'est le pire effet possible
 * d'une automatisation.
 *
 * On regarde les messages ENTRANTS reçus après la planification de la tâche.
 * Pas « depuis toujours » : une conversation ancienne ne doit pas empêcher
 * une nouvelle relance de partir.
 *
 * En cas de lecture impossible, on renvoie `false` — donc on N'ANNULE PAS.
 * Même prudence que `checkStopConditions` : ne jamais supprimer un envoi sur
 * une information qu'on n'a pas pu vérifier.
 */
async function clientARepondu(
  supabase: SupabaseClient,
  orgId: string,
  clientId: string | null,
  depuis: string,
): Promise<boolean> {
  if (!clientId) return false;
  const { data, error } = await supabase
    .from('messages')
    .select('id')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('direction', 'inbound')
    .gte('created_at', depuis)
    .limit(1);

  if (error) {
    console.error('[automationEngine] arrêt sur réponse indéterminable — tâche conservée:', error.message);
    return false;
  }
  return Boolean(data && data.length > 0);
}

async function checkStopConditions(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
  orgId: string,
  triggerEvent?: string,
  eventMetadata?: Record<string, unknown> | null,
): Promise<boolean> {
  /** Journalise et signale qu'aucune conclusion ne peut être tirée. */
  const illisible = (table: string, message: string): boolean => {
    console.error(
      `[automationEngine] condition d'arrêt indéterminable (${table}, ${entityType} ${entityId}) — tâche conservée:`,
      message,
    );
    return false; // ne PAS annuler
  };

  // Invoice reminders: stop if paid, cancelled, disputed, or client archived
  if (entityType === 'invoice') {
    const { data: inv, error } = await supabase
      .from('invoices')
      .select('status, client_id')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) return illisible('invoices', error.message);
    if (!inv) return true; // Invoice deleted
    if (['paid', 'cancelled', 'void'].includes(inv.status)) return true;
    // Check if client is archived/deleted
    if (inv.client_id) {
      const { data: cl, error: clErr } = await supabase
        .from('clients').select('deleted_at').eq('id', inv.client_id).eq('org_id', orgId).maybeSingle();
      if (clErr) return illisible('clients', clErr.message);
      if (cl?.deleted_at) return true;
    }
  }

  // Estimate follow-ups: stop if accepted, rejected, or lead archived
  if (entityType === 'invoice' && triggerEvent === 'estimate.sent') {
    const { data: inv, error } = await supabase
      .from('invoices')
      .select('status')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) return illisible('invoices', error.message);
    if (!inv) return true;
    if (['paid', 'accepted', 'rejected', 'cancelled', 'void'].includes(inv.status)) return true;
  }

  // Appointment reminders: stop if cancelled
  if (entityType === 'schedule_event' || entityType === 'appointment') {
    const { data: evt, error } = await supabase
      .from('schedule_events')
      .select('status, deleted_at')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) return illisible('schedule_events', error.message);
    if (!evt) return true;
    if (evt.deleted_at) return true;
    if (evt.status === 'cancelled') return true;
  }

  // Quote follow-ups: stop once the client responded (approved, declined,
  // changes requested) or the quote left circulation (expired, converted, archived)
  if (entityType === 'quote') {
    const { data: quote, error } = await supabase
      .from('quotes')
      .select('status, deleted_at')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) return illisible('quotes', error.message);
    if (!quote) return true; // Quote deleted
    if (quote.deleted_at) return true;
    if (['approved', 'declined', 'changes_requested', 'expired', 'converted', 'archived', 'void'].includes(quote.status)) return true;
  }

  // Lead: stop if archived or deleted (a lead is a client with status='lead')
  if (entityType === 'lead') {
    const { data: lead, error } = await supabase
      .from('clients')
      .select('status, lead_status, deleted_at')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) return illisible('clients', error.message);
    if (!lead) return true;
    if (lead.deleted_at) return true;
    // Stop once it's no longer an open lead (promoted/won/lost) or funnel-closed.
    if (lead.status !== 'lead') return true;

    /**
     * Exception : une relance de lead PERDU (`lost_lead_reengagement`, 90 jours
     * après le passage à « perdu ») s'annulait elle-même — la tâche était
     * planifiée parce que le lead venait d'être marqué perdu, puis supprimée
     * parce que le lead ÉTAIT perdu. Le preset n'a jamais pu s'exécuter une
     * seule fois depuis sa création.
     *
     * On n'assouplit la règle que pour ce cas précis : le déclencheur était un
     * passage à « perdu ». Les autres presets gardent la garde intacte — une
     * relance de soumission doit bien s'arrêter quand le lead devient perdu.
     */
    const relanceDeLeadPerdu =
      triggerEvent === 'lead.status_changed' &&
      (eventMetadata as { new_status?: unknown } | null)?.new_status === 'lost';
    const arretsLead = relanceDeLeadPerdu
      ? ['closed', 'converted', 'closed_won']
      : ['lost', 'closed', 'converted', 'closed_won', 'closed_lost'];
    if (arretsLead.includes(lead.lead_status)) return true;
  }

  return false;
}

// ── Public API ──────────────────────────────────────────────

export function initAutomationEngine(config: EngineConfig) {
  engineConfig = config;

  // Initialize event bus with supabase
  eventBus.init(config.supabase);

  // Listen to all events
  eventBus.onAnyEvent(handleEvent);

  logger.info('[automationEngine] initialized and listening for events');
}
