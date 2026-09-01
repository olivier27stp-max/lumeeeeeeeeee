/**
 * Job expenses — itemized expense lines per job + reusable org catalog
 * (expense_presets, same idea as predefined_services for products/services).
 * jobs.expenses_cents is kept in sync by a DB trigger (SUM of active lines),
 * so the Profitability card keeps working unchanged.
 *
 * Requires migration 20260831000000_job_expenses_catalogue. Until it is
 * applied the tables don't exist: callers detect that via
 * isMissingExpensesTable(err) and fall back to the legacy single amount.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export type ExpenseCategory = 'materiaux' | 'essence' | 'sous_traitance' | 'equipement' | 'autre';

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; fr: string; en: string }[] = [
  { value: 'materiaux', fr: 'Matériaux & produits', en: 'Materials & supplies' },
  { value: 'essence', fr: 'Essence & déplacement', en: 'Fuel & travel' },
  { value: 'sous_traitance', fr: 'Sous-traitance', en: 'Subcontracting' },
  { value: 'equipement', fr: 'Équipement', en: 'Equipment' },
  { value: 'autre', fr: 'Autre', en: 'Other' },
];

export function expenseCategoryLabel(value: string, fr: boolean): string {
  const cat = EXPENSE_CATEGORIES.find((c) => c.value === value);
  return cat ? (fr ? cat.fr : cat.en) : value;
}

export interface JobExpense {
  id: string;
  job_id: string;
  preset_id: string | null;
  name: string;
  category: ExpenseCategory;
  amount_cents: number;
  vendor: string | null;
  note: string | null;
  incurred_on: string; // YYYY-MM-DD
  created_at: string;
}

export interface ExpensePreset {
  id: string;
  name: string;
  category: ExpenseCategory;
  default_amount_cents: number | null;
  vendor: string | null;
}

/** True when the error means the migration hasn't been applied yet. */
export function isMissingExpensesTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  return /job_expenses|expense_presets/.test(e.message || '') && /not (exist|find)/i.test(e.message || '');
}

const EXPENSE_COLS = 'id, job_id, preset_id, name, category, amount_cents, vendor, note, incurred_on, created_at';

export async function fetchJobExpenses(jobId: string): Promise<JobExpense[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('job_expenses')
    .select(EXPENSE_COLS)
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('incurred_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as JobExpense[];
}

export async function addJobExpense(input: {
  job_id: string;
  name: string;
  category: ExpenseCategory;
  amount_cents: number;
  preset_id?: string | null;
  vendor?: string | null;
  note?: string | null;
  incurred_on?: string;
}): Promise<JobExpense> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('job_expenses')
    .insert({
      org_id: orgId,
      job_id: input.job_id,
      preset_id: input.preset_id || null,
      name: input.name,
      category: input.category,
      amount_cents: Math.max(0, Math.round(input.amount_cents)),
      vendor: input.vendor || null,
      note: input.note || null,
      ...(input.incurred_on ? { incurred_on: input.incurred_on } : {}),
    })
    .select(EXPENSE_COLS)
    .single();
  if (error) throw error;
  return data as JobExpense;
}

export async function removeJobExpense(id: string): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase
    .from('job_expenses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId);
  if (error) throw error;
}

export async function listExpensePresets(): Promise<ExpensePreset[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('expense_presets')
    .select('id, name, category, default_amount_cents, vendor')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('name');
  if (error) throw error;
  return (data || []) as ExpensePreset[];
}

export async function createExpensePreset(input: {
  name: string;
  category: ExpenseCategory;
  default_amount_cents?: number | null;
  vendor?: string | null;
}): Promise<ExpensePreset> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('expense_presets')
    .insert({
      org_id: orgId,
      name: input.name,
      category: input.category,
      default_amount_cents: input.default_amount_cents ?? null,
      vendor: input.vendor || null,
    })
    .select('id, name, category, default_amount_cents, vendor')
    .single();
  if (error) throw error;
  return data as ExpensePreset;
}

export async function removeExpensePreset(id: string): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase
    .from('expense_presets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId);
  if (error) throw error;
}
