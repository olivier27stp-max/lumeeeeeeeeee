/**
 * Résolution de libellés pour les rapports (noms de clients, de membres,
 * numéros de job / facture, équipes, tags).
 *
 * Toujours via le client service-role MAIS toujours filtré sur l'org de la
 * requête : on ne résout que des identifiants déjà visibles par l'utilisateur
 * (ils viennent de lignes lues sous RLS), et jamais hors de son org.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReportContext } from './types';

const CHUNK = 200;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

function uniqueIds(values: unknown[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)));
}

export function clientDisplayName(c: { first_name?: string | null; last_name?: string | null; company?: string | null; display_as_company?: boolean | null } | null | undefined): string {
  if (!c) return '';
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  if (c.display_as_company && c.company) return c.company;
  return person || c.company || '';
}

export async function lookupClients(svc: SupabaseClient, orgId: string, ids: unknown[]) {
  const map = new Map<string, { name: string; email: string; company: string }>();
  for (const part of chunks(uniqueIds(ids))) {
    const { data } = await svc
      .from('clients')
      .select('id, first_name, last_name, company, display_as_company, email')
      .eq('org_id', orgId)
      .in('id', part);
    for (const c of data || []) {
      map.set(c.id, { name: clientDisplayName(c), email: c.email || '', company: c.company || '' });
    }
  }
  return map;
}

/** Nom d'affichage des membres : memberships.full_name, repli profiles.full_name. */
export async function lookupMembers(svc: SupabaseClient, orgId: string, ids: unknown[]) {
  const map = new Map<string, string>();
  const wanted = uniqueIds(ids);
  for (const part of chunks(wanted)) {
    const { data } = await svc
      .from('memberships')
      .select('user_id, full_name')
      .eq('org_id', orgId)
      .in('user_id', part);
    for (const m of data || []) if (m.full_name) map.set(m.user_id, m.full_name);
  }
  const missing = wanted.filter((id) => !map.has(id));
  for (const part of chunks(missing)) {
    const { data } = await svc.from('profiles').select('id, full_name').in('id', part);
    for (const p of data || []) map.set(p.id, p.full_name || `Membre ${p.id.slice(0, 6)}`);
  }
  return map;
}

export async function lookupTeams(svc: SupabaseClient, orgId: string, ids: unknown[]) {
  const map = new Map<string, string>();
  for (const part of chunks(uniqueIds(ids))) {
    const { data } = await svc.from('teams').select('id, name').eq('org_id', orgId).in('id', part);
    for (const t of data || []) map.set(t.id, t.name || '');
  }
  return map;
}

export async function lookupJobTags(svc: SupabaseClient, orgId: string, ids: unknown[]) {
  const map = new Map<string, string>();
  for (const part of chunks(uniqueIds(ids))) {
    const { data } = await svc.from('job_tags').select('id, name').eq('org_id', orgId).in('id', part);
    for (const t of data || []) map.set(t.id, t.name || '');
  }
  return map;
}

export async function lookupJobs(svc: SupabaseClient, orgId: string, ids: unknown[]) {
  const map = new Map<string, { job_number: string; client_name: string; property_address: string; client_id: string | null; title: string }>();
  for (const part of chunks(uniqueIds(ids))) {
    const { data } = await svc
      .from('jobs')
      .select('id, job_number, client_name, property_address, client_id, title')
      .eq('org_id', orgId)
      .in('id', part);
    for (const j of data || []) {
      map.set(j.id, {
        job_number: j.job_number || '',
        client_name: j.client_name || '',
        property_address: j.property_address || '',
        client_id: j.client_id || null,
        title: j.title || '',
      });
    }
  }
  return map;
}

export async function lookupInvoices(svc: SupabaseClient, orgId: string, ids: unknown[]) {
  const map = new Map<string, { invoice_number: string; salesperson_id: string | null; client_id: string | null }>();
  for (const part of chunks(uniqueIds(ids))) {
    const { data } = await svc
      .from('invoices')
      .select('id, invoice_number, salesperson_id, client_id')
      .eq('org_id', orgId)
      .in('id', part);
    for (const i of data || []) map.set(i.id, { invoice_number: i.invoice_number || '', salesperson_id: i.salesperson_id || null, client_id: i.client_id || null });
  }
  return map;
}

export async function lookupCommissionRules(svc: SupabaseClient, orgId: string, ids: unknown[]) {
  const map = new Map<string, string>();
  for (const part of chunks(uniqueIds(ids))) {
    const { data } = await svc.from('fs_commission_rules').select('id, name').eq('org_id', orgId).in('id', part);
    for (const r of data || []) map.set(r.id, r.name || '');
  }
  return map;
}

/** Options dynamiques des filtres (membres actifs, équipes, tags de job). */
export async function resolveFilterSource(ctx: ReportContext, source: 'members' | 'teams' | 'jobTags') {
  if (source === 'members') {
    const { data } = await ctx.service
      .from('memberships')
      .select('user_id, full_name, role')
      .eq('org_id', ctx.orgId)
      .eq('status', 'active')
      .limit(300);
    const rows = data || [];
    const missing = rows.filter((m) => !m.full_name).map((m) => m.user_id);
    const profiles = new Map<string, string>();
    if (missing.length) {
      const { data: p } = await ctx.service.from('profiles').select('id, full_name').in('id', missing);
      for (const row of p || []) profiles.set(row.id, row.full_name || '');
    }
    return rows
      .map((m) => ({ value: m.user_id, label: m.full_name || profiles.get(m.user_id) || `Membre ${m.user_id.slice(0, 6)}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  if (source === 'teams') {
    const { data } = await ctx.service
      .from('teams')
      .select('id, name')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('name');
    return (data || []).map((t) => ({ value: t.id, label: t.name || '' }));
  }
  const { data } = await ctx.service
    .from('job_tags')
    .select('id, name')
    .eq('org_id', ctx.orgId)
    .is('deleted_at', null)
    .order('name');
  return (data || []).map((t) => ({ value: t.id, label: t.name || '' }));
}
