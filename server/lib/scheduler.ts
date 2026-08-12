import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  createNotification,
  sendSmsIfConfigured,
  applyTemplate,
  isSmsOptedOut,
} from './notificationHelpers';
import {
  addDelay,
  subtractDelay,
  computeNextRecurrenceDate,
} from './scheduler-utils';

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

type TriggerType =
  | 'days_after_quote_sent'
  | 'days_before_appointment'
  | 'on_invoice_due_date'
  | 'days_after_invoice_due'
  | 'days_after_job_completed'
  | 'custom';

interface Automation {
  id: string;
  org_id: string;
  name: string;
  trigger: TriggerType;
  delay_value: number;
  delay_unit: 'hours' | 'days';
  message_template: string;
  active: boolean;
  category: string | null;
}

interface TwilioConfig {
  client: any;
  phoneNumber: string;
}

// ---------------------------------------------------------------------------
// Delay helpers
// ---------------------------------------------------------------------------

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Envoi SMS d'automatisation — TOUJOURS depuis le numéro propre à l'org
// ---------------------------------------------------------------------------

/**
 * Résout le numéro Twilio de l'org puis envoie.
 *
 * Pourquoi ce détour plutôt qu'un `sendSmsIfConfigured(twilio, ...)` direct :
 * le scheduler recevait `TWILIO_PHONE_NUMBER` (numéro GLOBAL de la plateforme)
 * et l'utilisait pour tous les locataires. Deux conséquences en production :
 *
 *   1. si la variable d'env était vide, `twilioConfig` valait `null` et AUCUN
 *      SMS d'automatisation ne partait — sans la moindre erreur visible ;
 *   2. si elle était remplie, tous les orgs envoyaient depuis le même numéro
 *      inconnu : les réponses des clients atterrissaient dans la mauvaise
 *      boîte et le gate de forfait (`SmsNotInPlanError`) était contourné.
 *
 * `server/lib/actions/index.ts` faisait déjà correctement ce travail ; le
 * scheduler n'avait jamais été aligné. Le client Twilio (authentification)
 * reste global, seul le numéro expéditeur est résolu par org.
 */
async function sendOrgSms(
  twilio: TwilioConfig | null,
  orgId: string,
  to: string | null | undefined,
  body: string,
  supabase?: SupabaseClient,
): Promise<import('./notificationHelpers').SmsSendResult> {
  if (!twilio?.client) return { sent: false, reason: 'not_configured' };
  if (!to) return { sent: false, reason: 'no_recipient' };

  // Conformité CASL : les automatisations contournaient entièrement la liste
  // STOP et continuaient de relancer un client qui s'était désabonné.
  if (supabase) {
    const { normalizeE164 } = await import('./helpers');
    const normalized = normalizeE164(to);
    if (await isSmsOptedOut(supabase, orgId, normalized)) {
      console.warn(`[scheduler] SMS ignoré : ${normalized} s'est désabonné (STOP) de l'org ${orgId}`);
      return { sent: false, reason: 'no_recipient', error: 'recipient opted out (STOP)' };
    }
  }

  let fromNumber: string;
  try {
    const { getOrgSmsFromNumber } = await import('./twilioProvisioning');
    fromNumber = await getOrgSmsFromNumber(orgId);
  } catch (e: any) {
    // Org sans numéro provisionné ou forfait sans SMS : on saute la jambe SMS
    // plutôt que de retomber sur le numéro plateforme (fuite d'identité entre
    // locataires + contournement du forfait).
    console.warn(`[scheduler] SMS ignoré pour l'org ${orgId} : ${e?.name || e?.message}`);
    return { sent: false, reason: 'not_configured', error: e?.message };
  }

  return sendSmsIfConfigured({ client: twilio.client, phoneNumber: fromNumber }, to, body);
}

// ---------------------------------------------------------------------------
// Trigger handlers
// ---------------------------------------------------------------------------

