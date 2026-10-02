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
  OVERDUE_DAYS,
} from './scheduler-utils';
import { logger } from './logger';

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
/** File planifiée : au plus 20 lots (1 000 tâches) et 3 min par tick. */
export const LOTS_MAX_PAR_TICK = 20;
export const BUDGET_FILE_MS = 3 * 60 * 1000;

/**
 * Dépile la file planifiée lot après lot, tant qu'un lot revient plein, dans
 * les bornes ci-dessus. Renvoie le nombre de lots passés. `filtre` : la suite
 * de tests limite le passage à ses bureaux (le serveur n'en passe jamais).
 */
export async function viderFile(
  supabase: SupabaseClient,
  filtre: { orgId?: string; orgIds?: string[] } = {},
): Promise<number> {
  const { processScheduledTasks, TACHES_PAR_LOT } = await import('./automationEngine');
  const debut = Date.now();
  let lot = 0;
  while (lot < LOTS_MAX_PAR_TICK) {
    lot++;
    const lues = await processScheduledTasks(supabase, filtre);
    if (lues < TACHES_PAR_LOT || Date.now() - debut > BUDGET_FILE_MS) break;
  }
  return lot;
}

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

      logger.info(`[scheduler] cloned recurring invoice ${inv.invoice_number} -> ${newInvoiceNumber}`);
    } catch (err: any) {
      console.error(`[scheduler] error processing recurring invoice ${inv.id}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Overdue invoice detection — emits invoice.overdue events
// ---------------------------------------------------------------------------

/** Le jour (AAAA-MM-JJ) dans un fuseau donné. */
function jourDans(fuseau: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export async function detectOverdueInvoices(supabase: SupabaseClient, options: { orgId?: string } = {}) {
  /*
   * Launch 2026-09-28.
   *   · PAGINÉ : PostgREST plafonne une réponse (souvent 1 000 lignes) SANS
   *     erreur — au-delà, des factures en retard n'étaient jamais vues.
   *   · « Aujourd'hui » dans le FUSEAU DE L'ENTREPRISE : en UTC, une facture
   *     due hier à Montréal passait « en retard » à 20 h la veille, et les
   *     jalons J+x tombaient le mauvais jour.
   * Borne large (lendemain UTC) pour la requête ; le vrai tri se fait par
   * entreprise, dans son fuseau.
   */
  const borne = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const invoices: any[] = [];
  const PAGE = 1000;
  for (let de = 0; ; de += PAGE) {
    // `options.orgId` : une seule entreprise (suite d'intégration, bureau de test).
    const base = options.orgId
      ? supabase.from('invoices').select('id, org_id, invoice_number, due_date, client_id').eq('org_id', options.orgId)
      : supabase.from('invoices').select('id, org_id, invoice_number, due_date, client_id');
    const { data, error } = await base
      // Liste POSITIVE, comme le cron des relances : un brouillon n'a jamais
      // été reçu par le client — « votre facture est en retard » serait faux
      // (audit V2, D-05 ; 4 brouillons échus en prod au 2026-09-30).
      .in('status', ['sent', 'partial'])
      .not('due_date', 'is', null)
      .lt('due_date', borne)
      .is('deleted_at', null)
      .order('id')
      .range(de, de + PAGE - 1);
    if (error) {
      console.error('[scheduler] factures en retard illisibles:', error.message);
      return;
    }
    invoices.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  if (invoices.length === 0) return;

  const { eventBus } = await import('./eventBus');
  const { fuseauOrg } = await import('./automations-fuseau-org');
  const aujourdhuiParOrg = new Map<string, string>();
  for (const orgId of new Set(invoices.map((inv) => inv.org_id as string))) {
    aujourdhuiParOrg.set(orgId, jourDans(await fuseauOrg(supabase, orgId)));
  }
  const joursDeRetard = (inv: any) => {
    const aujourdhui = aujourdhuiParOrg.get(inv.org_id) ?? new Date().toISOString().slice(0, 10);
    return Math.round((Date.parse(aujourdhui + 'T00:00:00Z') - Date.parse(inv.due_date + 'T00:00:00Z')) / 86_400_000);
  };

  // Only emit on specific days to match preset conditions
  const candidates = invoices.filter(
    (inv) => inv.due_date && joursDeRetard(inv) > 0 && (OVERDUE_DAYS as readonly number[]).includes(joursDeRetard(inv)),
  );
  if (candidates.length === 0) return;

  // Anti-doublon durable : le cache en mémoire se vide à chaque redéploiement
  // (et n'est pas partagé entre instances). Une journée à 40 déploiements a
  // ainsi écrit 40 « Facture en retard » identiques sur la même facture.
  // activity_log est la preuve de ce qui a déjà été émis.
  const dejaJournalise = new Set<string>();
  const ids = candidates.map((inv) => inv.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: lignes, error: errLog } = await supabase
      .from('activity_log')
      .select('entity_id, metadata')
      .eq('event_type', 'invoice_overdue')
      .in('entity_id', ids.slice(i, i + 200));
    if (errLog) {
      // Fail-closed : l'événement est ré-émis au prochain tick, un doublon
      // resterait par contre visible à vie dans l'historique.
      console.error('[scheduler] anti-doublon retard illisible:', errLog.message);
      return;
    }
    for (const l of (lignes || []) as any[]) {
      dejaJournalise.add(`${l.entity_id}:${l.metadata?.days_overdue}`);
    }
  }

  for (const inv of candidates) {
    const daysOverdue = joursDeRetard(inv);
    if (dejaJournalise.has(`${inv.id}:${daysOverdue}`)) continue;
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

// ---------------------------------------------------------------------------
// « Date atteinte » — filet horaire du balayage quotidien (B-18)
// ---------------------------------------------------------------------------

/** Le tick rebalaie les dates au plus une fois par heure. */
export const INTERVALLE_BALAYAGE_DATES_MS = 60 * 60 * 1000;
let dernierBalayageDates = 0;

/**
 * Verrou partagé avec `POST /api/cron/rappels-dates` : le cron et le tick ne
 * balaient jamais en même temps (l'anti-doublon du balayage LIT ce qui est
 * déjà parti — deux passages simultanés ne se verraient pas).
 */
export const VERROU_RAPPELS_DATES = 'cron-rappels-dates';

async function balayerDatesSiDu(supabase: SupabaseClient, maintenant: number = Date.now()): Promise<void> {
  if (maintenant - dernierBalayageDates < INTERVALLE_BALAYAGE_DATES_MS) return;
  const { automatisationsActives } = await import('./automations-interrupteur');
  // Arrêt global : rien n'est émis (les événements seraient perdus). Les
  // dates de ces jours-là seront rattrapées à la reprise.
  if (!automatisationsActives()) return;
  dernierBalayageDates = maintenant;
  const { balayerRappelsDates } = await import('./rappels-dates');
  const { withAdvisoryLock } = await import('./advisory-lock');
  const { acquired, result } = await withAdvisoryLock(VERROU_RAPPELS_DATES, () =>
    balayerRappelsDates(supabase, new Date(maintenant), { enJournee: true }));
  if (!acquired) {
    // Le cron (ou une autre instance) balaie en ce moment : on repassera au tick suivant.
    dernierBalayageDates = 0;
    return;
  }
  if (result && (result.emis > 0 || result.erreurs > 0)) {
    logger.info('[scheduler] rappels sur date (filet horaire)', { ...result });
  }
}

// ---------------------------------------------------------------------------
// Relances de paiement — filet horaire du cron quotidien (point 11, B-08)
// ---------------------------------------------------------------------------

let dernieresRelancesPaiement = 0;

/**
 * Une fois par heure, sous le MÊME verrou que la route du cron
 * (`cron-payment-reminders`) : les entreprises dont c'est la première heure
 * d'envoi (8 h chez elles) sont relancées. Le journal `reminder_log` porte
 * l'idempotence : une facture déjà relancée à ce palier ne l'est pas deux fois.
 */
async function relancesDePaiementSiDu(maintenant: number = Date.now()): Promise<void> {
  if (maintenant - dernieresRelancesPaiement < INTERVALLE_BALAYAGE_DATES_MS) return;
  dernieresRelancesPaiement = maintenant;
  const { resolvePublicBaseUrl } = await import('./helpers');
  let publicBase = '';
  try {
    publicBase = resolvePublicBaseUrl();
  } catch (e: unknown) {
    // Sans adresse publique, le lien de paiement du courriel serait faux : on ne relance pas d'ici.
    logger.warn('[scheduler] relances de paiement : adresse publique inconnue — filet horaire sauté', { message: e instanceof Error ? e.message : String(e) });
    return;
  }
  const { executerRelancesPaiement } = await import('../routes/reminders-cron');
  const { withAdvisoryLock } = await import('./advisory-lock');
  const { acquired, result } = await withAdvisoryLock('cron-payment-reminders', () =>
    executerRelancesPaiement({ publicBase, premiereHeureSeulement: true }));
  if (!acquired) {
    dernieresRelancesPaiement = 0;
    return;
  }
  if (result && (result.sent > 0 || result.failed > 0)) {
    logger.info('[scheduler] relances de paiement (filet horaire)', { processed: result.processed, sent: result.sent, failed: result.failed });
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

    logger.info(`[scheduler] auto-expired quote ${q.quote_number}`);
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
    //
    // Par LOTS, tant qu'un lot revient plein : un seul lot de 50 par tick de
    // 5 min plafonnait la plateforme à 600 tâches/heure pour TOUTES les
    // entreprises (mesure de charge M-004) — une campagne d'une seule
    // entreprise retardait les rappels de toutes les autres. Bornes : 3 min
    // (le tick fait d'autres choses, et le verrou dure 10 min) et 20 lots.
    try {
      await viderFile(supabase);
    } catch (err: any) {
      console.error('[scheduler] scheduled tasks processing failed:', err.message);
    }

    // Les événements émis juste avant un redémarrage, jamais traités : sans
    // ce rejeu, leurs confirmations et relances ne partaient jamais.
    try {
      const { rejouerEvenementsOrphelins, menageOutbox } = await import('./outbox');
      await rejouerEvenementsOrphelins(supabase);
      await menageOutbox(supabase);
    } catch (err: any) {
      console.error('[scheduler] outbox replay failed:', err.message);
    }

    // Le pipeline de ventes : sa file d'événements, puis les deals qui dorment.
    //
    // La file AVANT la détection, volontairement : un deal qui vient de
    // changer d'étape ne doit pas être signalé « sans activité » dans le même
    // tick par un état qu'on n'a pas encore consommé.
    try {
      const { traiterEvenementsPipeline, detecterStagnation } = await import('./pipelineEvenements');
      await traiterEvenementsPipeline(supabase);
      await detecterStagnation(supabase);
    } catch (err: any) {
      console.error('[scheduler] pipeline events processing failed:', err.message);
    }

    // Detect overdue invoices and emit events
    try {
      await detectOverdueInvoices(supabase);
    } catch (err: any) {
      console.error('[scheduler] overdue invoice detection failed:', err.message);
    }

    // « Date atteinte » : filet du cron quotidien (B-18). Le balayage est
    // idempotent (une émission par règle, fiche et date) : le rejouer chaque
    // heure rattrape un passage que pg_cron a manqué, sans rien doubler.
    try {
      await balayerDatesSiDu(supabase);
    } catch (err: any) {
      console.error('[scheduler] balayage des dates échoué:', err.message);
    }

    // Relances de paiement : filet horaire du cron quotidien (point 11). Le
    // cron part à 13:00 UTC pour tout le monde ; une entreprise pour qui il
    // est alors la nuit est sautée, et relancée ici à sa première heure d'envoi.
    try {
      await relancesDePaiementSiDu();
    } catch (err: any) {
      console.error('[scheduler] relances de paiement (filet horaire) échouées:', err.message);
    }

    // Auto-expire quotes past valid_until
    try {
      await expireOverdueQuotes(supabase);
    } catch (err: any) {
      console.error('[scheduler] quote expiry check failed:', err.message);
    }

    // Ménage du bucket des champs « Fichier », une fois par jour : ce que ni le
    // remplacement ni le retrait depuis une fiche n'ont pu nettoyer (création
    // abandonnée, fiche supprimée). Volontairement rare et plafonné.
    try {
      if (Date.now() - dernierMenageFichiers > 86_400_000) {
        dernierMenageFichiers = Date.now();
        const { menageFichiersChamps } = await import('./champs/menageFichiers');
        await menageFichiersChamps(supabase);
      }
    } catch (err: any) {
      console.error('[scheduler] ménage des fichiers de champs échoué:', err.message);
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
    tickInterrompu = true;
  }
}

/** Vrai si le dernier tick a été interrompu par une erreur inattendue : sa trace « terminé » n'est pas écrite. */
let tickInterrompu = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let intervalHandle: ReturnType<typeof setInterval> | null = null;
/** Dernier ménage du bucket des champs « Fichier » (une fois par jour). */
let dernierMenageFichiers = 0;

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

  logger.info('[scheduler] automation scheduler started (interval: 5 min)');

  // Événements écrits par la base (bloc 2 du launch) : lus toutes les 15 s,
  // pas au tick de 5 min — une confirmation de rendez-vous n'attend pas.
  void import('./evenementsBase').then(({ demarrerEvenementsBase }) => demarrerEvenementsBase(supabase))
    .catch((e: unknown) => logger.error('[scheduler] file des événements de la base non démarrée', { message: e instanceof Error ? e.message : String(e) }));

  // Run once immediately, then every 5 minutes
  void tickProtege(supabase, twilioConfig);
  intervalHandle = setInterval(() => void tickProtege(supabase, twilioConfig), INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Surveillance du tick (B-19)
// ---------------------------------------------------------------------------
//
// Le tick est le seul à écrire aux clients, et rien ne disait qu'il tournait :
// figé, les relances s'arrêtaient en silence. Trois traces maintenant :
//   1. chaque tick TERMINÉ écrit son heure de début et de fin dans
//      `cron_locks` (ligne dédiée, jamais un verrou : ses deux dates sont
//      passées) — lisible par `etatDuTick()`, donc par /api/health ;
//   2. un passage Sentry (`withCronCheckIn`) : Sentry alerte sur un tick qui
//      plante ET sur un tick qui ne vient plus (« missed check-in »), une fois
//      le moniteur `automation-scheduler` créé de son côté ;
//   3. une ligne d'ERREUR si un tick dépasse le bail de son verrou (10 min,
//      `try_advisory_lock`) : au-delà, une seconde instance peut le doubler.

/** Bail du verrou distribué (`try_advisory_lock` : 10 minutes). */
export const BAIL_TICK_MS = 10 * 60 * 1000;
/** Au-delà de cet âge, le dernier tick terminé est tenu pour « en retard ». */
export const TICK_EN_RETARD_MS = 2 * INTERVAL_MS + BAIL_TICK_MS;
const NOM_TRACE_TICK = 'automation-scheduler:dernier-tick';

/** Même hachage que `advisory-lock.ts` (clé bigint de `cron_locks`). */
function cleDeTrace(nom: string): number {
  let h = 5381;
  for (let i = 0; i < nom.length; i++) h = ((h << 5) + h + nom.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Écrit la trace du tick qui vient de finir. Ne lève jamais. */
export async function noterTickTermine(supabase: SupabaseClient, debutMs: number, finMs: number = Date.now()): Promise<void> {
  try {
    const { error } = await supabase.from('cron_locks').upsert(
      { key: cleDeTrace(NOM_TRACE_TICK), locked_at: new Date(debutMs).toISOString(), locked_until: new Date(finMs).toISOString() },
      { onConflict: 'key' },
    );
    if (error) logger.error('[scheduler] trace du tick non écrite', { message: error.message });
  } catch (e: unknown) {
    logger.error('[scheduler] trace du tick non écrite', { message: e instanceof Error ? e.message : String(e) });
  }
}

export interface EtatDuTick {
  /** Début et fin du dernier tick TERMINÉ (ISO), ou null s'il n'y en a jamais eu. */
  dernier_tick_debut: string | null;
  dernier_tick_fin: string | null;
  duree_ms: number | null;
  /** Secondes écoulées depuis la fin du dernier tick. */
  age_s: number | null;
  /** Vrai si aucun tick n'a fini depuis TICK_EN_RETARD_MS (ou jamais) : le planificateur est figé ou arrêté. */
  en_retard: boolean;
}

/** Pur : l'état à partir de la trace lue. */
export function etatDepuisTrace(trace: { locked_at?: string | null; locked_until?: string | null } | null, maintenantMs: number = Date.now()): EtatDuTick {
  const debut = trace?.locked_at ? Date.parse(trace.locked_at) : NaN;
  const fin = trace?.locked_until ? Date.parse(trace.locked_until) : NaN;
  if (!Number.isFinite(fin)) return { dernier_tick_debut: null, dernier_tick_fin: null, duree_ms: null, age_s: null, en_retard: true };
  return {
    dernier_tick_debut: Number.isFinite(debut) ? new Date(debut).toISOString() : null,
    dernier_tick_fin: new Date(fin).toISOString(),
    duree_ms: Number.isFinite(debut) ? Math.max(0, fin - debut) : null,
    age_s: Math.max(0, Math.round((maintenantMs - fin) / 1000)),
    en_retard: maintenantMs - fin > TICK_EN_RETARD_MS,
  };
}

/** Le dernier tick terminé, lu en base (toutes instances confondues). Pour /api/health. */
export async function etatDuTick(supabase: SupabaseClient, maintenantMs: number = Date.now()): Promise<EtatDuTick> {
  const { data, error } = await supabase
    .from('cron_locks').select('locked_at, locked_until').eq('key', cleDeTrace(NOM_TRACE_TICK)).maybeSingle();
  if (error) throw new Error(error.message);
  return etatDepuisTrace(data as { locked_at?: string | null; locked_until?: string | null } | null, maintenantMs);
}

/** Dit fort qu'un tick a dépassé le bail de son verrou. */
function signalerTickTropLong(dureeMs: number, encoreEnCours: boolean): void {
  const minutes = Math.round(dureeMs / 60_000);
  const message = encoreEnCours
    ? `[scheduler] tick encore en cours après ${minutes} min : le bail du verrou (${BAIL_TICK_MS / 60_000} min) est dépassé, une autre instance peut le doubler`
    : `[scheduler] tick terminé en ${minutes} min : il a dépassé le bail du verrou (${BAIL_TICK_MS / 60_000} min)`;
  logger.error(message, { duree_ms: dureeMs });
  void import('./sentry').then(({ captureCronFailure }) => captureCronFailure('automation-scheduler', new Error(message))).catch(() => undefined);
}

/** Vrai pendant qu'un tick est en cours dans CE processus. */
let tickEnCours = false;

/**
 * Exécute un tick sous double protection.
 *
 * 1. `tickEnCours` — garde locale. `setInterval` relance toutes les 5 minutes
 *    sans se soucier de la durée du tick précédent ; un tick long (les
 *    handlers font une requête `clients` par ligne) se faisait doubler par le
 *    suivant.
 * 2. `withAdvisoryLock` — garde distribuée. Tous les autres crons du produit
 *    l'utilisent déjà ; celui-ci, qui est pourtant le seul à ENVOYER aux
 *    clients, en était dépourvu. Avec deux instances, chaque message partait
 *    en double.
 *
 * Le nom du verrou est stable : il identifie le travail, pas l'instance.
 */
async function tickProtege(supabase: SupabaseClient, twilio: TwilioConfig | null) {
  if (tickEnCours) {
    console.warn('[scheduler] tick précédent encore en cours — passage ignoré');
    return;
  }
  tickEnCours = true;
  const debut = Date.now();
  // Le tick qui ne finit pas : on le dit pendant qu'il dure, pas seulement après.
  const alarme = setTimeout(() => signalerTickTropLong(Date.now() - debut, true), BAIL_TICK_MS);
  alarme.unref?.();
  try {
    const { withAdvisoryLock } = await import('./advisory-lock');
    const { withCronCheckIn } = await import('./sentry');
    const { acquired } = await withAdvisoryLock('automation-scheduler', () =>
      withCronCheckIn('automation-scheduler', async () => {
        tickInterrompu = false;
        await tick(supabase, twilio);
        // Un tick coupé par une erreur inattendue n'est pas « terminé » : Sentry le reçoit, la trace n'avance pas.
        if (tickInterrompu) throw new Error('tick interrompu par une erreur inattendue (voir le journal du serveur)');
        // Dans le verrou : la trace est celle du tick qui a vraiment tourné.
        await noterTickTermine(supabase, debut);
      }));
    if (!acquired) {
      logger.info('[scheduler] tick pris par une autre instance — passage ignoré');
    } else if (Date.now() - debut > BAIL_TICK_MS) {
      signalerTickTropLong(Date.now() - debut, false);
    }
  } catch (err: any) {
    console.error('[scheduler] tick échoué:', err?.message);
  } finally {
    clearTimeout(alarme);
    tickEnCours = false;
  }
}

export function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('[scheduler] automation scheduler stopped');
  }
}
