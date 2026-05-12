/**
 * Recurring Invoices Engine — creates one invoice from a schedule.
 *
 * Uses service-role inserts (rpc_create_invoice_draft relies on auth.uid()
 * + current_org_id() which are unavailable in cron context).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, addMonths, addYears, parseISO, formatISO, isAfter } from 'date-fns';

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringSchedule {
  id: string;
  org_id: string;
  client_id: string;
  subject: string;
  items: Array<{ description: string; qty: number; unit_price_cents: number }>;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  due_days_offset: number;
  auto_send: boolean;
  is_active: boolean;
}

export function computeNextRunDate(from: string, freq: Frequency): string {
  const d = parseISO(from);
  switch (freq) {
    case 'weekly': return formatISO(addDays(d, 7), { representation: 'date' });
    case 'biweekly': return formatISO(addDays(d, 14), { representation: 'date' });
    case 'monthly': return formatISO(addMonths(d, 1), { representation: 'date' });
    case 'quarterly': return formatISO(addMonths(d, 3), { representation: 'date' });
    case 'yearly': return formatISO(addYears(d, 1), { representation: 'date' });
  }
}

/** Allocate a new invoice number for this org via the SECURITY DEFINER RPC. */
async function nextInvoiceNumber(svc: SupabaseClient, orgId: string): Promise<string> {
  const { data, error } = await svc.rpc('invoice_next_number', { p_org: orgId });
  if (error) throw error;
  return String(data || '');
}

export interface RunResult {
  invoice_id: string;
  invoice_number: string;
  advanced_to: string | null;
  deactivated: boolean;
}

/**
 * Create an invoice from a schedule. If `advance=true`, also bumps next_run_date.
 */
export async function runOneSchedule(
  svc: SupabaseClient,
  schedule: RecurringSchedule,
  opts: { advance: boolean } = { advance: true },
): Promise<RunResult> {
  const today = formatISO(new Date(), { representation: 'date' });
  const invoiceNumber = await nextInvoiceNumber(svc, schedule.org_id);

  // Compute due_date = issue_date + offset days
  const dueDate = formatISO(addDays(parseISO(today), schedule.due_days_offset), { representation: 'date' });

  const items = Array.isArray(schedule.items) ? schedule.items : [];
  const subtotal = items.reduce(
    (sum, it) => sum + Math.round(Number(it.qty || 0) * Number(it.unit_price_cents || 0)),
    0,
  );

  // Create invoice
  const { data: invoice, error: invErr } = await svc
    .from('invoices')
    .insert({
      org_id: schedule.org_id,
      client_id: schedule.client_id,
      invoice_number: invoiceNumber,
      status: 'draft',
      subject: schedule.subject,
      issued_at: null,
      due_date: dueDate,
      subtotal_cents: subtotal,
      tax_cents: 0,
      total_cents: subtotal,
      paid_cents: 0,
      balance_cents: subtotal,
    })
    .select('id, invoice_number')
    .single();
  if (invErr) throw invErr;

  // Insert items
  if (items.length > 0) {
    const itemRows = items.map((it) => ({
      org_id: schedule.org_id,
      invoice_id: invoice.id,
      description: (it.description || 'Item').trim(),
      qty: Math.max(0, Number(it.qty || 0)),
      unit_price_cents: Math.max(0, Math.round(Number(it.unit_price_cents || 0))),
    }));
    const { error: itemsErr } = await svc.from('invoice_items').insert(itemRows);
    if (itemsErr) throw itemsErr;
  }

  // Recalculate totals (handles taxes / triggers)
  try {
    await svc.rpc('recalculate_invoice_totals', { p_invoice_id: invoice.id });
  } catch { /* non-fatal */ }

  // auto_send: mark as sent (issued_at set) — actual email delivery is best
  // handled by the existing invoice reminder/email pipeline keyed off issued_at.
  // The /api/emails/send-invoice route requires an authed user; the cron context
  // has none. For V1, flagging issued_at + sent_at signals the reminders engine
  // which can fan out the email via its own service-role mailer flow.
  if (schedule.auto_send) {
    try {
      const nowIso = new Date().toISOString();
      await svc.from('invoices')
        .update({ status: 'sent', issued_at: nowIso, sent_at: nowIso })
        .eq('id', invoice.id);
    } catch { /* non-fatal */ }
  }

  // Advance next_run_date if requested
  let advancedTo: string | null = null;
  let deactivated = false;
  const updates: Record<string, any> = {
    last_invoice_id: invoice.id,
    last_run_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (opts.advance) {
    const nextRun = computeNextRunDate(schedule.next_run_date, schedule.frequency);
    advancedTo = nextRun;
    updates.next_run_date = nextRun;
    if (schedule.end_date && isAfter(parseISO(nextRun), parseISO(schedule.end_date))) {
      updates.is_active = false;
      deactivated = true;
    }
  }
  const { error: updErr } = await svc
    .from('recurring_invoice_schedules')
    .update(updates)
    .eq('id', schedule.id);
  if (updErr) throw updErr;

  return {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    advanced_to: advancedTo,
    deactivated,
  };
}

/** Find all schedules due to run today (or earlier) and run them. */
export async function runDueSchedules(svc: SupabaseClient): Promise<{
  processed: number;
  errors: number;
  results: Array<{ schedule_id: string; ok: boolean; error?: string; invoice_id?: string }>;
}> {
  const today = formatISO(new Date(), { representation: 'date' });
  const { data: rows, error } = await svc
    .from('recurring_invoice_schedules')
    .select('*')
    .eq('is_active', true)
    .lte('next_run_date', today);
  if (error) throw error;

  const due = (rows || []).filter(
    (r: any) => !r.end_date || r.end_date >= today,
  ) as RecurringSchedule[];

  const results: Array<{ schedule_id: string; ok: boolean; error?: string; invoice_id?: string }> = [];
  let processed = 0;
  let errors = 0;
  for (const sched of due) {
    try {
      const r = await runOneSchedule(svc, sched, { advance: true });
      processed++;
      results.push({ schedule_id: sched.id, ok: true, invoice_id: r.invoice_id });
    } catch (err: any) {
      errors++;
      results.push({ schedule_id: sched.id, ok: false, error: err?.message || 'Unknown error' });
    }
  }
  return { processed, errors, results };
}