async function handleDaysAfterQuoteSent(
  supabase: SupabaseClient,
  automation: Automation,
  twilio: TwilioConfig | null,
) {
  const today = todayDateString();

  const { data: rows, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, sent_at, client_id')
    .eq('org_id', automation.org_id)
    .eq('status', 'sent')
    .not('sent_at', 'is', null);

  if (error || !rows) return;

  for (const inv of rows as any[]) {
    if (!inv.sent_at) continue;
    const target = addDelay(new Date(inv.sent_at), automation.delay_value, automation.delay_unit);
    if (target !== today) continue;

    const { data: client } = inv.client_id
      ? await supabase.from('clients').select('first_name, last_name, phone').eq('id', inv.client_id).maybeSingle()
      : { data: null };
    const clientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
      : 'Client';
    const body = applyTemplate(automation.message_template, {
      client_name: clientName,
      invoice_number: inv.invoice_number,
    });

    // L'envoi d'abord, la notification ensuite : elle doit refléter ce qui
    // s'est réellement passé. Auparavant la notification « envoyé » était
    // créée avant l'appel Twilio et sans jamais regarder son résultat —
    // l'utilisateur voyait un succès pour un SMS jamais parti.
    await runAutomationOnce(supabase, automation, twilio, client?.phone, body, inv.id);
  }
}

async function handleDaysBeforeAppointment(
  supabase: SupabaseClient,
  automation: Automation,
  twilio: TwilioConfig | null,
) {
  // schedule_events where start_time - delay = now (today)
  const today = todayDateString();

  // `schedule_events` n'a pas de client_id : le client se rejoint via le job.
  // La FK est nommée explicitement : il existe DEUX contraintes vers `jobs`
  // (`schedule_events_job_id_fkey` et la composite `_same_org` du cloisonnement
  // multi-tenant). Sans ce nom, PostgREST répond PGRST201/HTTP 300 et la
  // requête ne rapporte RIEN — cette automatisation ne partait jamais.
  const { data: events, error } = await supabase
    .from('schedule_events')
    .select('id, title, start_time, job:jobs!schedule_events_job_id_fkey(client_id)')
    .eq('org_id', automation.org_id);

  if (error || !events) return;

  for (const evt of events as any[]) {
    if (!evt.start_time) continue;
    const target = subtractDelay(new Date(evt.start_time), automation.delay_value, automation.delay_unit);
    if (target !== today) continue;

    const job = Array.isArray(evt.job) ? evt.job[0] : evt.job;
    const clientId = job?.client_id || null;
    const { data: client } = clientId
      ? await supabase.from('clients').select('first_name, last_name, phone').eq('id', clientId).maybeSingle()
      : { data: null };
    const clientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
      : 'Client';
    const body = applyTemplate(automation.message_template, {
      client_name: clientName,
      event_title: evt.title,
    });

    await runAutomationOnce(supabase, automation, twilio, client?.phone, body, evt.id);
  }
}

async function handleOnInvoiceDueDate(
  supabase: SupabaseClient,
  automation: Automation,
  twilio: TwilioConfig | null,
) {
  const today = todayDateString();

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, due_date, client_id')
    .eq('org_id', automation.org_id)
    .eq('due_date', today)
    .neq('status', 'paid');

  if (error || !invoices) return;

  for (const inv of invoices as any[]) {
    const { data: client } = inv.client_id
      ? await supabase.from('clients').select('first_name, last_name, phone').eq('id', inv.client_id).maybeSingle()
      : { data: null };
    const clientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
      : 'Client';
    const body = applyTemplate(automation.message_template, {
      client_name: clientName,
      invoice_number: inv.invoice_number,
    });

    // L'envoi d'abord, la notification ensuite : elle doit refléter ce qui
    // s'est réellement passé. Auparavant la notification « envoyé » était
    // créée avant l'appel Twilio et sans jamais regarder son résultat —
    // l'utilisateur voyait un succès pour un SMS jamais parti.
    await runAutomationOnce(supabase, automation, twilio, client?.phone, body, inv.id);
  }
}

async function handleDaysAfterInvoiceDue(
  supabase: SupabaseClient,
  automation: Automation,
  twilio: TwilioConfig | null,
) {
  const today = todayDateString();

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, due_date, client_id')
    .eq('org_id', automation.org_id)
    .neq('status', 'paid');

  if (error || !invoices) return;

  for (const inv of invoices as any[]) {
    if (!inv.due_date) continue;
    const target = addDelay(new Date(inv.due_date), automation.delay_value, automation.delay_unit);
    if (target !== today) continue;

    const { data: client } = inv.client_id
      ? await supabase.from('clients').select('first_name, last_name, phone').eq('id', inv.client_id).maybeSingle()
      : { data: null };
    const clientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
      : 'Client';
    const body = applyTemplate(automation.message_template, {
      client_name: clientName,
      invoice_number: inv.invoice_number,
    });

    // L'envoi d'abord, la notification ensuite : elle doit refléter ce qui
    // s'est réellement passé. Auparavant la notification « envoyé » était
    // créée avant l'appel Twilio et sans jamais regarder son résultat —
    // l'utilisateur voyait un succès pour un SMS jamais parti.
    await runAutomationOnce(supabase, automation, twilio, client?.phone, body, inv.id);
  }
}

async function handleDaysAfterJobCompleted(
  supabase: SupabaseClient,
  automation: Automation,
  twilio: TwilioConfig | null,
) {
  const today = todayDateString();

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, title, completed_at, client_id')
    .eq('org_id', automation.org_id)
    .eq('status', 'completed')
    .not('completed_at', 'is', null);

  if (error || !jobs) return;

  for (const job of jobs as any[]) {
    if (!job.completed_at) continue;
    const target = addDelay(new Date(job.completed_at), automation.delay_value, automation.delay_unit);
    if (target !== today) continue;

    const { data: client } = job.client_id
      ? await supabase.from('clients').select('first_name, last_name, phone').eq('id', job.client_id).maybeSingle()
      : { data: null };
    const clientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
      : 'Client';
    const body = applyTemplate(automation.message_template, {
      client_name: clientName,
      job_title: job.title,
    });

    await runAutomationOnce(supabase, automation, twilio, client?.phone, body, job.id);
  }
}

// ---------------------------------------------------------------------------
// Déduplication : une automatisation ne doit se déclencher qu'une fois par
// jour et par entité concernée.
//
// Le garde-fou vivait UNIQUEMENT en mémoire du processus. Deux conséquences
// réelles en production :
//   - la mémoire est vidée à chaque redémarrage ou déploiement, donc le tick
//     suivant (toutes les 5 min) renvoyait les messages déjà envoyés ;
//   - avec plusieurs instances du serveur, chacune a son propre Set : autant
//     de copies du même message que d'instances.
//
// La vérification s'appuie désormais sur la table `notifications`, qui porte
// déjà `reference_id` + `created_at` et reçoit une ligne à chaque
// déclenchement. Elle survit donc aux redéploiements et est partagée par
// toutes les instances. Le Set est conservé en cache devant la base : il évite
// une requête quand la réponse est déjà connue, mais ne fait plus autorité.
// ---------------------------------------------------------------------------

let firedKeyDate = '';
const firedKeys = new Set<string>();

function cacheKey(automationId: string, refId: string) {
  return `${automationId}:${refId}`;
}

function resetCacheIfNewDay() {
  const today = todayDateString();
  if (firedKeyDate !== today) {
    firedKeys.clear();
    firedKeyDate = today;
  }
}

async function hasFired(
  supabase: SupabaseClient,
  orgId: string,
  automationName: string,
  refId: string,
  automationId: string,
): Promise<boolean> {
  resetCacheIfNewDay();
  if (firedKeys.has(cacheKey(automationId, refId))) return true;

  // Une notification portant ce titre et cette référence, créée aujourd'hui,
  // prouve que l'automatisation s'est déjà déclenchée — y compris avant un
  // redéploiement ou depuis une autre instance.
  const debutJour = `${todayDateString()}T00:00:00.000Z`;
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id')
      .eq('org_id', orgId)
      .eq('reference_id', refId)
      .eq('title', automationName)
      .gte('created_at', debutJour)
      .limit(1)
      .maybeSingle();

    if (error) {
      // Fail-open : en cas d'incident de lecture, mieux vaut un doublon
      // possible qu'une automatisation entièrement muette.
      console.error('[scheduler] vérification anti-doublon échouée:', error.message);
      return false;
    }
    if (data) {
      firedKeys.add(cacheKey(automationId, refId));
      return true;
    }
    return false;
  } catch (err: any) {
    console.error('[scheduler] vérification anti-doublon échouée:', err?.message);
    return false;
  }
}

