import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  createNotification,
  sendSmsIfConfigured,
  applyTemplate,
} from './notificationHelpers';

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
    .select('id, invoice_number, sent_at, client_id, clients(first_name, last_name, phone)')
    .eq('org_id', automation.org_id)
    .eq('status', 'sent')
    .not('sent_at', 'is', null);

  if (error || !rows) return;

  for (const inv of rows as any[]) {
    if (!inv.sent_at) continue;
    const target = addDelay(new Date(inv.sent_at), automation.delay_value, automation.delay_unit);
    if (target !== today) continue;

    const client = inv.clients as any;
    const clientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
      : 'Client';
    const body = applyTemplate(automation.message_template, {
      client_name: clientName,
      invoice_number: inv.invoice_number,
    });

    await createNotificationDeduped(supabase, automation.org_id, automation.id, automation.name, body, inv.id);
    await sendSmsIfConfigured(twilio, client?.phone, body);
  }
}

async function handleDaysBeforeAppointment(
  supabase: SupabaseClient,
  automation: Automation,
  twilio: TwilioConfig | null,
) {
  // schedule_events where start_time - delay = now (today)
  const today = todayDateString();

  const { data: events, error } = await supabase
    .from('schedule_events')
    .select('id, title, start_time, client_id, clients(first_name, last_name, phone)')
    .eq('org_id', automation.org_id);

  if (error || !events) return;

  for (const evt of events as any[]) {
    if (!evt.start_time) continue;
    const target = subtractDelay(new Date(evt.start_time), automation.delay_value, automation.delay_unit);
    if (target !== today) continue;

    const client = evt.clients as any;
    const clientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
      : 'Client';
    const body = applyTemplate(automation.message_template, {
      client_name: clientName,
      event_title: evt.title,
    });

    await createNotificationDeduped(supabase, automation.org_id, automation.id, automation.name, body, evt.id);
    await sendSmsIfConfigured(twilio, client?.phone, body);
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
    .select('id, invoice_number, due_date, client_id, clients(first_name, last_name, phone)')
    .eq('org_id', automation.org_id)
    .eq('due_date', today)
    .neq('status', 'paid');

  if (error || !invoices) return;

  for (const inv of invoices as any[]) {
    const client = inv.clients as any;
    const clientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
      : 'Client';
    const body = applyTemplate(automation.message_template, {
      client_name: clientName,
      invoice_number: inv.invoice_number,
    });

    await createNotificationDeduped(supabase, automation.org_id, automation.id, automation.name, body, inv.id);
    await sendSmsIfConfigured(twilio, client?.phone, body);
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
    .select('id, invoice_number, due_date, client_id, clients(first_name, last_name, phone)')
    .eq('org_id', automation.org_id)
    .neq('status', 'paid');

  if (error || !invoices) return;

  for (const inv of invoices as any[]) {
    if (!inv.due_date) continue;
    const target = addDelay(new Date(inv.due_date), automation.delay_value, automation.delay_unit);
    if (target !== today) continue;

    const client = inv.clients as any;
    const clientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
      : 'Client';
    const body = applyTemplate(automation.message_template, {
      client_name: clientName,
      invoice_number: inv.invoice_number,
    });

    await createNotificationDeduped(supabase, automation.org_id, automation.id, automation.name, body, inv.id);
    await sendSmsIfConfigured(twilio, client?.phone, body);
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
    .select('id, title, completed_at, client_id, clients(first_name, last_name, phone)')
    .eq('org_id', automation.org_id)
    .eq('status', 'completed')
    .not('completed_at', 'is', null);

  if (error || !jobs) return;

  for (const job of jobs as any[]) {
    if (!job.completed_at) continue;
    const target = addDelay(new Date(job.completed_at), automation.delay_value, automation.delay_unit);
    if (target !== today) continue;

    const client = job.clients as any;
    const clientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
      : 'Client';
    const body = applyTemplate(automation.message_template, {
      client_name: clientName,
      job_title: job.title,
    });

    await createNotificationDeduped(supabase, automation.org_id, automation.id, automation.name, body, job.id);
    await sendSmsIfConfigured(twilio, client?.phone, body);
  }
}

// ---------------------------------------------------------------------------
// Date arithmetic helpers
// ---------------------------------------------------------------------------

function addDelay(date: Date, value: number, unit: 'hours' | 'days'): string {
  const d = new Date(date);
  if (unit === 'days') {
    d.setDate(d.getDate() + value);
  } else {
    d.setHours(d.getHours() + value);
  }
  return d.toISOString().slice(0, 10);
}

function subtractDelay(date: Date, value: number, unit: 'hours' | 'days'): string {
  const d = new Date(date);
  if (unit === 'days') {
    d.setDate(d.getDate() - value);
  } else {
    d.setHours(d.getHours() - value);
  }
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Deduplication: track which (automation_id, reference_id, date) combos
// have already fired so we don't spam within the same day.
// Uses an in-memory set that resets daily.
// ---------------------------------------------------------------------------

let firedKeyDate = '';
const firedKeys = new Set<string>();

function hasFired(automationId: string, refId: string): boolean {
  const today = todayDateString();
  if (firedKeyDate !== today) {
    firedKeys.clear();
    firedKeyDate = today;
  }
  return firedKeys.has(`${automationId}:${refId}`);
}

function markFired(automationId: string, refId: string) {
  const today = todayDateString();
  if (firedKeyDate !== today) {
    firedKeys.clear();
    firedKeyDate = today;
  }
  firedKeys.add(`${automationId}:${refId}`);
}

// Wrap the original createNotification to include dedup
async function createNotificationDeduped(
  supabase: SupabaseClient,
  orgId: string,
  automationId: string,
  automationName: string,
  body: string,
  referenceId?: string,
) {
  const refKey = referenceId || 'no-ref';
  if (hasFired(automationId, refKey)) return;
  markFired(automationId, refKey);
  await createNotification(supabase, orgId, automationName, body, referenceId);
}

// ---------------------------------------------------------------------------
// Recurring invoices
// ---------------------------------------------------------------------------

function computeNextRecurrenceDate(
  fromDate: string,
  interval: string,
): string {
  const d = new Date(fromDate + 'T00:00:00');
  switch (interval) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().slice(0, 10);
}

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

      // Generate a new invoice number suffix
      const suffix = Date.now().toString(36).toUpperCase();
      const newInvoiceNumber = `${inv.invoice_number}-R${suffix}`;

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
        await supabase.from('invoice_items').insert(clonedItems);
      }

      // Update the original invoice's next_recurrence_date
      const nextDate = computeNextRecurrenceDate(
        inv.next_recurrence_date,
        inv.recurrence_interval,
      );
      await supabase
        .from('invoices')
        .update({ next_recurrence_date: nextDate })
        .eq('id', inv.id);

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
      if (hasFired('overdue-detection', dedupKey)) continue;
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
    .in('status', ['sent', 'awaiting_response', 'action_required'])
    .not('valid_until', 'is', null)
    .lt('valid_until', today)
    .is('deleted_at', null);

  if (error || !quotes) return;

  for (const q of quotes as any[]) {
    const dedupKey = `quote-expire:${q.id}`;
    if (hasFired('quote-expiry', dedupKey)) continue;
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
