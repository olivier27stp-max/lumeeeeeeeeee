/**
 * Recurring Invoices Engine — creates one invoice from a schedule.
 *
 * Uses service-role inserts (rpc_create_invoice_draft relies on auth.uid()
 * + current_org_id() which are unavailable in cron context).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, addMonths, addYears, parseISO, formatISO, isAfter } from 'date-fns';
import { resolveTaxesForOrg, computeTaxLines } from './taxResolve';
import { eventBus } from './eventBus';

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

  /* Les taxes du client, comme sur une facture faite à la main : région du
     client, sinon groupe par défaut du bureau, client exempté = aucune.
     Avant, la facture partait avec tax_cents = 0 et recalculate_invoice_totals
     ne fait que RELIRE la taxe stockée : chaque facture récurrente d'une
     entreprise québécoise sortait sans TPS ni TVQ. */
  const { taxes } = await resolveTaxesForOrg(svc, schedule.org_id, schedule.client_id);
  const lignesTaxes = computeTaxLines(subtotal, taxes);
  const taxCents = lignesTaxes.reduce((s, l) => s + l.amount_cents, 0);

  // invoices.created_by est NOT NULL : sans auteur, CHAQUE échéance échouait
  // (« null value in column created_by », batterie d'exécution du 2026-09-17).
  // L'auteur = le propriétaire de l'org (à défaut, son premier membre actif).
  const { data: proprietaire } = await svc
    .from('memberships')
    .select('user_id, role')
    .eq('org_id', schedule.org_id)
    .eq('status', 'active')
    .order('role', { ascending: true }) // admin < owner < … : on préfère owner ci-dessous
    .limit(20);
  const auteur = (proprietaire || []).find((m: any) => m.role === 'owner')?.user_id ?? proprietaire?.[0]?.user_id ?? null;
  if (!auteur) throw new Error(`Aucun membre actif dans l'org ${schedule.org_id} pour signer la facture récurrente.`);

  // Create invoice
  const { data: invoice, error: invErr } = await svc
    .from('invoices')
    .insert({
      org_id: schedule.org_id,
      client_id: schedule.client_id,
      created_by: auteur,
      invoice_number: invoiceNumber,
      status: 'draft',
      subject: schedule.subject,
      issued_at: null,
      due_date: dueDate,
      subtotal_cents: subtotal,
      tax_cents: taxCents,
      total_cents: subtotal + taxCents,
      paid_cents: 0,
      balance_cents: subtotal + taxCents,
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

  // Ventilation par taxe (TPS / TVQ) : ce que la facture publique et le
  // rapport des taxes lisent. Même forme que saveAppliedTaxes (src/lib/taxApi.ts).
  if (lignesTaxes.length > 0) {
    const { error: taxErr } = await svc.from('applied_taxes').insert(lignesTaxes.map((l, idx) => ({
      document_type: 'invoice',
      document_id: invoice.id,
      tax_config_id: l.tax_config_id,
      name: l.name,
      rate: l.rate,
      amount_cents: l.amount_cents,
      is_compound: l.is_compound,
      sort_order: idx,
    })));
    if (taxErr) {
      console.error(`[recurring-invoices] applied_taxes failed for invoice ${invoice.id} (schedule ${schedule.id}):`, taxErr.message);
    }
  }

  // Recalculate totals (handles taxes / triggers)
  // supabase-js ne leve pas : l'erreur doit etre lue, sinon une facture aux
  // totaux faux (taxes absentes) part chez le client sans aucune trace.
  const { error: totalsErr } = await svc.rpc('recalculate_invoice_totals', { p_invoice_id: invoice.id });
  if (totalsErr) {
    console.error(`[recurring-invoices] recalculate_invoice_totals failed for invoice ${invoice.id} (schedule ${schedule.id}):`, totalsErr.message);
  }

  /* auto_send : la facture part VRAIMENT chez le client.
     Avant, on posait seulement status « sent » : aucun courriel ne partait,
     mais la facture passait pour envoyée et les relances de retard visaient
     un client qui ne l'avait jamais reçue. On passe par l'action
     « envoyer_facture » des automatisations, qui porte déjà le
     désabonnement, le gabarit de l'entreprise et la journalisation. La
     facture n'est marquée envoyée QUE si le courriel est parti ; sinon elle
     reste en brouillon, visible dans les factures à envoyer. */
  if (schedule.auto_send) {
    const envoi = await envoyerParCourriel(svc, schedule, invoice.id);
    if (envoi.ok) {
      const nowIso = new Date().toISOString();
      const { error: sendErr } = await svc.from('invoices')
        .update({ status: 'sent', issued_at: nowIso, sent_at: nowIso })
        .eq('id', invoice.id);
      if (sendErr) {
        console.error(`[recurring-invoices] auto_send flag failed for invoice ${invoice.id} (schedule ${schedule.id}):`, sendErr.message);
      } else {
        eventBus.emit('invoice.sent', {
          orgId: schedule.org_id,
          entityType: 'invoice',
          entityId: invoice.id,
          relatedEntityType: 'client',
          relatedEntityId: schedule.client_id,
          metadata: { invoice_number: invoice.invoice_number, client_id: schedule.client_id, recurring_schedule_id: schedule.id },
        });
      }
    } else {
      console.error(`[recurring-invoices] auto_send : courriel non parti pour la facture ${invoice.id} (schedule ${schedule.id}), laissée en brouillon :`, envoi.error);
    }
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

/** Envoie la facture par courriel au client (action « envoyer_facture »). */
async function envoyerParCourriel(
  svc: SupabaseClient,
  schedule: RecurringSchedule,
  invoiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Import dynamique : actions/ importe les routes de courriel, inutile de
    // les charger pour les échéances sans envoi automatique.
    const { executeEnvoyerFacture, resolveEntityVariables } = await import('./actions');
    const { getBaseUrl } = await import('./config');
    const vars = await resolveEntityVariables(svc, schedule.org_id, 'invoice', invoiceId);
    const { data: cs } = await svc.from('company_settings').select('default_language').eq('org_id', schedule.org_id).maybeSingle();
    const r = await executeEnvoyerFacture({}, vars, {
      supabase: svc,
      orgId: schedule.org_id,
      entityType: 'invoice',
      entityId: invoiceId,
      twilio: null,
      baseUrl: getBaseUrl(),
      langue: cs?.default_language === 'en' ? 'en' : 'fr',
    });
    return r.success ? { ok: true } : { ok: false, error: r.error || 'envoi refusé' };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
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