function markFired(automationId: string, refId: string) {
  resetCacheIfNewDay();
  firedKeys.add(cacheKey(automationId, refId));
}

/**
 * Déduplication en mémoire, pour les détections internes (facture en retard,
 * devis expiré) qui émettent un ÉVÉNEMENT sans écrire de notification.
 *
 * `hasFired` ne peut pas les couvrir : elle s'appuie sur la table
 * `notifications`, qu'ils n'alimentent pas. Le risque résiduel est faible —
 * un doublon ici ne fait que ré-émettre un événement idempotent en aval,
 * il n'envoie aucun message à un client.
 */
function hasFiredLocal(scope: string, refId: string): boolean {
  resetCacheIfNewDay();
  return firedKeys.has(cacheKey(scope, refId));
}

/**
 * Exécute une automatisation une seule fois par jour et par entité : envoie le
 * SMS, puis journalise le résultat réel.
 *
 * Remplace l'ancien `createNotificationDeduped`, dont la garde ne couvrait que
 * la notification : l'appel SMS se trouvait à l'EXTÉRIEUR et repartait donc à
 * chaque tick (toutes les 5 minutes) même quand le doublon était détecté. Le
 * client recevait le message en boucle, alors que l'utilisateur ne voyait
 * qu'une seule notification.
 */
