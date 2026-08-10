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
      if ('eq' in expected && actual !== expected.eq) return false;
      if ('neq' in expected && actual === expected.neq) return false;
      if ('in' in expected && Array.isArray(expected.in) && !expected.in.includes(actual)) return false;
      if ('not_in' in expected && Array.isArray(expected.not_in) && expected.not_in.includes(actual)) return false;
    } else {
      // Direct equality
      if (actual !== expected) return false;
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

    // Defer immediate SMS fired during quiet hours to the next send window.
    if (action.type === 'send_sms' && isQuietHours()) {
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
        console.log(`[automationEngine] SMS deferred to send window (quiet hours) for rule "${rule.name}"`);
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

async function resolveExecuteAt(
  rule: AutomationRule,
  event: CRMEvent,
  config: EngineConfig,
): Promise<Date> {
  // Negative delay = "X seconds before the event's reference time"
  // Used for appointment reminders (e.g., -86400 = 1 day before start_time)
  if (rule.delay_seconds < 0 && (event.entityType === 'schedule_event' || event.entityType === 'appointment')) {
    const { data: evt } = await config.supabase
      .from('schedule_events')
      .select('start_at, start_time')
      .eq('id', event.entityId)
      .maybeSingle();

    const startField = evt?.start_at || evt?.start_time;
    if (startField) {
      const eventTime = new Date(startField).getTime();
      const executeAt = new Date(eventTime + rule.delay_seconds * 1000);
      // If the calculated time is already past, execute immediately
      if (executeAt.getTime() <= Date.now()) {
        return new Date(Date.now() + 5000); // 5s from now
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

// ── Map CRM event types to workflow trigger_type values ────
const EVENT_TO_TRIGGER: Record<string, string> = {
  'lead.created': 'lead_created',
  'lead.updated': 'lead_updated',
  'lead.status_changed': 'lead_status_changed',
  'lead.converted': 'lead_converted',
  'pipeline_deal.stage_changed': 'pipeline_deal_stage_changed',
  'estimate.sent': 'estimate_sent',
  'estimate.accepted': 'estimate_approved',
  'quote.created': 'quote_created',
  'quote.sent': 'quote_sent',
  'quote.approved': 'quote_approved',
  'quote.declined': 'quote_declined',
  'quote.converted': 'quote_converted',
  'appointment.created': 'job_scheduled',
  'job.created': 'job_scheduled',
  'job.completed': 'job_completed',
  'invoice.created': 'invoice_created',
  'invoice.sent': 'invoice_created',
  'invoice.overdue': 'invoice_overdue',
  'invoice.paid': 'payment_received',
};

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

    // ── 2. Match workflows table (new system) ──
    const triggerType = EVENT_TO_TRIGGER[event.type];
    if (triggerType) {
      const { data: workflows, error: wfError } = await engineConfig.supabase
        .from('workflows')
        .select('id, org_id, name, trigger_type, delay_value, delay_unit, conditions, actions_config')
        .eq('org_id', event.orgId)
        .eq('trigger_type', triggerType)
        .eq('active', true)
        .eq('status', 'published');

      if (wfError) {
        console.error('[automationEngine] failed to fetch workflows:', wfError.message);
      }

      if (workflows && workflows.length > 0) {
        for (const wf of workflows as any[]) {
          // Evaluate conditions (array format)
          const wfConditions = wf.conditions || [];
          if (Array.isArray(wfConditions) && wfConditions.length > 0) {
            const condObj: Record<string, any> = {};
            for (const c of wfConditions) {
              if (c.operator === 'equals') condObj[c.field] = { eq: c.value };
              else if (c.operator === 'not_equals') condObj[c.field] = { neq: c.value };
            }
            if (!evaluateConditions(condObj, event)) continue;
          }

          // Convert workflow to AutomationRule format for execution
          const wfActions = wf.actions_config || [];
          if (!Array.isArray(wfActions) || wfActions.length === 0) continue;

          const delaySeconds = delayToSeconds(wf.delay_value || 0, wf.delay_unit || 'immediate');

          const pseudoRule: AutomationRule = {
            id: wf.id,
            org_id: wf.org_id,
            name: wf.name,
            trigger_event: event.type,
            conditions: {},
            delay_seconds: delaySeconds,
            actions: wfActions,
            is_active: true,
          };

          if (delaySeconds > 0) {
            await scheduleDelayedActions(pseudoRule, event, engineConfig);
          } else {
            await executeRuleActions(pseudoRule, event, engineConfig);
          }

          console.log(`[automationEngine] workflow "${wf.name}" matched event ${event.type}`);
        }
      }
    }
  } catch (err: any) {
    console.error('[automationEngine] error handling event:', err.message);
  }
}

// ── Scheduled task processor (called by scheduler) ──────────

export async function processScheduledTasks(supabase: SupabaseClient) {
  if (!engineConfig) return;

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
    // Quiet hours: push due SMS tasks to the next send window without
    // consuming an attempt — the client shouldn't be texted at night.
    if (task.action_config?.type === 'send_sms' && isQuietHours()) {
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
    const { error: claimError } = await supabase
      .from('automation_scheduled_tasks')
      .update({ status: 'running', attempts: task.attempts + 1 })
      .eq('id', task.id);
    if (claimError) {
      console.error(`[automationEngine] failed to claim scheduled task ${task.id}:`, claimError.message);
      continue;
    }

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

      // Update task status
      const { error: statusError } = await supabase
        .from('automation_scheduled_tasks')
        .update({
          status: result.success ? 'completed' : 'failed',
          completed_at: new Date().toISOString(),
          last_error: result.error || null,
        })
        .eq('id', task.id);
      if (statusError) {
        // La tâche resterait 'running' pour toujours : personne ne la reprend.
        console.error(`[automationEngine] failed to close scheduled task ${task.id}:`, statusError.message);
      }
    } catch (err: any) {
      console.error(`[automationEngine] scheduled task ${task.id} failed:`, err.message);
      const { error: statusError } = await supabase
        .from('automation_scheduled_tasks')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          last_error: err.message,
        })
        .eq('id', task.id);
      if (statusError) {
        console.error(`[automationEngine] failed to mark task ${task.id} as failed:`, statusError.message);
      }
    }
  }
}

// ── Stop condition checker ──────────────────────────────────

async function checkStopConditions(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
  triggerEvent?: string,
): Promise<boolean> {
  // Invoice reminders: stop if paid, cancelled, disputed, or client archived
  if (entityType === 'invoice') {
    const { data: inv } = await supabase
      .from('invoices')
      .select('status, client_id')
      .eq('id', entityId)
      .maybeSingle();

    if (!inv) return true; // Invoice deleted
    if (['paid', 'cancelled', 'void'].includes(inv.status)) return true;
    // Check if client is archived/deleted
    if (inv.client_id) {
      const { data: cl } = await supabase.from('clients').select('deleted_at').eq('id', inv.client_id).maybeSingle();
      if (cl?.deleted_at) return true;
    }
  }

  // Estimate follow-ups: stop if accepted, rejected, or lead archived
  if (entityType === 'invoice' && triggerEvent === 'estimate.sent') {
    const { data: inv } = await supabase
      .from('invoices')
      .select('status')
      .eq('id', entityId)
      .maybeSingle();

    if (!inv) return true;
    if (['paid', 'accepted', 'rejected', 'cancelled', 'void'].includes(inv.status)) return true;
  }

  // Appointment reminders: stop if cancelled
  if (entityType === 'schedule_event' || entityType === 'appointment') {
    const { data: evt } = await supabase
      .from('schedule_events')
      .select('status, deleted_at')
      .eq('id', entityId)
      .maybeSingle();

    if (!evt) return true;
    if (evt.deleted_at) return true;
    if (evt.status === 'cancelled') return true;
  }

  // Quote follow-ups: stop once the client responded (approved, declined,
  // changes requested) or the quote left circulation (expired, converted, archived)
  if (entityType === 'quote') {
    const { data: quote } = await supabase
      .from('quotes')
      .select('status, deleted_at')
      .eq('id', entityId)
      .maybeSingle();

    if (!quote) return true; // Quote deleted
    if (quote.deleted_at) return true;
    if (['approved', 'declined', 'changes_requested', 'expired', 'converted', 'archived', 'void'].includes(quote.status)) return true;
  }

  // Lead: stop if archived or deleted (a lead is a client with status='lead')
  if (entityType === 'lead') {
    const { data: lead } = await supabase
      .from('clients')
      .select('status, lead_status, deleted_at')
      .eq('id', entityId)
      .maybeSingle();

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
