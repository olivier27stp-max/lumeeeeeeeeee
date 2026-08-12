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

interface AutomationRule {
  id: string;
  org_id: string;
  name: string;
  trigger_event: string;
  conditions: Record<string, any>;
  delay_seconds: number;
  actions: Array<{ type: ActionType; config: Record<string, any> }>;
  is_active: boolean;
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

export function isQuietHours(d: Date = new Date()): boolean {
  const h = localHour(d);
  return h < SEND_START_HOUR || h >= SEND_END_HOUR;
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
export function nextSendTime(from: Date = new Date()): Date {
  const next = new Date(from);
  for (let i = 0; i < 48; i++) {
    next.setTime(next.getTime() + 30 * 60 * 1000);
    if (!isQuietHours(next)) return next;
  }
  return from;
}

// ── Execute actions for a rule ──────────────────────────────

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
  };

  for (let i = 0; i < rule.actions.length; i++) {
    const action = rule.actions[i];
    const executionKey = buildExecutionKey(rule.id, event.entityId, i);

    // Reporte à la prochaine fenêtre d'envoi les actions déclenchées en heures
    // calmes. Une règle immédiate (délai 0) porte une confirmation attendue :
    // seuls ses SMS sont reportés, jamais ses courriels.
    if (shouldRespectQuietHours(action.type, rule.delay_seconds) && isQuietHours()) {
      // supabase-js ne lève jamais : l'erreur (dont le doublon 23505) arrive
      // dans la réponse, pas dans un catch.
      const { error: deferError } = await config.supabase.from('automation_scheduled_tasks').insert({
        org_id: event.orgId,
        automation_rule_id: rule.id,
        entity_type: event.entityType,
        entity_id: event.entityId,
        action_config: { ...action, trigger_event: event.type, event_metadata: event.metadata },
        execute_at: nextSendTime().toISOString(),
        status: 'pending',
        execution_key: executionKey,
      });
      if (deferError) {
        if (deferError.code !== '23505') {
          console.error(`[automationEngine] failed to defer quiet-hours SMS (rule ${rule.id}, org ${event.orgId}):`, deferError.message);
        }
      } else {
        console.log(`[automationEngine] ${action.type} deferred to send window (quiet hours) for rule "${rule.name}"`);
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
      const executeAt = new Date(eventTime + rule.delay_seconds * 1000);
      const retard = Date.now() - executeAt.getTime();

      if (retard > RETARD_TOLERE_MS) {
        // Le créneau du rappel est franchement dépassé : l'envoyer dirait au
        // client quelque chose de faux.
        console.log(
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
        console.log(`[automationEngine] skipped duplicate scheduled task: ${executionKey}`);
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

  try {
    // ── 1. Match automation_rules (legacy system) ──
    const { data: rules, error } = await engineConfig.supabase
      .from('automation_rules')
      .select('*')
      .eq('org_id', event.orgId)
      .eq('trigger_event', event.type)
      .eq('is_active', true);

    if (error) {
      console.error('[automationEngine] failed to fetch rules:', error.message);
    }

    if (rules && rules.length > 0) {
      for (const rule of rules as AutomationRule[]) {
        if (!evaluateConditions(rule.conditions, event)) continue;
        if (rule.delay_seconds !== 0) {
          await scheduleDelayedActions(rule, event, engineConfig);
        } else {
          await executeRuleActions(rule, event, engineConfig);
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
    .lt('updated_at', limite)
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
    .select('*, automation_rules!automation_scheduled_tasks_automation_rule_id_fkey(name, actions, conditions)')
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
    if ((taskType === 'send_sms' || taskType === 'send_email') && isQuietHours()) {
      const { error: pushError } = await supabase
        .from('automation_scheduled_tasks')
        .update({ execute_at: nextSendTime().toISOString() })
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
        actionConfig.trigger_event,
      );

      if (shouldStop) {
        const { error: cancelError } = await supabase
          .from('automation_scheduled_tasks')
          .update({ status: 'cancelled', completed_at: now })
          .eq('id', task.id);
        if (cancelError) {
          console.error(`[automationEngine] failed to cancel scheduled task ${task.id}:`, cancelError.message);
        }
        continue;
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
      };

      const startTime = Date.now();
      const result = await executeAction(actionType, config, vars, ctx);
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
async function checkStopConditions(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
  triggerEvent?: string,
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
      .maybeSingle();

    if (error) return illisible('invoices', error.message);
    if (!inv) return true; // Invoice deleted
    if (['paid', 'cancelled', 'void'].includes(inv.status)) return true;
    // Check if client is archived/deleted
    if (inv.client_id) {
      const { data: cl, error: clErr } = await supabase
        .from('clients').select('deleted_at').eq('id', inv.client_id).maybeSingle();
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
      .maybeSingle();

    if (error) return illisible('clients', error.message);
    if (!lead) return true;
    if (lead.deleted_at) return true;
    // Stop once it's no longer an open lead (promoted/won/lost) or funnel-closed.
    if (lead.status !== 'lead') return true;
    if (['lost', 'closed', 'converted', 'closed_won', 'closed_lost'].includes(lead.lead_status)) return true;
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

  console.log('[automationEngine] initialized and listening for events');
}