async function runAutomationOnce(
  supabase: SupabaseClient,
  automation: Automation,
  twilio: TwilioConfig | null,
  phone: string | null | undefined,
  body: string,
  referenceId: string,
) {
  const refKey = referenceId || 'no-ref';
  if (await hasFired(supabase, automation.org_id, automation.name, refKey, automation.id)) return;
  // Marqué AVANT l'envoi : deux ticks rapprochés ne doivent pas passer tous
  // les deux pendant que le premier attend la réponse de Twilio.
  markFired(automation.id, refKey);

  const smsRes = await sendOrgSms(twilio, automation.org_id, phone, body, supabase);
  await notifyAutomationResult(supabase, automation, body, referenceId, smsRes);
}

/**
 * Notifie l'utilisateur du résultat RÉEL de l'automatisation.
 *
 * Deux corrections par rapport au comportement précédent :
 *
 *  1. La notification ne dit plus « envoyé » quand rien n'est parti. Quand le
 *     SMS échoue, elle le dit explicitement et donne la cause — sinon
 *     l'utilisateur n'a aucun moyen d'apprendre que son client n'a rien reçu.
 *
 *  2. `no_recipient` (le client n'a pas de téléphone) n'est PAS un échec à
 *     signaler : l'automatisation n'avait simplement rien à faire ici. On
 *     garde alors la notification neutre d'origine, sans bruit inutile.
 */
async function notifyAutomationResult(
  supabase: SupabaseClient,
  automation: Automation,
  body: string,
  referenceId: string,
  smsRes: import('./notificationHelpers').SmsSendResult,
) {
  // Le TITRE reste toujours `automation.name`, y compris en cas d'échec :
  // c'est lui qui sert de clé à la détection de doublon en base
  // (`hasFired` filtre sur org_id + reference_id + title). Un titre différent
  // selon l'issue rendrait la garde inopérante dès qu'un envoi échoue, et
  // l'automatisation repartirait au tick suivant. La cause de l'échec va donc
  // dans le corps du message, pas dans le titre.
  if (smsRes.sent || smsRes.reason === 'no_recipient') {
    await createNotification(supabase, automation.org_id, automation.name, body, referenceId);
    return;
  }

  const cause = smsRes.reason === 'not_configured'
    ? "aucun numéro SMS n'est configuré pour cette organisation"
    : (smsRes.error || 'erreur d’envoi');
  await createNotification(
    supabase,
    automation.org_id,
    automation.name,
    `⚠️ SMS non envoyé (${cause}). Message prévu : ${body}`,
    referenceId,
  );
}

// ---------------------------------------------------------------------------
// Recurring invoices
// ---------------------------------------------------------------------------

