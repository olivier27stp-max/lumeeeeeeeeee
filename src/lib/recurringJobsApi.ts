/* ═══════════════════════════════════════════════════════════════
   API — Recurring Jobs & Job Templates
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { versDate } from './dateSeule';

// ─── Types ─────────────────────────────────────────────────────

export type RecurrenceFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';

export interface JobTemplate {
  id: string;
  org_id: string;
  created_by: string;
  title: string;
  description: string | null;
  job_type: string;
  line_items: Array<{ name: string; qty: number; unit_price_cents: number }>;
  tags: string[];
  notes: string | null;
  created_at: string;
}

export interface RecurrenceRule {
  id: string;
  job_id: string;
  org_id: string;
  frequency: RecurrenceFrequency;
  interval_days: number;
  day_of_week: number[] | null;
  day_of_month: number | null;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  occurrences_created: number;
  next_run_at: string | null;
  is_active: boolean;
  created_at: string;
}

// ─── Templates ─────────────────────────────────────────────────

export async function fetchJobTemplates(): Promise<JobTemplate[]> {
  const { data, error } = await supabase
    .from('job_templates')
    .select('*')
    .order('title', { ascending: true });
  if (error) {
    console.warn('job_templates fetch failed:', error.message);
    return [];
  }
  return data ?? [];
}

export async function createJobTemplate(template: {
  title: string;
  description?: string;
  job_type?: string;
  line_items?: any[];
  tags?: string[];
  notes?: string;
}): Promise<JobTemplate> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: membership } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership?.org_id) throw new Error('No organization');

  const { data, error } = await supabase
    .from('job_templates')
    .insert({
      org_id: membership.org_id,
      created_by: user.id,
      title: template.title,
      description: template.description ?? null,
      job_type: template.job_type ?? 'one_off',
      line_items: template.line_items ?? [],
      tags: template.tags ?? [],
      notes: template.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteJobTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('job_templates').delete().eq('id', id);
  if (error) throw error;
}

// ─── Recurrence Rules ──────────────────────────────────────────

export async function getRecurrenceRule(jobId: string): Promise<RecurrenceRule | null> {
  const { data, error } = await supabase
    .from('job_recurrence_rules')
    .select('*')
    .eq('job_id', jobId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) {
    console.warn('recurrence rule fetch failed:', error.message);
    return null;
  }
  return data;
}

export async function createRecurrenceRule(rule: {
  job_id: string;
  frequency: RecurrenceFrequency;
  interval_days?: number;
  day_of_week?: number[];
  day_of_month?: number;
  start_date: string;
  end_date?: string;
  max_occurrences?: number;
}): Promise<RecurrenceRule> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: membership } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership?.org_id) throw new Error('No organization');

  // Calculate next_run_at
  const startDate = versDate(rule.start_date);
  const now = new Date();
  const nextRun = startDate > now ? startDate : calculateNextOccurrence(now, rule.frequency, rule.interval_days || 7);

  const { data, error } = await supabase
    .from('job_recurrence_rules')
    .insert({
      job_id: rule.job_id,
      org_id: membership.org_id,
      frequency: rule.frequency,
      interval_days: rule.interval_days ?? getDefaultInterval(rule.frequency),
      day_of_week: rule.day_of_week ?? null,
      day_of_month: rule.day_of_month ?? null,
      start_date: rule.start_date,
      end_date: rule.end_date ?? null,
      max_occurrences: rule.max_occurrences ?? null,
      next_run_at: nextRun.toISOString(),
      is_active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deactivateRecurrenceRule(ruleId: string): Promise<void> {
  const { error } = await supabase
    .from('job_recurrence_rules')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', ruleId);
  if (error) throw error;
}

// ─── Helpers ───────────────────────────────────────────────────

function getDefaultInterval(freq: RecurrenceFrequency): number {
  switch (freq) {
    case 'daily': return 1;
    case 'weekly': return 7;
    case 'biweekly': return 14;
    case 'monthly': return 30;
    case 'custom': return 7;
  }
}

function calculateNextOccurrence(from: Date, freq: RecurrenceFrequency, intervalDays: number): Date {
  const next = new Date(from);
  switch (freq) {
    case 'daily': next.setDate(next.getDate() + 1); break;
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'biweekly': next.setDate(next.getDate() + 14); break;
    case 'monthly': next.setMonth(next.getMonth() + 1); break;
    case 'custom': next.setDate(next.getDate() + intervalDays); break;
  }
  return next;
}
