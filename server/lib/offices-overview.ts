/**
 * Vue d'ensemble des bureaux — les chiffres de chaque bureau d'un propriétaire,
 * côte à côte, et leur total.
 *
 * Chaque bureau est lu AVEC L'IDENTITÉ du propriétaire et l'en-tête de CE
 * bureau (x-lume-org) : la RLS et le filtre « bureau actif » s'appliquent
 * comme sur la page Rapports du bureau, et les fonctions appelées sont
 * exactement celles de cette page (rpc_insights_overview,
 * rpc_insights_invoices_summary). Les chiffres sont donc identiques, bureau
 * par bureau, à ce que le propriétaire verrait en changeant de bureau.
 */
import { buildSupabaseWithAuth } from './supabase';

export interface ChiffresBureau {
  revenue_cents: number;
  invoiced_cents: number;
  outstanding_cents: number;
  past_due_count: number;
  new_leads: number;
  converted_quotes: number;
  new_jobs: number;
  requests: number;
  unread_conversations: number;
}

export const CHIFFRES: ReadonlyArray<keyof ChiffresBureau> = [
  'revenue_cents', 'invoiced_cents', 'outstanding_cents', 'past_due_count',
  'new_leads', 'converted_quotes', 'new_jobs', 'requests', 'unread_conversations',
];

const zero = (): ChiffresBureau => Object.fromEntries(CHIFFRES.map((c) => [c, 0])) as unknown as ChiffresBureau;

export function totaliser(bureaux: ChiffresBureau[]): ChiffresBureau {
  const t = zero();
  for (const b of bureaux) for (const c of CHIFFRES) t[c] += Number(b[c]) || 0;
  return t;
}

/** Période AAAA-MM-JJ valide, sinon le mois en cours (même défaut que la page Rapports). */
export function periode(from: unknown, to: unknown, maintenant = new Date()): { from: string; to: string } {
  const jour = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  const debutMois = `${aujourdhui.slice(0, 7)}-01`;
  const a = jour(from) ?? debutMois;
  const b = jour(to) ?? aujourdhui;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export async function chiffresDuBureau(authorization: string, orgId: string, from: string, to: string): Promise<ChiffresBureau> {
  const client = buildSupabaseWithAuth(authorization, orgId);
  const [apercu, factures, conversations] = await Promise.all([
    client.rpc('rpc_insights_overview', { p_org: orgId, p_from: from, p_to: to }),
    client.rpc('rpc_insights_invoices_summary', { p_org: orgId, p_from: from, p_to: to }),
    client.from('conversations').select('id', { count: 'exact', head: true }).eq('org_id', orgId).gt('unread_count', 0),
  ]);
  if (apercu.error) throw apercu.error;
  if (factures.error) throw factures.error;
  if (conversations.error) throw conversations.error;
  const o = (Array.isArray(apercu.data) ? apercu.data[0] : apercu.data) ?? {};
  const f = (Array.isArray(factures.data) ? factures.data[0] : factures.data) ?? {};
  return {
    revenue_cents: Number(o.revenue_cents) || 0,
    invoiced_cents: Number(o.invoiced_value_cents) || 0,
    outstanding_cents: Number(f.total_outstanding_cents) || 0,
    past_due_count: Number(f.count_past_due) || 0,
    new_leads: Number(o.new_leads_count) || 0,
    converted_quotes: Number(o.converted_quotes_count) || 0,
    new_jobs: Number(o.new_oneoff_jobs_count) || 0,
    requests: Number(o.requests_count) || 0,
    unread_conversations: conversations.count ?? 0,
  };
}