async function handleRecurringInvoices(supabase: SupabaseClient) {
  const today = todayDateString();

  // Find all recurring invoices whose next_recurrence_date is today or earlier
  const { data: recurringInvoices, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('is_recurring', true)
    .lte('next_recurrence_date', today)
    .is('deleted_at', null);

  if (error) {
    console.error('[scheduler] failed to fetch recurring invoices:', error.message);
    return;
  }
  if (!recurringInvoices || recurringInvoices.length === 0) return;

  for (const inv of recurringInvoices as any[]) {
    try {
      // Fetch line items from the original invoice
      const { data: items } = await supabase
        .from('invoice_items')
        .select('description, qty, unit_price_cents, line_total_cents')
        .eq('invoice_id', inv.id);

      // Plus petit numéro libre de l'org, chiffres seulement (invoice_next_number);
      // fallback numérique si la fonction n'est pas disponible.
      let newInvoiceNumber: string;
      const { data: nextNum, error: numErr } = await supabase.rpc('invoice_next_number', { p_org: inv.org_id });
      if (!numErr && nextNum != null) {
        newInvoiceNumber = String(nextNum);
      } else {
        newInvoiceNumber = String(Date.now());
      }

      // Clone the invoice as a draft
      const { data: cloned, error: cloneError } = await supabase
        .from('invoices')
        .insert({
          org_id: inv.org_id,
          client_id: inv.client_id,
          job_id: inv.job_id || null,
          invoice_number: newInvoiceNumber,
          status: 'draft',
          currency: inv.currency || 'CAD',
          subject: inv.subject || null,
          due_date: null,
          subtotal_cents: inv.subtotal_cents || 0,
          tax_cents: inv.tax_cents || 0,
          total_cents: inv.total_cents || 0,
          balance_cents: inv.total_cents || 0,
          paid_cents: 0,
          parent_invoice_id: inv.id,
          is_recurring: false,
        })
        .select('id')
        .single();

      if (cloneError) {
        console.error(`[scheduler] failed to clone invoice ${inv.id}:`, cloneError.message);
        continue;
      }

      // Clone line items
      if (items && items.length > 0 && cloned) {
        const clonedItems = items.map((item: any) => ({
          invoice_id: cloned.id,
          description: item.description,
          qty: item.qty,
          unit_price_cents: item.unit_price_cents,
          line_total_cents: item.line_total_cents,
        }));
        const { error: itemsError } = await supabase.from('invoice_items').insert(clonedItems);
        if (itemsError) {
          // Le brouillon existe déjà mais SANS lignes — intervention manuelle requise.
          console.error(`[scheduler] RECURRING INVOICE ${inv.id}: line items insert FAILED for cloned draft ${cloned.id} (${newInvoiceNumber}) — the draft is EMPTY and must be fixed manually:`, itemsError.message);
        }
      }

      // Update the original invoice's next_recurrence_date
      const nextDate = computeNextRecurrenceDate(
        inv.next_recurrence_date,
        inv.recurrence_interval,
      );
      const { error: nextDateError } = await supabase
        .from('invoices')
        .update({ next_recurrence_date: nextDate })
        .eq('id', inv.id);
      if (nextDateError) {
        // Sans cette mise à jour, la facture serait re-clonée à CHAQUE passage du scheduler.
        console.error(`[scheduler] RECURRING INVOICE ${inv.id}: next_recurrence_date update FAILED (draft ${cloned.id} already created) — risk of duplicate clones on next run:`, nextDateError.message);
        continue;
      }

      // Create a notification
      await createNotification(
        supabase,
        inv.org_id,
        'Recurring Invoice',
        `Recurring invoice ${inv.invoice_number} generated a new draft: ${newInvoiceNumber}`,
        cloned?.id,
      );

      console.log(`[scheduler] cloned recurring invoice ${inv.invoice_number} -> ${newInvoiceNumber}`);
    } catch (err: any) {
      console.error(`[scheduler] error processing recurring invoice ${inv.id}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Overdue invoice detection — emits invoice.overdue events
// ---------------------------------------------------------------------------

async function detectOverdueInvoices(supabase: SupabaseClient) {
  const today = todayDateString();

  // Find invoices that are past due and not paid/cancelled
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, org_id, invoice_number, due_date, client_id')
    .not('status', 'in', '("paid","cancelled","void")')
    .not('due_date', 'is', null)
    .lt('due_date', today)
    .is('deleted_at', null);

  if (error || !invoices) return;

  const { eventBus } = await import('./eventBus');

  for (const inv of invoices as any[]) {
    if (!inv.due_date) continue;
    const dueDate = new Date(inv.due_date + 'T00:00:00');
    const todayDate = new Date(today + 'T00:00:00');
    const daysOverdue = Math.floor((todayDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    // Only emit on specific days to match preset conditions
    if ([1, 3, 5, 15, 30].includes(daysOverdue)) {
      const dedupKey = `overdue:${inv.id}:${daysOverdue}`;
      if (hasFiredLocal('overdue-detection', dedupKey)) continue;
      markFired('overdue-detection', dedupKey);

      await eventBus.emit('invoice.overdue', {
        orgId: inv.org_id,
        entityType: 'invoice',
        entityId: inv.id,
        metadata: {
          invoice_number: inv.invoice_number,
          days_overdue: daysOverdue,
          due_date: inv.due_date,
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-expire quotes past valid_until
// ---------------------------------------------------------------------------

async function expireOverdueQuotes(supabase: SupabaseClient) {
  const today = todayDateString();

  const { data: quotes, error } = await supabase
    .from('quotes')
    .select('id, org_id, quote_number, valid_until, status')
    .in('status', ['draft', 'awaiting_response', 'changes_requested'])
    .not('valid_until', 'is', null)
    .lt('valid_until', today)
    .is('deleted_at', null);

  if (error || !quotes) return;

  for (const q of quotes as any[]) {
    const dedupKey = `quote-expire:${q.id}`;
    if (hasFiredLocal('quote-expiry', dedupKey)) continue;
    markFired('quote-expiry', dedupKey);

    await supabase
      .from('quotes')
      .update({
        status: 'expired',
        expired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', q.id);

    await supabase.from('quote_status_history').insert({
      quote_id: q.id,
      old_status: q.status,
      new_status: 'expired',
      changed_by: null,
      reason: 'Auto-expired: past valid_until date',
    });

    await createNotification(
      supabase,
      q.org_id,
      'Quote Expired',
      `Quote #${q.quote_number} has automatically expired (valid until ${q.valid_until}).`,
      q.id,
    );

    console.log(`[scheduler] auto-expired quote ${q.quote_number}`);
  }
}

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------

async function tick(supabase: SupabaseClient, twilio: TwilioConfig | null) {
  try {
    // Handle recurring invoices each tick
    await handleRecurringInvoices(supabase);

    // Process event-driven scheduled tasks (automation engine)
    try {
      const { processScheduledTasks } = await import('./automationEngine');
      await processScheduledTasks(supabase);
    } catch (err: any) {
      console.error('[scheduler] scheduled tasks processing failed:', err.message);
    }

    // Detect overdue invoices and emit events
    try {
      await detectOverdueInvoices(supabase);
    } catch (err: any) {
      console.error('[scheduler] overdue invoice detection failed:', err.message);
    }

    // Auto-expire quotes past valid_until
    try {
      await expireOverdueQuotes(supabase);
    } catch (err: any) {
      console.error('[scheduler] quote expiry check failed:', err.message);
    }

    // Auto-archive expired quotes older than 30 days
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      await supabase
        .from('quotes')
        .update({ deleted_at: new Date().toISOString() })
        .in('status', ['expired', 'declined'])
        .lt('valid_until', thirtyDaysAgo)
        .is('deleted_at', null);
    } catch (err: any) {
      console.error('[scheduler] quote auto-archive failed:', err.message);
    }

    const { data: automations, error } = await supabase
      .from('automations')
      .select('*')
      .eq('active', true);

    if (error) {
      console.error('[scheduler] failed to fetch automations:', error.message);
      return;
    }
    if (!automations || automations.length === 0) return;

    for (const auto of automations as Automation[]) {
      try {
        switch (auto.trigger) {
          case 'days_after_quote_sent':
            await handleDaysAfterQuoteSent(supabase, auto, twilio);
            break;
          case 'days_before_appointment':
            await handleDaysBeforeAppointment(supabase, auto, twilio);
            break;
          case 'on_invoice_due_date':
            await handleOnInvoiceDueDate(supabase, auto, twilio);
            break;
          case 'days_after_invoice_due':
            await handleDaysAfterInvoiceDue(supabase, auto, twilio);
            break;
          case 'days_after_job_completed':
            await handleDaysAfterJobCompleted(supabase, auto, twilio);
            break;
          case 'custom':
            // Custom triggers are handled externally; skip in scheduler
            break;
          default:
            break;
        }
      } catch (err: any) {
        console.error(`[scheduler] error processing automation "${auto.name}" (${auto.id}):`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[scheduler] unexpected error in tick:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduler(
  supabaseUrl: string,
  serviceRoleKey: string,
  twilio?: { client: any; phoneNumber: string } | null,
) {
  if (intervalHandle) {
    console.warn('[scheduler] already running – skipping duplicate start');
    return;
  }

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[scheduler] missing Supabase credentials – scheduler not started');
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const twilioConfig: TwilioConfig | null =
    twilio && twilio.client && twilio.phoneNumber ? twilio : null;

  console.log('[scheduler] automation scheduler started (interval: 5 min)');

  // Run once immediately, then every 5 minutes
  tick(supabase, twilioConfig);
  intervalHandle = setInterval(() => tick(supabase, twilioConfig), INTERVAL_MS);
}

export function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[scheduler] automation scheduler stopped');
  }
}
